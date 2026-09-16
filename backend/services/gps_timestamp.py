"""Validate provider clocks and isolate device time from tracking time."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
import os

from sqlalchemy import func
from sqlalchemy.orm import Session


DEFAULT_FUTURE_SKEW_SECONDS = 300
DEFAULT_CLOCK_FALLBACK_MIN_AGE_SECONDS = 6 * 60 * 60
DEFAULT_CLOCK_RATE_TOLERANCE_SECONDS = 60
DEFAULT_CLOCK_EPOCH_RECOVERY_STALE_SECONDS = 5 * 60

DEVICE_TIME_BASIS = "device"
RECEIPT_CLOCK_FALLBACK_BASIS = "receipt_clock_fallback"
MISSING_DEVICE_TIME_BASIS = "receipt_missing"


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


def _bounded_setting(name: str, default: int, minimum: int, maximum: int) -> int:
    try:
        value = int(os.getenv(name, str(default)))
    except ValueError:
        return default
    return value if minimum <= value <= maximum else default


def clock_fallback_min_age_seconds() -> int:
    """Age at which a past device date can be considered a broken clock."""

    return _bounded_setting(
        "GPS_CLOCK_FALLBACK_MIN_AGE_SECONDS",
        DEFAULT_CLOCK_FALLBACK_MIN_AGE_SECONDS,
        300,
        7 * 24 * 60 * 60,
    )


def clock_rate_tolerance_seconds() -> int:
    """Maximum difference between device and receipt elapsed time."""

    return _bounded_setting(
        "GPS_CLOCK_RATE_TOLERANCE_SECONDS",
        DEFAULT_CLOCK_RATE_TOLERANCE_SECONDS,
        5,
        10 * 60,
    )


def clock_epoch_recovery_stale_seconds() -> int:
    """How stale a live snapshot must be before a new clock epoch may replace it."""

    return _bounded_setting(
        "GPS_CLOCK_EPOCH_RECOVERY_STALE_SECONDS",
        DEFAULT_CLOCK_EPOCH_RECOVERY_STALE_SECONDS,
        60,
        60 * 60,
    )


def latest_clock_observation(
    db: Session,
    *,
    bus_id: int,
    protocol: str | None,
    external_device_id: str | None,
):
    """Return the preceding raw observation used only to prove clock movement.

    This deliberately includes a quarantined first sample. A second sample can
    therefore prove a stable offset while the first one remains unable to
    affect the current location or route.
    """

    from backend.routes.models_tracking import ProviderGPSPosition

    query = db.query(ProviderGPSPosition).filter(
        ProviderGPSPosition.bus_id == bus_id,
    )
    if protocol:
        query = query.filter(ProviderGPSPosition.protocol == protocol)
    if external_device_id:
        query = query.filter(
            ProviderGPSPosition.external_device_id == external_device_id,
        )
    return query.order_by(
        ProviderGPSPosition.received_at.desc(),
        ProviderGPSPosition.id.desc(),
    ).first()


def effective_state_time(state) -> datetime | None:
    """Return the persisted time BusTrack may safely use for this snapshot."""

    basis = getattr(state, "timestamp_basis", DEVICE_TIME_BASIS)
    if basis in {RECEIPT_CLOCK_FALLBACK_BASIS, MISSING_DEVICE_TIME_BASIS}:
        return (
            as_utc(getattr(state, "effective_time", None))
            or as_utc(getattr(state, "received_at", None))
        )
    return (
        as_utc(getattr(state, "fix_time", None))
        or as_utc(getattr(state, "effective_time", None))
        or as_utc(getattr(state, "received_at", None))
    )


def select_effective_observation_time(
    fix_time: datetime | None,
    received_at: datetime,
    previous_state=None,
    previous_observation=None,
) -> tuple[datetime, str]:
    """Choose a trusted ordering time without changing the raw device time.

    A very old timestamp is treated as a clock-offset candidate only after a
    second, strictly newer fix proves that device time and receipt time are
    advancing at approximately the same rate. This rejects duplicates,
    backward packets and fast replay of an old provider queue.
    """

    received = as_utc(received_at)
    fixed = as_utc(fix_time)
    if received is None:  # Defensive; callers always supply a receipt time.
        received = datetime.now(timezone.utc)
    if fixed is None:
        return received, MISSING_DEVICE_TIME_BASIS

    age_seconds = (received - fixed).total_seconds()
    clock_is_implausible = (
        age_seconds > clock_fallback_min_age_seconds()
        or age_seconds < -allowed_future_skew_seconds()
    )
    if not clock_is_implausible:
        return fixed, DEVICE_TIME_BASIS
    comparison = previous_observation or previous_state
    if comparison is None:
        return fixed, DEVICE_TIME_BASIS

    previous_fixed = as_utc(getattr(comparison, "fix_time", None))
    previous_received = as_utc(getattr(comparison, "received_at", None))
    if previous_fixed is None or previous_received is None:
        return fixed, DEVICE_TIME_BASIS

    device_elapsed = (fixed - previous_fixed).total_seconds()
    receipt_elapsed = (received - previous_received).total_seconds()
    if device_elapsed <= 0 or receipt_elapsed <= 0:
        return fixed, DEVICE_TIME_BASIS
    if abs(device_elapsed - receipt_elapsed) > clock_rate_tolerance_seconds():
        return fixed, DEVICE_TIME_BASIS

    return received, RECEIPT_CLOCK_FALLBACK_BASIS


def observation_is_newer(
    state,
    *,
    fix_time: datetime | None,
    effective_time: datetime,
    timestamp_basis: str = DEVICE_TIME_BASIS,
    received_at: datetime | None = None,
) -> bool:
    """Enforce ordering, with a guarded transition into a new clock epoch."""

    if state is None:
        return True
    previous_fixed = as_utc(getattr(state, "fix_time", None))
    candidate_fixed = as_utc(fix_time)
    raw_moves_backwards = (
        previous_fixed is not None
        and candidate_fixed is not None
        and candidate_fixed <= previous_fixed
    )
    current_effective = effective_state_time(state)
    candidate_effective = as_utc(effective_time)
    if (
        candidate_effective is None
        or (
            current_effective is not None
            and candidate_effective <= current_effective
        )
    ):
        return False
    if not raw_moves_backwards:
        return True

    # A proven receipt-clock candidate may replace an abandoned live snapshot
    # from a different device-clock epoch. Never permit this shortcut once the
    # state is already in fallback mode, and require the old snapshot to have
    # been stale before the candidate arrived.
    if (
        timestamp_basis != RECEIPT_CLOCK_FALLBACK_BASIS
        or getattr(state, "timestamp_basis", DEVICE_TIME_BASIS)
        == RECEIPT_CLOCK_FALLBACK_BASIS
    ):
        return False
    received = as_utc(received_at) or candidate_effective
    return (
        current_effective is not None
        and (received - current_effective).total_seconds()
        >= clock_epoch_recovery_stale_seconds()
    )


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


def device_timestamp_quarantine_reason(
    timestamp: datetime | None,
    received_at: datetime,
) -> str | None:
    """Explain why one implausible raw clock sample cannot drive live state."""

    future_reason = future_timestamp_quarantine_reason(timestamp, received_at)
    if future_reason:
        return future_reason
    fixed = as_utc(timestamp)
    received = as_utc(received_at)
    if fixed is None or received is None:
        return None
    seconds_behind = int((received - fixed).total_seconds())
    if seconds_behind <= clock_fallback_min_age_seconds():
        return None
    return (
        f"Device timestamp is {seconds_behind} seconds behind BusTrack receipt "
        "time. One more normally advancing observation is required before "
        "safe receipt-clock correction can start."
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
    state.effective_time = position.effective_time
    state.timestamp_basis = position.timestamp_basis
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
        ProviderGPSPosition.timestamp_basis != RECEIPT_CLOCK_FALLBACK_BASIS,
    ).all()
    for position in future_positions:
        position.quarantine_reason = future_timestamp_quarantine_reason(
            position.fix_time,
            position.received_at,
        )

    affected_states = db.query(BusGPSState).filter(
        BusGPSState.fix_time.is_not(None),
        BusGPSState.fix_time > cutoff,
        BusGPSState.timestamp_basis != RECEIPT_CLOCK_FALLBACK_BASIS,
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
            func.coalesce(
                ProviderGPSPosition.effective_time,
                ProviderGPSPosition.fix_time,
                ProviderGPSPosition.received_at,
            ).desc(),
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
            replacement_tracking_time = (
                effective_state_time(replacement) or replacement.fix_time
            )
            if provider_health is not None:
                provider_health.last_source_time = replacement_tracking_time
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
                    trip.last_location_update = replacement_tracking_time
                if as_utc(trip.started_at) and as_utc(trip.started_at) > cutoff:
                    trip.started_at = replacement_tracking_time
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
                "replacement_tracking_time": (
                    replacement_tracking_time if replacement is not None else None
                ),
                "repair_time": current_time,
            },
        )

    return {
        "quarantined_positions": len(future_positions),
        "repaired_states": repaired,
        "cleared_states": cleared,
    }
