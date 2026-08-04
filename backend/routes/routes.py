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
)
from backend.schemas import (
    RouteCreate,
    RouteUpdate,
    RouteResponse,
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

    return new_route
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

    routes = db.query(Route).order_by(Route.route_name).all()

    for route in routes:

        route.total_stops = (
            db.query(RouteStop)
            .filter(RouteStop.route_id == route.id)
            .count()
        )

    return routes
# ==========================================================
# GET SINGLE ROUTE
# ==========================================================

@router.get(
    "/{route_id}",
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

    return route
# ==========================================================
# UPDATE ROUTE
# ==========================================================

@router.put(
    "/{route_id}",
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

    for key, value in updated.model_dump().items():
        setattr(route, key, value)

    db.commit()
    db.refresh(route)

    return route
# ==========================================================
# DELETE ROUTE
# ==========================================================

@router.delete("/{route_id}")
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
