"""
Student API routes.

Provides authenticated student-specific transport information.

The currently authenticated user is obtained from the JWT.
The browser never supplies a student ID for these endpoints.
"""

from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.security import require_management, require_user
from backend.models import (
    Student,
    User,
    Route,
    Driver,
    RouteStop,
    Stop,
)

from backend.routes.models_tracking import (
    LiveTrip,
    LiveLocation,
    BusGPSState,
)

from backend.services.tracking_engine import (
    determine_route_progress,
)
from backend.services.trip_direction import ordered_route_stops
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

    bus = student.bus
    stop = student.stop

    # ------------------------------------------------------
    # The student's selected route is authoritative. The fallback supports
    # profiles created before route_id was added to student assignments.
    route = student.route or (
        db.query(Route).filter(Route.bus_id == bus.id).first()
        if bus else None
    )
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
    # 2. FIND ASSIGNED BUS
    # ======================================================

    bus = student.bus

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
    # 3. FIND AUTHORITATIVE ROUTE
    #
    # The student's selected route is authoritative. The fallback supports
    # older student profiles that predate student.route_id.
    # ======================================================

    route = student.route or (
        db.query(Route).filter(Route.bus_id == bus.id).first()
    )

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
        expected_interval = 20 if provider_state.ignition is True else 120
        provider_is_fresh = (
            datetime.now(timezone.utc) - received_at
        ).total_seconds() <= expected_interval * 3

    # A fresh ignition-on vehicle fix is the authoritative location, even if
    # an earlier in-app trip has not received a coordinate yet.  Without this
    # preference, students can be left with an empty map while the GPS company
    # is already supplying a valid position for their assigned bus.
    use_provider_position = provider_is_fresh and (
        trip is None
        or provider_state.ignition is True
        or trip.current_latitude is None
        or trip.current_longitude is None
    )

    tracking_available = trip is not None or provider_is_fresh
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
        (20 if provider_state.ignition is True else 120) * 3
        if tracking_source == "vehicle_gps" and provider_state is not None
        else 60
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

    if (
        tracking_available
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
