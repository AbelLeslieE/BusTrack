"""
==========================================================
BUS TRACK
TRACKING ENGINE
==========================================================

Responsibilities:

1. Calculate GPS distance.
2. Validate GPS speed.
3. Calculate speed from consecutive GPS points.
4. Detect stop geofence entry.
5. Detect stop geofence exit.
6. Determine current and next route stops.
7. Keep stop progression moving forward.

IMPORTANT:

This module does NOT write to the database.

The GPS route endpoint will call these functions and
then save the resulting tracking state.
"""

from __future__ import annotations

from math import (
    atan2,
    cos,
    radians,
    sin,
    sqrt,
)

from datetime import datetime, timezone


# ==========================================================
# CONFIGURATION
# ==========================================================

# Maximum speed that BusTrack will accept as a valid
# physical bus speed.
#
# This is NOT the normal operating speed.
# It is only a protection against corrupted GPS values.
MAX_VALID_SPEED_KMH = 120.0


# Maximum calculated speed allowed from two GPS points.
#
# A GPS jump can otherwise produce something like:
#
# 35 km/h
#      ↓
# 280 km/h
#
# which is clearly invalid for a college bus.
MAX_CALCULATED_SPEED_KMH = 140.0


# Default stop radius when a stop has no valid radius.
#
# Your Stop model already normally supplies a radius,
# so this is only a safety fallback.
DEFAULT_STOP_RADIUS_METERS = 50.0


# ==========================================================
# DISTANCE CALCULATION
# ==========================================================

def calculate_distance_meters(
    latitude_1: float,
    longitude_1: float,
    latitude_2: float,
    longitude_2: float,
) -> float:
    """
    Calculate the great-circle distance between two
    latitude/longitude coordinates.

    Returns:
        Distance in meters.
    """

    earth_radius_meters = 6_371_000.0

    lat_1 = radians(
        float(latitude_1)
    )

    lat_2 = radians(
        float(latitude_2)
    )

    delta_lat = radians(
        float(latitude_2) -
        float(latitude_1)
    )

    delta_longitude = radians(
        float(longitude_2) -
        float(longitude_1)
    )

    a = (
        sin(delta_lat / 2) ** 2
        +
        cos(lat_1)
        *
        cos(lat_2)
        *
        sin(delta_longitude / 2) ** 2
    )

    c = (
        2
        *
        atan2(
            sqrt(a),
            sqrt(1 - a),
        )
    )

    return (
        earth_radius_meters *
        c
    )


# ==========================================================
# CALCULATED GPS SPEED
# ==========================================================

def calculate_speed_kmh(
    previous_latitude: float,
    previous_longitude: float,
    previous_timestamp: datetime,
    current_latitude: float,
    current_longitude: float,
    current_timestamp: datetime,
) -> float | None:
    """
    Calculate speed from two GPS positions.

    This uses the distance travelled between two consecutive
    GPS coordinates and the elapsed time between them.

    Result:
        Speed in km/h.
    """

    # ======================================================
    # VALIDATE INPUT
    # ======================================================

    if (
        previous_latitude is None
        or previous_longitude is None
        or previous_timestamp is None
        or current_latitude is None
        or current_longitude is None
        or current_timestamp is None
    ):
        return None

    # ======================================================
    # NORMALIZE TIMESTAMPS
    # ======================================================
    # SQLite may return stored DateTime values without
    # timezone information even when timezone=True is used.
    #
    # The current GPS timestamp is UTC-aware, while an older
    # database timestamp may be timezone-naive.
    #
    # Python cannot subtract:
    #
    #     aware datetime - naive datetime
    #
    # Therefore both timestamps are explicitly normalized
    # to UTC before calculating elapsed time.
    # ======================================================

    if previous_timestamp.tzinfo is None:

        previous_timestamp = (
            previous_timestamp.replace(
                tzinfo=timezone.utc
            )
        )

    else:

        previous_timestamp = (
            previous_timestamp.astimezone(
                timezone.utc
            )
        )

    if current_timestamp.tzinfo is None:

        current_timestamp = (
            current_timestamp.replace(
                tzinfo=timezone.utc
            )
        )

    else:

        current_timestamp = (
            current_timestamp.astimezone(
                timezone.utc
            )
        )

    # ======================================================
    # CALCULATE ELAPSED TIME
    # ======================================================

    elapsed_seconds = (
        current_timestamp -
        previous_timestamp
    ).total_seconds()

    # Ignore invalid or duplicate timestamps.
    if elapsed_seconds <= 0:
        return None

    # ======================================================
    # CALCULATE DISTANCE
    # ======================================================

    distance_meters = calculate_distance_meters(
        previous_latitude,
        previous_longitude,
        current_latitude,
        current_longitude,
    )

    distance_kilometers = (
        distance_meters / 1000.0
    )

    # ======================================================
    # CALCULATE SPEED
    # ======================================================

    elapsed_hours = (
        elapsed_seconds / 3600.0
    )

    if elapsed_hours <= 0:
        return None

    speed_kmh = (
        distance_kilometers /
        elapsed_hours
    )

    # ======================================================
    # REJECT IMPOSSIBLE GPS JUMPS
    # ======================================================

    if speed_kmh < 0:
        return None

    if speed_kmh > MAX_CALCULATED_SPEED_KMH:
        return None

    return speed_kmh


# ==========================================================
# SPEED VALIDATION
# ==========================================================

def validate_speed(
    reported_speed_kmh: float | None,
    calculated_speed_kmh: float | None,
) -> dict:
    """
    Validate and select the most reliable GPS speed.

    BusTrack receives speed from two possible sources:

    1. GPS/device reported speed
       navigator.geolocation.coords.speed
       converted to km/h by the GPS route.

    2. Calculated speed
       distance between consecutive GPS coordinates
       divided by elapsed time.

    The function rejects impossible values and prevents
    a single noisy GPS calculation from becoming the
    displayed bus speed.

    Returns:

        {
            "speed_kmh": float | None,
            "reported_speed_kmh": float | None,
            "calculated_speed_kmh": float | None,
            "valid": bool,
            "reason": str
        }
    """

    # ======================================================
    # NORMALIZE INPUT VALUES
    # ======================================================

    reported = None
    calculated = None

    if reported_speed_kmh is not None:

        try:
            reported = float(
                reported_speed_kmh
            )

        except (
            TypeError,
            ValueError,
        ):
            reported = None

    if calculated_speed_kmh is not None:

        try:
            calculated = float(
                calculated_speed_kmh
            )

        except (
            TypeError,
            ValueError,
        ):
            calculated = None

    # ======================================================
    # REJECT IMPOSSIBLE REPORTED SPEED
    # ======================================================

    if (
        reported is not None
        and (
            reported < 0
            or reported > MAX_VALID_SPEED_KMH
        )
    ):
        reported = None

    # ======================================================
    # REJECT IMPOSSIBLE CALCULATED SPEED
    # ======================================================

    if (
        calculated is not None
        and (
            calculated < 0
            or calculated > MAX_CALCULATED_SPEED_KMH
        )
    ):
        calculated = None

    # ======================================================
    # BOTH VALUES AVAILABLE
    # ======================================================

    if (
        reported is not None
        and calculated is not None
    ):

        difference = abs(
            reported - calculated
        )

        # --------------------------------------------------
        # STRONG AGREEMENT
        #
        # Both GPS sources are close.
        # Use their average.
        # --------------------------------------------------

        if difference <= 10.0:

            validated_speed = (
                reported +
                calculated
            ) / 2.0

            return {
                "speed_kmh":
                    round(
                        validated_speed,
                        2,
                    ),

                "reported_speed_kmh":
                    round(
                        reported,
                        2,
                    ),

                "calculated_speed_kmh":
                    round(
                        calculated,
                        2,
                    ),

                "valid":
                    True,

                "reason":
                    "Reported and calculated GPS speeds agree.",
            }

        # --------------------------------------------------
        # MODERATE DISAGREEMENT
        #
        # Prefer coordinate-derived speed because it is
        # independently calculated from movement.
        # --------------------------------------------------

        if difference <= 30.0:

            return {
                "speed_kmh":
                    round(
                        calculated,
                        2,
                    ),

                "reported_speed_kmh":
                    round(
                        reported,
                        2,
                    ),

                "calculated_speed_kmh":
                    round(
                        calculated,
                        2,
                    ),

                "valid":
                    True,

                "reason":
                    "Using coordinate-derived speed because GPS readings differ moderately.",
            }

        # --------------------------------------------------
        # LARGE DISAGREEMENT
        #
        # One of the values is probably affected by GPS
        # noise or a stale GPS reading.
        #
        # Coordinate-derived speed is preferred because
        # it is calculated from actual movement between
        # two timestamps.
        # --------------------------------------------------

        return {
            "speed_kmh":
                round(
                    calculated,
                    2,
                ),

            "reported_speed_kmh":
                round(
                    reported,
                    2,
                ),

            "calculated_speed_kmh":
                round(
                    calculated,
                    2,
                ),

            "valid":
                True,

            "reason":
                "Reported GPS speed differs significantly; using coordinate-derived speed.",
        }

    # ======================================================
    # ONLY CALCULATED SPEED AVAILABLE
    # ======================================================

    if calculated is not None:

        return {
            "speed_kmh":
                round(
                    calculated,
                    2,
                ),

            "reported_speed_kmh":
                None,

            "calculated_speed_kmh":
                round(
                    calculated,
                    2,
                ),

            "valid":
                True,

            "reason":
                "Using speed calculated from consecutive GPS positions.",
        }

    # ======================================================
    # ONLY REPORTED SPEED AVAILABLE
    # ======================================================

    if reported is not None:

        return {
            "speed_kmh":
                round(
                    reported,
                    2,
                ),

            "reported_speed_kmh":
                round(
                    reported,
                    2,
                ),

            "calculated_speed_kmh":
                None,

            "valid":
                True,

            "reason":
                "Using GPS-provided speed because coordinate-derived speed is unavailable.",
        }

    # ======================================================
    # NO VALID SPEED
    # ======================================================

    return {
        "speed_kmh":
            None,

        "reported_speed_kmh":
            None,

        "calculated_speed_kmh":
            None,

        "valid":
            False,

        "reason":
            "No valid GPS speed available.",
    }
# ==========================================================
# STOP RADIUS
# ==========================================================

def get_stop_radius_meters(
    stop,
) -> float:
    """
    Return a safe geofence radius for a stop.
    """

    try:

        radius = float(
            stop.radius
        )

    except (
        TypeError,
        ValueError,
    ):

        radius = DEFAULT_STOP_RADIUS_METERS

    if radius <= 0:

        radius = DEFAULT_STOP_RADIUS_METERS

    return radius


# ==========================================================
# STOP DISTANCE
# ==========================================================
# ==========================================================
# STOP DISTANCE
# ==========================================================

def calculate_stop_distance(
    latitude: float,
    longitude: float,
    stop,
) -> float | None:
    """
    Calculate the distance from the bus to a stop.

    The tracking engine may receive either:
        - a Stop object
        - a RouteStop object

    RouteStop stores the route sequence.
    Stop stores the actual coordinates.
    """

    # ------------------------------------------------------
    # Validate bus coordinates.
    # ------------------------------------------------------

    if (
        latitude is None
        or longitude is None
        or stop is None
    ):
        return None

    # ------------------------------------------------------
    # RouteStop -> Stop
    #
    # RouteStop does NOT contain latitude/longitude.
    # Its related Stop object does.
    # ------------------------------------------------------

    actual_stop = getattr(
        stop,
        "stop",
        None,
    )

    if actual_stop is not None:
        stop = actual_stop

    # ------------------------------------------------------
    # Validate stop coordinates.
    # ------------------------------------------------------

    stop_latitude = getattr(
        stop,
        "latitude",
        None,
    )

    stop_longitude = getattr(
        stop,
        "longitude",
        None,
    )

    if (
        stop_latitude is None
        or stop_longitude is None
    ):
        return None

    # ------------------------------------------------------
    # Calculate great-circle distance.
    # ------------------------------------------------------

    return calculate_distance_meters(
        latitude,
        longitude,
        stop_latitude,
        stop_longitude,
    )
# ==========================================================
# GEOFENCE STATE
# ==========================================================

def is_inside_stop_radius(
    distance_meters: float | None,
    stop,
) -> bool:
    """
    Determine whether the bus is currently inside
    the stop's configured geofence.
    """

    if distance_meters is None:

        return False

    radius = get_stop_radius_meters(
        stop
    )

    return (
        distance_meters <= radius
    )


# ==========================================================
# DETECT ARRIVAL / DEPARTURE
# ==========================================================

def detect_geofence_transition(
    previous_distance_meters: float | None,
    current_distance_meters: float | None,
    stop,
) -> str | None:
    """
    Detect a geofence transition.

    Returns:

        "ARRIVED"
        "DEPARTED"
        None

    A transition is only generated when the bus crosses
    the configured radius boundary.
    """

    if (
        previous_distance_meters is None
        or current_distance_meters is None
    ):

        return None

    radius = get_stop_radius_meters(
        stop
    )

    was_inside = (
        previous_distance_meters <= radius
    )

    is_inside = (
        current_distance_meters <= radius
    )

    if (
        not was_inside
        and is_inside
    ):

        return "ARRIVED"

    if (
        was_inside
        and not is_inside
    ):

        return "DEPARTED"

    return None


# ==========================================================
# ROUTE STOP PROGRESSION
# ==========================================================

def determine_route_progress(
    latitude: float,
    longitude: float,
    route_stops: list,
    previous_latitude: float | None = None,
    previous_longitude: float | None = None,
) -> dict:
    """
    Determine the current and next route stop.

    IMPORTANT:

    This is route-order based.

    The system does NOT simply choose the geographically
    nearest stop.

    It evaluates stops in their configured sequence.
    """

    if not route_stops:

        return {
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

    # ------------------------------------------------------
    # Calculate distances.
    # ------------------------------------------------------

    # ------------------------------------------------------
# Calculate distances.
#
# RouteStop:
#     sequence/order
#
# Stop:
#     latitude
#     longitude
#     radius
# ------------------------------------------------------

    distances = []

    for route_stop in route_stops:

        actual_stop = getattr(
            route_stop,
            "stop",
            None,
        )

        if actual_stop is None:

            distances.append(None)

            continue

        distance = calculate_stop_distance(
            latitude,
            longitude,
            actual_stop,
        )

        distances.append(
            distance
        )

    # ------------------------------------------------------
    # Find the first stop currently inside its radius.
    #
    # This is the active ARRIVED stop.
    # ------------------------------------------------------

    current_index = -1

    for index, route_stop in enumerate(
        route_stops
    ):

        distance = distances[index]

        actual_stop = getattr(
            route_stop,
            "stop",
            None,
        )

        if actual_stop is None:

            continue

        if is_inside_stop_radius(
            distance,
            actual_stop,
        ):

            current_index = index

            break

    # ------------------------------------------------------
    # If no stop is currently occupied, find the nearest
    # upcoming stop in route order.
    # ------------------------------------------------------

    if current_index == -1:

        current_index = 0

        if (
            previous_latitude is not None
            and previous_longitude is not None
        ):

            # Determine the closest upcoming stop,
            # but only among the ordered route stops.

            best_distance = None
            best_index = 0

            for index, distance in enumerate(
                distances
            ):

                if distance is None:

                    continue

                if (
                    best_distance is None
                    or distance <
                    best_distance
                ):

                    best_distance = distance
                    best_index = index

            current_index = best_index

    current_stop = (
        route_stops[current_index]
        if current_index >= 0
        and current_index <
        len(route_stops)
        else None
    )

    # ------------------------------------------------------
    # Next stop.
    # ------------------------------------------------------

    next_index = (
        current_index + 1
        if current_index >= 0
        and current_index <
        len(route_stops) - 1
        else -1
    )

    next_stop = (
        route_stops[next_index]
        if next_index >= 0
        else None
    )

    current_distance = (
        distances[current_index]
        if current_index >= 0
        else None
    )

    next_distance = (
        distances[next_index]
        if next_index >= 0
        else None
    )

    return {
        "current_stop":
            current_stop,

        "next_stop":
            next_stop,

        "current_index":
            current_index,

        "next_index":
            next_index,

        "current_distance_meters":
            current_distance,

        "next_distance_meters":
            next_distance,

        "current_inside_radius":
            (
                is_inside_stop_radius(
                    current_distance,
                    current_stop.stop,
                )
                if current_stop is not None
                and current_stop.stop is not None
                else False
            ),

        "next_inside_radius":
            (
                is_inside_stop_radius(
                    next_distance,
                    next_stop.stop,
                )
                if next_stop is not None
                and next_stop.stop is not None
                else False
            ),
    }