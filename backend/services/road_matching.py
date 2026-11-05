"""Best-effort road matching for completed Route Studio recordings.

Raw phone fixes remain stored in ``route_studio_points``.  This module only
builds the display/route geometry, so a routing-provider outage can never
destroy or prevent access to the original evidence.
"""
from __future__ import annotations

import json
import logging
import math
import os
from urllib.parse import urlencode
from urllib.request import Request, urlopen


logger = logging.getLogger(__name__)
_EARTH_RADIUS_METRES = 6_371_000.0


def _enabled() -> bool:
    return os.getenv("ROUTE_STUDIO_ROAD_MATCHING_ENABLED", "false").casefold() in {
        "true", "1", "yes"
    }


def _distance(a: dict, b: dict) -> float:
    lat1, lat2 = math.radians(a["latitude"]), math.radians(b["latitude"])
    dlat = lat2 - lat1
    dlon = math.radians(b["longitude"] - a["longitude"])
    value = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return _EARTH_RADIUS_METRES * 2 * math.atan2(math.sqrt(value), math.sqrt(max(0.0, 1 - value)))


def _clean(raw: list[dict]) -> list[dict]:
    """Remove unusable fixes and impossible jumps without altering stored raw data."""
    result: list[dict] = []
    for point in raw:
        try:
            latitude = float(point["latitude"])
            longitude = float(point["longitude"])
            accuracy = float(point.get("accuracy", 0))
        except (KeyError, TypeError, ValueError):
            continue
        if not all(math.isfinite(value) for value in (latitude, longitude, accuracy)):
            continue
        if not (-90 <= latitude <= 90 and -180 <= longitude <= 180) or accuracy > 150:
            continue
        candidate = {**point, "latitude": latitude, "longitude": longitude, "accuracy": accuracy}
        if result and _distance(result[-1], candidate) < 1:
            continue
        result.append(candidate)
    return result


def _point_segment_distance(point: dict, start: dict, end: dict) -> float:
    """Approximate perpendicular distance in metres for path simplification."""
    reference_latitude = math.radians((start["latitude"] + end["latitude"]) / 2)
    scale_x = 111_320 * max(0.01, math.cos(reference_latitude))
    scale_y = 110_540
    px = (point["longitude"] - start["longitude"]) * scale_x
    py = (point["latitude"] - start["latitude"]) * scale_y
    ex = (end["longitude"] - start["longitude"]) * scale_x
    ey = (end["latitude"] - start["latitude"]) * scale_y
    length_squared = ex * ex + ey * ey
    if length_squared == 0:
        return math.hypot(px, py)
    fraction = max(0.0, min(1.0, (px * ex + py * ey) / length_squared))
    return math.hypot(px - fraction * ex, py - fraction * ey)


def _simplify(points: list[dict], tolerance: float) -> list[dict]:
    if len(points) <= 2:
        return points
    maximum, index = 0.0, 0
    for candidate_index in range(1, len(points) - 1):
        distance = _point_segment_distance(points[candidate_index], points[0], points[-1])
        if distance > maximum:
            maximum, index = distance, candidate_index
    if maximum <= tolerance:
        return [points[0], points[-1]]
    left = _simplify(points[: index + 1], tolerance)
    right = _simplify(points[index:], tolerance)
    return left[:-1] + right


def _routing_points(points: list[dict], maximum: int = 90) -> list[dict]:
    for tolerance in (5, 8, 12, 20, 35, 50, 80):
        simplified = _simplify(points, tolerance)
        if len(simplified) <= maximum:
            return simplified
    # Keep both ends if an exceptionally complex trace still exceeds the URL-safe limit.
    step = (len(simplified) - 1) / (maximum - 1)
    return [simplified[round(index * step)] for index in range(maximum)]


def _request(service: str, points: list[dict]) -> list[list[float]]:
    base = os.getenv("ROUTE_STUDIO_ROUTER_URL", "https://router.project-osrm.org").rstrip("/")
    coordinates = ";".join(f'{point["longitude"]:.7f},{point["latitude"]:.7f}' for point in points)
    if service == "match":
        query = urlencode({
            "overview": "full",
            "geometries": "geojson",
            "steps": "false",
            "tidy": "true",
            "gaps": "ignore",
            "radiuses": ";".join(str(max(5, min(50, round(point["accuracy"])))) for point in points),
        })
        url = f"{base}/match/v1/driving/{coordinates}?{query}"
    else:
        query = urlencode({"overview": "full", "geometries": "geojson", "steps": "false"})
        url = f"{base}/route/v1/driving/{coordinates}?{query}"
    timeout = max(2.0, min(20.0, float(os.getenv("ROUTE_STUDIO_ROUTER_TIMEOUT_SECONDS", "12"))))
    request = Request(url, headers={"Accept": "application/json", "User-Agent": "BusTrack-RouteStudio/1.0"})
    with urlopen(request, timeout=timeout) as response:  # noqa: S310 - host is deployment-configured
        data = json.load(response)
    if data.get("code") != "Ok":
        raise ValueError(f'Road service returned {data.get("code", "an invalid response")}.')
    geometries = data.get("matchings") if service == "match" else data.get("routes")
    output: list[list[float]] = []
    for item in geometries or []:
        geometry = item.get("geometry", {}).get("coordinates", [])
        for coordinate in geometry:
            if not (isinstance(coordinate, list) and len(coordinate) >= 2):
                continue
            longitude, latitude = float(coordinate[0]), float(coordinate[1])
            if not (math.isfinite(longitude) and math.isfinite(latitude)):
                continue
            candidate = [longitude, latitude]
            if not output or candidate != output[-1]:
                output.append(candidate)
    if len(output) < 2:
        raise ValueError("Road service returned no usable geometry.")
    return output


def road_geometry(raw: list[dict]) -> tuple[list[list[float]], bool]:
    """Return road-following geometry and whether matching succeeded."""
    original = [[float(point["longitude"]), float(point["latitude"])] for point in raw]
    if not _enabled():
        return original, False
    cleaned = _clean(raw)
    # If every fix is weak, retain the available endpoints and let the router at
    # least produce a road-following line instead of a diagonal map chord.
    if len(cleaned) < 2:
        cleaned = [
            {**point, "latitude": float(point["latitude"]), "longitude": float(point["longitude"]),
             "accuracy": min(50, float(point.get("accuracy", 50)))}
            for point in raw
        ]
    if len(cleaned) < 2:
        return original, False
    waypoints = _routing_points(cleaned)
    for service in ("match", "route"):
        try:
            return _request(service, waypoints), True
        except Exception as error:  # Raw geometry is the safe fallback.
            logger.warning("Route Studio %s request failed: %s", service, error)
    return original, False
