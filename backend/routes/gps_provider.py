"""Secure webhook receiver and translator for external GPS providers.

The public integration endpoint deliberately accepts the vendor's native JSON.
It translates known fields into BusTrack's internal format while keeping the
complete original object for audit and future provider-specific UI details.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
import hashlib
import json
import re
import secrets
from typing import Any

from fastapi import APIRouter, Body, Depends, Header, HTTPException, Request, status
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models import Bus
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
from backend.models import Driver, User


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
        return float(value)
    except (TypeError, ValueError):
        return None


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

    return {
        "external_ids": external_ids,
        "latitude": latitude,
        "longitude": longitude,
        "speed_kmh": _number(_read_path(raw, field_paths["speed_kmh"])),
        "course": _number(_read_path(raw, field_paths["course"])),
        "altitude": _number(_read_path(raw, field_paths["altitude"])),
        "accuracy": _number(_read_path(raw, field_paths["accuracy"])),
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
    expected_interval_seconds = 20 if state.ignition is True else 120
    received_at = state.received_at
    if received_at.tzinfo is None:
        received_at = received_at.replace(tzinfo=timezone.utc)
    age_seconds = max(0, int((now - received_at).total_seconds()))
    fresh = age_seconds <= expected_interval_seconds * 3
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
        "tracking_source": "vehicle_gps" if fresh and state.ignition is True else "mobile_available",
    }
    if include_raw:
        try:
            result["provider_payload"] = json.loads(state.raw_payload)
        except json.JSONDecodeError:
            result["provider_payload"] = None
    return result


def vehicle_gps_is_authoritative(state: BusGPSState | None, now: datetime | None = None) -> bool:
    """Vehicle GPS blocks driver-phone updates only while on and recently heard."""

    if state is None or state.ignition is not True or state.valid is False:
        return False
    current = now or _utc_now()
    received_at = state.received_at.replace(tzinfo=timezone.utc) if state.received_at.tzinfo is None else state.received_at
    return received_at >= current - timedelta(seconds=60)


def _update_active_trip_from_vehicle(db: Session, position: dict[str, Any], bus_id: int, received_at: datetime) -> int | None:
    """Mirror provider GPS into the existing trip API without changing trip lifecycle."""

    trip = db.query(LiveTrip).filter(
        LiveTrip.bus_id == bus_id,
        LiveTrip.status == "Running",
        LiveTrip.ended_at.is_(None),
    ).order_by(LiveTrip.last_location_update.desc(), LiveTrip.started_at.desc()).first()
    if trip is None:
        return None
    db.add(LiveLocation(
        trip_id=trip.id,
        latitude=position["latitude"], longitude=position["longitude"],
        speed=position["speed_kmh"], accuracy=position["accuracy"],
        recorded_at=received_at, source="vehicle_gps",
    ))
    trip.current_latitude = position["latitude"]
    trip.current_longitude = position["longitude"]
    trip.current_speed = position["speed_kmh"]
    trip.current_accuracy = position["accuracy"]
    trip.last_location_update = received_at
    trip.current_location_source = "vehicle_gps"
    return trip.id


@router.post("/tokens", status_code=status.HTTP_201_CREATED)
def create_ingest_token(payload: GPSIngestTokenCreate, db: Session = Depends(get_db), _technician: User = Depends(require_gps_technician)):
    if payload.bus_id is not None and db.get(Bus, payload.bus_id) is None:
        raise HTTPException(status_code=404, detail="Bus not found.")
    plaintext_token = secrets.token_urlsafe(32)
    credential = GPSIngestToken(
        label=payload.label.strip(), bus_id=payload.bus_id,
        token_hash=hashlib.sha256(plaintext_token.encode("utf-8")).hexdigest(),
    )
    db.add(credential)
    db.commit()
    db.refresh(credential)
    return {
        "id": credential.id, "label": credential.label, "bus_id": credential.bus_id,
        "is_active": credential.is_active, "created_at": credential.created_at,
        "token": plaintext_token,
        "delivery": "Send this value once to the GPS provider. It is not stored in readable form and cannot be retrieved later.",
    }


@router.get("/tokens")
def list_ingest_tokens(db: Session = Depends(get_db), _technician: User = Depends(require_gps_technician)):
    return [{"id": item.id, "label": item.label, "bus_id": item.bus_id, "is_active": item.is_active,
             "created_at": item.created_at, "last_used_at": item.last_used_at}
            for item in db.query(GPSIngestToken).order_by(GPSIngestToken.id.desc()).all()]


@router.patch("/tokens/{token_id}")
def set_ingest_token_status(token_id: int, payload: GPSIngestTokenUpdate, db: Session = Depends(get_db), _technician: User = Depends(require_gps_technician)):
    credential = db.get(GPSIngestToken, token_id)
    if credential is None:
        raise HTTPException(status_code=404, detail="GPS integration token not found.")
    credential.is_active = payload.is_active
    db.commit()
    return {"id": credential.id, "is_active": credential.is_active}


@router.post("/tokens/{token_id}/rotate")
def rotate_ingest_token(token_id: int, db: Session = Depends(get_db), _technician: User = Depends(require_gps_technician)):
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
def delete_ingest_token(token_id: int, db: Session = Depends(get_db), _technician: User = Depends(require_gps_technician)):
    """Permanently remove an unused or compromised provider credential."""

    credential = db.get(GPSIngestToken, token_id)
    if credential is None:
        raise HTTPException(status_code=404, detail="GPS integration token not found.")
    db.delete(credential)
    db.commit()
    return {"message": "GPS integration token deleted. It can no longer submit positions."}


@router.post("/devices", status_code=status.HTTP_201_CREATED)
def create_device_mapping(payload: GPSDeviceMappingCreate, db: Session = Depends(get_db), _technician: User = Depends(require_gps_technician)):
    if db.get(Bus, payload.bus_id) is None:
        raise HTTPException(status_code=404, detail="Bus not found.")
    external_device_id = payload.external_device_id.strip()
    if db.query(GPSDeviceMapping).filter(GPSDeviceMapping.external_device_id == external_device_id).first():
        raise HTTPException(status_code=409, detail="That external device ID is already mapped.")
    mapping = GPSDeviceMapping(bus_id=payload.bus_id, external_device_id=external_device_id, display_name=payload.display_name)
    db.add(mapping)
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
def update_device_mapping(mapping_id: int, payload: GPSDeviceMappingUpdate, db: Session = Depends(get_db), _technician: User = Depends(require_gps_technician)):
    mapping = db.get(GPSDeviceMapping, mapping_id)
    if mapping is None:
        raise HTTPException(status_code=404, detail="GPS device mapping not found.")
    external_device_id = payload.external_device_id.strip()
    duplicate = db.query(GPSDeviceMapping).filter(GPSDeviceMapping.external_device_id == external_device_id, GPSDeviceMapping.id != mapping_id).first()
    if duplicate:
        raise HTTPException(status_code=409, detail="That external device ID is already mapped.")
    mapping.external_device_id, mapping.display_name, mapping.is_active = external_device_id, payload.display_name, payload.is_active
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
def update_translation_config(payload: GPSTranslationConfigUpdate, db: Session = Depends(get_db), technician: User = Depends(require_gps_technician)):
    field_paths = _validate_field_paths(payload.field_paths)
    config = db.get(GPSProviderTranslationConfig, 1)
    if config is None:
        config = GPSProviderTranslationConfig(id=1, field_paths_json=json.dumps(field_paths), updated_by_user_id=technician.id)
        db.add(config)
    else:
        config.field_paths_json = json.dumps(field_paths)
        config.updated_by_user_id = technician.id
    db.commit()
    db.refresh(config)
    return {"field_paths": field_paths, "updated_at": config.updated_at, "updated_by_user_id": config.updated_by_user_id}


@router.post("/ingest")
async def ingest_positions(
    request: Request,
    payload: Any = Body(...),
    x_gps_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    """Vendor webhook. POST JSON with `X-GPS-Token` is the recommended contract."""

    del request  # FastAPI keeps Request available for provider logging middleware.
    # This custom token is checked only here. It cannot authenticate a user,
    # read tracking data, alter settings, or access any other API route.
    credential = _authenticate_vendor_token(db, _vendor_token_from_header(x_gps_token))
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
        state_fix_time = None
        if state is not None and state.fix_time is not None:
            state_fix_time = (
                state.fix_time.replace(tzinfo=timezone.utc)
                if state.fix_time.tzinfo is None
                else state.fix_time.astimezone(timezone.utc)
            )
        should_apply = (
            state is None
            or state_fix_time is None
            or position["fix_time"] is None
            or position["fix_time"] >= state_fix_time
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
        accepted.append({"index": index, "bus_id": bus.id, "bus_number": bus.bus_number, "external_device_id": external_device_id,
                         "applied_to_current_state": should_apply, "active_trip_id": active_trip_id})
    db.commit()
    return {"accepted": accepted, "ignored": ignored, "received_count": len(accepted) + len(ignored)}


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
    """Tell the driver UI when the vehicle GPS must replace phone tracking."""

    driver = db.query(Driver).filter(Driver.user_id == current_user.id).first()
    if driver is None or driver.bus_id is None:
        return {"tracking_source": "mobile", "mobile_tracking_allowed": True, "reason": "No bus GPS is assigned."}
    state = db.query(BusGPSState).filter(BusGPSState.bus_id == driver.bus_id).first()
    if vehicle_gps_is_authoritative(state):
        return {"tracking_source": "vehicle_gps", "mobile_tracking_allowed": False,
                "reason": "Fresh ignition-on vehicle GPS is being received.", "vehicle": _serialize_state(state, db.get(Bus, driver.bus_id))}
    return {"tracking_source": "mobile", "mobile_tracking_allowed": True,
            "reason": "Vehicle GPS is off, stale, or unavailable.",
            "vehicle": _serialize_state(state, db.get(Bus, driver.bus_id)) if state else None}
