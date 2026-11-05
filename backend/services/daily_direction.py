"""Once-per-IST-day recovery; normal terminal reversal remains in gps.py."""
from datetime import datetime, time, timedelta, timezone

from sqlalchemy import Column, Date, Integer

from backend.database import Base
from backend.models import RouteStop
from backend.routes.models_tracking import LiveTrip
from backend.services.trip_reset import as_utc, lock_tracking_bus

IST = timezone(timedelta(hours=5, minutes=30), name="IST")


class DailyDirectionCheckpoint(Base):
    __tablename__ = "daily_direction_checkpoints"
    bus_id = Column(Integer, primary_key=True)
    applied_day = Column(Date, nullable=False)


def apply_daily_direction(db, now=None):
    now = as_utc(now) or datetime.now(timezone.utc)
    local = now.astimezone(IST)
    day = local.date() if local.time() >= time(0, 1) else local.date() - timedelta(days=1)
    boundary = datetime.combine(day, time(0, 1), tzinfo=IST).astimezone(timezone.utc)
    changed = 0
    bus_ids = [row[0] for row in db.query(LiveTrip.bus_id).filter(
        LiveTrip.status == "Running", LiveTrip.ended_at.is_(None)).distinct().all()]
    for bus_id in sorted(bus_ids):
        lock_tracking_bus(db, bus_id)
        checkpoint = db.get(DailyDirectionCheckpoint, bus_id)
        if checkpoint and checkpoint.applied_day >= day:
            continue
        trips = db.query(LiveTrip).populate_existing().filter(
            LiveTrip.bus_id == bus_id, LiveTrip.status == "Running", LiveTrip.ended_at.is_(None)).all()
        for trip in trips:
            # Do not reset a journey legitimately begun after today's boundary.
            if as_utc(trip.started_at) >= boundary or trip.route_direction != "reverse":
                continue
            first = db.query(RouteStop).filter(RouteStop.route_id == trip.route_id).order_by(RouteStop.sequence, RouteStop.id).first()
            trip.route_direction = "forward"
            trip.current_route_stop_id = first.id if first else None
            trip.current_stop_status = "Approaching"
            trip.current_stop_arrived_at = trip.current_stop_departed_at = None
            trip.terminal_reached_at = trip.terminal_stop_id = None
            trip.route_reset_at = boundary
            trip.reset_waiting_for_start = True
            trip.reset_version = (trip.reset_version or 0) + 1
            trip.reset_request_id = f"daily-{day.isoformat()}"
            changed += 1
        if checkpoint:
            checkpoint.applied_day = day
        else:
            db.add(DailyDirectionCheckpoint(bus_id=bus_id, applied_day=day))
    return changed
