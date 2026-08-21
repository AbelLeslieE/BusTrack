"""Bounded GPS-coordinate retention for the live tracking service.

The product needs one current, correctly timestamped position for live maps,
not an unbounded archive of every latitude/longitude fix.  Stop events are the
long-term trip record; raw coordinates are short-lived operational data.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
import os

from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.database import engine
from backend.routes.models_tracking import (
    BusGPSState,
    LiveLocation,
    LiveTrip,
    ProviderGPSPosition,
    TripStopEvent,
)


def _bounded_int(name: str, default: int, *, minimum: int, maximum: int) -> int:
    """Read a safe integer setting without making a bad environment fatal."""

    try:
        value = int(os.getenv(name, str(default)))
    except ValueError:
        return default
    return value if minimum <= value <= maximum else default


def telemetry_retention_enabled() -> bool:
    """Enable destructive coordinate trimming by default only on PostgreSQL.

    Keeping SQLite untouched until the verified cutover protects the local
    rollback source.  A deployment may explicitly override this with
    ``TELEMETRY_RETENTION_ENABLED=true`` or ``false``.
    """

    configured = os.getenv("TELEMETRY_RETENTION_ENABLED", "").strip().casefold()
    if configured in {"true", "1", "yes", "on"}:
        return True
    if configured in {"false", "0", "no", "off"}:
        return False
    return engine.dialect.name == "postgresql"


def trim_active_trip_location_history(db: Session, trip_id: int) -> int:
    """Keep only the newest few raw points per source for a running trip.

    Two fixes per source retain enough context to calculate speed while
    preventing a two-minute GPS heartbeat from becoming permanent history.
    The authoritative current coordinate remains on ``LiveTrip``.
    """

    keep_per_source = _bounded_int(
        "GPS_ACTIVE_LOCATION_MAX_PER_SOURCE", 2, minimum=1, maximum=20
    )
    locations = (
        db.query(LiveLocation.id, LiveLocation.source)
        .filter(LiveLocation.trip_id == trip_id)
        .order_by(LiveLocation.source.asc(), LiveLocation.recorded_at.desc(), LiveLocation.id.desc())
        .all()
    )
    retained_per_source: dict[str, int] = {}
    delete_ids: list[int] = []
    for location_id, source in locations:
        source_key = source or "unknown"
        retained_count = retained_per_source.get(source_key, 0)
        if retained_count < keep_per_source:
            retained_per_source[source_key] = retained_count + 1
        else:
            delete_ids.append(location_id)

    if not delete_ids:
        return 0
    return (
        db.query(LiveLocation)
        .filter(LiveLocation.id.in_(delete_ids))
        .delete(synchronize_session=False)
    )


def discard_completed_trip_coordinates(db: Session, trip: LiveTrip) -> dict[str, int]:
    """Remove a completed trip's raw coordinates but retain its event audit.

    ``TripStopEvent`` still retains the trip, stop, event type and UTC arrival
    or departure timestamp.  Snapshot fields ensure that record also remains
    understandable if an administrator later renames a stop.
    """

    deleted_locations = (
        db.query(LiveLocation)
        .filter(LiveLocation.trip_id == trip.id)
        .delete(synchronize_session=False)
    )
    cleared_event_coordinates = (
        db.query(TripStopEvent)
        .filter(TripStopEvent.trip_id == trip.id)
        .update(
            {
                TripStopEvent.latitude: None,
                TripStopEvent.longitude: None,
                TripStopEvent.distance_meters: None,
                TripStopEvent.radius_meters: None,
            },
            synchronize_session=False,
        )
    )
    trip.current_latitude = None
    trip.current_longitude = None
    trip.current_speed = None
    trip.current_accuracy = None
    trip.last_location_update = None
    trip.current_location_source = None
    trip.current_route_stop_id = None
    trip.current_stop_status = trip.status
    trip.current_stop_arrived_at = None
    trip.current_stop_departed_at = None
    return {
        "deleted_live_locations": deleted_locations,
        "sanitized_stop_events": cleared_event_coordinates,
    }


def purge_ended_trip_coordinates(db: Session) -> int:
    """Apply completed-trip retention to older records after a deployment."""

    ended_trips = (
        db.query(LiveTrip)
        .filter(LiveTrip.ended_at.is_not(None))
        .all()
    )
    removed = 0
    for trip in ended_trips:
        removed += discard_completed_trip_coordinates(db, trip)["deleted_live_locations"]
    return removed


def purge_provider_position_history(db: Session, *, now: datetime | None = None) -> int:
    """Delete expired provider fixes while always retaining every bus's latest state."""

    # Request sessions intentionally disable autoflush. Flush a just-created
    # BusGPSState first so its referenced position cannot be mistaken for an
    # expired, unprotected telemetry row in this same transaction.
    db.flush()
    retention_minutes = _bounded_int(
        "GPS_PROVIDER_HISTORY_RETENTION_MINUTES", 15, minimum=5, maximum=1440
    )
    current_time = now or datetime.now(timezone.utc)
    cutoff = current_time - timedelta(minutes=retention_minutes)
    current_position_ids = select(BusGPSState.provider_position_id).where(
        BusGPSState.provider_position_id.is_not(None)
    )
    return (
        db.query(ProviderGPSPosition)
        .filter(ProviderGPSPosition.received_at < cutoff)
        .filter(~ProviderGPSPosition.id.in_(current_position_ids))
        .delete(synchronize_session=False)
    )


def run_telemetry_retention(db: Session, *, now: datetime | None = None) -> dict[str, int]:
    """Run the complete bounded-retention policy in the caller's transaction."""

    return {
        "deleted_completed_trip_locations": purge_ended_trip_coordinates(db),
        "deleted_expired_provider_positions": purge_provider_position_history(db, now=now),
    }
