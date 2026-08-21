"""
Driver Management API

Handles CRUD operations for school bus drivers.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models import Driver, Bus, FleetNotification, Route, RouteStop, User
from backend.routes.models_tracking import LiveLocation, LiveTrip, TripStopEvent
from backend.schemas import (

    DriverUpdate,
    DriverResponse,
)
from backend.security import require_driver, require_management

router = APIRouter(
    prefix="/api/drivers",
    tags=["Driver Management"],
)


def _driver_portal_data(driver: Driver, db: Session) -> dict:
    """Safely build the authenticated driver's own workspace data."""

    bus = db.get(Bus, driver.bus_id) if driver.bus_id else None
    route = db.query(Route).filter(Route.driver_id == driver.id).first()
    active_trip = (
        db.query(LiveTrip)
        .filter(LiveTrip.driver_id == driver.id, LiveTrip.ended_at.is_(None))
        .order_by(LiveTrip.started_at.desc())
        .first()
    )
    route_stops = (
        db.query(RouteStop)
        .filter(RouteStop.route_id == route.id)
        .order_by(RouteStop.sequence.asc())
        .all()
        if route else []
    )
    return {
        "driver": {
            "id": driver.id, "full_name": driver.user.full_name if driver.user else None,
            "driver_code": driver.driver_code, "status": driver.status,
            "license_number": driver.license_number, "license_expiry": driver.license_expiry,
            "phone": driver.user.phone if driver.user else None, "email": driver.user.email if driver.user else None,
        },
        "bus": ({
            "id": bus.id, "bus_number": bus.bus_number, "registration_number": bus.registration_number,
            "capacity": bus.capacity, "manufacturer": bus.manufacturer, "model": bus.model,
            "year": bus.year, "fuel_type": bus.fuel_type, "status": bus.status,
        } if bus else None),
        "route": ({
            "id": route.id, "route_code": route.route_code, "route_name": route.route_name,
            "departure_time": route.departure_time, "arrival_time": route.arrival_time, "status": route.status,
            "stops": [{"sequence": item.sequence, "stop_code": item.stop.stop_code, "stop_name": item.stop.stop_name}
                      for item in route_stops if item.stop],
        } if route else None),
        "active_trip": ({
            "id": active_trip.id, "status": active_trip.status, "started_at": active_trip.started_at,
            "latitude": active_trip.current_latitude, "longitude": active_trip.current_longitude,
            "speed_kmh": active_trip.current_speed, "last_location_update": active_trip.last_location_update,
            "location_source": active_trip.current_location_source,
            "route_direction": active_trip.route_direction,
        } if active_trip else None),
    }


@router.get("/me")
def get_my_driver_portal(
    current_user: User = Depends(require_driver),
    db: Session = Depends(get_db),
):
    driver = db.query(Driver).filter(Driver.user_id == current_user.id).first()
    if driver is None:
        raise HTTPException(status_code=404, detail="Driver profile not found.")
    return _driver_portal_data(driver, db)


@router.get("/me/trips")
def get_my_trip_history(
    current_user: User = Depends(require_driver),
    db: Session = Depends(get_db),
):
    driver = db.query(Driver).filter(Driver.user_id == current_user.id).first()
    if driver is None:
        raise HTTPException(status_code=404, detail="Driver profile not found.")
    trips = (
        db.query(LiveTrip).filter(LiveTrip.driver_id == driver.id)
        .order_by(LiveTrip.started_at.desc()).limit(100).all()
    )
    buses = {item.id: item for item in db.query(Bus).all()}
    routes = {item.id: item for item in db.query(Route).all()}
    return [{
        "id": trip.id, "status": trip.status, "started_at": trip.started_at, "ended_at": trip.ended_at,
        "bus_number": buses.get(trip.bus_id).bus_number if trip.bus_id in buses else None,
        "route_code": routes.get(trip.route_id).route_code if trip.route_id in routes else None,
        "route_name": routes.get(trip.route_id).route_name if trip.route_id in routes else None,
        "last_location_update": trip.last_location_update,
    } for trip in trips]


@router.get("/", response_model=list[DriverResponse])
def get_drivers(
    db: Session = Depends(get_db),
    _current_user = Depends(require_management),
):
    """Return all drivers."""
    return db.query(Driver).order_by(Driver.driver_code).all()





@router.get("/{driver_id}", response_model=DriverResponse)
def get_driver(
    driver_id: int,
    db: Session = Depends(get_db),
    _current_user = Depends(require_management),
):
    """Return a single driver."""

    driver = (
        db.query(Driver)
        .filter(Driver.id == driver_id)
        .first()
    )

    if not driver:
        raise HTTPException(
            status_code=404,
            detail="Driver not found.",
        )

    return driver


@router.put("/{driver_id}", response_model=DriverResponse)
def update_driver(
    driver_id: int,
    driver: DriverUpdate,
    db: Session = Depends(get_db),
    _current_user = Depends(require_management),
):
    """Update a driver."""

    existing = (
        db.query(Driver)
        .filter(Driver.id == driver_id)
        .first()
    )

    if not existing:
        raise HTTPException(
            status_code=404,
            detail="Driver not found.",
        )

    duplicate_driver = (
        db.query(Driver)
        .filter(
            Driver.driver_code == driver.driver_code,
            Driver.id != driver_id,
        )
        .first()
    )

    if duplicate_driver:
        raise HTTPException(
            status_code=400,
            detail="Driver code already exists.",
        )

    duplicate_license = (
        db.query(Driver)
        .filter(
            Driver.license_number == driver.license_number,
            Driver.id != driver_id,
        )
        .first()
    )

    if duplicate_license:
        raise HTTPException(
            status_code=400,
            detail="License number already exists.",
        )

    if driver.bus_id is not None:
        bus = (
            db.query(Bus)
            .filter(Bus.id == driver.bus_id)
            .first()
        )

        if not bus:
            raise HTTPException(
                status_code=400,
                detail="Assigned bus does not exist.",
            )

    # Bus assignment is managed centrally in the Assignments workspace.
    for key, value in driver.model_dump(exclude={"bus_id"}).items():
        setattr(existing, key, value)

    db.commit()
    db.refresh(existing)

    return existing


@router.delete("/{driver_id}")
def delete_driver(
    driver_id: int,
    db: Session = Depends(get_db),
    _current_user = Depends(require_management),
):
    """Delete a driver."""

    driver = (
        db.query(Driver)
        .filter(Driver.id == driver_id)
        .first()
    )

    if not driver:
        raise HTTPException(
            status_code=404,
            detail="Driver not found.",
        )

    # Remove the driver's central assignment before deleting the profile.
    db.query(Route).filter(Route.driver_id == driver.id).update(
        {Route.driver_id: None}, synchronize_session=False
    )
    db.query(Bus).filter(Bus.driver_id == driver.id).update(
        {Bus.driver_id: None}, synchronize_session=False
    )

    # Live trips retain required driver references.  The former SQLite path
    # could delete a driver and leave historic trips pointing at a missing
    # record; PostgreSQL correctly rejects that corruption.  Delete the
    # driver's tracking graph explicitly, matching the bus/route deletion
    # behavior and preserving unrelated feedback after detaching it.
    trip_ids = db.query(LiveTrip.id).filter(LiveTrip.driver_id == driver.id)
    db.query(FleetNotification).filter(FleetNotification.trip_id.in_(trip_ids)).update(
        {FleetNotification.trip_id: None}, synchronize_session=False
    )
    db.query(TripStopEvent).filter(TripStopEvent.trip_id.in_(trip_ids)).delete(
        synchronize_session=False
    )
    db.query(LiveLocation).filter(LiveLocation.trip_id.in_(trip_ids)).delete(
        synchronize_session=False
    )
    db.query(LiveTrip).filter(LiveTrip.driver_id == driver.id).delete(
        synchronize_session=False
    )
    db.query(FleetNotification).filter(FleetNotification.driver_id == driver.id).update(
        {FleetNotification.driver_id: None}, synchronize_session=False
    )
    driver.bus_id = None
    db.flush()
    db.delete(driver)
    db.commit()

    return {
        "message": "Driver deleted successfully."
    }
