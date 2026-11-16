"""Opt-in route recordings assembled from accepted fleet GPS observations.

Phone Tracer recordings remain independent. This module only copies a newly
accepted Airotrack/Kingstrack fix when the bus and the active peak window are
explicitly enabled by a technician.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time as wall_time, timezone
import json
import logging
import math
import uuid

from sqlalchemy.orm import Session

from backend.models import Bus
from backend.models_route_studio import (
    ProviderTraceSetting,
    TracePoint,
    TraceSession,
)
from backend.services.gps_schedule import IST, PEAK_WINDOWS, as_ist
from backend.services.road_matching import road_geometry


logger = logging.getLogger(__name__)
PROVIDER_TRACE_SOURCE = "provider_gps"


@dataclass(frozen=True)
class CaptureWindow:
    name: str
    label: str
    start: datetime
    end: datetime

    @property
    def key(self) -> str:
        return f"{self.start.date().isoformat()}:{self.name}"


def windows_for_day(day: date) -> tuple[CaptureWindow, CaptureWindow]:
    labels = (("morning", "Morning"), ("evening", "Evening"))
    return tuple(
        CaptureWindow(
            name=name,
            label=label,
            start=datetime.combine(day, times[0], tzinfo=IST),
            end=datetime.combine(day, times[1], tzinfo=IST),
        )
        for (name, label), times in zip(labels, PEAK_WINDOWS)
    )


def active_capture_window(now: datetime | None = None) -> CaptureWindow | None:
    local = as_ist(now)
    return next(
        (window for window in windows_for_day(local.date()) if window.start <= local < window.end),
        None,
    )


def _window_from_key(value: str | None) -> CaptureWindow | None:
    try:
        day_text, name = str(value or "").split(":", 1)
        day = date.fromisoformat(day_text)
    except (TypeError, ValueError):
        return None
    return next((window for window in windows_for_day(day) if window.name == name), None)


def _enabled(setting: ProviderTraceSetting | None, window_name: str) -> bool:
    if setting is None:
        return False
    return bool(
        setting.morning_enabled if window_name == "morning" else setting.evening_enabled
    )


def record_provider_trace_observation(
    db: Session,
    *,
    bus: Bus,
    protocol: str,
    latitude: float,
    longitude: float,
    recorded_at: datetime,
    accuracy: float | None,
    speed_kmh: float | None,
    heading: float | None,
    received_at: datetime | None = None,
) -> str | None:
    """Append one accepted, non-duplicate provider fix to an armed window."""

    observed_at = recorded_at if recorded_at.tzinfo else recorded_at.replace(tzinfo=timezone.utc)
    window = active_capture_window(received_at or observed_at)
    if window is None:
        return None
    setting = db.get(ProviderTraceSetting, bus.id)
    if not _enabled(setting, window.name):
        return None
    values = (latitude, longitude)
    if not all(isinstance(value, (int, float)) and math.isfinite(value) for value in values):
        return None
    if not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
        return None

    session = db.query(TraceSession).filter(
        TraceSession.bus_id == bus.id,
        TraceSession.source == PROVIDER_TRACE_SOURCE,
        TraceSession.capture_window == window.key,
    ).first()
    if session is not None and session.status != "RECORDING":
        return session.id
    if session is None:
        session = TraceSession(
            id=str(uuid.uuid4()),
            # Provider captures are system-owned and are never exposed in a
            # phone Tracer account's personal recording list.
            user_id=0,
            bus_id=bus.id,
            status="RECORDING",
            name=f"{bus.bus_number} GPS · {window.start:%d %b %Y} {window.label}",
            source=PROVIDER_TRACE_SOURCE,
            capture_window=window.key,
        )
        db.add(session)
        db.flush()

    last = db.query(TracePoint).filter(
        TracePoint.session_id == session.id
    ).order_by(TracePoint.sequence.desc()).first()
    timestamp = observed_at.astimezone(timezone.utc).isoformat()
    if last is not None:
        previous = json.loads(last.payload)
        if (
            previous.get("recorded_at") == timestamp
            and float(previous.get("latitude")) == float(latitude)
            and float(previous.get("longitude")) == float(longitude)
        ):
            return session.id
        sequence = last.sequence + 1
    else:
        sequence = 1
    if sequence > 20_000:
        logger.warning("Provider trace %s reached its sample limit.", session.id)
        return session.id

    normalized_accuracy = 10.0 if accuracy is None else max(0.0, min(35.0, float(accuracy)))
    speed_mps = None if speed_kmh is None else max(0.0, float(speed_kmh) / 3.6)
    normalized_heading = (
        float(heading) % 360
        if heading is not None and math.isfinite(float(heading))
        else None
    )
    payload = {
        "sequence": sequence,
        "latitude": float(latitude),
        "longitude": float(longitude),
        "recorded_at": timestamp,
        "accuracy": normalized_accuracy,
        "speed": speed_mps,
        "heading": normalized_heading,
        "protocol": protocol,
    }
    db.add(TracePoint(
        session_id=session.id,
        sequence=sequence,
        payload=json.dumps(payload, sort_keys=True),
    ))
    return session.id


def safely_record_provider_trace_observation(db: Session, **values) -> str | None:
    """Isolate route capture so it can never roll back canonical live GPS."""

    try:
        with db.begin_nested():
            return record_provider_trace_observation(db, **values)
    except Exception:
        logger.exception("Optional provider route capture failed; live GPS was preserved.")
        return None


def _finish(session: TraceSession, db: Session, ended_at: datetime) -> None:
    points = db.query(TracePoint).filter(
        TracePoint.session_id == session.id
    ).order_by(TracePoint.sequence).all()
    raw = [json.loads(point.payload) for point in points]
    geometry, matched = road_geometry(raw)
    session.ended_at = ended_at.astimezone(timezone.utc)
    if len(geometry) < 2:
        session.status = "DISCARDED"
        logger.info(
            "Discarded provider trace %s because it had no reliable movement (%s raw fixes).",
            session.id,
            len(raw),
        )
        return
    session.geometry_json = json.dumps(geometry)
    session.status = "DRAFT"
    logger.info(
        "Finished provider trace %s with %s raw fixes and %s geometry points (OSRM=%s).",
        session.id,
        len(raw),
        len(geometry),
        matched,
    )


def finalize_provider_traces(
    db: Session,
    *,
    now: datetime | None = None,
    bus_id: int | None = None,
) -> list[str]:
    """Close expired captures, or captures whose switch has been turned off."""

    current = as_ist(now)
    query = db.query(TraceSession).filter(
        TraceSession.source == PROVIDER_TRACE_SOURCE,
        TraceSession.status == "RECORDING",
    )
    if bus_id is not None:
        query = query.filter(TraceSession.bus_id == bus_id)
    sessions = query.all()
    bus_ids = {session.bus_id for session in sessions}
    settings = {
        setting.bus_id: setting
        for setting in db.query(ProviderTraceSetting).filter(
            ProviderTraceSetting.bus_id.in_(bus_ids)
        ).all()
    } if bus_ids else {}
    finished: list[str] = []
    for session in sessions:
        window = _window_from_key(session.capture_window)
        expired = window is None or current >= window.end
        disabled = window is None or not _enabled(settings.get(session.bus_id), window.name)
        if not (expired or disabled):
            continue
        _finish(session, db, current)
        finished.append(session.id)
    return finished


def capture_schedule_payload(now: datetime | None = None) -> dict:
    local = as_ist(now)
    active = active_capture_window(local)
    return {
        "server_ist": local,
        "active_window": active.name if active else None,
        "windows": [
            {
                "name": window.name,
                "label": window.label,
                "start": window.start.strftime("%H:%M"),
                "end": window.end.strftime("%H:%M"),
            }
            for window in windows_for_day(local.date())
        ],
    }
