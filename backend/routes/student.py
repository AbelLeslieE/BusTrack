"""
Student API routes.

Provides authenticated student-specific transport information.

The currently authenticated user is obtained from the JWT.
The browser never supplies a student ID for these endpoints.
"""

from datetime import date, datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.security import require_management, require_user
from backend.models import (
    Student,
    User,
    Bus,
    Route,
    Driver,
    RouteStop,
    Stop,
    BusPass,
)

from backend.routes.models_tracking import (
    LiveTrip,
    LiveLocation,
    BusGPSState,
)

from backend.services.tracking_engine import (
    calculate_stop_distance,
    determine_route_progress,
)
from backend.services.trip_direction import ordered_route_stops
from backend.services.vehicle_gps import GPS_OFFLINE_GRACE_SECONDS
from backend.schemas import StudentAssignmentUpdate


router = APIRouter(
    prefix="/api/students",
    tags=["Students"],
)


def _student_directory_item(student: Student, db: Session) -> dict:
    """Build the admin-facing student assignment record."""
    route = student.route or (
        db.query(Route).filter(Route.bus_id == student.bus_id).first()
        if student.bus_id else None
    )
    bus = student.bus
    stop = student.stop
    return {
        "id": student.id,
        "user_id": student.user_id,
        "student_code": student.student_code,
        "full_name": student.user.full_name if student.user else "Unknown student",
        "username": student.user.username if student.user else None,
        "email": student.user.email if student.user else None,
        "phone": student.user.phone if student.user else None,
        "status": student.user.status if student.user else "Inactive",
        "route": (
            {
                "id": route.id,
                "route_code": route.route_code,
                "route_name": route.route_name,
                "status": route.status,
            }
            if route else None
        ),
        "bus": (
            {"id": bus.id, "bus_number": bus.bus_number, "status": bus.status}
            if bus else None
        ),
        "stop": (
            {"id": stop.id, "stop_code": stop.stop_code, "stop_name": stop.stop_name}
            if stop else None
        ),
    }


@router.get("/directory")
def get_student_directory(
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_management),
):
    """Return every student and their current route, bus, and stop."""
    students = db.query(Student).order_by(Student.student_code).all()
    return [_student_directory_item(student, db) for student in students]


@router.put("/{student_id:int}/assignment")
def update_student_assignment(
    student_id: int,
    assignment: StudentAssignmentUpdate,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_management),
):
    """Assign a student's route and boarding stop from the Students workspace."""
    student = db.get(Student, student_id)
    if student is None:
        raise HTTPException(status_code=404, detail="Student not found.")

    route = db.get(Route, assignment.route_id) if assignment.route_id else None
    if assignment.route_id and route is None:
        raise HTTPException(status_code=400, detail="Selected route was not found.")
    if route and route.bus_id is None:
        raise HTTPException(
            status_code=400,
            detail="Assign a bus to this route before assigning students to it.",
        )

    if assignment.stop_id is not None:
        if route is None:
            raise HTTPException(status_code=400, detail="Choose a route before selecting a boarding stop.")
        valid_stop = db.query(RouteStop).filter(
            RouteStop.route_id == route.id,
            RouteStop.stop_id == assignment.stop_id,
        ).first()
        if valid_stop is None:
            raise HTTPException(
                status_code=400,
                detail="The selected boarding stop does not belong to the selected route.",
            )

    student.route_id = route.id if route else None
    student.bus_id = route.bus_id if route else None
    student.stop_id = assignment.stop_id if route else None
    db.commit()
    db.refresh(student)
    return _student_directory_item(student, db)


# ==========================================================
# CURRENT STUDENT
# ==========================================================

@router.get("/me")
def get_current_student(
    current_user: Annotated[
        User,
        Depends(require_user),
    ],
    db: Session = Depends(get_db),
):
    """
    Return the student profile belonging to the
    currently authenticated user.

    The student is identified through the JWT user account.
    """

    # ------------------------------------------------------
    # Find the student transport profile belonging to this User account.
    # ------------------------------------------------------

    student = (
        db.query(Student)
        .filter(
            Student.user_id == current_user.id
        )
        .first()
    )

    if student is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Student profile not found.",
        )

    # ------------------------------------------------------
    # Build a frontend-safe response.
    # ------------------------------------------------------

    # ------------------------------------------------------
    # The student's selected route is authoritative. The fallback supports
    # profiles created before route_id was added to student assignments.
    route = student.route or (
        db.query(Route).filter(Route.bus_id == student.bus_id).first()
        if student.bus_id else None
    )
    # Route assignments are authoritative.  Resolve the bus through the route
    # so a student cannot be left viewing an older bus_id mirror after an
    # administrator changes the route assignment.
    bus = db.get(Bus, route.bus_id) if route is not None and route.bus_id else (
        student.bus if route is None else None
    )
    stop = student.stop
    driver = db.get(Driver, route.driver_id) if route and route.driver_id else None

    return {
        "id": student.id,
        "student_code": student.student_code,

        "user": {
            "id": current_user.id,
            "username": current_user.username,
            "full_name": current_user.full_name,
            "email": current_user.email,
            "phone": current_user.phone,
        },

        "assigned_bus": (
            {
                "id": bus.id,
                "bus_number": bus.bus_number,
                "registration_number": bus.registration_number,
                "capacity": bus.capacity,
                "manufacturer": bus.manufacturer,
                "model": bus.model,
                "year": bus.year,
                "fuel_type": bus.fuel_type,
                "status": bus.status,

                # --------------------------------------------------
                # Return the assigned route as a frontend-safe
                # JSON object instead of the SQLAlchemy object.
                # --------------------------------------------------
                "route": (
                    {
                        "id": route.id,
                        "route_code": route.route_code,
                        "route_name": route.route_name,
                        "status": route.status,
                    }
                    if route
                    else None
                ),

                "driver_name": (
                    driver.user.full_name
                    if driver and driver.user
                    else None
                ),

                "device_id": bus.device_id,
            }
            if bus
            else None
        ),

        "assigned_stop": (
            {
                "id": stop.id,
                "stop_code": stop.stop_code,
                "stop_name": stop.stop_name,
                "latitude": stop.latitude,
                "longitude": stop.longitude,
                "radius": stop.radius,
                "status": stop.status,
            }
            if stop
            else None
        ),
    }


# ==========================================================
# CURRENT STUDENT BUS PASS
# ==========================================================

def _effective_pass_status(bus_pass: BusPass) -> str:
    """Return the status a student should see without mutating pass history."""

    stored_status = (bus_pass.status or "Pending").strip().title()
    today = date.today()
    if stored_status == "Active" and bus_pass.valid_until and bus_pass.valid_until < today:
        return "Expired"
    if stored_status == "Active" and bus_pass.valid_from and bus_pass.valid_from > today:
        return "Pending"
    return stored_status


@router.get("/me/bus-pass")
def get_current_student_bus_pass(
    current_user: Annotated[User, Depends(require_user)],
    db: Session = Depends(get_db),
):
    """Return only the authenticated student's pass and authoritative assignment."""

    student = db.query(Student).filter(Student.user_id == current_user.id).first()
    if student is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Student profile not found.",
        )

    # This is the same resolution path used by /me and /me/tracking.  A pass
    # never stores a competing bus or route assignment.
    route = student.route or (
        db.query(Route).filter(Route.bus_id == student.bus_id).first()
        if student.bus_id else None
    )
    bus = db.get(Bus, route.bus_id) if route and route.bus_id else (
        student.bus if route is None else None
    )
    stop = student.stop
    bus_pass = db.query(BusPass).filter(BusPass.student_id == student.id).first()

    effective_status = _effective_pass_status(bus_pass) if bus_pass else None
    days_until_expiry = (
        (bus_pass.valid_until - date.today()).days
        if bus_pass and bus_pass.valid_until else None
    )
    alerts = []
    if (
        effective_status == "Active"
        and days_until_expiry is not None
        and 0 <= days_until_expiry <= 30
    ):
        alerts.append({
            "type": "bus_pass_expiring",
            "title": "Bus pass expires soon",
            "message": f"Your bus pass expires in {days_until_expiry} day{'s' if days_until_expiry != 1 else ''}. Please contact the transport office to renew it.",
            "days_until_expiry": days_until_expiry,
        })
    return {
        "student": {
            "id": student.id,
            "name": current_user.full_name,
            "student_code": student.student_code,
        },
        "bus_pass": (
            {
                "id": bus_pass.id,
                "pass_number": bus_pass.pass_number,
                "status": bus_pass.status,
                "effective_status": effective_status,
                "is_valid": effective_status == "Active",
                "valid_from": bus_pass.valid_from,
                "valid_until": bus_pass.valid_until,
                "validity_period": bus_pass.validity_period,
                "academic_year": bus_pass.academic_year,
                "issued_at": bus_pass.issued_at,
                "days_until_expiry": days_until_expiry,
            }
            if bus_pass else None
        ),
        "alerts": alerts,
        "transport": {
            "bus": (
                {
                    "id": bus.id,
                    "bus_number": bus.bus_number,
                    "registration_number": bus.registration_number,
                }
                if bus else None
            ),
            "route": (
                {
                    "id": route.id,
                    "route_code": route.route_code,
                    "route_name": route.route_name,
                }
                if route else None
            ),
            "boarding_stop": (
                {
                    "id": stop.id,
                    "stop_code": stop.stop_code,
                    "stop_name": stop.stop_name,
                }
                if stop else None
            ),
        },
    }
# ==========================================================
# CURRENT STUDENT LIVE TRACKING
# ==========================================================

# ==========================================================
# CURRENT STUDENT LIVE TRACKING
# ==========================================================

@router.get("/me/tracking")
def get_student_live_tracking(
    current_user: Annotated[
        User,
        Depends(require_user),
    ],
    db: Session = Depends(get_db),
    response: Response = None,
):
    """
    Return authoritative live tracking information for the
    bus assigned to the currently authenticated student.

    The browser never supplies:
        - student ID
        - bus ID
        - route ID

    The server determines:

        JWT user
            ↓
        Student
            ↓
        Assigned Bus
            ↓
        Active LiveTrip
            ↓
        Assigned Route
            ↓
        Ordered Route Stops
            ↓
        Current / Next Stop
    """

    # This endpoint is intentionally polled by the student portal. Never let
    # a browser or intermediary reuse an old GPS response.
    if response is not None:
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        response.headers["Pragma"] = "no-cache"

    # ======================================================
    # 1. FIND STUDENT
    # ======================================================

    student = (
        db.query(Student)
        .filter(
            Student.user_id == current_user.id
        )
        .first()
    )

    if student is None:

        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Student profile not found.",
        )

    # ======================================================
    # 2. FIND AUTHORITATIVE ROUTE AND ASSIGNED BUS
    # ======================================================

    route = student.route or (
        db.query(Route).filter(Route.bus_id == student.bus_id).first()
        if student.bus_id else None
    )
    # Route changes in the Admin portal take effect in the Student portal on
    # the next tracking read, even if a legacy Student.bus_id mirror is stale.
    bus = db.get(Bus, route.bus_id) if route is not None and route.bus_id else (
        student.bus if route is None else None
    )

    if bus is None:

        return {
            "tracking_available": False,

            "reason":
                "No bus assigned.",

            "student": {
                "id":
                    student.id,

                "student_code":
                    student.student_code,
            },

            "bus":
                None,

            "route":
                None,

            "assigned_stop":
                None,

            "trip":
                None,

            "stops":
                [],
        }

    # ======================================================
    # 3. VALIDATE THE AUTHORITATIVE ROUTE
    # ======================================================

    if route is None:

        return {
            "tracking_available": False,

            "reason":
                "No route assigned to this bus.",

            "student": {
                "id":
                    student.id,

                "student_code":
                    student.student_code,
            },

            "bus": {
                "id":
                    bus.id,

                "bus_number":
                    bus.bus_number,

                "registration_number":
                    bus.registration_number,

                "status":
                    bus.status,

                "device_id":
                    bus.device_id,
            },

            "route":
                None,

            "assigned_stop": (
                {
                    "id":
                        student.stop.id,

                    "stop_code":
                        student.stop.stop_code,

                    "stop_name":
                        student.stop.stop_name,

                    "latitude":
                        student.stop.latitude,

                    "longitude":
                        student.stop.longitude,

                    "radius":
                        student.stop.radius,
                }
                if student.stop
                else None
            ),

            "trip":
                None,

            "stops":
                [],
        }

    # ======================================================
    # 4. FIND CURRENT ACTIVE LIVE TRIP
    # ======================================================

    trip = (
        db.query(LiveTrip)
        .filter(
            LiveTrip.bus_id == bus.id,

            LiveTrip.route_id == route.id,

            # Only the currently running trip is eligible.
            LiveTrip.status == "Running",

            # A completed trip must never be returned.
            LiveTrip.ended_at.is_(None),
        )
        .order_by(
            # Prefer the trip that has received the newest GPS.
            LiveTrip.last_location_update.desc(),

            # If no GPS has been received yet, fall back
            # to the newest trip start time.
            LiveTrip.started_at.desc(),
        )
        .first()
    )

    # A provider position is also a valid live bus position when the driver
    # has not yet started an in-app trip. This leaves the existing mobile-trip
    # lifecycle untouched while allowing students to see the vehicle GPS.
    provider_state = (
        db.query(BusGPSState)
        .filter(BusGPSState.bus_id == bus.id)
        .first()
    )
    provider_is_fresh = False
    if provider_state is not None:
        received_at = provider_state.fix_time or provider_state.received_at
        if received_at.tzinfo is None:
            received_at = received_at.replace(tzinfo=timezone.utc)
        provider_is_fresh = (
            datetime.now(timezone.utc) - received_at
        ).total_seconds() <= GPS_OFFLINE_GRACE_SECONDS

    provider_has_position = (
        provider_state is not None
        and provider_state.latitude is not None
        and provider_state.longitude is not None
    )

    # Select the newest accepted state across vehicle and mobile telemetry.
    # Freshness alone is insufficient: an older-but-fresh provider heartbeat
    # must not move the map backwards after a later trip update has already
    # advanced the stop timeline.
    provider_timestamp = (
        (provider_state.fix_time or provider_state.received_at)
        if provider_state is not None
        else None
    )
    trip_timestamp = trip.last_location_update if trip is not None else None
    if provider_timestamp is not None and provider_timestamp.tzinfo is None:
        provider_timestamp = provider_timestamp.replace(tzinfo=timezone.utc)
    if trip_timestamp is not None and trip_timestamp.tzinfo is None:
        trip_timestamp = trip_timestamp.replace(tzinfo=timezone.utc)
    use_provider_position = provider_has_position and (
        trip is None
        or trip.current_latitude is None
        or trip.current_longitude is None
        or (
            provider_timestamp is not None
            and (trip_timestamp is None or provider_timestamp >= trip_timestamp)
        )
    )

    # Keep a stale module fix visible as the last-known bus location; the
    # telemetry explicitly labels it stale after the three-minute grace period.
    tracking_available = trip is not None or provider_has_position
    tracking_latitude = (
        provider_state.latitude if use_provider_position
        else trip.current_latitude if trip is not None else None
    )
    tracking_longitude = (
        provider_state.longitude if use_provider_position
        else trip.current_longitude if trip is not None else None
    )
    tracking_source = (
        "vehicle_gps" if use_provider_position
        else trip.current_location_source or "mobile" if trip is not None else None
    )

    # Translate provider telemetry into a small student-safe status summary.
    # Raw vendor diagnostics (device identity, IP, protocol, odometer, power,
    # and the original payload) remain private to management/technicians.
    location_timestamp = (
        (provider_state.fix_time or provider_state.received_at) if use_provider_position
        else trip.last_location_update if trip is not None else None
    )
    location_age_seconds = None
    if location_timestamp is not None:
        timestamp = (
            location_timestamp.replace(tzinfo=timezone.utc)
            if location_timestamp.tzinfo is None
            else location_timestamp
        )
        location_age_seconds = max(0, int((datetime.now(timezone.utc) - timestamp).total_seconds()))
    active_speed = (
        provider_state.speed_kmh if use_provider_position
        else trip.current_speed if trip is not None else None
    )
    is_moving = (
        provider_state.motion
        if tracking_source == "vehicle_gps" and provider_state is not None and provider_state.motion is not None
        else bool(active_speed is not None and active_speed > 1)
    )
    freshness_limit_seconds = (
        GPS_OFFLINE_GRACE_SECONDS
        if tracking_source == "vehicle_gps" and provider_state is not None
        else GPS_OFFLINE_GRACE_SECONDS
    )
    location_is_fresh = (
        location_age_seconds is not None
        and location_age_seconds <= freshness_limit_seconds
    )
    telemetry = {
        "source": tracking_source,
        "source_label": "Vehicle GPS" if tracking_source == "vehicle_gps" else "Driver mobile" if tracking_source == "mobile" else "Unavailable",
        "is_fresh": location_is_fresh,
        "last_seen_seconds": location_age_seconds,
        "moving": is_moving if tracking_available else None,
        "ignition_on": provider_state.ignition if tracking_source == "vehicle_gps" and provider_state is not None else None,
    }
    # ======================================================
    # 5. LOAD ORDERED ROUTE STOPS
    # ======================================================

    route_stops = (
        db.query(RouteStop)
        .filter(
            RouteStop.route_id ==
                route.id
        )
        .order_by(
            RouteStop.sequence.asc()
        )
        .all()
    )
    route_stops = ordered_route_stops(
        route_stops,
        trip.route_direction if trip is not None else "forward",
    )
    display_sequences = {
        route_stop.id: index
        for index, route_stop in enumerate(route_stops, start=1)
    }

    # ======================================================
    # 6. BUILD FRONTEND-SAFE STOP LIST
    # ======================================================

    stops = []

    for route_stop in route_stops:

        stop = route_stop.stop

        if stop is None:

            continue

        stops.append({

            "id":
                stop.id,

            "stop_code":
                stop.stop_code,

            "stop_name":
                stop.stop_name,

            "latitude":
                stop.latitude,

            "longitude":
                stop.longitude,

            "radius":
                stop.radius,

            "sequence":
                display_sequences[route_stop.id],

            "scheduled_time":
                route_stop.scheduled_time,

            "estimated_minutes":
                route_stop.estimated_minutes,

        })

    # ======================================================
    # 7. DETERMINE CURRENT / NEXT STOP
    #
    # IMPORTANT:
    #
    # This uses the backend tracking engine rather than
    # allowing the browser to decide which stop is current.
    # ======================================================

    route_progress = {

        "current_stop":
            None,

        "next_stop":
            None,

        "current_index":
            -1,

        "next_index":
            -1,

        "current_distance_meters":
            None,

        "next_distance_meters":
            None,

        "current_inside_radius":
            False,

        "next_inside_radius":
            False,

    }

    # The trip's geofence state is written by every accepted mobile and
    # vehicle-GPS update.  Prefer it so the map and the railway-style view
    # cannot disagree about which stop the bus is serving.
    if trip is not None and trip.current_route_stop_id is not None:

        current_index = next(
            (
                index
                for index, route_stop in enumerate(route_stops)
                if route_stop.id == trip.current_route_stop_id
            ),
            -1,
        )

        if current_index >= 0:
            current_route_stop = route_stops[current_index]
            next_index = (
                current_index + 1
                if current_index + 1 < len(route_stops)
                else -1
            )
            next_route_stop = (
                route_stops[next_index]
                if next_index >= 0
                else None
            )
            current_distance = calculate_stop_distance(
                tracking_latitude,
                tracking_longitude,
                current_route_stop.stop,
            )
            next_distance = calculate_stop_distance(
                tracking_latitude,
                tracking_longitude,
                next_route_stop.stop if next_route_stop is not None else None,
            )

            route_progress = {
                "current_stop": current_route_stop,
                "next_stop": next_route_stop,
                "current_index": current_index,
                "next_index": next_index,
                "current_distance_meters": current_distance,
                "next_distance_meters": next_distance,
                "current_inside_radius": trip.current_stop_status == "Arrived",
                "next_inside_radius": False,
            }

    # Older trips and provider-only tracking have no persisted stop state, so
    # retain the safe server-side calculated fallback until their next update.
    if (
        route_progress["current_stop"] is None
        and
        tracking_available
        and location_is_fresh
        and
        tracking_latitude is not None
        and
        tracking_longitude is not None
        and
        route_stops
    ):

        # --------------------------------------------------
        # Previous GPS point.
        #
        # Used by the tracking engine when determining
        # route progression.
        # --------------------------------------------------

        previous_location = (
            db.query(LiveLocation)
            .filter(
                LiveLocation.trip_id ==
                    trip.id
            )
            .order_by(
                LiveLocation.recorded_at.desc()
            )
            .offset(1)
            .first()
            if trip is not None
            else None
        )

        route_progress =determine_route_progress(

                latitude =
                    tracking_latitude,

                longitude =
                    tracking_longitude,

                route_stops =
                    route_stops,

                previous_latitude = (
                    previous_location.latitude
                    if previous_location
                    else None
                ),

                previous_longitude = (
                    previous_location.longitude
                    if previous_location
                    else None
                ),

            )

    # ======================================================
    # 8. SERIALIZE CURRENT STOP
    # ======================================================

    current_stop =route_progress.get(
            "current_stop"
        )

    next_stop =route_progress.get(
            "next_stop"
        )

    # Build a server-authoritative visual state for every displayed stop. The
    # frontend must not guess whether a bus is at a stop or travelling between
    # two stops from array indexes alone. After leaving Stop 2, for example,
    # Stop 2 is completed and Stop 3 is explicitly approaching until its
    # geofence is entered. The same ordered list is used for forward and
    # return directions.
    terminal_reached = bool(
        trip is not None
        and trip.terminal_reached_at is not None
        and trip.current_stop_status == "Arrived"
        and current_stop is not None
        and current_stop.stop is not None
        and current_stop.stop.id == trip.terminal_stop_id
    )
    current_index = route_progress["current_index"]
    for stop_data in stops:
        display_index = int(stop_data["sequence"]) - 1
        if current_index < 0:
            stop_data["tracking_status"] = "pending"
        elif display_index < current_index:
            stop_data["tracking_status"] = "completed"
        elif display_index == current_index:
            if terminal_reached:
                stop_data["tracking_status"] = "terminal_completed"
            elif trip is not None and trip.current_stop_status == "Arrived":
                stop_data["tracking_status"] = "reached"
            elif route_progress["current_inside_radius"]:
                stop_data["tracking_status"] = "reached"
            else:
                stop_data["tracking_status"] = "approaching"
        else:
            stop_data["tracking_status"] = "pending"

    current_stop_data = None

    if current_stop is not None:

        current_stop_data = {

            "id":
                current_stop.stop.id,

            "stop_code":
                current_stop.stop.stop_code,

            "stop_name":
                current_stop.stop.stop_name,

            "latitude":
                current_stop.stop.latitude,

            "longitude":
                current_stop.stop.longitude,

            "radius":
                current_stop.stop.radius,

            "sequence":
                display_sequences[current_stop.id],

            "distance_meters":
                (
                    round(
                        route_progress[
                            "current_distance_meters"
                        ],
                        2,
                    )
                    if
                    route_progress[
                        "current_distance_meters"
                    ]
                    is not None
                    else None
                ),

            "inside_radius":
                route_progress[
                    "current_inside_radius"
                ],

        }

    # ======================================================
    # 9. SERIALIZE NEXT STOP
    # ======================================================

    next_stop_data = None

    if next_stop is not None:

        next_stop_data = {

            "id":
                next_stop.stop.id,

            "stop_code":
                next_stop.stop.stop_code,

            "stop_name":
                next_stop.stop.stop_name,

            "latitude":
                next_stop.stop.latitude,

            "longitude":
                next_stop.stop.longitude,

            "radius":
                next_stop.stop.radius,

            "sequence":
                display_sequences[next_stop.id],

            "distance_meters":
                (
                    round(
                        route_progress[
                            "next_distance_meters"
                        ],
                        2,
                    )
                    if
                    route_progress[
                        "next_distance_meters"
                    ]
                    is not None
                    else None
                ),

            "inside_radius":
                route_progress[
                    "next_inside_radius"
                ],

        }

    # ======================================================
    # 10. BUILD LIVE TRIP DATA
    # ======================================================

    trip_data = None

    if tracking_available:

        trip_data = {

            "id":
                trip.id if trip is not None else None,

            "status":
                trip.status if trip is not None else (provider_state.status or "Parked"),

            "latitude":
                tracking_latitude,

            "longitude":
                tracking_longitude,

            "speed":
                provider_state.speed_kmh if use_provider_position else trip.current_speed if trip is not None else None,

            "accuracy":
                provider_state.accuracy if use_provider_position else trip.current_accuracy if trip is not None else None,

            "last_location_update":
                (provider_state.fix_time or provider_state.received_at) if use_provider_position else trip.last_location_update if trip is not None else None,

            "started_at":
                trip.started_at if trip is not None else (provider_state.fix_time or provider_state.received_at),

            "location_source":
                tracking_source,

            "route_direction":
                trip.route_direction if trip is not None else "forward",

            "stop_status":
                trip.current_stop_status if trip is not None else None,

            "current_route_stop_id":
                trip.current_route_stop_id if trip is not None else None,

            "terminal_reached": terminal_reached,

            "terminal_reached_at": trip.terminal_reached_at if terminal_reached else None,

            "terminal_stop_name": current_stop.stop.stop_name if terminal_reached else None,

            "ignition":
                provider_state.ignition if provider_state is not None else None,

            "telemetry": telemetry,

            "current_stop":
                current_stop_data,

            "next_stop":
                next_stop_data,

            "current_stop_distance_meters":
                (
                    round(
                        route_progress[
                            "current_distance_meters"
                        ],
                        2,
                    )
                    if
                    route_progress[
                        "current_distance_meters"
                    ]
                    is not None
                    else None
                ),

            "next_stop_distance_meters":
                (
                    round(
                        route_progress[
                            "next_distance_meters"
                        ],
                        2,
                    )
                    if
                    route_progress[
                        "next_distance_meters"
                    ]
                    is not None
                    else None
                ),

            "current_stop_inside_radius":
                route_progress[
                    "current_inside_radius"
                ],

            "next_stop_inside_radius":
                route_progress[
                    "next_inside_radius"
                ],

        }

    # ======================================================
    # 11. FINAL RESPONSE
    # ======================================================

    return {

        "tracking_available":
            tracking_available,

        "reason":
            (
                None
                if tracking_available
                else
                "The assigned bus is not currently live."
            ),

        "student": {

            "id":
                student.id,

            "student_code":
                student.student_code,

        },

        "bus": {

            "id":
                bus.id,

            "bus_number":
                bus.bus_number,

            "registration_number":
                bus.registration_number,

            "status":
                bus.status,

            "device_id":
                bus.device_id,

        },

        "route": {

            "id":
                route.id,

            "route_code":
                route.route_code,

            "route_name":
                route.route_name,

            "status":
                route.status,

            "total_stops":
                route.total_stops,

        },

        "assigned_stop": (

            {
                "id":
                    student.stop.id,

                "stop_code":
                    student.stop.stop_code,

                "stop_name":
                    student.stop.stop_name,

                "latitude":
                    student.stop.latitude,

                "longitude":
                    student.stop.longitude,

                "radius":
                    student.stop.radius,

            }

            if student.stop

            else None

        ),

        "trip":
            trip_data,

        # This is intentionally a derived, student-safe view of the provider
        # data rather than a copy of the vendor payload.
        "telemetry": telemetry,

        "stops":
            stops,

    }
