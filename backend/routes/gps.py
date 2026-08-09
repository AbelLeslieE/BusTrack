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
    TripStopRequest,
    LocationUpdateRequest,
    LiveTripResponse,
)

from backend.auth import get_current_user

from backend.models import (
    User,
    Driver,
    Route,
    Bus,
)


# ==========================================================
# ROUTER
# ==========================================================

router = APIRouter(
    prefix="/api/gps",
    tags=["GPS Tracking"],
)


# ==========================================================
# BUILD LIVE TRIP RESPONSE
# ==========================================================

def build_live_trip_response(
    trip: LiveTrip,
    db: Session,
):
    """
    Build the standard response returned for a live trip.

    The LiveTrip table stores IDs only.
    This function resolves the related Bus and Route
    so the frontend receives human-readable information.
    """

    # ------------------------------------------------------
    # Find assigned bus
    # ------------------------------------------------------

    bus = (
        db.query(Bus)
        .filter(
            Bus.id == trip.bus_id
        )
        .first()
    )

    if bus is None:

        raise HTTPException(
            status_code=404,
            detail="Bus assigned to trip not found.",
        )

    # ------------------------------------------------------
    # Find assigned route
    # ------------------------------------------------------

    route = (
        db.query(Route)
        .filter(
            Route.id == trip.route_id
        )
        .first()
    )

    if route is None:

        raise HTTPException(
            status_code=404,
            detail="Route assigned to trip not found.",
        )

    # ------------------------------------------------------
    # Return standard trip response
    # ------------------------------------------------------

    return {

        "id": trip.id,

        "driver_id": trip.driver_id,

        "bus_id": trip.bus_id,

        "route_id": trip.route_id,

        "bus_number": bus.bus_number,

        "route_name": route.route_name,

        "route_code": route.route_code,

        "status": trip.status,

        "started_at": trip.started_at,

        "ended_at": trip.ended_at,

    }


# ==========================================================
# START TRIP
# ==========================================================

@router.post(
    "/start",
    response_model=LiveTripResponse,
)
def start_trip(

    current_user: User = Depends(
        get_current_user
    ),

    db: Session = Depends(
        get_db
    ),

):

    # ------------------------------------------------------
    # Find Driver Profile
    # ------------------------------------------------------

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

    # ------------------------------------------------------
    # Driver must have a bus
    # ------------------------------------------------------

    if driver.bus_id is None:

        raise HTTPException(
            status_code=400,
            detail="No bus assigned.",
        )

    # ------------------------------------------------------
    # Find Assigned Route
    # ------------------------------------------------------

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

    # ------------------------------------------------------
    # Check if driver already has an active trip
    # ------------------------------------------------------

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

    # ------------------------------------------------------
    # Create Trip
    # ------------------------------------------------------

    trip = LiveTrip(

        driver_id=driver.id,

        bus_id=driver.bus_id,

        route_id=route.id,

        status="Running",

        started_at=datetime.now(
            timezone.utc
        ),

    )

    # ------------------------------------------------------
    # Save Trip
    # ------------------------------------------------------

    db.add(trip)

    db.commit()

    db.refresh(trip)

    # ------------------------------------------------------
    # Return standard response
    # ------------------------------------------------------

    return build_live_trip_response(
        trip,
        db,
    )


# ==========================================================
# UPDATE DRIVER LOCATION
# ==========================================================

@router.post("/update")
def update_location(

    request: LocationUpdateRequest,

    db: Session = Depends(
        get_db
    ),

):

    # ------------------------------------------------------
    # Find active trip
    # ------------------------------------------------------

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

    # ------------------------------------------------------
    # Save GPS History
    # ------------------------------------------------------

    location = LiveLocation(

        trip_id=trip.id,

        latitude=request.latitude,

        longitude=request.longitude,

        speed=request.speed,

        accuracy=request.accuracy,

        recorded_at=datetime.now(
            timezone.utc
        ),

    )

    db.add(location)

    # ------------------------------------------------------
    # Update Current Live Position
    # ------------------------------------------------------

    trip.current_latitude = request.latitude

    trip.current_longitude = request.longitude

    trip.current_speed = request.speed

    trip.current_accuracy = request.accuracy

    trip.last_location_update = datetime.now(
        timezone.utc
    )

    db.commit()

    return {
        "message": "Location updated successfully."
    }


# ==========================================================
# STOP TRIP
# ==========================================================

@router.post("/stop")
def stop_trip(

    request: TripStopRequest,

    db: Session = Depends(
        get_db
    ),

):

    # ------------------------------------------------------
    # Find active trip
    # ------------------------------------------------------

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

    # ------------------------------------------------------
    # Complete Trip
    # ------------------------------------------------------

    trip.status = "Completed"

    trip.ended_at = datetime.now(
        timezone.utc
    )

    db.commit()

    return {
        "message": "Trip completed successfully."
    }


# ==========================================================
# GET ALL ACTIVE LIVE TRIPS
# ==========================================================
# ==========================================================
# GET LIVE TRACKING
# ==========================================================

@router.get("/live")
def get_live_tracking(
    db: Session = Depends(get_db),
):

    # ------------------------------------------------------
    # Get all currently running trips
    # ------------------------------------------------------

    trips = (
        db.query(LiveTrip)
        .filter(
            LiveTrip.ended_at.is_(None)
        )
        .all()
    )

    response = []

    # ------------------------------------------------------
    # Build live tracking response
    # ------------------------------------------------------

    for trip in trips:

        # ==================================================
        # DRIVER
        # ==================================================

        driver = (
            db.query(Driver)
            .filter(
                Driver.id == trip.driver_id
            )
            .first()
        )

        driver_name = None

        if driver and driver.user:

            driver_name = driver.user.full_name


        # ==================================================
        # BUS
        # ==================================================

        bus = (
            db.query(Bus)
            .filter(
                Bus.id == trip.bus_id
            )
            .first()
        )

        bus_number = None

        if bus:

            bus_number = bus.bus_number


        # ==================================================
        # ROUTE
        # ==================================================

        route = (
            db.query(Route)
            .filter(
                Route.id == trip.route_id
            )
            .first()
        )

        route_name = None
        route_code = None

        if route:

            route_name = route.route_name
            route_code = route.route_code


        # ==================================================
        # RESPONSE
        # ==================================================

        response.append({

            # ------------------------------------------------
            # Trip information
            # ------------------------------------------------

            "trip_id": trip.id,

            "status": trip.status,

            "started_at": trip.started_at,

            # ------------------------------------------------
            # Driver
            # ------------------------------------------------

            "driver_id": trip.driver_id,

            "driver_name": driver_name,

            # ------------------------------------------------
            # Bus
            # ------------------------------------------------

            "bus_id": trip.bus_id,

            "bus_number": bus_number,

            # ------------------------------------------------
            # Route
            # ------------------------------------------------

            "route_id": trip.route_id,

            "route_name": route_name,

            "route_code": route_code,

            # ------------------------------------------------
            # GPS
            # ------------------------------------------------

            "latitude": trip.current_latitude,

            "longitude": trip.current_longitude,

            "speed": trip.current_speed,

            "accuracy": trip.current_accuracy,

            "last_location_update":
                trip.last_location_update,

        })

    return response

# ==========================================================
# GET CURRENT DRIVER TRIP
# ==========================================================

@router.get("/current")
def get_current_trip(

    current_user: User = Depends(
        get_current_user
    ),

    db: Session = Depends(
        get_db
    ),

):

    # ------------------------------------------------------
    # Find Driver
    # ------------------------------------------------------

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
            detail="Driver not found.",
        )

    # ------------------------------------------------------
    # Find Active Trip
    # ------------------------------------------------------

    trip = (
        db.query(LiveTrip)
        .filter(
            LiveTrip.driver_id == driver.id,
            LiveTrip.ended_at.is_(None),
        )
        .first()
    )

    # ------------------------------------------------------
    # No active trip
    # ------------------------------------------------------

    if trip is None:

        return None

    # ------------------------------------------------------
    # Return standard response
    # ------------------------------------------------------

    return build_live_trip_response(
        trip,
        db,
    )