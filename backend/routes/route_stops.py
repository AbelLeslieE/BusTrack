"""
==========================================================
BUSTRACK
ROUTE STOPS API
==========================================================

This API connects Routes and Stops.

A Route does not own stop information.
It only stores the ordered sequence of
master stops.
"""
  
# ==========================================================
# IMPORTS
# ==========================================================

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models import (
    Route,
    Stop,
    RouteStop,
)
from backend.schemas import (
    RouteStopCreate,
    RouteStopUpdate,
    RouteStopResponse,
    RouteStopReorder,
) 
from backend.security import require_management
from backend.routes.models_tracking import LiveTrip, TripStopEvent
# ==========================================================
# ROUTER
# ==========================================================

router = APIRouter(

    prefix="/api/route-stops",

    tags=["Route Stops"]

)
# ==========================================================
# HELPER FUNCTIONS
# ==========================================================
# ==========================================================
# GET ROUTE OR 404
# ==========================================================

def get_route_or_404(
    db: Session,
    route_id: int,
) -> Route:

    route = (
        db.query(Route)
        .filter(Route.id == route_id)
        .first()
    )

    if route is None:
        raise HTTPException(
            status_code=404,
            detail="Route not found."
        )

    return route
# ==========================================================
# GET STOP OR 404
# ==========================================================

def get_stop_or_404(
    db: Session,
    stop_id: int,
) -> Stop:

    stop = (
        db.query(Stop)
        .filter(Stop.id == stop_id)
        .first()
    )

    if stop is None:
        raise HTTPException(
            status_code=404,
            detail="Stop not found."
        )

    return stop
# ==========================================================
# GET ROUTE STOP OR 404
# ==========================================================

def get_route_stop_or_404(
    db: Session,
    route_stop_id: int,
) -> RouteStop:

    route_stop = (
        db.query(RouteStop)
        .filter(RouteStop.id == route_stop_id)
        .first()
    )

    if route_stop is None:
        raise HTTPException(
            status_code=404,
            detail="Route stop not found."
        )

    return route_stop
# ==========================================================
# UPDATE TOTAL STOPS
# ==========================================================

def update_route_stop_count(
    db: Session,
    route_id: int,
):

    route = get_route_or_404(db, route_id)

    route.total_stops = (
        db.query(RouteStop)
        .filter(RouteStop.route_id == route_id)
        .count()
    )
# ==========================================================
# RESEQUENCE ROUTE STOPS
# ==========================================================

def resequence_route_stops(
    db: Session,
    route_id: int,
):

    stops = (
        db.query(RouteStop)
        .filter(RouteStop.route_id == route_id)
        .order_by(RouteStop.sequence)
        .all()
    )

    for index, stop in enumerate(stops, start=1):
        stop.sequence = index
# ==========================================================
# GET STOPS OF A ROUTE
# ==========================================================

@router.get(
    "/{route_id}",
    response_model=list[RouteStopResponse],
)
def get_route_stops(

    route_id: int,

    db: Session = Depends(get_db),
    _current_user = Depends(require_management),

):
    """
    Returns all stops that belong to a route.
    """

    route = get_route_or_404(db, route_id)
    stops = (

        db.query(RouteStop)

        .join(

            Stop,

            RouteStop.stop_id == Stop.id

        )

        .filter(

            RouteStop.route_id == route_id

        )

        .order_by(

            RouteStop.sequence

        )

        .all()

    )

    data = []

    for item in stops:

        data.append({

            "id": item.id,

            "route_id": item.route_id,

            "stop_id": item.stop.id,

            "stop_code": item.stop.stop_code,

            "stop_name": item.stop.stop_name,

            "latitude": item.stop.latitude,

            "longitude": item.stop.longitude,

            "radius": item.stop.radius,

            "sequence": item.sequence,

            "scheduled_time": item.scheduled_time,

            "fare": item.fare,

            "distance_from_previous": item.distance_from_previous,

            "estimated_minutes": item.estimated_minutes

        })

    return data


@router.put("/route/{route_id}/replace")
def replace_route_stops(
    route_id: int,
    stop_data: list[RouteStopCreate],
    db: Session = Depends(get_db),
    _current_user = Depends(require_management),
):
    """Atomically replace a route's ordered list of master stops."""

    route = get_route_or_404(db, route_id)
    stop_ids = [item.stop_id for item in stop_data]
    if len(stop_ids) != len(set(stop_ids)):
        raise HTTPException(status_code=422, detail="A stop can appear only once in a route.")

    stops = db.query(Stop).filter(Stop.id.in_(stop_ids)).all() if stop_ids else []
    found_ids = {stop.id for stop in stops}
    missing_ids = sorted(set(stop_ids) - found_ids)
    if missing_ids:
        raise HTTPException(status_code=404, detail=f"Stop not found: {missing_ids[0]}.")

    try:
        # Route-stop IDs are referenced by the live trip's current geofence
        # state.  Recreating every row on each route edit invalidates those
        # references (and PostgreSQL correctly refuses the delete).  Retain
        # rows for stops that are still part of the route and only remove
        # genuinely omitted stops.
        existing_stops = db.query(RouteStop).filter(
            RouteStop.route_id == route_id
        ).all()
        existing_by_stop_id = {item.stop_id: item for item in existing_stops}
        requested_stop_ids = set(stop_ids)
        removed_stops = [
            item for item in existing_stops
            if item.stop_id not in requested_stop_ids
        ]

        removed_ids = [item.id for item in removed_stops]
        if removed_ids:
            # Stop-arrival history is immutable.  Do not silently delete or
            # rewrite that audit trail when someone edits a route.
            has_history = db.query(TripStopEvent.id).filter(
                TripStopEvent.route_stop_id.in_(removed_ids)
            ).first()
            if has_history:
                raise HTTPException(
                    status_code=409,
                    detail=(
                        "A removed stop is referenced by trip history and "
                        "cannot be deleted. Keep the stop or create a new route."
                    ),
                )

            # A removed stop may still be the current stop of an active or
            # completed trip.  The historical trip remains intact; clearing
            # this transient pointer lets the next GPS update choose from the
            # newly saved route instead of violating the foreign key.
            db.query(LiveTrip).filter(
                LiveTrip.current_route_stop_id.in_(removed_ids)
            ).update(
                {
                    LiveTrip.current_route_stop_id: None,
                    LiveTrip.current_stop_status: "Approaching",
                    LiveTrip.current_stop_arrived_at: None,
                    LiveTrip.current_stop_departed_at: None,
                },
                synchronize_session=False,
            )
            db.query(RouteStop).filter(RouteStop.id.in_(removed_ids)).delete(
                synchronize_session=False
            )

        for sequence, item in enumerate(stop_data, start=1):
            route_stop = existing_by_stop_id.get(item.stop_id)
            if route_stop is None:
                route_stop = RouteStop(route_id=route_id, stop_id=item.stop_id)
                db.add(route_stop)
            route_stop.sequence = sequence
            route_stop.scheduled_time = item.scheduled_time
            route_stop.fare = item.fare
            route_stop.distance_from_previous = item.distance_from_previous
            route_stop.estimated_minutes = item.estimated_minutes
        route.total_stops = len(stop_data)
        db.commit()
    except Exception:
        db.rollback()
        raise

    return {"route_id": route_id, "total_stops": len(stop_data)}
# ==========================================================
# ADD STOP TO ROUTE
# ==========================================================

@router.post(
    "/{route_id}",
    response_model=RouteStopResponse,
)
def add_stop_to_route(

    route_id: int,

    stop_data: RouteStopCreate,

    db: Session = Depends(get_db),
    _current_user = Depends(require_management),

):
    """
    Adds a master stop to a route.
    """

    # ======================================================
    # CHECK ROUTE
    # ======================================================

    route = get_route_or_404(db, route_id)

    # ======================================================
    # CHECK STOP
    # ======================================================

    stop = get_stop_or_404(db, stop_data.stop_id)

    # ======================================================
    # CHECK DUPLICATE
    # ======================================================

    existing = (

        db.query(RouteStop)

        .filter(

            RouteStop.route_id == route_id,

            RouteStop.stop_id == stop.id

        )

        .first()

    )

    if existing:

        raise HTTPException(

            status_code=400,

            detail="This stop already exists in the route."

        )

    # ======================================================
    # NEXT SEQUENCE
    # ======================================================

    last_stop = (

        db.query(RouteStop)

        .filter(
            RouteStop.route_id == route_id
        )

        .order_by(
            RouteStop.sequence.desc()
        )

        .first()

    )

    next_sequence = 1

    if last_stop:

        next_sequence = last_stop.sequence + 1

    # ======================================================
    # CREATE ROUTE STOP
    # ======================================================

    route_stop = RouteStop(

        route_id = route_id,

        stop_id = stop.id,

        sequence = next_sequence,

        scheduled_time = stop_data.scheduled_time,

        fare = stop_data.fare,

        distance_from_previous = stop_data.distance_from_previous,

        estimated_minutes = stop_data.estimated_minutes,

    )

    db.add(route_stop)

    # ======================================================
    # UPDATE ROUTE
    # ======================================================

    db.flush()

    update_route_stop_count(
        db,
        route_id,
    )

    db.commit()

    db.refresh(route_stop)

    return {

            "id": route_stop.id,

            "route_id": route_stop.route_id,

            "stop_id": route_stop.stop_id,

            "stop_code": stop.stop_code,

            "stop_name": stop.stop_name,

            "latitude": stop.latitude,

            "longitude": stop.longitude,

            "radius": stop.radius,

            "sequence": route_stop.sequence,

            "scheduled_time": route_stop.scheduled_time,

            "fare": route_stop.fare,

            "distance_from_previous": route_stop.distance_from_previous,

            "estimated_minutes": route_stop.estimated_minutes,

        }

    
# ==========================================================
# REORDER ROUTE STOPS
# ==========================================================

@router.put("/{route_stop_id}/sequence")
def update_stop_sequence(

    route_stop_id: int,

    data: dict,

    db: Session = Depends(get_db),
    _current_user = Depends(require_management),

):
    """
    Moves a stop up or down within a route.
    """

    route_stop = get_route_stop_or_404(db, route_stop_id)

    if route_stop is None:

        raise HTTPException(

            status_code=404,

            detail="Route stop not found."

        )

    new_sequence = data.get("sequence")

    if new_sequence is None:

        raise HTTPException(

            status_code=400,

            detail="New sequence is required."

        )

    # ======================================================
    # FIND STOP CURRENTLY AT NEW POSITION
    # ======================================================

    existing = (

        db.query(RouteStop)

        .filter(

            RouteStop.route_id == route_stop.route_id,

            RouteStop.sequence == new_sequence

        )

        .first()

    )

    # ======================================================
    # SWAP POSITIONS
    # ======================================================

    if existing:

        existing.sequence = route_stop.sequence

    route_stop.sequence = new_sequence

    db.commit()

    return {

        "success": True,

        "message": "Stop order updated successfully."

    }
# ==========================================================
# CLEAR ALL STOPS FOR A ROUTE
# ==========================================================

@router.delete("/route/{route_id}")
def clear_route_stops(
    route_id: int,
    db: Session = Depends(get_db),
    _current_user = Depends(require_management),
):

    db.query(RouteStop).filter(
        RouteStop.route_id == route_id
    ).delete()

    db.commit()

    return {
        "message": "Route stops cleared."
    }
# ==========================================================
# REMOVE STOP FROM ROUTE
# ==========================================================

@router.delete("/{route_stop_id}")
def remove_stop_from_route(

    route_stop_id: int,

    db: Session = Depends(get_db),
    _current_user = Depends(require_management),

):
    """
    Removes a stop from a route.
    """

    route_stop = get_route_stop_or_404(
        db,
        route_stop_id,
    )

    db.delete(route_stop)

    db.flush()

    update_route_stop_count(
        db,
        route_stop.route_id,
    )

    resequence_route_stops(
        db,
        route_stop.route_id,
    )

    db.commit()

    return {

        "success": True,

        "message": "Stop removed successfully."

    }
