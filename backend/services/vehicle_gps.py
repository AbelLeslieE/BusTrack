"""Shared rules for deciding when vehicle GPS is the live source of truth."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone


# The MVD vendor publishes a moving bus fix every 20 seconds and a parked
# (ignition-off) heartbeat every two minutes. Three missed reports marks the
# signal stale while still allowing normal delivery jitter.
VEHICLE_GPS_IGNITION_ON_INTERVAL_SECONDS = 20
VEHICLE_GPS_IGNITION_OFF_INTERVAL_SECONDS = 120


def vehicle_gps_expected_interval_seconds(ignition: bool | None) -> int:
    return (
        VEHICLE_GPS_IGNITION_ON_INTERVAL_SECONDS
        if ignition is True
        else VEHICLE_GPS_IGNITION_OFF_INTERVAL_SECONDS
    )


def vehicle_gps_is_authoritative(state, now: datetime | None = None) -> bool:
    """Return true only for a recent, valid, ignition-on vehicle position."""

    if state is None or state.ignition is not True or state.valid is False:
        return False

    position_time = state.fix_time or state.received_at
    if position_time is None:
        return False
    if position_time.tzinfo is None:
        position_time = position_time.replace(tzinfo=timezone.utc)

    return position_time >= (now or datetime.now(timezone.utc)) - timedelta(
        seconds=vehicle_gps_expected_interval_seconds(state.ignition) * 3
    )
