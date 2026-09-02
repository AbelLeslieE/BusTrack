"""Secure webhook receiver and translator for external GPS providers.

The public integration endpoint deliberately accepts the vendor's native JSON.
It translates known fields into BusTrack's internal format while keeping the
complete original object for audit and future provider-specific UI details.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
import hashlib
import json
import math
import re
import secrets
from typing import Any

from fastapi import APIRouter, Body, Depends, Header, HTTPException, Query, Request, status
from sqlalchemy import or_
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.audit import record_audit_event
from backend.models import APIRequestLog, AuditEvent, Bus, Driver, Route, User
from backend.routes.models_tracking import (
    BusGPSState,
    GPSDeviceMapping,
    GPSIngestToken,
    GPSProviderTranslationConfig,
    LiveLocation,
    LiveTrip,
    ProviderGPSPosition,
)
from backend.schemas_gps_provider import (
    GPSDeviceMappingCreate,
    GPSDeviceMappingUpdate,
    GPSIngestTokenCreate,
    GPSIngestTokenUpdate,
    GPSTranslationConfigUpdate,
)
from backend.security import require_driver, require_gps_technician
from backend.services.vehicle_gps import (
    GPS_OFFLINE_GRACE_SECONDS,
    vehicle_gps_expected_interval_seconds,
)
from backend.routes.gps import update_route_stop_progression
from backend.services.trip_direction import direction_from_start_position, ordered_route_stops
from backend.services.telemetry_retention import trim_active_trip_location_history
from backend.models import RouteStop


router = APIRouter(prefix="/api/integrations/gps", tags=["GPS Provider Integration"])

DEFAULT_FIELD_PATHS: dict[str, Any] = {
    "external_device_ids": ["uniqueId", "deviceId", "name", "phone"],
    "latitude": "latitude", "longitude": "longitude", "speed_kmh": "speed",
    "course": "course", "altitude": "altitude", "accuracy": "accuracy",
    "fix_time": "fixTime", "device_time": "deviceTime", "server_time": "serverTime",
    "status": "status", "ignition": "attributes.ignition", "motion": "attributes.motion",
    "valid": "valid", "protocol": "protocol",
}
FIELD_PATH_KEYS = frozenset(DEFAULT_FIELD_PATHS)
FIELD_PATH_PATTERN = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$")


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _as_utc(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed.astimezone(timezone.utc)


def _number(value: Any) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if math.isfinite(parsed) else None


def _boolean(value: Any) -> bool | None:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)) and value in (0, 1):
        return bool(value)
    if isinstance(value, str):
        normalized = value.strip().casefold()
        if normalized in {"true", "1", "yes", "on"}:
            return True
        if normalized in {"false", "0", "no", "off"}:
            return False
    return None


def _payload_items(payload: Any) -> list[dict[str, Any]]:
    """Accept a native position object, a list, or common envelope shapes."""

    if isinstance(payload, list):
        items = payload
    elif isinstance(payload, dict):
        nested = payload.get("positions", payload.get("data", payload))
        items = nested if isinstance(nested, list) else [nested]
    else:
        raise HTTPException(status_code=422, detail="GPS payload must be an object or a list of objects.")
    if not items or not all(isinstance(item, dict) for item in items):
        raise HTTPException(status_code=422, detail="GPS payload contains no position objects.")
    return items


def _read_path(payload: dict[str, Any], path: str) -> Any:
    value: Any = payload
    for part in path.split("."):
        if not isinstance(value, dict):
            return None
        value = value.get(part)
    return value


def _validate_field_paths(field_paths: dict[str, Any]) -> dict[str, Any]:
    if set(field_paths) != FIELD_PATH_KEYS:
        raise HTTPException(status_code=422, detail="Translation configuration must contain exactly the supported field-path keys.")
    validated: dict[str, Any] = {}
    for key, configured_path in field_paths.items():
        paths = configured_path if key == "external_device_ids" else [configured_path]
        if not isinstance(paths, list) or not paths or (key == "external_device_ids" and len(paths) > 8):
            raise HTTPException(status_code=422, detail=f"{key} must be a non-empty field path{ ' list' if key == 'external_device_ids' else '' }.")
        if not all(isinstance(path, str) and FIELD_PATH_PATTERN.fullmatch(path) for path in paths):
            raise HTTPException(status_code=422, detail=f"{key} contains an invalid JSON field path.")
        validated[key] = paths if key == "external_device_ids" else paths[0]
    return validated


def _translation_field_paths(db: Session) -> dict[str, Any]:
    config = db.get(GPSProviderTranslationConfig, 1)
    if config is None:
        return DEFAULT_FIELD_PATHS.copy()
    try:
        stored = json.loads(config.field_paths_json)
    except (TypeError, json.JSONDecodeError):
        return DEFAULT_FIELD_PATHS.copy()
    try:
        return _validate_field_paths(stored)
    except HTTPException:
        # A malformed historic config must never make the public webhook crash.
        return DEFAULT_FIELD_PATHS.copy()


def _translate(raw: dict[str, Any], field_paths: dict[str, Any]) -> dict[str, Any]:
    """Translate the supplied Teltonika-style payload without discarding it."""

    latitude = _number(_read_path(raw, field_paths["latitude"]))
    longitude = _number(_read_path(raw, field_paths["longitude"]))
    if latitude is None or longitude is None or not -90 <= latitude <= 90 or not -180 <= longitude <= 180:
        raise ValueError("A valid latitude and longitude are required.")

    candidates = [_read_path(raw, path) for path in field_paths["external_device_ids"]]
    external_ids = [str(candidate).strip() for candidate in candidates if candidate is not None and str(candidate).strip()]
    if not external_ids:
        raise ValueError("No vendor device identity was supplied (uniqueId, deviceId, name, or phone).")

    speed_kmh = _number(_read_path(raw, field_paths["speed_kmh"]))
    course = _number(_read_path(raw, field_paths["course"]))
    accuracy = _number(_read_path(raw, field_paths["accuracy"]))
    # Optional telemetry must not turn invalid provider values into misleading
    # live-tracking values.  The unmodified vendor payload remains available in
    # the audit history for troubleshooting.
    if speed_kmh is not None and speed_kmh < 0:
        speed_kmh = None
    if course is not None and not 0 <= course <= 360:
        course = None
    if accuracy is not None and accuracy < 0:
        accuracy = None

    return {
        "external_ids": external_ids,
        "latitude": latitude,
        "longitude": longitude,
        # No rounding or unit conversion occurs here: the provider's numeric
        # speed is kept at full precision in the internal km/h field.
        "speed_kmh": speed_kmh,
        "course": course,
        "altitude": _number(_read_path(raw, field_paths["altitude"])),
        "accuracy": accuracy,
        "fix_time": _as_utc(_read_path(raw, field_paths["fix_time"]) or _read_path(raw, field_paths["device_time"]) or _read_path(raw, field_paths["server_time"])),
        "status": str(_read_path(raw, field_paths["status"])) if _read_path(raw, field_paths["status"]) is not None else None,
        "ignition": _boolean(_read_path(raw, field_paths["ignition"])),
        "motion": _boolean(_read_path(raw, field_paths["motion"])),
        "valid": _boolean(_read_path(raw, field_paths["valid"])),
        "protocol": str(_read_path(raw, field_paths["protocol"])) if _read_path(raw, field_paths["protocol"]) is not None else None,
        "raw": raw,
    }


def _vendor_token_from_header(x_gps_token: str | None) -> str:
    """Read the vendor-only key; it is intentionally not a browser/JWT token."""

    if x_gps_token and x_gps_token.strip():
        return x_gps_token.strip()
    raise HTTPException(
        status_code=401,
        detail="An X-GPS-Token header is required for the GPS ingestion endpoint.",
    )


def _authenticate_vendor_token(db: Session, token: str) -> GPSIngestToken:
    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
    credential = db.query(GPSIngestToken).filter(
        GPSIngestToken.token_hash == token_hash,
        GPSIngestToken.is_active.is_(True),
    ).first()
    if credential is None:
        raise HTTPException(status_code=401, detail="Invalid GPS integration token.")
    credential.last_used_at = _utc_now()
    return credential


def _find_device_mapping(db: Session, external_ids: list[str]) -> GPSDeviceMapping | None:
    return db.query(GPSDeviceMapping).filter(
        GPSDeviceMapping.external_device_id.in_(external_ids),
        GPSDeviceMapping.is_active.is_(True),
    ).first()


def _serialize_state(state: BusGPSState, bus: Bus, *, include_raw: bool = False) -> dict[str, Any]:
    now = _utc_now()
    expected_interval_seconds = vehicle_gps_expected_interval_seconds(state.ignition)
    position_time = state.fix_time or state.received_at
    if position_time.tzinfo is None:
        position_time = position_time.replace(tzinfo=timezone.utc)
    age_seconds = max(0, int((now - position_time).total_seconds()))
    fresh = age_seconds <= GPS_OFFLINE_GRACE_SECONDS
    result = {
        "bus_id": bus.id,
        "bus_number": bus.bus_number,
        "registration_number": bus.registration_number,
        "external_device_id": state.external_device_id,
        "latitude": state.latitude,
        "longitude": state.longitude,
        "speed_kmh": state.speed_kmh,
        "course": state.course,
        "altitude": state.altitude,
        "accuracy": state.accuracy,
        "fix_time": state.fix_time,
        "received_at": state.received_at,
        "status": state.status,
        "ignition": state.ignition,
        "motion": state.motion,
        "valid": state.valid,
        "protocol": state.protocol,
        "expected_interval_seconds": expected_interval_seconds,
        "age_seconds": age_seconds,
        "is_fresh": fresh,
        # A delayed module fix is still a real vehicle position.  Keep it
        # available to every portal as the last known location instead of
        # making the bus disappear after the freshness grace period.
        "tracking_source": "vehicle_gps" if fresh else "vehicle_gps_last_known",
    }
    if include_raw:
        try:
            result["provider_payload"] = json.loads(state.raw_payload)
        except json.JSONDecodeError:
            result["provider_payload"] = None
    return result


def _serialize_audit_event(event: AuditEvent) -> dict[str, Any]:
    """Return readable audit metadata while keeping credential values secret."""

    try:
        details = json.loads(event.details_json) if event.details_json else None
    except (TypeError, json.JSONDecodeError):
        details = None
    return {
        "id": event.id,
        "category": event.category,
        "action": event.action,
        "actor_user_id": event.actor_user_id,
        "actor_username": event.actor_username,
        "actor_role": event.actor_role,
        "subject_type": event.subject_type,
        "subject_id": event.subject_id,
        "subject_label": event.subject_label,
        "client_ip": event.client_ip,
        "user_agent": event.user_agent,
        "details": details,
        "created_at": event.created_at,
    }


def _ensure_vehicle_tracking_session(
    db: Session,
    position: dict[str, Any],
    bus_id: int,
    received_at: datetime,
) -> LiveTrip | None:
    """Create the GPS-owned tracking session for an assigned moving bus.

    Browser actions must never be required for vehicle tracking.  The driver
    phone may add a secondary location source later, but a fresh valid module
    coordinate creates the server-side session and its stop progression.
    """

    trip = db.query(LiveTrip).filter(
        LiveTrip.bus_id == bus_id,
        LiveTrip.status == "Running",
        LiveTrip.ended_at.is_(None),
    ).order_by(LiveTrip.last_location_update.desc(), LiveTrip.started_at.desc()).first()
    if trip is not None:
        return trip

    # GPS state is continuous. Any authenticated packet with a usable
    # coordinate can establish the same route-state session as an
    # ignition-on fix. Provider ``valid`` is retained as diagnostics only:
    # some devices flag parked terminal heartbeats as false even though their
    # coordinates are exactly what is needed to reverse the trip.

    route = db.query(Route).filter(
        Route.bus_id == bus_id,
        Route.status == "Active",
    ).order_by(Route.id.asc()).first()
    if route is None:
        return None

    # A route assignment is normally authoritative. Keep compatibility with
    # older bus assignments by falling back to the driver linked to the bus.
    driver_id = route.driver_id
    if driver_id is None:
        driver_id = db.query(Driver.id).filter(Driver.bus_id == bus_id).scalar()
    if driver_id is None:
        legacy_bus = db.get(Bus, bus_id)
        driver_id = legacy_bus.driver_id if legacy_bus is not None else None
    if driver_id is None or db.get(Driver, driver_id) is None:
        return None

    route_stops = db.query(RouteStop).filter(
        RouteStop.route_id == route.id,
    ).order_by(RouteStop.sequence.asc()).all()
    started_at = position.get("fix_time") or received_at
    trip = LiveTrip(
        driver_id=driver_id,
        bus_id=bus_id,
        route_id=route.id,
        status="Running",
        route_direction=direction_from_start_position(
            route_stops,
            position["latitude"],
            position["longitude"],
        ),
        started_at=started_at,
        current_location_source="vehicle_gps",
    )
    db.add(trip)
    db.flush()
    return trip


def _update_active_trip_from_vehicle(db: Session, position: dict[str, Any], bus_id: int, received_at: datetime) -> int | None:
    """Mirror vehicle GPS and geofence progression into its GPS-owned session."""

    trip = _ensure_vehicle_tracking_session(db, position, bus_id, received_at)
    if trip is None:
        return None

    # Some installed modules do not send an ignition attribute. Any accepted
    # coordinate must still progress the active trip even while phone data is
    # also arriving. The provider's validity flag is preserved for diagnostics
    # but never blocks a final-stop coordinate from reversing the route.

    position_timestamp = position.get("fix_time") or received_at

    # A provider packet may be preserved in raw history even when it is old,
    # but it must never regress the student-visible trip state. An exact replay
    # of the current coordinate is intentionally allowed through: this lets the
    # first/next terminal heartbeat reconcile a trip after a restart without
    # waiting for the device to produce a different position or timestamp.
    replayed_current_position = False
    if trip.last_location_update is not None:
        latest_trip_time = (
            trip.last_location_update.replace(tzinfo=timezone.utc)
            if trip.last_location_update.tzinfo is None
            else trip.last_location_update.astimezone(timezone.utc)
        )
        latest_position_time = (
            position_timestamp.replace(tzinfo=timezone.utc)
            if position_timestamp.tzinfo is None
            else position_timestamp.astimezone(timezone.utc)
        )
        if latest_position_time < latest_trip_time:
            return trip.id
        if latest_position_time == latest_trip_time:
            replayed_current_position = bool(
                trip.current_latitude is not None
                and trip.current_longitude is not None
                and math.isclose(float(trip.current_latitude), float(position["latitude"]), abs_tol=1e-7)
                and math.isclose(float(trip.current_longitude), float(position["longitude"]), abs_tol=1e-7)
            )
            if not replayed_current_position:
                return trip.id

    previous_location = db.query(LiveLocation).filter(
        LiveLocation.trip_id == trip.id,
    ).order_by(LiveLocation.recorded_at.desc()).first()
    route_stops = db.query(RouteStop).filter(
        RouteStop.route_id == trip.route_id,
    ).order_by(RouteStop.sequence.asc()).all()

    # A return trip starts near the final morning stop (normally campus).
    # Store its direction once; the route definition itself is never rewritten.
    if trip.current_route_stop_id is None and trip.current_latitude is None:
        trip.route_direction = direction_from_start_position(
            route_stops,
            position["latitude"],
            position["longitude"],
        )

    update_route_stop_progression(
        trip=trip,
        route_stops=ordered_route_stops(route_stops, trip.route_direction),
        latitude=position["latitude"],
        longitude=position["longitude"],
        previous_location=previous_location,
        current_timestamp=position_timestamp,
        db=db,
    )

    if not replayed_current_position:
        db.add(LiveLocation(
            trip_id=trip.id,
            latitude=position["latitude"], longitude=position["longitude"],
            speed=position["speed_kmh"], accuracy=position["accuracy"],
            recorded_at=position_timestamp, source="vehicle_gps",
        ))
        db.flush()
        trim_active_trip_location_history(db, trip.id)
    trip.current_latitude = position["latitude"]
    trip.current_longitude = position["longitude"]
    trip.current_speed = position["speed_kmh"]
    trip.current_accuracy = position["accuracy"]
    # Freshness must reflect when the GPS device fixed this position, not when
    # a polling job happened to receive it. This keeps old coordinates visibly
    # last-known instead of making them appear live again.
    trip.last_location_update = position_timestamp
    trip.current_location_source = "vehicle_gps"
    return trip.id


@router.post("/tokens", status_code=status.HTTP_201_CREATED)
def create_ingest_token(payload: GPSIngestTokenCreate, request: Request, db: Session = Depends(get_db), technician: User = Depends(require_gps_technician)):
    if payload.bus_id is not None and db.get(Bus, payload.bus_id) is None:
        raise HTTPException(status_code=404, detail="Bus not found.")
    plaintext_token = secrets.token_urlsafe(32)
    credential = GPSIngestToken(
        label=payload.label.strip(), bus_id=payload.bus_id,
        token_hash=hashlib.sha256(plaintext_token.encode("utf-8")).hexdigest(),
    )
    db.add(credential)
    db.flush()
    record_audit_event(
        db, category="gps", action="token_created", actor=technician,
        subject_type="token", subject_id=credential.id, subject_label=credential.label,
        details={"scope": f"bus:{credential.bus_id}" if credential.bus_id else "fleet"}, request=request,
    )
    db.commit()
    db.refresh(credential)
    return {
        "id": credential.id, "label": credential.label, "bus_id": credential.bus_id,
        "is_active": credential.is_active, "created_at": credential.created_at,
        "token": plaintext_token,
        "delivery": "Send this value once to the GPS provider. It is not stored in readable form and cannot be retrieved later.",
    }


@router.get("/tokens")
def list_ingest_tokens(
    search: str | None = Query(default=None, max_length=100),
    state: str | None = Query(default=None, pattern="^(active|inactive)$"),
    db: Session = Depends(get_db),
    _technician: User = Depends(require_gps_technician),
):
    query = db.query(GPSIngestToken)
    if search and search.strip():
        query = query.filter(GPSIngestToken.label.ilike(f"%{search.strip()}%"))
    if state == "active":
        query = query.filter(GPSIngestToken.is_active.is_(True))
    elif state == "inactive":
        query = query.filter(GPSIngestToken.is_active.is_(False))
    return [{"id": item.id, "label": item.label, "bus_id": item.bus_id, "is_active": item.is_active,
             "created_at": item.created_at, "last_used_at": item.last_used_at}
            for item in query.order_by(GPSIngestToken.id.desc()).all()]


@router.get("/tokens/{token_id}/history")
def get_ingest_token_history(token_id: int, db: Session = Depends(get_db), _technician: User = Depends(require_gps_technician)):
    """Return safe metadata and lifecycle history for one live token.

    The plaintext token is intentionally absent, including from this endpoint.
    """

    credential = db.get(GPSIngestToken, token_id)
    if credential is None:
        raise HTTPException(status_code=404, detail="GPS integration token not found.")
    events = db.query(AuditEvent).filter(
        AuditEvent.subject_type == "token", AuditEvent.subject_id == token_id
    ).order_by(AuditEvent.created_at.desc()).all()
    return {
        "token": {
            "id": credential.id, "label": credential.label, "bus_id": credential.bus_id,
            "is_active": credential.is_active, "created_at": credential.created_at,
            "last_used_at": credential.last_used_at,
            "value_available": False,
        },
        "events": [_serialize_audit_event(event) for event in events],
    }


@router.get("/audit")
def list_integration_audit(
    category: str | None = Query(default=None, pattern="^(gps|portal|operations)$"),
    limit: int = Query(default=100, ge=1, le=250),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    _technician: User = Depends(require_gps_technician),
):
    """Paginated technician audit log for portal, token, and trip recovery activity."""

    query = db.query(AuditEvent)
    if category:
        query = query.filter(AuditEvent.category == category)
    total = query.count()
    events = query.order_by(AuditEvent.created_at.desc(), AuditEvent.id.desc()).offset(offset).limit(limit).all()
    return {
        "events": [_serialize_audit_event(event) for event in events],
        "offset": offset,
        "limit": limit,
        "total": total,
        "has_more": offset + len(events) < total,
    }


def _serialize_request_log(item: APIRequestLog) -> dict[str, Any]:
    return {
        "id": item.id,
        "method": item.method,
        "path": item.path,
        "status_code": item.status_code,
        "duration_ms": item.duration_ms,
        "actor_user_id": item.actor_user_id,
        "actor_username": item.actor_username,
        "actor_role": item.actor_role,
        "integration_token_id": item.integration_token_id,
        "integration_token_label": item.integration_token_label,
        "client_ip": item.client_ip,
        "created_at": item.created_at,
    }


@router.get("/requests")
def list_api_request_logs(
    search: str | None = Query(default=None, max_length=100),
    method: str | None = Query(default=None, pattern="^(GET|POST|PUT|PATCH|DELETE)$"),
    status_class: str | None = Query(default=None, pattern="^[245]xx$"),
    token_id: int | None = Query(default=None, ge=1),
    limit: int = Query(default=100, ge=1, le=250),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    _technician: User = Depends(require_gps_technician),
):
    """Search the safe operational request queue; headers and bodies are never stored."""

    query = db.query(APIRequestLog)
    if search and search.strip():
        pattern = f"%{search.strip()}%"
        query = query.filter(or_(
            APIRequestLog.path.ilike(pattern),
            APIRequestLog.method.ilike(pattern),
            APIRequestLog.actor_username.ilike(pattern),
            APIRequestLog.integration_token_label.ilike(pattern),
        ))
    if method:
        query = query.filter(APIRequestLog.method == method)
    if status_class:
        first_digit = int(status_class[0])
        query = query.filter(
            APIRequestLog.status_code >= first_digit * 100,
            APIRequestLog.status_code < (first_digit + 1) * 100,
        )
    if token_id is not None:
        query = query.filter(APIRequestLog.integration_token_id == token_id)
    total = query.count()
    entries = query.order_by(APIRequestLog.created_at.desc(), APIRequestLog.id.desc()).offset(offset).limit(limit).all()
    return {
        "requests": [_serialize_request_log(item) for item in entries],
        "offset": offset,
        "limit": limit,
        "total": total,
        "has_more": offset + len(entries) < total,
    }


@router.patch("/tokens/{token_id}")
def set_ingest_token_status(token_id: int, payload: GPSIngestTokenUpdate, request: Request, db: Session = Depends(get_db), technician: User = Depends(require_gps_technician)):
    credential = db.get(GPSIngestToken, token_id)
    if credential is None:
        raise HTTPException(status_code=404, detail="GPS integration token not found.")
    credential.is_active = payload.is_active
    record_audit_event(
        db, category="gps", action="token_enabled" if credential.is_active else "token_disabled", actor=technician,
        subject_type="token", subject_id=credential.id, subject_label=credential.label,
        details={"scope": f"bus:{credential.bus_id}" if credential.bus_id else "fleet"}, request=request,
    )
    db.commit()
    return {"id": credential.id, "is_active": credential.is_active}


@router.post("/tokens/{token_id}/rotate")
def rotate_ingest_token(token_id: int, request: Request, db: Session = Depends(get_db), technician: User = Depends(require_gps_technician)):
    """Replace a compromised credential and return the replacement once to the authorised caller."""

    credential = db.get(GPSIngestToken, token_id)
    if credential is None:
        raise HTTPException(status_code=404, detail="GPS integration token not found.")
    # A new value is deliberately generated before it is hashed.  The hash is
    # the only value persisted, while the plaintext is returned in this one
    # response so an authorised provisioning process can deliver it to MVD.
    # It can never be retrieved again from the database or token-list API.
    replacement_token = secrets.token_urlsafe(32)
    credential.token_hash = hashlib.sha256(replacement_token.encode("utf-8")).hexdigest()
    credential.is_active = True
    credential.last_used_at = None
    record_audit_event(
        db, category="gps", action="token_rotated", actor=technician,
        subject_type="token", subject_id=credential.id, subject_label=credential.label,
        details={"scope": f"bus:{credential.bus_id}" if credential.bus_id else "fleet", "last_used_reset": True}, request=request,
    )
    db.commit()
    return {
        "id": credential.id,
        "label": credential.label,
        "is_active": credential.is_active,
        "rotated_at": _utc_now(),
        "token": replacement_token,
        "delivery": "Send this replacement once to the GPS provider through an approved secure channel. It is not stored in readable form and cannot be retrieved later.",
        "message": "A replacement GPS token was generated. The previous token can no longer submit locations.",
    }


@router.delete("/tokens/{token_id}")
def delete_ingest_token(token_id: int, request: Request, db: Session = Depends(get_db), technician: User = Depends(require_gps_technician)):
    """Permanently remove an unused or compromised provider credential."""

    credential = db.get(GPSIngestToken, token_id)
    if credential is None:
        raise HTTPException(status_code=404, detail="GPS integration token not found.")
    record_audit_event(
        db, category="gps", action="token_deleted", actor=technician,
        subject_type="token", subject_id=credential.id, subject_label=credential.label,
        details={"scope": f"bus:{credential.bus_id}" if credential.bus_id else "fleet"}, request=request,
    )
    db.delete(credential)
    db.commit()
    return {"message": "GPS integration token deleted. It can no longer submit positions."}


@router.post("/devices", status_code=status.HTTP_201_CREATED)
def create_device_mapping(payload: GPSDeviceMappingCreate, request: Request, db: Session = Depends(get_db), technician: User = Depends(require_gps_technician)):
    if db.get(Bus, payload.bus_id) is None:
        raise HTTPException(status_code=404, detail="Bus not found.")
    external_device_id = payload.external_device_id.strip()
    if db.query(GPSDeviceMapping).filter(GPSDeviceMapping.external_device_id == external_device_id).first():
        raise HTTPException(status_code=409, detail="That external device ID is already mapped.")
    mapping = GPSDeviceMapping(bus_id=payload.bus_id, external_device_id=external_device_id, display_name=payload.display_name)
    db.add(mapping)
    db.flush()
    record_audit_event(
        db, category="gps", action="device_mapping_created", actor=technician,
        subject_type="device_mapping", subject_id=mapping.id, subject_label=external_device_id,
        details={"bus_id": mapping.bus_id, "display_name": mapping.display_name}, request=request,
    )
    db.commit()
    db.refresh(mapping)
    return {"id": mapping.id, "bus_id": mapping.bus_id, "external_device_id": mapping.external_device_id,
            "display_name": mapping.display_name, "is_active": mapping.is_active}


@router.get("/devices")
def list_device_mappings(db: Session = Depends(get_db), _technician: User = Depends(require_gps_technician)):
    mappings = db.query(GPSDeviceMapping).order_by(GPSDeviceMapping.external_device_id).all()
    return [{"id": item.id, "bus_id": item.bus_id, "bus_number": db.get(Bus, item.bus_id).bus_number if db.get(Bus, item.bus_id) else None,
             "external_device_id": item.external_device_id, "display_name": item.display_name, "is_active": item.is_active}
            for item in mappings]


@router.put("/devices/{mapping_id}")
def update_device_mapping(mapping_id: int, payload: GPSDeviceMappingUpdate, request: Request, db: Session = Depends(get_db), technician: User = Depends(require_gps_technician)):
    mapping = db.get(GPSDeviceMapping, mapping_id)
    if mapping is None:
        raise HTTPException(status_code=404, detail="GPS device mapping not found.")
    external_device_id = payload.external_device_id.strip()
    duplicate = db.query(GPSDeviceMapping).filter(GPSDeviceMapping.external_device_id == external_device_id, GPSDeviceMapping.id != mapping_id).first()
    if duplicate:
        raise HTTPException(status_code=409, detail="That external device ID is already mapped.")
    previous_external_device_id = mapping.external_device_id
    mapping.external_device_id, mapping.display_name, mapping.is_active = external_device_id, payload.display_name, payload.is_active
    record_audit_event(
        db, category="gps", action="device_mapping_updated", actor=technician,
        subject_type="device_mapping", subject_id=mapping.id, subject_label=external_device_id,
        details={"bus_id": mapping.bus_id, "previous_external_device_id": previous_external_device_id,
                 "is_active": mapping.is_active, "display_name": mapping.display_name}, request=request,
    )
    db.commit()
    return {"id": mapping.id, "bus_id": mapping.bus_id, "external_device_id": mapping.external_device_id,
            "display_name": mapping.display_name, "is_active": mapping.is_active}


@router.get("/buses")
def list_mapping_buses(db: Session = Depends(get_db), _technician: User = Depends(require_gps_technician)):
    """Minimal bus directory needed for device mapping, not the Admin fleet API."""

    return [
        {"id": bus.id, "bus_number": bus.bus_number, "registration_number": bus.registration_number, "device_id": bus.device_id}
        for bus in db.query(Bus).order_by(Bus.bus_number).all()
    ]


@router.get("/translator")
def get_translation_config(db: Session = Depends(get_db), _technician: User = Depends(require_gps_technician)):
    config = db.get(GPSProviderTranslationConfig, 1)
    return {
        "field_paths": _translation_field_paths(db),
        "updated_at": config.updated_at if config else None,
        "using_default": config is None,
    }


@router.put("/translator")
def update_translation_config(payload: GPSTranslationConfigUpdate, request: Request, db: Session = Depends(get_db), technician: User = Depends(require_gps_technician)):
    field_paths = _validate_field_paths(payload.field_paths)
    config = db.get(GPSProviderTranslationConfig, 1)
    if config is None:
        config = GPSProviderTranslationConfig(id=1, field_paths_json=json.dumps(field_paths), updated_by_user_id=technician.id)
        db.add(config)
    else:
        config.field_paths_json = json.dumps(field_paths)
        config.updated_by_user_id = technician.id
    record_audit_event(
        db, category="gps", action="translation_updated", actor=technician,
        subject_type="translation_config", subject_id=1, subject_label="GPS provider field paths",
        details={"field_paths": field_paths}, request=request,
    )
    db.commit()
    db.refresh(config)
    return {"field_paths": field_paths, "updated_at": config.updated_at, "updated_by_user_id": config.updated_by_user_id}


@router.post("/ingest")
def ingest_positions(
    request: Request,
    payload: Any = Body(...),
    x_gps_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    """Vendor webhook. POST JSON with `X-GPS-Token` is the recommended contract."""

    # This custom token is checked only here. It cannot authenticate a user,
    # read tracking data, alter settings, or access any other API route.
    credential = _authenticate_vendor_token(db, _vendor_token_from_header(x_gps_token))
    # Safe identity metadata for the request queue. The plaintext token is
    # intentionally not copied into the database, log, or response.
    request.state.audit_actor_username = f"GPS token: {credential.label}"
    request.state.audit_actor_role = "GPS service"
    request.state.audit_integration_token_id = credential.id
    request.state.audit_integration_token_label = credential.label
    field_paths = _translation_field_paths(db)
    accepted: list[dict[str, Any]] = []
    ignored: list[dict[str, Any]] = []
    for index, raw in enumerate(_payload_items(payload)):
        try:
            position = _translate(raw, field_paths)
        except ValueError as error:
            ignored.append({"index": index, "reason": str(error)})
            continue
        mapping = _find_device_mapping(db, position["external_ids"])
        if mapping is None:
            # Existing buses can be adopted without a schema migration by using
            # their already-present device_id field as the external identifier.
            bus = db.query(Bus).filter(Bus.device_id.in_(position["external_ids"])).first()
            mapping_id = None
        else:
            bus = db.get(Bus, mapping.bus_id)
            mapping_id = mapping.id
        if bus is None:
            ignored.append({"index": index, "external_device_ids": position["external_ids"], "reason": "No bus mapping exists."})
            continue
        if credential.bus_id is not None and credential.bus_id != bus.id:
            ignored.append({"index": index, "external_device_ids": position["external_ids"], "reason": "Token is not authorized for this bus."})
            continue

        now = _utc_now()
        external_device_id = position["external_ids"][0]
        raw_json = json.dumps(position["raw"], separators=(",", ":"), default=str)
        history = ProviderGPSPosition(
            bus_id=bus.id, device_mapping_id=mapping_id, external_device_id=external_device_id,
            latitude=position["latitude"], longitude=position["longitude"], speed_kmh=position["speed_kmh"],
            course=position["course"], altitude=position["altitude"], accuracy=position["accuracy"],
            fix_time=position["fix_time"], received_at=now, status=position["status"], ignition=position["ignition"],
            motion=position["motion"], valid=position["valid"], protocol=position["protocol"], raw_payload=raw_json,
        )
        db.add(history)
        db.flush()
        state = db.query(BusGPSState).filter(BusGPSState.bus_id == bus.id).first()
        state_time = None
        if state is not None:
            stored_time = state.fix_time or state.received_at
            state_time = (
                stored_time.replace(tzinfo=timezone.utc)
                if stored_time.tzinfo is None
                else stored_time.astimezone(timezone.utc)
            )
        # A missing device timestamp must not discard a heartbeat. Use its
        # authenticated server receipt time. Exact replays of the current
        # coordinate are also passed to route progression so a final-stop
        # heartbeat can reverse immediately after a restart/reconnect.
        position_time = position["fix_time"] or now
        should_apply = (
            state is None
            or state_time is None
            or position_time > state_time
        )
        should_reconcile_route = bool(
            not should_apply
            and state is not None
            and state_time is not None
            and position_time == state_time
            and math.isclose(float(state.latitude), float(position["latitude"]), abs_tol=1e-7)
            and math.isclose(float(state.longitude), float(position["longitude"]), abs_tol=1e-7)
        )
        active_trip_id = None
        if should_apply:
            if state is None:
                state = BusGPSState(bus_id=bus.id, external_device_id=external_device_id, latitude=position["latitude"], longitude=position["longitude"], raw_payload=raw_json)
                db.add(state)
            state.provider_position_id, state.external_device_id = history.id, external_device_id
            state.latitude, state.longitude, state.speed_kmh = position["latitude"], position["longitude"], position["speed_kmh"]
            state.course, state.altitude, state.accuracy, state.fix_time = position["course"], position["altitude"], position["accuracy"], position["fix_time"]
            state.received_at, state.status, state.ignition, state.motion = now, position["status"], position["ignition"], position["motion"]
            state.valid, state.protocol, state.raw_payload = position["valid"], position["protocol"], raw_json
            active_trip_id = _update_active_trip_from_vehicle(db, position, bus.id, now)
        elif should_reconcile_route:
            active_trip_id = _update_active_trip_from_vehicle(db, position, bus.id, now)
        accepted.append({"index": index, "bus_id": bus.id, "bus_number": bus.bus_number, "external_device_id": external_device_id,
                         "applied_to_current_state": should_apply, "route_progression_reconciled": should_reconcile_route,
                         "active_trip_id": active_trip_id})
    db.commit()
    return {"accepted": accepted, "ignored": ignored, "received_count": len(accepted) + len(ignored)}


@router.post("/airotrack/refresh")
def refresh_airotrack_positions(
    bus_id: int | None = Query(default=None, ge=1),
    db: Session = Depends(get_db),
    _technician: User = Depends(require_gps_technician),
):
    """Fetch configured Airotrack vehicles now; the token stays server-side."""

    from backend.services.airotrack import refresh_airotrack
    try:
        return refresh_airotrack(db, bus_id=bus_id)
    except RuntimeError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error


@router.get("/status")
def list_provider_status(db: Session = Depends(get_db), _technician: User = Depends(require_gps_technician)):
    states = db.query(BusGPSState).order_by(BusGPSState.received_at.desc()).all()
    return [_serialize_state(state, db.get(Bus, state.bus_id)) for state in states if db.get(Bus, state.bus_id) is not None]


@router.get("/status/{bus_id}")
def get_provider_status(bus_id: int, db: Session = Depends(get_db), _technician: User = Depends(require_gps_technician)):
    bus = db.get(Bus, bus_id)
    if bus is None:
        raise HTTPException(status_code=404, detail="Bus not found.")
    state = db.query(BusGPSState).filter(BusGPSState.bus_id == bus_id).first()
    if state is None:
        raise HTTPException(status_code=404, detail="No GPS provider data has been received for this bus.")
    return _serialize_state(state, bus, include_raw=True)


@router.get("/driver/source")
def get_driver_tracking_source(current_user: User = Depends(require_driver), db: Session = Depends(get_db)):
    """Return the driver's own latest MVD position, never an admin relay."""

    driver = db.query(Driver).filter(Driver.user_id == current_user.id).first()
    if driver is None or driver.bus_id is None:
        return {
            "tracking_source": "unavailable",
            "mobile_tracking_allowed": False,
            "active_trip_id": None,
            "reason": "No bus GPS is assigned.",
        }
    state = db.query(BusGPSState).filter(BusGPSState.bus_id == driver.bus_id).first()
    active_trip = db.query(LiveTrip).filter(
        LiveTrip.driver_id == driver.id,
        LiveTrip.status == "Running",
        LiveTrip.ended_at.is_(None),
    ).order_by(LiveTrip.started_at.desc()).first()
    vehicle = _serialize_state(state, db.get(Bus, driver.bus_id)) if state else None
    vehicle_is_primary = bool(
        vehicle
        and vehicle["is_fresh"]
    )
    if vehicle_is_primary:
        return {"tracking_source": "vehicle_gps", "mobile_tracking_allowed": True,
                "reason": (
                    "Vehicle GPS is live; phone GPS is also recorded to keep the trip continuous."
                    if state.ignition is True
                    else "Vehicle GPS parked heartbeat is current and accepted for route progression."
                ), "vehicle": vehicle,
                "route_direction": active_trip.route_direction if active_trip else None,
                "active_trip_id": active_trip.id if active_trip else None}
    return {
            # A running GPS-owned session does not mean the driver has enabled
            # phone sharing. The browser owns that opt-in, so do not report a
            # phone source merely because a vehicle session is active.
            "tracking_source": "vehicle_gps_last_known" if vehicle else "vehicle_gps_offline",
            "mobile_tracking_allowed": True,
            "reason": (
                "Vehicle GPS has not sent a recent fix; showing the bus at its last known module position."
                if active_trip
                else "Vehicle GPS is unavailable; waiting for the module to report."
            ), "vehicle": vehicle,
            "route_direction": active_trip.route_direction if active_trip else None,
            "active_trip_id": active_trip.id if active_trip else None}
