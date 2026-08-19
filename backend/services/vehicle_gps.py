"""Shared rules for deciding when vehicle GPS is the live source of truth."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone


def vehicle_gps_is_authoritative(state, now: datetime | None = None) -> bool:
    """Return true only for a recent, valid, ignition-on vehicle position."""

    if state is None or state.ignition is not True or state.valid is False:
        return False

    position_time = state.fix_time or state.received_at
    if position_time is None:
        return False
    if position_time.tzinfo is None:
        position_time = position_time.replace(tzinfo=timezone.utc)

    return position_time >= (now or datetime.now(timezone.utc)) - timedelta(seconds=60)
