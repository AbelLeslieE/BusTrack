"""Centralised route, bus, and driver assignment workflow."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models import Bus, Driver, Route, Student
from backend.schemas import RouteAssignmentUpdate


router = APIRouter(prefix="/api/assignments", tags=["Assignments"])


def _driver_label(driver: Driver | None) -> str | None:
    if driver is None:
        return None
    name = driver.user.full_name if driver.user else "Unknown driver"
    return f"{name} • {driver.driver_code}"


def _route_data(route: Route, db: Session) -> dict:
    bus = db.get(Bus, route.bus_id) if route.bus_id else None
    driver = db.get(Driver, route.driver_id) if route.driver_id else None
    return {
        "id": route.id,
        "route_code": route.route_code,
        "route_name": route.route_name,
        "status": route.status,
        "departure_time": route.departure_time,
        "arrival_time": route.arrival_time,
        "bus_id": route.bus_id,
        "bus_number": bus.bus_number if bus else None,
        "driver_id": route.driver_id,
        "driver_name": _driver_label(driver),
    }


@router.get("")
def get_assignments(db: Session = Depends(get_db)):
    """Return every route with its current assignment and available resources."""
    routes = db.query(Route).order_by(Route.route_name).all()
    buses = db.query(Bus).order_by(Bus.bus_number).all()
    drivers = db.query(Driver).order_by(Driver.driver_code).all()

    return {
        "routes": [_route_data(route, db) for route in routes],
        "buses": [
            {"id": bus.id, "bus_number": bus.bus_number, "status": bus.status}
            for bus in buses
        ],
        "drivers": [
            {
                "id": driver.id,
                "label": _driver_label(driver),
                "driver_code": driver.driver_code,
                "status": driver.status,
            }
            for driver in drivers
        ],
    }


@router.put("/routes/{route_id}")
def save_route_assignment(
    route_id: int,
    assignment: RouteAssignmentUpdate,
    db: Session = Depends(get_db),
):
    """Assign one bus and one driver to a route, keeping legacy mirrors in sync."""
    route = db.get(Route, route_id)
    if route is None:
        raise HTTPException(status_code=404, detail="Route not found.")

    bus = db.get(Bus, assignment.bus_id) if assignment.bus_id else None
    driver = db.get(Driver, assignment.driver_id) if assignment.driver_id else None

    if assignment.bus_id and bus is None:
        raise HTTPException(status_code=400, detail="Selected bus was not found.")
    if assignment.driver_id and driver is None:
        raise HTTPException(status_code=400, detail="Selected driver was not found.")

    old_bus_id = route.bus_id

    # A bus and a driver can each belong to only one route. If the selected
    # resource is currently attached to another route, detach that route and
    # keep its students linked to their route (but without an active bus).
    if bus:
        for other_route in db.query(Route).filter(
            Route.id != route.id,
            Route.bus_id == bus.id,
        ):
            db.query(Student).filter(Student.route_id == other_route.id).update(
                {Student.bus_id: None}, synchronize_session=False
            )
            # Upgrade legacy students while their previous bus still uniquely
            # identifies the route they belonged to.
            db.query(Student).filter(
                Student.route_id.is_(None),
                Student.bus_id == bus.id,
            ).update(
                {Student.route_id: other_route.id, Student.bus_id: None},
                synchronize_session=False,
            )
            other_route.bus_id = None

    if driver:
        for other_route in db.query(Route).filter(
            Route.id != route.id,
            Route.driver_id == driver.id,
        ):
            other_route.driver_id = None

    # Upgrade legacy student assignments associated with this route, then
    # propagate the route's newly selected bus to every student on the route.
    if old_bus_id:
        db.query(Student).filter(
            Student.route_id.is_(None),
            Student.bus_id == old_bus_id,
        ).update(
            {Student.route_id: route.id},
            synchronize_session=False,
        )

    route.bus_id = bus.id if bus else None
    route.driver_id = driver.id if driver else None
    db.query(Student).filter(Student.route_id == route.id).update(
        {Student.bus_id: route.bus_id}, synchronize_session=False
    )

    # Bus.driver_id, Bus.route, and Driver.bus_id are legacy display mirrors.
    # Rebuild them from the authoritative route assignments in one place.
    db.flush()
    for managed_bus in db.query(Bus).all():
        managed_bus.driver_id = None
        managed_bus.route = None
    for managed_driver in db.query(Driver).all():
        managed_driver.bus_id = None
    for assigned_route in db.query(Route).filter(Route.bus_id.is_not(None)):
        assigned_bus = db.get(Bus, assigned_route.bus_id)
        if assigned_bus is None:
            continue
        assigned_bus.route = assigned_route.route_name
        assigned_bus.driver_id = assigned_route.driver_id
        if assigned_route.driver_id:
            assigned_driver = db.get(Driver, assigned_route.driver_id)
            if assigned_driver:
                assigned_driver.bus_id = assigned_bus.id

    db.commit()
    db.refresh(route)
    return _route_data(route, db)
