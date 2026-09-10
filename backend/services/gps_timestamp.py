"""Validate provider clocks and repair snapshots poisoned by future fixes."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
import os

from sqlalchemy.orm import Session


DEFAULT_FUTURE_SKEW_SECONDS = 300


def as_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return (
        value.replace(tzinfo=timezone.utc)
        if value.tzinfo is None
        else value.astimezone(timezone.utc)
    )


def allowed_future_skew_seconds() -> int:
    """Allow small tracker clock drift while rejecting implausible dates."""

    try:
        value = int(os.getenv(
            "GPS_MAX_FUTURE_SKEW_SECONDS",
            str(DEFAULT_FUTURE_SKEW_SECONDS),
        ))
    except ValueError:
        return DEFAULT_FUTURE_SKEW_SECONDS
    return value if 0 <= value <= 3600 else DEFAULT_FUTURE_SKEW_SECONDS


def future_timestamp_seconds(
    timestamp: datetime | None,
    received_at: datetime,
) -> int | None:
    """Return excessive future skew, or ``None`` for an acceptable clock."""

    fixed = as_utc(timestamp)
    received = as_utc(received_at)
    if fixed is None or received is None:
        return None
    seconds_ahead = int((fixed - received).total_seconds())
    return (
        seconds_ahead
        if seconds_ahead > allowed_future_skew_seconds()
        else None
    )


def future_timestamp_quarantine_reason(
    timestamp: datetime | None,
    received_at: datetime,
) -> str | None:
    seconds_ahead = future_timestamp_seconds(timestamp, received_at)
    if seconds_ahead is None:
        return None
    return (
        f"Device timestamp is {seconds_ahead} seconds ahead of BusTrack receipt "
        f"time; maximum allowed clock skew is {allowed_future_skew_seconds()} seconds."
    )


def _copy_provider_position_to_state(state, position) -> None:
    state.provider_position_id = position.id
    state.external_device_id = position.external_device_id
    state.latitude = position.latitude
    state.longitude = position.longitude
    state.speed_kmh = position.speed_kmh
    state.course = position.course
    state.altitude = position.altitude
    state.accuracy = position.accuracy
    state.fix_time = position.fix_time
    state.received_at = position.received_at
    state.status = position.status
    state.ignition = position.ignition
    state.motion = position.motion
    state.valid = position.valid
    state.protocol = position.protocol
    state.raw_payload = position.raw_payload


def repair_future_gps_states(
    db: Session,
    *,
    now: datetime | None = None,
) -> dict[str, int]:
    """Quarantine historic future fixes and restore each affected live snapshot.

    Provider history is preserved. Only the derived current-state snapshot and
    matching vehicle-owned trip location are restored, so route assignments,
    stop definitions, and stop history remain untouched.
    """

    from backend.audit import record_audit_event
    from backend.routes.models_tracking import (
        BusGPSState,
        GPSProviderHealthState,
        LiveTrip,
        ProviderGPSPosition,
    )
    from backend.services.trip_reset import lock_tracking_bus

    current_time = as_utc(now) or datetime.now(timezone.utc)
    cutoff = current_time + timedelta(seconds=allowed_future_skew_seconds())
    future_positions = db.query(ProviderGPSPosition).filter(
        ProviderGPSPosition.fix_time.is_not(None),
        ProviderGPSPosition.fix_time > cutoff,
    ).all()
    for position in future_positions:
        position.quarantine_reason = future_timestamp_quarantine_reason(
            position.fix_time,
            position.received_at,
        )

    affected_states = db.query(BusGPSState).filter(
        BusGPSState.fix_time.is_not(None),
        BusGPSState.fix_time > cutoff,
    ).all()
    repaired = 0
    cleared = 0
    for loaded_state in affected_states:
        bus_id = loaded_state.bus_id
        lock_tracking_bus(db, bus_id)
        state = db.query(BusGPSState).populate_existing().filter(
            BusGPSState.bus_id == bus_id,
        ).first()
        if state is None or as_utc(state.fix_time) <= cutoff:
            continue

        previous_position_id = state.provider_position_id
        replacement = db.query(ProviderGPSPosition).filter(
            ProviderGPSPosition.bus_id == bus_id,
            ProviderGPSPosition.fix_time.is_not(None),
            ProviderGPSPosition.fix_time <= cutoff,
            ProviderGPSPosition.quarantine_reason.is_(None),
        ).order_by(
            ProviderGPSPosition.fix_time.desc(),
            ProviderGPSPosition.received_at.desc(),
            ProviderGPSPosition.id.desc(),
        ).first()

        running_trips = db.query(LiveTrip).filter(
            LiveTrip.bus_id == bus_id,
            LiveTrip.status == "Running",
            LiveTrip.ended_at.is_(None),
        ).all()
        provider_health = db.query(GPSProviderHealthState).filter(
            GPSProviderHealthState.bus_id == bus_id,
        ).first()
        if replacement is None:
            db.delete(state)
            for trip in running_trips:
                if (
                    trip.current_location_source == "vehicle_gps"
                    and as_utc(trip.last_location_update)
                    and as_utc(trip.last_location_update) > cutoff
                ):
                    trip.current_latitude = None
                    trip.current_longitude = None
                    trip.current_speed = None
                    trip.current_accuracy = None
                    trip.last_location_update = None
            if provider_health is not None:
                provider_health.last_source_time = None
            cleared += 1
            replacement_id = None
            replacement_time = None
        else:
            _copy_provider_position_to_state(state, replacement)
            if provider_health is not None:
                provider_health.last_source_time = replacement.fix_time
            for trip in running_trips:
                if (
                    trip.current_location_source == "vehicle_gps"
                    and as_utc(trip.last_location_update)
                    and as_utc(trip.last_location_update) > cutoff
                ):
                    trip.current_latitude = replacement.latitude
                    trip.current_longitude = replacement.longitude
                    trip.current_speed = replacement.speed_kmh
                    trip.current_accuracy = replacement.accuracy
                    trip.last_location_update = replacement.fix_time
                if as_utc(trip.started_at) and as_utc(trip.started_at) > cutoff:
                    trip.started_at = replacement.fix_time
                if as_utc(trip.current_stop_arrived_at) and as_utc(trip.current_stop_arrived_at) > cutoff:
                    trip.current_stop_arrived_at = None
                if as_utc(trip.current_stop_departed_at) and as_utc(trip.current_stop_departed_at) > cutoff:
                    trip.current_stop_departed_at = None
                if as_utc(trip.terminal_reached_at) and as_utc(trip.terminal_reached_at) > cutoff:
                    trip.terminal_reached_at = None
                    trip.terminal_stop_id = None
            repaired += 1
            replacement_id = replacement.id
            replacement_time = replacement.fix_time

        record_audit_event(
            db,
            category="gps",
            action="future_timestamp_state_repaired",
            actor_username="BusTrack startup repair",
            actor_role="System",
            subject_type="bus",
            subject_id=bus_id,
            subject_label=f"Bus {bus_id}",
            details={
                "previous_provider_position_id": previous_position_id,
                "replacement_provider_position_id": replacement_id,
                "replacement_fix_time": replacement_time,
                "repair_time": current_time,
            },
        )

    return {
        "quarantined_positions": len(future_positions),
        "repaired_states": repaired,
        "cleared_states": cleared,
    }
