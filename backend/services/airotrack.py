"""Pull live GPS positions from the Airotrack API.

The vendor API is queried only by the backend.  Browser clients never receive
the vendor token; they continue to read the normal BusTrack live-tracking API.
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
import json
import os
from threading import Lock
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session

from backend.models import Bus
from backend.routes.gps_provider import _position_from_current_state, _update_active_trip_from_vehicle
from backend.routes.models_tracking import BusGPSState, GPSDeviceMapping, ProviderGPSPosition
from backend.services.provider_health import record_provider_error, record_provider_success
from backend.services.vehicle_gps import GPS_OFFLINE_GRACE_SECONDS


AIROTRACK_ENDPOINT = "https://api.airotrack.in/api/vehicle-live-data"
_REFRESH_LOCK = Lock()


def _registration_key(value: Any) -> str:
    """Compare plates independently of spaces, punctuation, and letter case."""

    return "".join(character for character in str(value or "").upper() if character.isalnum())


def _as_vendor_time(value: Any) -> datetime | None:
    """Convert Airotrack's ``DD-MM-YYYY hh:mm:ss AM`` timestamp to UTC."""

    if not isinstance(value, str) or not value.strip():
        return None
    try:
        local_time = datetime.strptime(value.strip(), "%d-%m-%Y %I:%M:%S %p")
    except ValueError:
        return None
    return local_time.replace(tzinfo=ZoneInfo("Asia/Kolkata")).astimezone(timezone.utc)


def _number(value: Any) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _ignition(value: Any) -> bool | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip().upper()
    if normalized == "ON":
        return True
    if normalized == "OFF":
        return False
    return None


def _request_vehicle(token: str, keyword: str) -> dict[str, Any]:
    url = f"{AIROTRACK_ENDPOINT}?{urlencode({'token': token, 'keyword': keyword})}"
    request = Request(url, headers={
        "Accept": "application/json",
        "Cache-Control": "no-cache, no-store, max-age=0",
        "Pragma": "no-cache",
        "User-Agent": "BusTrack/1.0",
    })
    try:
        with urlopen(request, timeout=15) as response:  # noqa: S310 - fixed HTTPS vendor endpoint
            payload = json.loads(response.read().decode("utf-8"))
    except (HTTPError, URLError, TimeoutError, json.JSONDecodeError) as error:
        raise RuntimeError(f"Airotrack request failed: {error}") from error
    if not isinstance(payload, dict):
        raise RuntimeError("Airotrack returned an invalid response.")
    return payload


def _bounded_integer(name: str, default: int, *, minimum: int, maximum: int) -> int:
    try:
        value = int(os.getenv(name, str(default)))
    except ValueError:
        return default
    return value if minimum <= value <= maximum else default


def _fetch_most_advanced_vehicle(
    token: str,
    keyword: str,
    *,
    catch_up: bool,
) -> list[dict[str, Any]]:
    """Pull through a delayed vendor queue and return every observed packet.

    Some Airotrack responses advance through queued heartbeats after a service
    wakes.  One GET can therefore be a successful response while still being
    many minutes behind.  For a stale bus we keep requesting until the device
    timestamp stops advancing, becomes current, or reaches a bounded limit.
    The caller persists every response and strict timestamp checks select the
    most advanced one as the visible state.
    """

    maximum_requests = (
        _bounded_integer("AIROTRACK_CATCHUP_MAX_REQUESTS", 8, minimum=2, maximum=20)
        if catch_up
        else 1
    )
    responses: list[dict[str, Any]] = []
    previous_source_time: datetime | None = None
    freshness_cutoff = datetime.now(timezone.utc) - timedelta(
        seconds=GPS_OFFLINE_GRACE_SECONDS
    )

    for _ in range(maximum_requests):
        try:
            response = _request_vehicle(token, keyword)
        except RuntimeError:
            # The first response is already useful. A best-effort follow-up
            # timing out must not discard the newer coordinate we obtained.
            if responses:
                break
            raise
        if response.get("status") != "success" or not isinstance(response.get("data"), dict):
            if responses:
                break
            raise RuntimeError(
                str(response.get("error") or "Vehicle was not returned by Airotrack.")
            )
        data = response["data"]
        source_time = _as_vendor_time(data.get("source_date"))
        responses.append(data)

        if not catch_up or source_time is None or source_time >= freshness_cutoff:
            break
        # Always allow one follow-up for a stale first response. After that,
        # stop as soon as the vendor repeats or moves backwards.
        if previous_source_time is not None and source_time <= previous_source_time:
            break
        previous_source_time = source_time

    return responses


def _store_position(db: Session, bus: Bus, data: dict[str, Any]) -> dict[str, Any]:
    # Serialize current-state decisions with webhook writes. Without this row
    # lock, two concurrent workers could both compare against an old value and
    # let the slower transaction overwrite a newer device timestamp.
    bus = db.query(Bus).filter(Bus.id == bus.id).with_for_update().one()
    returned_registration = str(data.get("vehicle_registration") or "").strip()
    if not returned_registration:
        raise ValueError("Airotrack response has no vehicle registration.")
    if _registration_key(returned_registration) != _registration_key(bus.registration_number):
        raise ValueError(
            f"Airotrack returned {returned_registration}, not the requested registration {bus.registration_number}."
        )

    latitude, longitude = _number(data.get("latitude")), _number(data.get("longitude"))
    if latitude is None or longitude is None or not -90 <= latitude <= 90 or not -180 <= longitude <= 180:
        raise ValueError("Airotrack returned invalid latitude or longitude.")

    imei = str(data.get("imei_no") or "").strip()
    if not imei:
        raise ValueError("Airotrack response has no IMEI.")
    fix_time = _as_vendor_time(data.get("source_date"))
    if fix_time is None:
        raise ValueError("Airotrack response has no valid source_date timestamp.")
    speed = _number(data.get("speed"))
    if speed is not None and speed < 0:
        speed = None
    ignition = _ignition(data.get("ignition"))
    now = datetime.now(timezone.utc)
    position = {
        "latitude": latitude,
        "longitude": longitude,
        "speed_kmh": speed,
        "accuracy": None,
        "fix_time": fix_time,
        "valid": True,
    }
    raw_json = json.dumps(data, separators=(",", ":"), default=str)
    mapping = db.query(GPSDeviceMapping).filter(
        GPSDeviceMapping.external_device_id == imei,
        GPSDeviceMapping.is_active.is_(True),
    ).first()
    if mapping is not None and mapping.bus_id != bus.id:
        raise ValueError("Airotrack IMEI is mapped to a different bus.")
    history = ProviderGPSPosition(
        bus_id=bus.id, device_mapping_id=mapping.id if mapping else None,
        external_device_id=imei, latitude=latitude, longitude=longitude,
        speed_kmh=speed, course=None, altitude=None, accuracy=None,
        fix_time=fix_time, received_at=now,
        status="Running" if ignition else "Parked", ignition=ignition,
        motion=None if speed is None else speed > 1, valid=True,
        protocol="airotrack", raw_payload=raw_json,
    )
    db.add(history)
    db.flush()

    state = db.query(BusGPSState).filter(BusGPSState.bus_id == bus.id).first()
    current_position_time = (state.fix_time or state.received_at) if state else None
    if current_position_time is not None and current_position_time.tzinfo is None:
        current_position_time = current_position_time.replace(tzinfo=timezone.utc)
    apply = state is None or current_position_time is None or fix_time > current_position_time
    active_trip_id = None
    if apply:
        if state is None:
            state = BusGPSState(bus_id=bus.id, external_device_id=imei, latitude=latitude, longitude=longitude, raw_payload=raw_json)
            db.add(state)
        state.provider_position_id, state.external_device_id = history.id, imei
        state.latitude, state.longitude, state.speed_kmh = latitude, longitude, speed
        state.course, state.altitude, state.accuracy, state.fix_time = None, None, None, fix_time
        state.received_at, state.status, state.ignition, state.motion = now, history.status, ignition, history.motion
        state.valid, state.protocol, state.raw_payload = True, "airotrack", raw_json
    # Reconcile from the canonical saved state even when Airotrack repeats the
    # same source_date. This repairs a missing provider-owned route session
    # after assignments change without treating the repeated payload as a new
    # coordinate or allowing it to move the route backwards.
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
        "provider_position_id": history.id,
        "active_trip_id": active_trip_id,
    }


def _refresh_airotrack_unlocked(db: Session, *, bus_id: int | None = None) -> dict[str, Any]:
    """Fetch configured buses and catch up any delayed vendor heartbeat queue."""

    token = os.getenv("AIROTRACK_API_TOKEN", "").strip()
    if not token:
        raise RuntimeError("AIROTRACK_API_TOKEN is not configured.")
    query = db.query(Bus)
    if bus_id is not None:
        query = query.filter(Bus.id == bus_id)
    buses = query.order_by(Bus.id).all()
    updated, skipped, errors = [], [], []

    current_states = {
        state.bus_id: state
        for state in db.query(BusGPSState).filter(
            BusGPSState.bus_id.in_([bus.id for bus in buses])
        ).all()
    } if buses else {}
    refresh_started_at = datetime.now(timezone.utc)
    lookup_buses: list[tuple[Bus, str, bool]] = []
    for bus in buses:
        # Airotrack accepts the registration number directly, so the existing
        # Bus registration field is the one value administrators maintain for
        # every bus. The API returns and stores the tracker IMEI itself.
        keyword = (bus.registration_number or "").strip()
        if not keyword:
            reason = "No registration number configured."
            skipped.append({"bus_id": bus.id, "reason": reason})
            record_provider_error(
                db, bus.id, reason, protocol="airotrack", attempted_at=refresh_started_at
            )
            continue
        state = current_states.get(bus.id)
        state_time = (state.fix_time or state.received_at) if state else None
        if state_time is not None and state_time.tzinfo is None:
            state_time = state_time.replace(tzinfo=timezone.utc)
        catch_up = state_time is None or state_time < (
            refresh_started_at - timedelta(seconds=GPS_OFFLINE_GRACE_SECONDS)
        )
        lookup_buses.append((bus, keyword, catch_up))

    # A fleet refresh can contain 24 vehicles. Fetch in small bounded batches
    # so a slow/offline tracker does not delay every other bus, while avoiding
    # an uncontrolled burst against the vendor API.
    with ThreadPoolExecutor(max_workers=min(6, len(lookup_buses) or 1)) as executor:
        pending = {
            executor.submit(
                _fetch_most_advanced_vehicle,
                token,
                keyword,
                catch_up=catch_up,
            ): (bus, keyword, catch_up)
            for bus, keyword, catch_up in lookup_buses
        }
        for future in as_completed(pending):
            bus, keyword, catch_up = pending[future]
            try:
                responses = future.result()
                # Persist by source time so even an out-of-order provider
                # batch ends with the most advanced coordinate selected.
                responses.sort(key=lambda item: _as_vendor_time(item.get("source_date")) or datetime.min.replace(tzinfo=timezone.utc))
                stored: list[dict[str, Any]] = []
                for data in responses:
                    try:
                        stored.append(_store_position(db, bus, data))
                    except ValueError as error:
                        errors.append({
                            "bus_id": bus.id,
                            "keyword": keyword,
                            "reason": str(error),
                        })
                if not stored:
                    record_provider_error(
                        db,
                        bus.id,
                        errors[-1]["reason"] if errors else "No valid Airotrack position was returned.",
                        protocol="airotrack",
                    )
                    continue
                newest = max(stored, key=lambda item: item["source_date"])
                newest["provider_requests"] = len(responses)
                newest["stored_positions"] = len(stored)
                newest["catch_up"] = catch_up
                updated.append(newest)
                record_provider_success(
                    db,
                    bus.id,
                    protocol="airotrack",
                    source_time=newest["source_date"],
                )
            except (RuntimeError, ValueError) as error:
                errors.append({"bus_id": bus.id, "keyword": keyword, "reason": str(error)})
                record_provider_error(db, bus.id, error, protocol="airotrack")
    db.commit()
    return {"updated": updated, "skipped": skipped, "errors": errors}


def refresh_airotrack(db: Session, *, bus_id: int | None = None) -> dict[str, Any]:
    """Run one fleet refresh at a time within this service process."""

    with _REFRESH_LOCK:
        return _refresh_airotrack_unlocked(db, bus_id=bus_id)
