"""Choose and apply the direction of an individual live trip.

Routes are stored once in their normal morning order.  A return trip reverses
that order in memory; it never rewrites the route or its saved stop sequences.
"""

from __future__ import annotations

from backend.services.tracking_engine import calculate_stop_distance, is_inside_stop_radius


FORWARD = "forward"
REVERSE = "reverse"


def ordered_route_stops(route_stops: list, direction: str | None) -> list:
    """Return route stops in the travel order for this one trip."""

    ordered = list(route_stops)
    if direction == REVERSE:
        ordered.reverse()
    return ordered


def direction_from_terminal_position(
    route_stops: list,
    latitude: float | None,
    longitude: float | None,
) -> str | None:
    """Return the trip direction only when a trip starts at a route terminal.

    A new leg must begin in the geofence of either terminal.  Returning
    ``None`` for every other position prevents an accidental mid-route start
    from being silently treated as an outbound journey.
    """

    if len(route_stops) < 2 or latitude is None or longitude is None:
        return None

    first_stop = getattr(route_stops[0], "stop", None)
    last_stop = getattr(route_stops[-1], "stop", None)
    if first_stop is None or last_stop is None:
        return None

    first_distance = calculate_stop_distance(latitude, longitude, first_stop)
    last_distance = calculate_stop_distance(latitude, longitude, last_stop)

    first_inside = (
        first_distance is not None
        and is_inside_stop_radius(first_distance, first_stop)
    )
    last_inside = (
        last_distance is not None
        and is_inside_stop_radius(last_distance, last_stop)
    )

    if first_inside and (not last_inside or first_distance <= last_distance):
        return FORWARD
    if last_inside:
        return REVERSE
    return None


def direction_from_start_position(route_stops: list, latitude: float | None, longitude: float | None) -> str:
    """Use an endpoint start location to identify a return journey safely.

    A trip is reversed only when it starts within a practical endpoint radius
    of the saved final stop.  Starting elsewhere retains the normal route.
    """

    return direction_from_terminal_position(
        route_stops,
        latitude,
        longitude,
    ) or FORWARD
