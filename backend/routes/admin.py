"""Read-only data used by the real administrator overview dashboard."""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models import Bus, Driver, FleetNotification, Route, Student
from backend.routes.models_tracking import LiveTrip
from backend.security import require_management


router = APIRouter(prefix="/api/admin", tags=["Administrator Dashboard"])


@router.get("/dashboard")
def get_dashboard_summary(
    db: Session = Depends(get_db),
    _admin=Depends(require_management),
):
    """Return only live operational data; no dashboard values are invented."""

    buses = db.query(Bus).order_by(Bus.bus_number).all()
    routes = db.query(Route).filter(Route.status == "Active").order_by(Route.departure_time.asc(), Route.route_code.asc()).all()
    running_trips = db.query(LiveTrip).filter(LiveTrip.status == "Running", LiveTrip.ended_at.is_(None)).all()
    active_driver_count = db.query(Driver).filter(Driver.status == "Available").count()
    open_notifications = (
        db.query(FleetNotification)
        .filter(FleetNotification.status != "Resolved")
        .order_by(FleetNotification.created_at.desc())
        .limit(6)
        .all()
    )
    bus_by_id = {bus.id: bus for bus in buses}
    driver_by_id = {driver.id: driver for driver in db.query(Driver).all()}

    return {
        "metrics": {
            "total_buses": len(buses),
            "maintenance_buses": sum(1 for bus in buses if bus.status.casefold() == "maintenance"),
            "active_trips": len(running_trips),
            "assigned_students": db.query(Student).filter(Student.bus_id.is_not(None)).count(),
            "active_drivers": active_driver_count,
            "unassigned_drivers": db.query(Driver).filter(Driver.bus_id.is_(None)).count(),
        },
        "live_trips": [
            {
                "id": trip.id,
                "bus_number": bus_by_id.get(trip.bus_id).bus_number if trip.bus_id in bus_by_id else "Unknown bus",
                "speed_kmh": trip.current_speed,
                "last_location_update": trip.last_location_update,
            }
            for trip in running_trips
        ],
        "departures": [
            {
                "route_code": route.route_code,
                "route_name": route.route_name,
                "departure_time": route.departure_time,
                "bus_number": bus_by_id.get(route.bus_id).bus_number if route.bus_id in bus_by_id else None,
                "driver_name": (
                    driver_by_id[route.driver_id].user.full_name
                    if route.driver_id in driver_by_id and driver_by_id[route.driver_id].user
                    else None
                ),
            }
            for route in routes[:6]
        ],
        "alerts": [
            {
                "id": item.id,
                "title": item.title,
                "message": item.message,
                "severity": item.severity,
                "status": item.status,
                "created_at": item.created_at,
            }
            for item in open_notifications
        ],
    }
