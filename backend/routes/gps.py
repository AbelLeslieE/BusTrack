"""
BusTrack
GPS Tracking API
"""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from backend.database import get_db

from backend.routes.models_tracking import (
    LiveTrip,
    LiveLocation,
)

from backend.schemas_tracking import (
    TripStartRequest,
    TripStopRequest,
    LocationUpdateRequest,
    LiveTripResponse,
)
from backend.auth import get_current_user

from backend.models import (
    User,
    Driver,
    Route,
)
router = APIRouter(
    prefix="/api/gps",
    tags=["GPS Tracking"],
)
@router.post(
    "/start",
    response_model=LiveTripResponse,
)
def start_trip(

    current_user: User = Depends(get_current_user),

    db: Session = Depends(get_db),

):

    # --------------------------------------------------
    # Find Driver Profile
    # --------------------------------------------------

    driver = (
        db.query(Driver)
        .filter(
            Driver.user_id == current_user.id
        )
        .first()
    )

    if driver is None:

        raise HTTPException(
            status_code=404,
            detail="Driver profile not found.",
        )

    # --------------------------------------------------
    # Driver must have a bus
    # --------------------------------------------------

    if driver.bus_id is None:

        raise HTTPException(
            status_code=400,
            detail="No bus assigned.",
        )

    # --------------------------------------------------
    # Find Assigned Route
    # --------------------------------------------------

    route = (
        db.query(Route)
        .filter(
            Route.driver_id == driver.id
        )
        .first()
    )

    if route is None:

        raise HTTPException(
            status_code=400,
            detail="No route assigned.",
        )

    # --------------------------------------------------
    # Already running?
    # --------------------------------------------------

    running = (
        db.query(LiveTrip)
        .filter(
            LiveTrip.driver_id == driver.id,
            LiveTrip.ended_at.is_(None),
        )
        .first()
    )

    if running:

        raise HTTPException(
            status_code=400,
            detail="Trip already running.",
        )

    # --------------------------------------------------
    # Create Trip
    # --------------------------------------------------

    trip = LiveTrip(

        driver_id=driver.id,

        bus_id=driver.bus_id,

        route_id=route.id,

        status="Running",

        started_at=datetime.now(timezone.utc),

    )

    db.add(trip)

    db.commit()

    db.refresh(trip)

    return trip
@router.post("/update")
def update_location(
    request: LocationUpdateRequest,
    db: Session = Depends(get_db),
):

    # --------------------------------------------------
    # Find the active trip
    # --------------------------------------------------

    trip = (
        db.query(LiveTrip)
        .filter(
            LiveTrip.id == request.trip_id,
            LiveTrip.ended_at.is_(None),
        )
        .first()
    )

    if trip is None:
        raise HTTPException(
            status_code=404,
            detail="Active trip not found.",
        )

    # --------------------------------------------------
    # Save GPS history
    # --------------------------------------------------

    location = LiveLocation(

        trip_id=trip.id,

        latitude=request.latitude,

        longitude=request.longitude,

        speed=request.speed,

        accuracy=request.accuracy,

        recorded_at=datetime.now(timezone.utc),

    )

    db.add(location)

    # --------------------------------------------------
    # Update latest live position
    # --------------------------------------------------

    trip.current_latitude = request.latitude
    trip.current_longitude = request.longitude
    trip.current_speed = request.speed
    trip.current_accuracy = request.accuracy
    trip.last_location_update = datetime.now(timezone.utc)

    db.commit()
    return {
        "message": "Location updated successfully."
    }

    
@router.post("/stop")
def stop_trip(
    request: TripStopRequest,
    db: Session = Depends(get_db),
):

    trip = (
        db.query(LiveTrip)
        .filter(
            LiveTrip.id == request.trip_id,
            LiveTrip.ended_at.is_(None),
        )
        .first()
    )

    if trip is None:
        raise HTTPException(
            status_code=404,
            detail="Active trip not found.",
        )

    trip.status = "Completed"
    trip.ended_at = datetime.now(timezone.utc)

    db.commit()

    return {
        "message": "Trip completed successfully."
    }
@router.get("/live")
def get_live_tracking(
    db: Session = Depends(get_db),
):

    trips = (
        db.query(LiveTrip)
        .filter(
            LiveTrip.ended_at.is_(None)
        )
        .all()
    )

    response = []

    for trip in trips:

        response.append({

            "trip_id": trip.id,

            "driver_id": trip.driver_id,

            "bus_id": trip.bus_id,

            "route_id": trip.route_id,

            "status": trip.status,

            "latitude": trip.current_latitude,

            "longitude": trip.current_longitude,

            "speed": trip.current_speed,

            "accuracy": trip.current_accuracy,

            "last_location_update": trip.last_location_update,

            "started_at": trip.started_at,

        })
    return response

@router.get("/current")
def get_current_trip(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):

    driver = (
        db.query(Driver)
        .filter(Driver.user_id == current_user.id)
        .first()
    )

    if driver is None:
        raise HTTPException(
            status_code=404,
            detail="Driver not found.",
        )

    trip = (
        db.query(LiveTrip)
        .filter(
            LiveTrip.driver_id == driver.id,
            LiveTrip.ended_at.is_(None),
        )
        .first()
    )

    if trip is None:
        return None

    return trip