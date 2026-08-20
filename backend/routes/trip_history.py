"""Management bus-first trip history, feedback, and stop-event records."""

from datetime import date, datetime, time, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models import Bus, Driver, FleetNotification, Route, RouteStop, Stop, User
from backend.routes.models_tracking import LiveTrip, TripStopEvent
from backend.security import require_management

router = APIRouter(prefix="/api/trip-history", tags=["Trip History"])


def _bounds(date_from: date | None, date_to: date | None):
    start = datetime.combine(date_from, time.min, tzinfo=timezone.utc) if date_from else None
    end = datetime.combine(date_to, time.max, tzinfo=timezone.utc) if date_to else None
    return start, end


def _build_stop_visits(
    events: list[TripStopEvent],
    *,
    stops: dict[int, Stop],
    route_stops: dict[int, RouteStop],
) -> list[dict]:
    """Pair each stop-radius entry with the following exit for Trip History."""

    visits: list[dict] = []
    open_visits: dict[tuple[int, int], list[dict]] = {}

    for event in sorted(events, key=lambda item: (item.occurred_at, item.id)):
        stop = stops.get(event.stop_id)
        route_stop = route_stops.get(event.route_stop_id)
        key = (event.trip_id, event.route_stop_id)
        event_type = event.event_type.strip().casefold()

        if event_type == "arrived":
            visit = {
                "trip_id": event.trip_id,
                "route_stop_id": event.route_stop_id,
                "stop_id": event.stop_id,
                "stop_name": stop.stop_name if stop else "Unknown stop",
                "stop_code": stop.stop_code if stop else None,
                "sequence": route_stop.sequence if route_stop else None,
                "arrived_at": event.occurred_at,
                "departed_at": None,
                "arrival_distance_meters": event.distance_meters,
                "departure_distance_meters": None,
            }
            visits.append(visit)
            open_visits.setdefault(key, []).append(visit)
            continue

        if event_type != "departed":
            continue

        # A historic record may contain only a departure. Preserve it rather
        # than discarding a useful timestamp, but normally this updates the
        # most recent open arrival for the same trip stop.
        visit = next(
            (
                candidate
                for candidate in reversed(open_visits.get(key, []))
                if candidate["departed_at"] is None
            ),
            None,
        )
        if visit is None:
            visit = {
                "trip_id": event.trip_id,
                "route_stop_id": event.route_stop_id,
                "stop_id": event.stop_id,
                "stop_name": stop.stop_name if stop else "Unknown stop",
                "stop_code": stop.stop_code if stop else None,
                "sequence": route_stop.sequence if route_stop else None,
                "arrived_at": None,
                "departed_at": event.occurred_at,
                "arrival_distance_meters": None,
                "departure_distance_meters": event.distance_meters,
            }
            visits.append(visit)
        else:
            visit["departed_at"] = event.occurred_at
            visit["departure_distance_meters"] = event.distance_meters

    return sorted(
        visits,
        key=lambda visit: visit["arrived_at"] or visit["departed_at"],
        reverse=True,
    )


@router.get("/buses")
def list_history_buses(
    search: str = Query(default="", max_length=100),
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_management),
):
    term = search.strip().casefold()
    buses = db.query(Bus).order_by(Bus.bus_number).all()
    result = []
    for bus in buses:
        if term and term not in f"{bus.bus_number} {bus.registration_number}".casefold():
            continue
        latest = db.query(LiveTrip).filter(LiveTrip.bus_id == bus.id).order_by(LiveTrip.started_at.desc()).first()
        result.append({
            "id": bus.id,
            "bus_number": bus.bus_number,
            "registration_number": bus.registration_number,
            "status": bus.status,
            "trip_count": db.query(LiveTrip).filter(LiveTrip.bus_id == bus.id).count(),
            "feedback_count": db.query(FleetNotification).filter(FleetNotification.bus_id == bus.id).count(),
            "last_trip_at": latest.started_at if latest else None,
        })
    return result


@router.get("/buses/{bus_id}")
def bus_history(
    bus_id: int,
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    search: str = Query(default="", max_length=100),
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_management),
):
    bus = db.get(Bus, bus_id)
    if bus is None:
        raise HTTPException(status_code=404, detail="Bus not found.")
    start, end = _bounds(date_from, date_to)
    trip_query = db.query(LiveTrip).filter(LiveTrip.bus_id == bus.id)
    if start: trip_query = trip_query.filter(LiveTrip.started_at >= start)
    if end: trip_query = trip_query.filter(LiveTrip.started_at <= end)
    trips = trip_query.order_by(LiveTrip.started_at.desc()).all()
    trip_ids = [trip.id for trip in trips]
    routes = {route.id: route for route in db.query(Route).all()}
    drivers = {driver.id: driver for driver in db.query(Driver).all()}
    route_stops = {item.id: item for item in db.query(RouteStop).all()}
    stops = {stop.id: stop for stop in db.query(Stop).all()}
    stop_event_models: list[TripStopEvent] = []
    events = []
    if trip_ids:
        event_query = db.query(TripStopEvent).filter(TripStopEvent.trip_id.in_(trip_ids))
        if start: event_query = event_query.filter(TripStopEvent.occurred_at >= start)
        if end: event_query = event_query.filter(TripStopEvent.occurred_at <= end)
        stop_event_models = event_query.order_by(TripStopEvent.occurred_at.asc(), TripStopEvent.id.asc()).all()
        for event in stop_event_models:
            stop = stops.get(event.stop_id)
            route_stop = route_stops.get(event.route_stop_id)
            events.append({"id": event.id, "kind": "stop", "trip_id": event.trip_id,
                           "event_type": event.event_type, "occurred_at": event.occurred_at,
                           "stop_name": stop.stop_name if stop else "Unknown stop",
                           "stop_code": stop.stop_code if stop else None,
                           "sequence": route_stop.sequence if route_stop else None,
                           "distance_meters": event.distance_meters, "radius_meters": event.radius_meters})
    feedback_query = db.query(FleetNotification).filter(FleetNotification.bus_id == bus.id)
    if start: feedback_query = feedback_query.filter(FleetNotification.created_at >= start)
    if end: feedback_query = feedback_query.filter(FleetNotification.created_at <= end)
    feedback = [{"id": item.id, "kind": "feedback", "trip_id": item.trip_id,
                 "feedback_type": item.feedback_type, "title": item.title, "message": item.message,
                 "severity": item.severity, "status": item.status, "occurred_at": item.created_at,
                 "driver_name": drivers.get(item.driver_id).user.full_name if item.driver_id in drivers and drivers[item.driver_id].user else None}
                for item in feedback_query.order_by(FleetNotification.created_at.desc()).all()]
    term = search.strip().casefold()
    timeline = events + feedback
    if term:
        timeline = [item for item in timeline if term in " ".join(str(value or "") for value in item.values()).casefold()]
    timeline.sort(key=lambda item: item["occurred_at"], reverse=True)
    return {
        "bus": {"id": bus.id, "bus_number": bus.bus_number, "registration_number": bus.registration_number,
                "status": bus.status, "manufacturer": bus.manufacturer, "model": bus.model, "capacity": bus.capacity},
        "trips": [{"id": trip.id, "status": trip.status, "started_at": trip.started_at, "ended_at": trip.ended_at,
                   "route_name": routes.get(trip.route_id).route_name if trip.route_id in routes else None,
                   "route_code": routes.get(trip.route_id).route_code if trip.route_id in routes else None,
                   "driver_name": drivers.get(trip.driver_id).user.full_name if trip.driver_id in drivers and drivers[trip.driver_id].user else None,
                   "direction": trip.route_direction, "end_reason": trip.end_reason} for trip in trips],
        "stop_visits": _build_stop_visits(
            stop_event_models,
            stops=stops,
            route_stops=route_stops,
        ),
        "timeline": timeline,
    }
