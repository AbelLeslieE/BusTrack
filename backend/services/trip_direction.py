"""Choose and apply the direction of an individual live trip.

Routes are stored once in their normal morning order.  A return trip reverses
that order in memory; it never rewrites the route or its saved stop sequences.
"""

from __future__ import annotations

from backend.services.tracking_engine import calculate_stop_distance


FORWARD = "forward"
REVERSE = "reverse"


def ordered_route_stops(route_stops: list, direction: str | None) -> list:
    """Return route stops in the travel order for this one trip."""

    ordered = list(route_stops)
    if direction == REVERSE:
        ordered.reverse()
    return ordered


def direction_from_start_position(route_stops: list, latitude: float | None, longitude: float | None) -> str:
    """Use an endpoint start location to identify a return journey safely.

    A trip is reversed only when it starts within a practical endpoint radius
    of the saved final stop.  Starting elsewhere retains the normal route.
    """

    if len(route_stops) < 2 or latitude is None or longitude is None:
        return FORWARD

    first_stop = getattr(route_stops[0], "stop", None)
    last_stop = getattr(route_stops[-1], "stop", None)
    if first_stop is None or last_stop is None:
        return FORWARD

    last_distance = calculate_stop_distance(latitude, longitude, last_stop)
    first_distance = calculate_stop_distance(latitude, longitude, first_stop)
    last_radius = max(250.0, float(last_stop.radius or 0) * 2)

    if last_distance <= last_radius and last_distance < first_distance:
        return REVERSE
    return FORWARD
