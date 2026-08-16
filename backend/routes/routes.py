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
    Student,
)
from backend.schemas import (
    RouteCreate,
    RouteUpdate,
    RouteResponse,
)
# ==========================================================
# BUILD ROUTE RESPONSE
# ==========================================================

def build_route_response(
    route: Route,
    db: Session,
) -> RouteResponse:

    driver_name = None
    bus_number = None

    if route.driver_id:

        driver = (
            db.query(Driver)
            .filter(Driver.id == route.driver_id)
            .first()
        )

        if driver and driver.user:

            driver_name = driver.user.full_name

    if route.bus_id:

        bus = (
            db.query(Bus)
            .filter(Bus.id == route.bus_id)
            .first()
        )

        if bus:

            bus_number = bus.bus_number

    total_stops = (
        db.query(RouteStop)
        .filter(RouteStop.route_id == route.id)
        .count()
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
):

    existing = (
        db.query(Route)
        .filter(
            (Route.route_code == route.route_code)
            | (Route.route_name == route.route_name)
        )
        .first()
    )

    if existing:
        raise HTTPException(
            status_code=400,
            detail="Route already exists.",
        )

    new_route = Route(**route.model_dump())

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
):

    routes = (
        db.query(Route)
        .order_by(Route.route_name)
        .all()
    )

    return [

        build_route_response(
            route,
            db,
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
):

    route = db.get(Route, route_id)

    if not route:
        raise HTTPException(
            status_code=404,
            detail="Route not found.",
        )

    # Assignments have their own workflow. Editing route details must never
    # accidentally clear the bus or driver selected there.
    for key, value in updated.model_dump().items():
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
