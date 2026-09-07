"""Persistent reset metadata and the common lock used by tracking writers."""

from datetime import datetime, timezone

from sqlalchemy.orm import Session

from backend.models import Bus


RESET_WAITING_MESSAGE = "Route reset — waiting to reach the first stop."


def as_utc(value):
    if value is None:
        return None
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def lock_tracking_bus(db: Session, bus_id: int):
    """Serialize reset, provider and phone writes until the transaction ends.

    PostgreSQL locks one bus row. SQLite ignores FOR UPDATE, so acquire its
    writer lock before reading tracking state (the sqlite3 driver uses legacy
    transaction control). An existing write transaction already holds it.
    """
    if db.get_bind().dialect.name == "sqlite":
        connection = db.connection()
        if not connection.connection.driver_connection.in_transaction:
            connection.exec_driver_sql("BEGIN IMMEDIATE")
    return db.query(Bus).filter(Bus.id == bus_id).populate_existing().with_for_update().first()


def reset_metadata(trip):
    return {
        "reset_version": (trip.reset_version or 0) if trip else 0,
        "route_reset_at": trip.route_reset_at if trip else None,
        "reset_waiting_for_start": bool(trip and trip.reset_waiting_for_start),
        "reset_message": RESET_WAITING_MESSAGE if trip and trip.reset_waiting_for_start else None,
    }


def observation_after_reset(trip, timestamp, now=None):
    """Reset progression needs a real, recent observation from the new journey."""
    if not trip.route_reset_at:
        return True
    from backend.services.vehicle_gps import GPS_OFFLINE_GRACE_SECONDS

    timestamp = as_utc(timestamp)
    now = as_utc(now) or datetime.now(timezone.utc)
    if not timestamp or timestamp <= as_utc(trip.route_reset_at) or timestamp > now:
        return False
    # Once the new journey has genuinely started, preserve normal processing
    # of delayed-but-newer observations (and its existing skipped-stop rules).
    return not trip.reset_waiting_for_start or (now - timestamp).total_seconds() <= GPS_OFFLINE_GRACE_SECONDS
