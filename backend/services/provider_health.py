"""Persist provider contact outcomes independently from GPS fix freshness."""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy.orm import Session

from backend.routes.models_tracking import GPSProviderHealthState


def _utc(value: datetime | None = None) -> datetime:
    moment = value or datetime.now(timezone.utc)
    return (
        moment.replace(tzinfo=timezone.utc)
        if moment.tzinfo is None
        else moment.astimezone(timezone.utc)
    )


def record_provider_success(
    db: Session,
    bus_id: int,
    *,
    protocol: str | None,
    attempted_at: datetime | None = None,
    source_time: datetime | None = None,
) -> GPSProviderHealthState:
    """Record a successful provider response without claiming its fix is fresh."""

    now = _utc(attempted_at)
    state = db.query(GPSProviderHealthState).filter(
        GPSProviderHealthState.bus_id == bus_id
    ).first()
    if state is None:
        state = GPSProviderHealthState(bus_id=bus_id)
        db.add(state)
    state.protocol = protocol or state.protocol
    state.last_attempt_at = now
    state.last_success_at = now
    state.last_error = None
    state.consecutive_errors = 0
    if source_time is not None:
        normalized_source_time = _utc(source_time)
        current_source_time = state.last_source_time
        if current_source_time is not None:
            current_source_time = _utc(current_source_time)
        if current_source_time is None or normalized_source_time > current_source_time:
            state.last_source_time = normalized_source_time
    return state


def record_provider_error(
    db: Session,
    bus_id: int,
    error: object,
    *,
    protocol: str | None,
    attempted_at: datetime | None = None,
) -> GPSProviderHealthState:
    """Record a failed provider contact while retaining the last good fix."""

    now = _utc(attempted_at)
    state = db.query(GPSProviderHealthState).filter(
        GPSProviderHealthState.bus_id == bus_id
    ).first()
    if state is None:
        state = GPSProviderHealthState(bus_id=bus_id)
        db.add(state)
    state.protocol = protocol or state.protocol
    state.last_attempt_at = now
    state.last_error_at = now
    state.last_error = str(error)[:500]
    state.consecutive_errors = (state.consecutive_errors or 0) + 1
    return state
