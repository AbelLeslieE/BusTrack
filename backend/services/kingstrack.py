"""Pull fleet positions from the Kingstrack account feeds.

Each configured endpoint returns every vehicle in that account. BusTrack
matches plates against saved bus registration numbers, then writes the same
canonical GPS state used by Airotrack, webhooks, students and drivers.
"""

from __future__ import annotations

from datetime import datetime, timezone
import json
import os
from threading import Lock
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from sqlalchemy.orm import Session

from backend.models import Bus
from backend.routes.gps_provider import (
    _position_from_current_state,
    _update_active_trip_from_vehicle,
)
from backend.routes.models_tracking import (
    BusGPSState,
    GPSDeviceMapping,
    ProviderGPSPosition,
)
from backend.services.gps_timestamp import future_timestamp_quarantine_reason
from backend.services.provider_health import record_provider_error, record_provider_success
from backend.services.trip_reset import lock_tracking_bus


KINGSTRACK_ENDPOINT = "https://mvt.apmkingstrack.com/fleettracking/api/live/json"
_REFRESH_LOCK = Lock()


def _registration_key(value: Any) -> str:
    return "".join(character for character in str(value or "").upper() if character.isalnum())


def _number(value: Any) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _as_vendor_time(value: Any) -> datetime | None:
    """Parse Kingstrack's ISO-8601 timestamp and normalize it to UTC."""

    if not isinstance(value, str) or not value.strip():
        return None
    candidate = value.strip()
    if candidate.endswith("Z"):
        candidate = f"{candidate[:-1]}+00:00"
    try:
        parsed = datetime.fromisoformat(candidate)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def configured_accounts() -> list[tuple[str, str]]:
    """Read ``company:user`` account pairs from the server environment."""

    raw = os.getenv("KINGSTRACK_ACCOUNTS", "").strip()
    if not raw:
        return []
    accounts: list[tuple[str, str]] = []
    for entry in raw.split(","):
        parts = [part.strip() for part in entry.split(":", 1)]
        if len(parts) != 2 or not all(part.isdigit() for part in parts):
            raise RuntimeError(
                "KINGSTRACK_ACCOUNTS must contain comma-separated company_id:user_id pairs."
            )
        account = (parts[0], parts[1])
        if account not in accounts:
            accounts.append(account)
    return accounts


def _request_account(company_id: str, user_id: str) -> list[dict[str, Any]]:
    url = f"{KINGSTRACK_ENDPOINT}?{urlencode({'company_id': company_id, 'user_id': user_id})}"
    request = Request(url, headers={
        "Accept": "application/json",
        "Cache-Control": "no-cache, no-store, max-age=0",
        "Pragma": "no-cache",
        "User-Agent": "BusTrack/1.0",
    })
    try:
        with urlopen(request, timeout=15) as response:  # noqa: S310 - fixed HTTPS endpoint
            payload = json.loads(response.read().decode("utf-8"))
    except (HTTPError, URLError, TimeoutError, json.JSONDecodeError) as error:
        raise RuntimeError(f"Kingstrack request failed: {error}") from error
    if not isinstance(payload, list) or any(not isinstance(item, dict) for item in payload):
        raise RuntimeError("Kingstrack returned an invalid fleet response.")
    return payload


def _store_position(db: Session, bus: Bus, data: dict[str, Any]) -> dict[str, Any]:
    """Validate and store one Kingstrack record through canonical route logic."""

    bus = lock_tracking_bus(db, bus.id)
    if (bus.gps_provider or "auto") not in {"auto", "kingstrack"}:
        raise ValueError(
            f"{bus.bus_number} is assigned to {bus.gps_provider}, not Kingstrack."
        )
    returned_registration = str(data.get("plate_no") or "").strip()
    if not returned_registration:
        raise ValueError("Kingstrack response has no plate number.")
    if _registration_key(returned_registration) != _registration_key(bus.registration_number):
        raise ValueError(
            f"Kingstrack returned {returned_registration}, not {bus.registration_number}."
        )

    latitude = _number(data.get("latitude"))
    longitude = _number(data.get("longitude"))
    if (
        latitude is None
        or longitude is None
        or not -90 <= latitude <= 90
        or not -180 <= longitude <= 180
    ):
        raise ValueError("Kingstrack returned invalid latitude or longitude.")

    imei = str(data.get("imei_no") or "").strip()
    if not imei:
        raise ValueError("Kingstrack response has no IMEI.")
    fix_time = _as_vendor_time(data.get("timestamp"))
    if fix_time is None:
        raise ValueError("Kingstrack response has no valid timestamp.")
    speed = _number(data.get("speed"))
    if speed is not None and speed < 0:
        speed = None
    ignition_value = data.get("ignition")
    ignition = ignition_value if isinstance(ignition_value, bool) else None
    gps_enabled = str(data.get("gps") or "").strip().upper() != "OFF"
    now = datetime.now(timezone.utc)
    quarantine_reason = future_timestamp_quarantine_reason(fix_time, now)
    raw_json = json.dumps(data, separators=(",", ":"), default=str)

    mapping = db.query(GPSDeviceMapping).filter(
        GPSDeviceMapping.external_device_id == imei,
        GPSDeviceMapping.is_active.is_(True),
    ).first()
    if mapping is not None and mapping.bus_id != bus.id:
        raise ValueError("Kingstrack IMEI is mapped to a different bus.")

    bus.gps_provider = "kingstrack"
    motion = None if speed is None else speed > 1
    history = ProviderGPSPosition(
        bus_id=bus.id,
        device_mapping_id=mapping.id if mapping else None,
        external_device_id=imei,
        latitude=latitude,
        longitude=longitude,
        speed_kmh=speed,
        course=None,
        altitude=None,
        accuracy=None,
        fix_time=fix_time,
        received_at=now,
        status="Running" if ignition else "Parked",
        ignition=ignition,
        motion=motion,
        valid=gps_enabled,
        protocol="kingstrack",
        quarantine_reason=quarantine_reason,
        raw_payload=raw_json,
    )
    db.add(history)
    db.flush()

    state = db.query(BusGPSState).filter(BusGPSState.bus_id == bus.id).first()
    current_time = (state.fix_time or state.received_at) if state else None
    if current_time is not None and current_time.tzinfo is None:
        current_time = current_time.replace(tzinfo=timezone.utc)
    apply = (
        gps_enabled
        and quarantine_reason is None
        and (state is None or current_time is None or fix_time > current_time)
    )
    active_trip_id = None
    if apply:
        if state is None:
            state = BusGPSState(
                bus_id=bus.id,
                external_device_id=imei,
                latitude=latitude,
                longitude=longitude,
                raw_payload=raw_json,
            )
            db.add(state)
        state.provider_position_id = history.id
        state.external_device_id = imei
        state.latitude = latitude
        state.longitude = longitude
        state.speed_kmh = speed
        state.course = None
        state.altitude = None
        state.accuracy = None
        state.fix_time = fix_time
        state.received_at = now
        state.status = history.status
        state.ignition = ignition
        state.motion = motion
        state.valid = True
        state.protocol = "kingstrack"
        state.raw_payload = raw_json

    # The same guarded progression function handles outbound/return order,
    # reset boundaries, skipped stops and legitimate terminal reversal.
    if quarantine_reason is None and state is not None:
        active_trip_id = _update_active_trip_from_vehicle(
            db,
            _position_from_current_state(state),
            bus.id,
            now,
        )

    return {
        "bus_id": bus.id,
        "bus_number": bus.bus_number,
        "registration_number": bus.registration_number,
        "imei": imei,
        "source_date": fix_time,
        "applied": apply,
        "quarantined": quarantine_reason is not None,
        "quarantine_reason": quarantine_reason,
        "provider_position_id": history.id,
        "active_trip_id": active_trip_id,
    }


def _refresh_kingstrack_unlocked(
    db: Session,
    *,
    bus_id: int | None = None,
) -> dict[str, Any]:
    accounts = configured_accounts()
    if not accounts:
        raise RuntimeError("KINGSTRACK_ACCOUNTS is not configured.")

    bus_query = db.query(Bus)
    if bus_id is not None:
        bus_query = bus_query.filter(Bus.id == bus_id)
    buses = bus_query.order_by(Bus.id).all()
    buses_by_registration = {
        _registration_key(bus.registration_number): bus
        for bus in buses
        if (bus.gps_provider or "auto") in {"auto", "kingstrack"}
    }
    configured_kingstrack_buses = {
        bus.id: bus
        for bus in buses
        if bus.gps_provider == "kingstrack"
    }
    updated: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []
    seen_bus_ids: set[int] = set()
    request_count = 0

    for company_id, user_id in accounts:
        try:
            records = _request_account(company_id, user_id)
            request_count += 1
        except RuntimeError as error:
            errors.append({"account": company_id, "reason": str(error)})
            continue
        for data in records:
            plate = str(data.get("plate_no") or "").strip()
            bus = buses_by_registration.get(_registration_key(plate))
            if bus is None:
                skipped.append({"registration_number": plate or None, "reason": "No matching BusTrack bus."})
                continue
            try:
                stored = _store_position(db, bus, data)
                updated.append(stored)
                seen_bus_ids.add(bus.id)
                record_provider_success(
                    db,
                    bus.id,
                    protocol="kingstrack",
                    source_time=stored["source_date"] if not stored["quarantined"] else None,
                )
            except ValueError as error:
                errors.append({"bus_id": bus.id, "registration_number": plate, "reason": str(error)})
                record_provider_error(db, bus.id, error, protocol="kingstrack")

    for bus_id_value, bus in configured_kingstrack_buses.items():
        if bus_id_value in seen_bus_ids:
            continue
        reason = "Bus was not returned by any configured Kingstrack account."
        errors.append({"bus_id": bus.id, "registration_number": bus.registration_number, "reason": reason})
        record_provider_error(db, bus.id, reason, protocol="kingstrack")

    db.commit()
    return {
        "provider": "kingstrack",
        "updated": updated,
        "skipped": skipped,
        "errors": errors,
        "provider_requests": request_count,
    }


def refresh_kingstrack(db: Session, *, bus_id: int | None = None) -> dict[str, Any]:
    """Refresh both Kingstrack accounts as one serialized provider operation."""

    with _REFRESH_LOCK:
        return _refresh_kingstrack_unlocked(db, bus_id=bus_id)
