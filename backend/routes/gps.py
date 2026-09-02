"""
BusTrack
GPS Tracking API
"""

from datetime import datetime, timezone
from math import ceil

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from backend.database import get_db

from backend.routes.models_tracking import (
    LiveTrip,
    LiveLocation,
    TripStopEvent,
)

from backend.schemas_tracking import (
    TripStartRequest,
    TripStopRequest,
    TripDirectionRequest,
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
from backend.services.trip_direction import (
    direction_from_start_position,
    direction_from_terminal_position,
    original_route_stops,
    ordered_route_stops,
)
from backend.security import require_driver, require_management
from backend.audit import record_audit_event
from backend.services.vehicle_gps import (
    GPS_OFFLINE_GRACE_SECONDS,
    vehicle_gps_expected_interval_seconds,
    vehicle_gps_is_authoritative,
)
from backend.services.telemetry_retention import (
    discard_completed_trip_coordinates,
    trim_active_trip_location_history,
)
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


def build_gps_freshness(
    timestamp: datetime | None,
    *,
    ignition: bool | None = None,
    source: str | None = None,
):
    """Return a single, frontend-safe freshness description for a GPS fix."""

    if timestamp is None:
        return {
            "age_seconds": None,
            "expected_interval_seconds": None,
            "is_fresh": False,
            "label": "No GPS reading",
        }

    if timestamp.tzinfo is None:
        timestamp = timestamp.replace(tzinfo=timezone.utc)

    expected_interval = vehicle_gps_expected_interval_seconds(ignition)
    age_seconds = max(
        0,
        int((datetime.now(timezone.utc) - timestamp).total_seconds()),
    )
    is_fresh = age_seconds <= GPS_OFFLINE_GRACE_SECONDS

    return {
        "age_seconds": age_seconds,
        "expected_interval_seconds": expected_interval,
        "is_fresh": is_fresh,
        "label": "GPS fresh" if is_fresh else "GPS signal stale",
    }


def calculate_next_stop_eta_minutes(
    latitude: float | None,
    longitude: float | None,
    speed_kmh: float | None,
    next_stop: object | None,
):
    """Estimate arrival from the latest point using the reported live speed."""

    if (
        latitude is None
        or longitude is None
        or next_stop is None
        or speed_kmh is None
        or float(speed_kmh) < 3
    ):
        return None

    distance_meters = calculate_stop_distance(
        latitude,
        longitude,
        next_stop,
    )

    if distance_meters is None:
        return None

    meters_per_minute = float(speed_kmh) * 1000 / 60

    if meters_per_minute <= 0:
        return None

    return max(1, ceil(distance_meters / meters_per_minute))


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

        "route_direction": trip.route_direction,

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

    # ``route_stops`` is the direction-specific travel/display order. Keep a
    # separately reconstructed original order for all terminal decisions. A
    # return list has the start terminal at its end, but that must still set
    # FORWARD rather than being treated as a new return terminal.
    original_stops = original_route_stops(route_stops)

    def is_active_direction_terminal(route_stop: RouteStop) -> bool:
        """Whether ``route_stop`` finishes the trip's current direction.

        GPS updates normally receive a direction-ordered list, but that is a
        presentation convenience rather than durable state.  Resolving the
        terminal from the immutable route endpoints and the persisted trip
        direction prevents a replayed or legacy canonical-order update from
        reversing a parked bus a second time.
        """

        if len(original_stops) < 2 or route_stop.stop is None:
            return False

        terminal_route_stop = (
            original_stops[0]
            if trip.route_direction == "reverse"
            else original_stops[-1]
        )
        return route_stop.id == terminal_route_stop.id

    def terminal_reversal_is_pending(route_stop: RouteStop) -> bool:
        """Return true once for each terminal arrival of a live trip."""

        return (
            is_active_direction_terminal(route_stop)
            and getattr(trip, "terminal_stop_id", None) != route_stop.stop.id
        )

    def record_stop_event(event_type: str, route_stop: RouteStop, stop, distance: float | None):
        db.add(TripStopEvent(
            trip_id=trip.id,
            route_stop_id=route_stop.id,
            stop_id=stop.id,
            event_type=event_type,
            occurred_at=current_timestamp,
            stop_code_snapshot=stop.stop_code,
            stop_name_snapshot=stop.stop_name,
            route_sequence_snapshot=route_stop.sequence,
        ))

    def switch_direction_at_terminal(stop) -> tuple[str, str]:
        """Turn the same live trip around after its terminal arrival.

        The route definition remains immutable.  The terminal stays as the
        current arrived stop, but becomes index 0 in the newly ordered return
        journey until the next provider fix confirms the bus has departed.
        """

        completed_direction = trip.route_direction
        original_start = original_stops[0].stop if original_stops else None
        original_end = original_stops[-1].stop if original_stops else None

        # Direction is determined from the immutable original endpoints, not
        # by toggling the current/displayed direction. This also makes a
        # replayed terminal fix idempotent.
        if original_start is not None and stop.id == original_start.id:
            next_direction = "forward"
        elif original_end is not None and stop.id == original_end.id:
            next_direction = "reverse"
        else:
            # This is defensive only: callers invoke this helper solely for a
            # terminal in travel order. Do not invent a direction for a
            # malformed route or a non-terminal stop.
            next_direction = completed_direction

        trip.route_direction = next_direction
        trip.terminal_reached_at = current_timestamp
        trip.terminal_stop_id = stop.id
        return completed_direction, next_direction


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
    # Every new trip is seeded at a terminal by ``start_trip``.  For legacy
    # trips that predate that safeguard, begin at the first stop in the
    # already direction-ordered view.  Never select an arbitrary nearby stop:
    # each following update may advance only to the expected next stop.
    # ======================================================

    if current_route_stop is None:

        current_route_stop = route_stops[0]

        trip.current_route_stop_id = current_route_stop.id

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

    # Reconcile a terminal that was already marked as arrived before a device
    # reconnect, server restart, or delayed provider heartbeat. Direction is
    # normally switched by the arrival transition below, but a parked bus may
    # keep reporting from inside the terminal without crossing it again.
    # ``terminal_stop_id`` makes this idempotent even if a legacy caller sends
    # the route in its original order after the direction has changed.
    if (
        terminal_reversal_is_pending(current_route_stop)
        and trip.current_stop_status == "Arrived"
        and inside_radius
    ):
        # Preserve a separate, immutable audit event for the completed leg.
        # The direction is switched immediately below, so this record is the
        # reliable point-in-time marker for the direction that just finished.
        record_stop_event("Leg completed", current_route_stop, current_stop, current_distance)
        completed_direction, next_direction = switch_direction_at_terminal(
            current_stop
        )
        return {
            "event": "Terminal reached",
            "route_stop_id": current_route_stop.id,
            "stop_id": current_stop.id,
            "stop_code": current_stop.stop_code,
            "stop_name": current_stop.stop_name,
            "sequence": current_route_stop.sequence,
            "distance_meters": round(current_distance, 2),
            "radius_meters": float(current_stop.radius)
            if current_stop.radius is not None
            else 50.0,
            "terminal_reached": True,
            "completed_direction": completed_direction,
            "next_direction": next_direction,
            "trip_leg_completed": True,
        }

    # Use a wider exit boundary than the arrival geofence.  A noisy GPS fix
    # hovering around the arrival edge must not repeatedly toggle a stop
    # between Arrived and Departed.
    exit_radius = max(
        100.0,
        float(current_stop.radius) * 1.5
        if current_stop.radius is not None
        else 75.0,
    )
    outside_exit_radius = current_distance > exit_radius

    # A vehicle can legitimately take a shortcut. Inspect *every* later stop
    # on every accepted GPS update, rather than waiting for departure from the
    # current stop. This lets an update at Stop 3 correctly pass a missed Stop
    # 2 even when geofences overlap or the current radius is unusually large.
    # Only later stops are examined, so a delayed reading can never move the
    # trip backward or change its direction.
    if current_route_stop in route_stops:
        current_index = route_stops.index(current_route_stop)
        stops_ahead_inside_radius = []
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
            # Prefer the closest physical stop. The travel-order index keeps
            # ties deterministic when two geofences overlap.
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

            terminal_reached = terminal_reversal_is_pending(target_route_stop)
            completed_direction = None
            next_direction = None
            if terminal_reached:
                record_stop_event("Leg completed", target_route_stop, target_stop, target_distance)
                completed_direction, next_direction = switch_direction_at_terminal(
                    target_stop
                )

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
                "completed_direction": completed_direction,
                "next_direction": next_direction,
                "trip_leg_completed": terminal_reached,
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

        # The final stop completes the present route leg.  Keep the live trip
        # running and switch its travel view so the next provider fix advances
        # from this terminal through the same immutable route in reverse.
        terminal_reached = terminal_reversal_is_pending(current_route_stop)
        completed_direction = None
        next_direction = None
        if terminal_reached:
            record_stop_event("Leg completed", current_route_stop, current_stop, current_distance)
            completed_direction, next_direction = switch_direction_at_terminal(
                current_stop
            )


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
            "completed_direction": completed_direction,
            "next_direction": next_direction,
            "trip_leg_completed": terminal_reached,
        }


    # ======================================================
    # ARRIVED → DEPARTED
    #
    # The bus must first have been inside the radius and
    # then move outside it.
    # ======================================================

    if (
        trip.current_stop_status == "Arrived"
        and outside_exit_radius
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
# ENABLE MOBILE GPS
# ==========================================================

@router.post(
    "/start",
    response_model=LiveTripResponse,
)
def start_trip(

    start_request: TripStartRequest | None = None,

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

    # Vehicle GPS owns the live session. This endpoint is retained for
    # compatible clients, but it now only returns the GPS-created session to
    # which the driver may attach mobile location sharing.
    trip = (
        db.query(LiveTrip)
        .filter(
            LiveTrip.driver_id == driver.id,
            LiveTrip.bus_id == driver.bus_id,
            LiveTrip.status == "Running",
            LiveTrip.ended_at.is_(None),
        )
        .order_by(LiveTrip.last_location_update.desc(), LiveTrip.started_at.desc())
        .first()
    )
    if trip is None:
        raise HTTPException(
            status_code=409,
            detail="Vehicle GPS tracking has not started for this bus yet.",
        )
    return build_live_trip_response(trip, db)


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

    # Phone and installed-module positions are both accepted. Each source
    # updates the active-trip snapshot when it reports, so a driver phone can
    # fill gaps while module-only devices still advance the route normally.

    mobile_accuracy = request.accuracy

    # ======================================================
    # FIND PREVIOUS GPS LOCATION
    # ======================================================

    # Never calculate a phone speed from the prior MVD coordinate. A source
    # switchover can be minutes apart and would create a false speed spike.
    previous_location = (
        db.query(LiveLocation)
        .filter(
            LiveLocation.trip_id == trip.id,
            LiveLocation.source == "mobile",
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
            mobile_accuracy,

        recorded_at =
            current_timestamp,

        source="mobile",

    )

    db.add(location)
    db.flush()
    trim_active_trip_location_history(db, trip.id)

    # ======================================================
    # UPDATE CURRENT LIVE POSITION
    # ======================================================

    trip.current_latitude = request.latitude

    trip.current_longitude = request.longitude

    trip.current_speed = validated_speed_kmh

    trip.current_accuracy = mobile_accuracy

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
            mobile_accuracy,

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
# DISABLE MOBILE GPS
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

    return {
        "message": "Mobile location sharing stopped. Vehicle GPS tracking continues."
    }


@router.post("/direction")
def change_trip_direction(
    request: TripDirectionRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_driver),
):
    """Change the travel order of the authenticated driver's active trip.

    Route-stop sequences are shared route data and must never be rewritten for
    one bus. The trip stores its own direction, so all live clients redraw
    from the same backend state on their next refresh.
    """

    driver = db.query(Driver).filter(Driver.user_id == current_user.id).first()
    if driver is None:
        raise HTTPException(status_code=403, detail="Driver access required.")

    trip = db.query(LiveTrip).filter(
        LiveTrip.id == request.trip_id,
        LiveTrip.driver_id == driver.id,
        LiveTrip.ended_at.is_(None),
    ).first()
    if trip is None:
        raise HTTPException(status_code=404, detail="Active trip not found.")

    route_stops = db.query(RouteStop).filter(
        RouteStop.route_id == trip.route_id,
    ).order_by(RouteStop.sequence.asc()).all()
    automatic_direction = direction_from_terminal_position(
        route_stops,
        trip.current_latitude,
        trip.current_longitude,
    )
    if automatic_direction is None:
        raise HTTPException(
            status_code=409,
            detail=(
                "Route direction changes automatically only when the bus is "
                "inside an original route terminal."
            ),
        )

    # Retain the endpoint for legacy clients, but never allow it to override
    # the GPS-derived state. The requested value is intentionally ignored.
    trip.route_direction = automatic_direction
    trip.terminal_reached_at = datetime.now(timezone.utc)
    terminal = route_stops[0] if automatic_direction == "forward" else route_stops[-1]
    trip.terminal_stop_id = terminal.stop_id
    db.commit()
    db.refresh(trip)

    return {
        "trip_id": trip.id,
        "route_direction": trip.route_direction,
        "message": "Route direction was synchronized from the original terminal GPS position.",
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

    Ending a trip removes it from live tracking and releases raw coordinate
    history. Stop arrivals/departures and their timestamps remain available.
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
    discard_completed_trip_coordinates(db, trip)
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
        next_stop = None

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

        # The tracker may continue reporting independently of a driver's
        # mobile trip.  Include its current ignition/freshness data on the
        # active-trip card without replacing the trip's selected position.
        provider_state = (
            db.query(BusGPSState)
            .filter(BusGPSState.bus_id == trip.bus_id)
            .first()
        )
        provider_gps = None

        if provider_state is not None:
            provider_timestamp = (
                provider_state.fix_time
                or provider_state.received_at
            )
            provider_freshness = build_gps_freshness(
                provider_timestamp,
                ignition=provider_state.ignition,
                source="vehicle_gps",
            )
            provider_gps = {
                "external_device_id": provider_state.external_device_id,
                # Keep the provider telemetry complete for the admin map and
                # diagnostics.  The top-level values below are the active
                # trip snapshot; these are the original latest MVD values.
                "latitude": provider_state.latitude,
                "longitude": provider_state.longitude,
                "speed_kmh": provider_state.speed_kmh,
                "accuracy": provider_state.accuracy,
                "fix_time": provider_state.fix_time,
                "received_at": provider_state.received_at,
                "ignition": provider_state.ignition,
                "motion": provider_state.motion,
                "valid": provider_state.valid,
                "course": provider_state.course,
                "altitude": provider_state.altitude,
                "protocol": provider_state.protocol,
                **provider_freshness,
            }

        gps_freshness = build_gps_freshness(
            trip.last_location_update,
            ignition=(
                provider_state.ignition
                if provider_state is not None
                else None
            ),
            source=trip.current_location_source or "mobile",
        )
        next_stop_eta_minutes = calculate_next_stop_eta_minutes(
            trip.current_latitude,
            trip.current_longitude,
            trip.current_speed,
            next_stop,
        )
        terminal_reached = bool(
            trip.terminal_reached_at is not None
            and trip.current_stop_status == "Arrived"
            and current_route_stop is not None
            and current_route_stop.stop is not None
            and current_route_stop.stop.id == trip.terminal_stop_id
        )
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

            "provider_gps": provider_gps,

            "gps_freshness": gps_freshness,

            "route_direction": trip.route_direction,

            "terminal_reached": terminal_reached,

            "terminal_reached_at": (
                trip.terminal_reached_at if terminal_reached else None
            ),

            "terminal_stop_name": (
                current_route_stop.stop.stop_name if terminal_reached else None
            ),
            # ------------------------------------------------
            # ROUTE STOP PROGRESSION
            # ------------------------------------------------

            "current_stop":
                current_stop_data,

            "next_stop":
                next_stop_data,

            "next_stop_eta_minutes": next_stop_eta_minutes,

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
        provider_freshness = build_gps_freshness(
            position_time,
            ignition=provider_state.ignition,
            source="vehicle_gps",
        )
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
                "latitude": provider_state.latitude,
                "longitude": provider_state.longitude,
                "speed_kmh": provider_state.speed_kmh,
                "accuracy": provider_state.accuracy,
                "fix_time": provider_state.fix_time,
                "received_at": provider_state.received_at,
                "ignition": provider_state.ignition,
                "motion": provider_state.motion,
                "valid": provider_state.valid,
                "course": provider_state.course,
                "altitude": provider_state.altitude,
                "protocol": provider_state.protocol,
                **provider_freshness,
            },
            "gps_freshness": provider_freshness,
            "current_stop": None,
            "next_stop": None,
            "next_stop_eta_minutes": None,
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
