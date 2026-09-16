"""
Route Management API

Provides CRUD operations for transport routes.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func

from backend.database import get_db
from backend.models import (
    Route,
    RouteStop,
    Bus,
    Driver,
    FleetNotification,
    Student,
)
from backend.routes.models_tracking import LiveLocation, LiveTrip, TripStopEvent
from backend.schemas import (
    RouteCreate,
    RouteUpdate,
    RouteResponse,
)
from backend.security import require_management
from backend.services.generated_codes import (
    lock_generated_code_writes,
    next_route_code,
)
# ==========================================================
# BUILD ROUTE RESPONSE
# ==========================================================

def build_route_response(
    route: Route,
    db: Session,
    drivers_by_id: dict[int, Driver] | None = None,
    buses_by_id: dict[int, Bus] | None = None,
    stop_counts_by_route_id: dict[int, int] | None = None,
) -> RouteResponse:

    driver_name = None
    bus_number = None

    if route.driver_id:
        driver = (
            drivers_by_id.get(route.driver_id)
            if drivers_by_id is not None
            else db.get(Driver, route.driver_id)
        )

        if driver and driver.user:

            driver_name = driver.user.full_name

    if route.bus_id:
        bus = (
            buses_by_id.get(route.bus_id)
            if buses_by_id is not None
            else db.get(Bus, route.bus_id)
        )

        if bus:

            bus_number = bus.bus_number

    total_stops = (
        stop_counts_by_route_id.get(route.id, 0)
        if stop_counts_by_route_id is not None
        else db.query(RouteStop).filter(RouteStop.route_id == route.id).count()
    )

    return RouteResponse(

        id=route.id,

        route_code=route.route_code,
        route_name=route.route_name,

        bus_id=route.bus_id,
        bus_number=bus_number,

        driver_id=route.driver_id,
        driver_name=driver_name,

        departure_time=route.departure_time,
        arrival_time=route.arrival_time,

        status=route.status,

        total_stops=total_stops,

        created_at=route.created_at,
        updated_at=route.updated_at,
    )
router = APIRouter(
    prefix="/api/routes",
    tags=["Routes"],
)


@router.get("/next-code")
def get_next_route_code(
    db: Session = Depends(get_db),
    _current_user = Depends(require_management),
):
    """Preview the next route code; creation recalculates it under a lock."""

    return {"route_code": next_route_code(db)}


# ==========================================================
# CREATE ROUTE
# ==========================================================

@router.post(
    "",
    response_model=RouteResponse,
)
def create_route(
    route: RouteCreate,
    db: Session = Depends(get_db),
    _current_user = Depends(require_management),
):

    lock_generated_code_writes(db, "route")
    generated_code = next_route_code(db)

    existing = (
        db.query(Route)
        .filter(
            func.lower(Route.route_name) == route.route_name.strip().lower()
        )
        .first()
    )

    if existing:
        raise HTTPException(
            status_code=409,
            detail=f"Route name already exists ({existing.route_code} — {existing.route_name}). Change the route name or edit the existing route.",
        )

    new_route = Route(**{
        **route.model_dump(),
        "route_code": generated_code,
    })

    db.add(new_route)
    db.commit()
    db.refresh(new_route)

    return build_route_response(
        new_route,
        db,
    )
# ==========================================================
# GET ALL ROUTES
# ==========================================================

@router.get(
    "",
    response_model=list[RouteResponse],
)
def get_routes(
    db: Session = Depends(get_db),
    _current_user = Depends(require_management),
):

    routes = (
        db.query(Route)
        .order_by(Route.route_name)
        .all()
    )
    driver_ids = {route.driver_id for route in routes if route.driver_id is not None}
    bus_ids = {route.bus_id for route in routes if route.bus_id is not None}
    route_ids = [route.id for route in routes]
    drivers_by_id = {
        driver.id: driver
        for driver in (
            db.query(Driver).filter(Driver.id.in_(driver_ids)).all()
            if driver_ids
            else []
        )
    }
    buses_by_id = {
        bus.id: bus
        for bus in (
            db.query(Bus).filter(Bus.id.in_(bus_ids)).all()
            if bus_ids
            else []
        )
    }
    stop_counts_by_route_id = {
        route_id: stop_count
        for route_id, stop_count in (
            db.query(RouteStop.route_id, func.count(RouteStop.id))
            .filter(RouteStop.route_id.in_(route_ids))
            .group_by(RouteStop.route_id)
            .all()
            if route_ids
            else []
        )
    }

    return [

        build_route_response(
            route,
            db,
            drivers_by_id,
            buses_by_id,
            stop_counts_by_route_id,
        )

        for route in routes

    ]
# ==========================================================
# GET SINGLE ROUTE
# ==========================================================

@router.get(
    "/{route_id:int}",
    response_model=RouteResponse,
)
def get_route(
    route_id: int,
    db: Session = Depends(get_db),
    _current_user = Depends(require_management),
):

    route = db.get(Route, route_id)

    if not route:
        raise HTTPException(
            status_code=404,
            detail="Route not found.",
        )

    route.total_stops = (
        db.query(RouteStop)
        .filter(RouteStop.route_id == route.id)
        .count()
    )

    return build_route_response(
        route,
        db,
        stop_counts_by_route_id={route.id: route.total_stops},
    )
# ==========================================================
# UPDATE ROUTE
# ==========================================================

@router.put(
    "/{route_id:int}",
    response_model=RouteResponse,
)
def update_route(
    route_id: int,
    updated: RouteUpdate,
    db: Session = Depends(get_db),
    _current_user = Depends(require_management),
):

    route = db.get(Route, route_id)

    if not route:
        raise HTTPException(
            status_code=404,
            detail="Route not found.",
        )

    duplicate = db.query(Route).filter(
        Route.id != route_id,
        func.lower(Route.route_name) == updated.route_name.strip().lower(),
    ).first()
    if duplicate:
        raise HTTPException(
            status_code=409,
            detail=f"Route name already exists ({duplicate.route_code} — {duplicate.route_name}). Change the route name or edit the existing route.",
        )

    # Assignments have their own workflow. Editing route details must never
    # accidentally clear the bus or driver selected there.
    for key, value in updated.model_dump(exclude={"route_code"}).items():
        setattr(route, key, value)
    db.commit()
    db.refresh(route)

    return build_route_response(
        route,
        db,
    )
# ==========================================================
# DELETE ROUTE
# ==========================================================

@router.delete("/{route_id:int}")
def delete_route(
    route_id: int,
    db: Session = Depends(get_db),
    _current_user = Depends(require_management),
):

    route = db.get(Route, route_id)

    if not route:
        raise HTTPException(
            status_code=404,
            detail="Route not found.",
        )

    bus = db.get(Bus, route.bus_id) if route.bus_id else None
    driver = db.get(Driver, route.driver_id) if route.driver_id else None

    # A deleted route must not leave a bus, driver, or student appearing assigned.
    if bus:
        db.query(Student).filter(Student.bus_id == bus.id).update(
            {Student.route_id: None, Student.bus_id: None, Student.stop_id: None}, synchronize_session=False
        )
    db.query(Student).filter(Student.route_id == route.id).update(
        {Student.route_id: None, Student.bus_id: None, Student.stop_id: None}, synchronize_session=False
    )

    # Route stops and live trips both have required references to this route.
    # Remove trip locations before their trips, then remove the route stops so
    # an active or historical trip cannot block route deletion.
    trip_ids = db.query(LiveTrip.id).filter(LiveTrip.route_id == route.id)
    db.query(FleetNotification).filter(FleetNotification.trip_id.in_(trip_ids)).update(
        {FleetNotification.trip_id: None}, synchronize_session=False
    )
    db.query(FleetNotification).filter(FleetNotification.route_id == route.id).update(
        {FleetNotification.route_id: None}, synchronize_session=False
    )
    db.query(TripStopEvent).filter(TripStopEvent.trip_id.in_(trip_ids)).delete(
        synchronize_session=False
    )
    db.query(LiveLocation).filter(LiveLocation.trip_id.in_(trip_ids)).delete(
        synchronize_session=False
    )
    db.query(LiveTrip).filter(LiveTrip.route_id == route.id).delete(
        synchronize_session=False
    )
    db.query(RouteStop).filter(RouteStop.route_id == route.id).delete(
        synchronize_session=False
    )

    if bus:
        bus.driver_id = None
        bus.route = None
    if driver:
        driver.bus_id = None

    db.delete(route)
    db.commit()

    return {
        "message": "Route deleted successfully."
    }
# ==========================================================
# ROUTE STATISTICS
# ==========================================================

@router.get("/statistics")
def route_statistics(
    db: Session = Depends(get_db),
    _current_user = Depends(require_management),
):

    total = db.query(Route).count()

    active = (
        db.query(Route)
        .filter(Route.status == "Active")
        .count()
    )

    inactive = (
        db.query(Route)
        .filter(Route.status == "Inactive")
        .count()
    )

    return {
        "total_routes": total,
        "active_routes": active,
        "inactive_routes": inactive,
    }
