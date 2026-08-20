"""
BusTrack
GPS Tracking API
"""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from backend.database import get_db

from backend.routes.models_tracking import (
    LiveTrip,
    LiveLocation,
    TripStopEvent,
)

from backend.schemas_tracking import (
    TripStopRequest,
    TripAdminStopRequest,
    LocationUpdateRequest,
    LiveTripResponse,
)
from backend.services.tracking_engine import (
    calculate_speed_kmh,
    validate_speed,
    calculate_stop_distance,
    is_inside_stop_radius,
)
from backend.services.trip_direction import direction_from_start_position, ordered_route_stops
from backend.security import require_driver, require_management
from backend.audit import record_audit_event
from backend.services.vehicle_gps import vehicle_gps_is_authoritative
from backend.routes.models_tracking import BusGPSState

from backend.models import (
    User,
    Driver,
    Route,
    Bus,
    RouteStop,
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
# UPDATE ROUTE STOP PROGRESSION
# ==========================================================

def update_route_stop_progression(
    trip: LiveTrip,
    route_stops: list[RouteStop],
    latitude: float,
    longitude: float,
    previous_location: LiveLocation | None,
    current_timestamp: datetime,
    db: Session,
):
    """
    Update the persistent route-stop state for a live trip.

    State flow:

        Approaching
            ↓
        enter radius
            ↓
          Arrived
            ↓
        leave radius
            ↓
         Departed
            ↓
        next RouteStop

    The current stop controls ordinary arrival and departure transitions.
    If a GPS position is inside a later stop in the same travel direction,
    the trip may advance to that stop. This handles legitimate shortcuts and
    delayed position uploads without ever moving backward through the route.
    """

    if not route_stops:
        return None

    def record_stop_event(event_type: str, route_stop: RouteStop, stop, distance: float | None):
        db.add(TripStopEvent(
            trip_id=trip.id,
            route_stop_id=route_stop.id,
            stop_id=stop.id,
            event_type=event_type,
            occurred_at=current_timestamp,
            latitude=latitude,
            longitude=longitude,
            distance_meters=distance,
            radius_meters=float(stop.radius) if stop.radius is not None else 50.0,
        ))


    # ======================================================
    # FIND CURRENT ROUTE STOP
    # ======================================================

    current_route_stop = None

    if trip.current_route_stop_id is not None:

        current_route_stop = next(
            (
                route_stop
                for route_stop in route_stops
                if route_stop.id == trip.current_route_stop_id
            ),
            None,
        )


    # ======================================================
    # INITIALIZE ROUTE STOP
    #
    # If this is the first GPS update of the trip, determine
    # which stop should become the current stop.
    #
    # If the bus is already inside a stop radius, use that
    # stop. Otherwise start with the first route stop.
    # ======================================================

    if current_route_stop is None:

        stops_inside_radius = []

        for route_index, route_stop in enumerate(route_stops):

            stop = route_stop.stop

            if stop is None:
                continue

            distance = calculate_stop_distance(
                latitude,
                longitude,
                stop,
            )

            if distance is not None and is_inside_stop_radius(
                distance,
                stop,
            ):
                stops_inside_radius.append(
                    (
                        route_index,
                        route_stop,
                        distance,
                    )
                )

        if stops_inside_radius:

            stops_inside_radius.sort(
                # Overlapping radii are possible. Prefer the actual closest
                # stop, then the earlier one if two distances are identical.
                key=lambda item: (item[2], item[0])
            )

            current_route_stop = (
                stops_inside_radius[0][1]
            )

            trip.current_route_stop_id = (
                current_route_stop.id
            )

            trip.current_stop_status = "Arrived"

            trip.current_stop_arrived_at = (
                current_timestamp
            )

            trip.current_stop_departed_at = None

            record_stop_event(
                "Arrived",
                current_route_stop,
                current_route_stop.stop,
                stops_inside_radius[0][2],
            )

        else:

            current_route_stop = route_stops[0]

            trip.current_route_stop_id = (
                current_route_stop.id
            )

            trip.current_stop_status = "Approaching"

            trip.current_stop_arrived_at = None

            trip.current_stop_departed_at = None


    # ======================================================
    # CURRENT STOP
    # ======================================================

    current_stop = current_route_stop.stop

    if current_stop is None:
        return None


    # ======================================================
    # DISTANCE TO CURRENT STOP
    # ======================================================

    current_distance = calculate_stop_distance(
        latitude,
        longitude,
        current_stop,
    )


    if current_distance is None:
        return None


    inside_radius = is_inside_stop_radius(
        current_distance,
        current_stop,
    )

    # ======================================================
    # LOCATION-BASED FORWARD ADVANCE
    #
    # A bus may legally take a shortcut or upload a delayed position. If it
    # is outside the active stop but inside a later stop in the current travel
    # order, use the vehicle's real location as the current stop. Only stops
    # ahead of the active index are eligible, so inaccurate GPS can never
    # move a trip backward.
    # ======================================================

    current_index = route_stops.index(current_route_stop)
    stops_ahead_inside_radius = []

    if not inside_radius:
        for route_index, route_stop in enumerate(
            route_stops[current_index + 1:],
            start=current_index + 1,
        ):
            stop = route_stop.stop
            if stop is None:
                continue
            distance = calculate_stop_distance(latitude, longitude, stop)
            if distance is not None and is_inside_stop_radius(distance, stop):
                stops_ahead_inside_radius.append((route_index, route_stop, distance))

    if stops_ahead_inside_radius:
        # Prefer the closest matching stop. This makes a shortcut landing at
        # a later stop reliable while avoiding a false jump through overlapping
        # geofences.
        stops_ahead_inside_radius.sort(key=lambda item: (item[2], item[0]))
        target_index, target_route_stop, target_distance = stops_ahead_inside_radius[0]
        target_stop = target_route_stop.stop

        departed_stop = None
        if trip.current_stop_status == "Arrived":
            trip.current_stop_departed_at = current_timestamp
            record_stop_event("Departed", current_route_stop, current_stop, current_distance)
            departed_stop = {
                "route_stop_id": current_route_stop.id,
                "stop_id": current_stop.id,
                "stop_name": current_stop.stop_name,
                "sequence": current_route_stop.sequence,
            }

        trip.current_route_stop_id = target_route_stop.id
        trip.current_stop_status = "Arrived"
        trip.current_stop_arrived_at = current_timestamp
        trip.current_stop_departed_at = None
        record_stop_event("Arrived", target_route_stop, target_stop, target_distance)

        terminal_reached = len(route_stops) > 1 and target_route_stop == route_stops[-1]
        completed_direction = trip.route_direction
        if terminal_reached:
            trip.route_direction = "reverse" if completed_direction != "reverse" else "forward"
            trip.terminal_reached_at = current_timestamp
            trip.terminal_stop_id = target_stop.id

        return {
            "event": "Arrived",
            "route_stop_id": target_route_stop.id,
            "stop_id": target_stop.id,
            "stop_code": target_stop.stop_code,
            "stop_name": target_stop.stop_name,
            "sequence": target_route_stop.sequence,
            "distance_meters": round(target_distance, 2),
            "radius_meters": float(target_stop.radius) if target_stop.radius is not None else 50.0,
            "advanced_from_sequence": current_route_stop.sequence,
            "skipped_stop_count": target_index - current_index - 1,
            "departed_stop": departed_stop,
            "terminal_reached": terminal_reached,
            "completed_direction": completed_direction if terminal_reached else None,
            "next_direction": trip.route_direction if terminal_reached else None,
        }


    # ======================================================
    # APPROACHING → ARRIVED
    # ======================================================

    if (
        trip.current_stop_status != "Arrived"
        and inside_radius
    ):

        trip.current_stop_status = "Arrived"

        trip.current_stop_arrived_at = (
            current_timestamp
        )

        trip.current_stop_departed_at = None

        record_stop_event("Arrived", current_route_stop, current_stop, current_distance)

        # Reaching the final stop completes this leg of the same live trip.
        # Reverse the *display/travel* order in memory; never rewrite the
        # route's saved master stop sequence. The terminal remains current,
        # but becomes stop 1 of the return journey on the next GPS update.
        terminal_reached = len(route_stops) > 1 and current_route_stop == route_stops[-1]
        completed_direction = trip.route_direction
        if terminal_reached:
            trip.route_direction = "reverse" if completed_direction != "reverse" else "forward"
            trip.terminal_reached_at = current_timestamp
            trip.terminal_stop_id = current_stop.id


        return {
            "event": "Arrived",
            "route_stop_id": current_route_stop.id,
            "stop_id": current_stop.id,
            "stop_code": current_stop.stop_code,
            "stop_name": current_stop.stop_name,
            "sequence": current_route_stop.sequence,
            "distance_meters": round(
                current_distance,
                2,
            ),
            "radius_meters": float(
                current_stop.radius
            )
            if current_stop.radius is not None
            else 50.0,
            "terminal_reached": terminal_reached,
            "completed_direction": completed_direction if terminal_reached else None,
            "next_direction": trip.route_direction if terminal_reached else None,
        }


    # ======================================================
    # ARRIVED → DEPARTED
    #
    # The bus must first have been inside the radius and
    # then move outside it.
    # ======================================================

    if (
        trip.current_stop_status == "Arrived"
        and not inside_radius
    ):

        departed_route_stop_id = (
            current_route_stop.id
        )

        departed_stop_id = (
            current_stop.id
        )

        departed_stop_code = (
            current_stop.stop_code
        )

        departed_stop_name = (
            current_stop.stop_name
        )

        departed_sequence = (
            current_route_stop.sequence
        )

        trip.current_stop_status = "Departed"

        trip.current_stop_departed_at = (
            current_timestamp
        )

        record_stop_event("Departed", current_route_stop, current_stop, current_distance)


        # --------------------------------------------------
        # Find the next route stop in this trip's travel order.  The list can
        # be reversed for an evening return journey.
        # --------------------------------------------------

        current_index = route_stops.index(current_route_stop)
        next_route_stop = (
            route_stops[current_index + 1]
            if current_index + 1 < len(route_stops)
            else None
        )


        # --------------------------------------------------
        # No more stops.
        # --------------------------------------------------

        if next_route_stop is None:

            return {
                "event": "Departed",
                "route_stop_id": departed_route_stop_id,
                "stop_id": departed_stop_id,
                "stop_code": departed_stop_code,
                "stop_name": departed_stop_name,
                "sequence": departed_sequence,
                "distance_meters": round(
                    current_distance,
                    2,
                ),
                "radius_meters": float(
                    current_stop.radius
                )
                if current_stop.radius is not None
                else 50.0,
                "next_stop": None,
            }


        # --------------------------------------------------
        # Move tracking to the next stop.
        # --------------------------------------------------

        trip.current_route_stop_id = (
            next_route_stop.id
        )

        trip.current_stop_status = "Approaching"

        trip.current_stop_arrived_at = None

        trip.current_stop_departed_at = None


        next_stop = next_route_stop.stop


        return {
            "event": "Departed",
            "route_stop_id": departed_route_stop_id,
            "stop_id": departed_stop_id,
            "stop_code": departed_stop_code,
            "stop_name": departed_stop_name,
            "sequence": departed_sequence,
            "distance_meters": round(
                current_distance,
                2,
            ),
            "radius_meters": float(
                current_stop.radius
            )
            if current_stop.radius is not None
            else 50.0,
            "next_stop": {
                "route_stop_id": next_route_stop.id,
                "stop_id": next_stop.id
                if next_stop
                else None,
                "stop_code": next_stop.stop_code
                if next_stop
                else None,
                "stop_name": next_stop.stop_name
                if next_stop
                else None,
                "sequence": next_route_stop.sequence,
            },
        }


    # ======================================================
    # NO STATE TRANSITION
    # ======================================================

    return None
# ==========================================================
# START TRIP
# ==========================================================

@router.post(
    "/start",
    response_model=LiveTripResponse,
)
def start_trip(

    current_user: User = Depends(
        require_driver
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

    route_stops = (
        db.query(RouteStop)
        .filter(RouteStop.route_id == route.id)
        .order_by(RouteStop.sequence.asc())
        .all()
    )
    vehicle_state = (
        db.query(BusGPSState)
        .filter(BusGPSState.bus_id == driver.bus_id)
        .first()
    )
    route_direction = direction_from_start_position(
        route_stops,
        vehicle_state.latitude if vehicle_gps_is_authoritative(vehicle_state) else None,
        vehicle_state.longitude if vehicle_gps_is_authoritative(vehicle_state) else None,
    )

    # ------------------------------------------------------
    # Create Trip
    # ------------------------------------------------------

    trip = LiveTrip(

        driver_id=driver.id,

        bus_id=driver.bus_id,

        route_id=route.id,

        status="Running",

        route_direction=route_direction,

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

    # If the mapped vehicle device is already reporting a fresh ignition-on
    # position, seed the just-created trip immediately. The driver UI can then
    # switch to vehicle GPS without waiting for the next 20-second provider
    # delivery; later deliveries continue through the normal provider mirror.
    if vehicle_gps_is_authoritative(vehicle_state):
        received_at = vehicle_state.received_at
        update_route_stop_progression(
            trip=trip,
            route_stops=ordered_route_stops(route_stops, trip.route_direction),
            latitude=vehicle_state.latitude,
            longitude=vehicle_state.longitude,
            previous_location=None,
            current_timestamp=vehicle_state.fix_time or received_at,
            db=db,
        )
        db.add(LiveLocation(
            trip_id=trip.id,
            latitude=vehicle_state.latitude,
            longitude=vehicle_state.longitude,
            speed=vehicle_state.speed_kmh,
            accuracy=vehicle_state.accuracy,
            recorded_at=received_at,
            source="vehicle_gps",
        ))
        trip.current_latitude = vehicle_state.latitude
        trip.current_longitude = vehicle_state.longitude
        trip.current_speed = vehicle_state.speed_kmh
        trip.current_accuracy = vehicle_state.accuracy
        trip.last_location_update = received_at
        trip.current_location_source = "vehicle_gps"
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

# ==========================================================
# UPDATE DRIVER LOCATION
# ==========================================================

@router.post("/update")
def update_location(

    request: LocationUpdateRequest,

    current_user: User = Depends(
        require_driver
    ),

    db: Session = Depends(
        get_db
    ),

):

    """
    Receive one GPS position from the active driver trip.

    Responsibilities:

    1. Authenticate the driver.
    2. Verify that the trip belongs to that driver.
    3. Read the previous GPS point.
    4. Calculate GPS-derived speed.
    5. Validate the reported GPS speed.
    6. Save GPS history.
    7. Update LiveTrip.
    8. Check route-stop geofences.
    """

    # ======================================================
    # FIND DRIVER PROFILE
    # ======================================================

    driver = (
        db.query(Driver)
        .filter(
            Driver.user_id == current_user.id
        )
        .first()
    )

    if driver is None:

        raise HTTPException(
            status_code=403,
            detail="Driver access required.",
        )

    # ======================================================
    # FIND ACTIVE TRIP
    # ======================================================

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

    # ======================================================
    # SECURITY CHECK
    #
    # A driver must only be able to update their own trip.
    # ======================================================

    if trip.driver_id != driver.id:

        raise HTTPException(
            status_code=403,
            detail="You are not authorized to update this trip.",
        )

    # ======================================================
    # CURRENT TIMESTAMP
    # ======================================================

    current_timestamp = datetime.now(
        timezone.utc
    )

    # A working ignition-on vehicle device is more accurate and cannot be
    # accidentally overwritten by a driver's phone. Phone tracking remains
    # available automatically when the provider signal is absent, stale, or
    # reports ignition off.
    vehicle_state = (
        db.query(BusGPSState)
        .filter(BusGPSState.bus_id == trip.bus_id)
        .first()
    )
    if vehicle_gps_is_authoritative(vehicle_state, current_timestamp):
        raise HTTPException(
            status_code=409,
            detail={
                "message": "Vehicle GPS is currently active; mobile tracking is disabled.",
                "tracking_source": "vehicle_gps",
            },
        )

    # ======================================================
    # FIND PREVIOUS GPS LOCATION
    # ======================================================

    previous_location = (
        db.query(LiveLocation)
        .filter(
            LiveLocation.trip_id == trip.id
        )
        .order_by(
            LiveLocation.recorded_at.desc()
        )
        .first()
    )

    # ======================================================
    # CALCULATE SPEED FROM GPS COORDINATES
    # ======================================================

    calculated_speed_kmh = None

    if previous_location is not None:

        calculated_speed_kmh = calculate_speed_kmh(

            previous_latitude =
                previous_location.latitude,

            previous_longitude =
                previous_location.longitude,

            previous_timestamp =
                previous_location.recorded_at,

            current_latitude =
                request.latitude,

            current_longitude =
                request.longitude,

            current_timestamp =
                current_timestamp,
        )

    # ======================================================
    # BROWSER GPS SPEED
    #
    # navigator.geolocation.coords.speed is metres/second.
    #
    # BusTrack stores speed internally as km/h.
    # ======================================================

    reported_speed_kmh = None

    if request.speed is not None:

        try:

            reported_speed_kmh = (
                float(request.speed) *
                3.6
            )

        except (
            TypeError,
            ValueError,
        ):

            reported_speed_kmh = None

    # ======================================================
    # VALIDATE SPEED
    # ======================================================

    speed_result = validate_speed(

        reported_speed_kmh =
            reported_speed_kmh,

        calculated_speed_kmh =
            calculated_speed_kmh,
    )

    validated_speed_kmh = (
        speed_result["speed_kmh"]
    )

    # ======================================================
    # FIND ROUTE STOPS
    #
    # RouteStop contains the sequence.
    # Stop contains the actual coordinates and radius.
    # ======================================================

    route_stops = (
        db.query(RouteStop)
        .filter(
            RouteStop.route_id == trip.route_id
        )
        .order_by(
            RouteStop.sequence.asc()
        )
        .all()
    )
    if trip.current_route_stop_id is None and trip.current_latitude is None:
        trip.route_direction = direction_from_start_position(
            route_stops, request.latitude, request.longitude
        )
    route_stops = ordered_route_stops(route_stops, trip.route_direction)



            
    # ======================================================
    # UPDATE PERSISTENT STOP PROGRESSION
    #
    # This must run ONCE for each GPS update.
    # It must NOT run inside the route-stop loop.
    # ======================================================

    stop_progression_event = None

    if route_stops:

        stop_progression_event = (
            update_route_stop_progression(
                trip=trip,
                route_stops=route_stops,
                latitude=request.latitude,
                longitude=request.longitude,
                previous_location=previous_location,
                current_timestamp=current_timestamp,
                db=db,
            )
        )
    # ======================================================
    # SAVE GPS HISTORY
    # ======================================================

    location = LiveLocation(

        trip_id =
            trip.id,

        latitude =
            request.latitude,

        longitude =
            request.longitude,

        speed =
            validated_speed_kmh,

        accuracy =
            request.accuracy,

        recorded_at =
            current_timestamp,

    )

    db.add(location)

    # ======================================================
    # UPDATE CURRENT LIVE POSITION
    # ======================================================

    trip.current_latitude = request.latitude

    trip.current_longitude = request.longitude

    trip.current_speed = validated_speed_kmh

    trip.current_accuracy = request.accuracy

    trip.last_location_update = current_timestamp
    trip.current_location_source = "mobile"
    # ======================================================
    # SAVE EVERYTHING
    # ======================================================

    db.commit()



    # ======================================================
    # RESPONSE
    # ======================================================

    return {

        "message":
            "Location updated successfully.",

        "trip_id":
            trip.id,

        "latitude":
            request.latitude,

        "longitude":
            request.longitude,

        "speed_kmh":
            validated_speed_kmh,

        "reported_speed_kmh":
            reported_speed_kmh,

        "calculated_speed_kmh":
            calculated_speed_kmh,

        "speed_validation":
            speed_result["reason"],

        "accuracy":
            request.accuracy,

        "timestamp":
            current_timestamp,

        "current_route_stop_id":
            trip.current_route_stop_id,

        "current_stop_status":
            trip.current_stop_status,

        "current_stop_arrived_at":
            trip.current_stop_arrived_at,

        "current_stop_departed_at":
            trip.current_stop_departed_at,

        "stop_progression_event":
            stop_progression_event,
    }

# ==========================================================
# STOP TRIP
# ==========================================================

@router.post("/stop")
def stop_trip(

    request: TripStopRequest,

    db: Session = Depends(get_db),
    current_user: User = Depends(require_driver),

):

    # ------------------------------------------------------
    # Find active trip
    # ------------------------------------------------------

    trip = (
        db.query(LiveTrip)
        .filter(
            LiveTrip.id == request.trip_id,
            LiveTrip.driver_id == (
                db.query(Driver.id)
                .filter(Driver.user_id == current_user.id)
                .scalar_subquery()
            ),
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


@router.post("/admin/trips/{trip_id}/end")
def end_trip_as_admin(
    trip_id: int,
    payload: TripAdminStopRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_management),
):
    """Safely stop or cancel a stuck active trip from the Admin portal.

    Ending a trip removes it from live tracking. Historical locations stay
    available, and the driver can start a fresh trip immediately afterwards.
    """

    trip = db.query(LiveTrip).filter(
        LiveTrip.id == trip_id,
        LiveTrip.ended_at.is_(None),
    ).first()
    if trip is None:
        raise HTTPException(status_code=404, detail="Active trip not found or already ended.")

    trip.status = payload.action
    trip.ended_at = datetime.now(timezone.utc)
    trip.ended_by_user_id = current_user.id
    trip.end_reason = payload.reason.strip() if payload.reason and payload.reason.strip() else None
    bus = db.get(Bus, trip.bus_id)
    record_audit_event(
        db,
        category="operations",
        action="trip_cancelled_by_admin" if payload.action == "Cancelled" else "trip_stopped_by_admin",
        actor=current_user,
        subject_type="live_trip",
        subject_id=trip.id,
        subject_label=bus.bus_number if bus else f"Trip #{trip.id}",
        details={"driver_id": trip.driver_id, "route_id": trip.route_id, "reason": trip.end_reason},
        request=request,
    )
    db.commit()
    return {
        "message": f"Trip {payload.action.casefold()} by administrator.",
        "trip_id": trip.id,
        "status": trip.status,
        "ended_at": trip.ended_at,
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
    _current_user: User = Depends(require_management),
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
        # CURRENT ROUTE STOP
        # ==================================================

        current_stop_data = None
        next_stop_data = None

        current_route_stop = None

        if trip.current_route_stop_id is not None:

            current_route_stop = (
                db.query(RouteStop)
                .filter(
                    RouteStop.id ==
                    trip.current_route_stop_id
                )
                .first()
            )

        if current_route_stop is not None:

            current_stop = current_route_stop.stop

            if current_stop is not None:

                current_stop_data = {
                    "route_stop_id":
                        current_route_stop.id,

                    "stop_id":
                        current_stop.id,

                    "sequence":
                        current_route_stop.sequence,

                    "stop_code":
                        current_stop.stop_code,

                    "stop_name":
                        current_stop.stop_name,

                    "latitude":
                        current_stop.latitude,

                    "longitude":
                        current_stop.longitude,

                    "radius":
                        current_stop.radius,
                }


            # --------------------------------------------------
            # Find the next stop in this trip's travel order.
            # A route is saved in its morning order, while an evening return
            # journey travels that same list in reverse from the campus stop.
            # --------------------------------------------------

            trip_route_stops = (
                db.query(RouteStop)
                .filter(
                    RouteStop.route_id == trip.route_id,
                )
                .order_by(RouteStop.sequence.asc())
                .all()
            )
            trip_route_stops = ordered_route_stops(
                trip_route_stops,
                trip.route_direction,
            )
            current_index = next(
                (
                    index
                    for index, route_stop in enumerate(trip_route_stops)
                    if route_stop.id == current_route_stop.id
                ),
                -1,
            )
            next_route_stop = (
                trip_route_stops[current_index + 1]
                if current_index >= 0
                and current_index + 1 < len(trip_route_stops)
                else None
            )

            if next_route_stop is not None:

                next_stop = next_route_stop.stop

                if next_stop is not None:

                    next_stop_data = {
                        "route_stop_id":
                            next_route_stop.id,

                        "stop_id":
                            next_stop.id,

                        "sequence":
                            next_route_stop.sequence,

                        "stop_code":
                            next_stop.stop_code,

                        "stop_name":
                            next_stop.stop_name,

                        "latitude":
                            next_stop.latitude,

                        "longitude":
                            next_stop.longitude,

                        "radius":
                            next_stop.radius,
                    }        
        # ==================================================
        # RESPONSE
        # ==================================================

        response.append({

            # ------------------------------------------------
            # Trip information
            # ------------------------------------------------

            "trip_id": trip.id,

            "is_active_trip": True,

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

            "registration_number": bus.registration_number if bus else None,

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

            "location_source":
                trip.current_location_source or "mobile",

            "route_direction": trip.route_direction,
            # ------------------------------------------------
            # ROUTE STOP PROGRESSION
            # ------------------------------------------------

            "current_stop":
                current_stop_data,

            "next_stop":
                next_stop_data,

            "stop_status":
                trip.current_stop_status,

            "stop_arrived_at":
                trip.current_stop_arrived_at,

            "stop_departed_at":
                trip.current_stop_departed_at,

        })

    # Provider GPS does not start or stop a driver's trip by itself. Still,
    # management must be able to see a mapped bus when it reports an off-state
    # heartbeat or before the driver starts a trip in the app.
    trip_bus_ids = {trip.bus_id for trip in trips}
    provider_states = db.query(BusGPSState).all()
    for provider_state in provider_states:
        if provider_state.bus_id in trip_bus_ids:
            continue
        bus = db.query(Bus).filter(Bus.id == provider_state.bus_id).first()
        if bus is None:
            continue
        route = db.query(Route).filter(Route.bus_id == bus.id).first()
        assigned_driver_id = route.driver_id if route and route.driver_id else bus.driver_id
        driver = db.get(Driver, assigned_driver_id) if assigned_driver_id else None
        position_time = provider_state.fix_time or provider_state.received_at
        if position_time.tzinfo is None:
            position_time = position_time.replace(tzinfo=timezone.utc)
        expected_interval = 20 if provider_state.ignition is True else 120
        age_seconds = max(0, int((datetime.now(timezone.utc) - position_time).total_seconds()))
        # Keep a real, last-known provider position visible even when it has
        # become stale.  It is explicitly labelled through ``is_fresh`` below,
        # so administrators never mistake it for a current live position, but
        # a parked/offline bus does not disappear from the fleet map merely
        # because its tracker has not emitted another heartbeat yet.
        response.append({
            "trip_id": None,
            "is_active_trip": False,
            "status": provider_state.status or ("Running" if provider_state.ignition else "Parked"),
            "started_at": None,
            "driver_id": driver.id if driver else None,
            "driver_name": driver.user.full_name if driver and driver.user else None,
            "bus_id": bus.id,
            "bus_number": bus.bus_number,
            "registration_number": bus.registration_number,
            "route_id": route.id if route else None,
            "route_name": route.route_name if route else None,
            "route_code": route.route_code if route else None,
            "latitude": provider_state.latitude,
            "longitude": provider_state.longitude,
            "speed": provider_state.speed_kmh,
            "accuracy": provider_state.accuracy,
            # ``position_time`` is explicitly UTC-aware above. SQLite returns
            # datetimes without tzinfo, so returning the raw column would make
            # browsers render a UTC value as a local time.
            "last_location_update": position_time,
            "location_source": "vehicle_gps",
            "provider_gps": {
                "external_device_id": provider_state.external_device_id,
                "ignition": provider_state.ignition,
                "motion": provider_state.motion,
                "valid": provider_state.valid,
                "course": provider_state.course,
                "altitude": provider_state.altitude,
                "protocol": provider_state.protocol,
                "expected_interval_seconds": expected_interval,
                "age_seconds": age_seconds,
                "is_fresh": age_seconds <= expected_interval * 3,
            },
            "current_stop": None,
            "next_stop": None,
            "stop_status": None,
            "stop_arrived_at": None,
            "stop_departed_at": None,
        })

    return response

# ==========================================================
# GET CURRENT DRIVER TRIP
# ==========================================================

@router.get("/current")
def get_current_trip(

    current_user: User = Depends(
        require_driver
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
