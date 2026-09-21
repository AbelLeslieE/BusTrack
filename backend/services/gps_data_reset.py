"""Guard the clean boundary between deleted GPS history and new telemetry."""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy.orm import Session

from backend.routes.models_tracking import GPSDataResetBoundary


def _as_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return (
        value.replace(tzinfo=timezone.utc)
        if value.tzinfo is None
        else value.astimezone(timezone.utc)
    )


def observation_crosses_reset_boundary(
    db: Session,
    *,
    bus_id: int,
    fix_time: datetime | None,
    received_at: datetime,
) -> bool:
    """Accept only a genuinely post-reset observation for a waiting bus.

    Timestamped providers must advance beyond the last deleted device fix.
    Authenticated webhook payloads without a device timestamp are new when
    their server receipt occurs after the reset.
    """

    boundary = db.get(GPSDataResetBoundary, bus_id)
    if boundary is None:
        return True
    if fix_time is None:
        received = _as_utc(received_at)
        reset_at = _as_utc(boundary.reset_at)
        return received is not None and reset_at is not None and received > reset_at
    previous = _as_utc(boundary.previous_fix_time)
    return previous is None or _as_utc(fix_time) > previous


def advance_reset_boundary(
    db: Session,
    *,
    bus_id: int,
    fix_time: datetime | None,
) -> None:
    """Remember a newer rejected/quarantined fix without restoring GPS state."""

    if fix_time is None:
        return
    boundary = db.get(GPSDataResetBoundary, bus_id)
    if boundary is None:
        return
    current = _as_utc(boundary.previous_fix_time)
    candidate = _as_utc(fix_time)
    if current is None or (candidate is not None and candidate > current):
        boundary.previous_fix_time = fix_time


def clear_reset_boundary(db: Session, *, bus_id: int) -> None:
    """Finish the waiting state after a new observation becomes current."""

    boundary = db.get(GPSDataResetBoundary, bus_id)
    if boundary is not None:
        db.delete(boundary)
