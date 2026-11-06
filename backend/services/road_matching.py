"""Filter phone GPS and use OSRM to road-match completed recordings.

Raw phone fixes remain stored in ``route_studio_points``.  This module only
builds the display/route geometry, so a routing-provider outage can never
destroy or prevent access to the original evidence.
"""
from __future__ import annotations

import json
import logging
import math
import os
from datetime import datetime
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
    """Keep credible movement, not the street loops made by stationary GPS drift.

    This only selects points for route geometry. Every original fix remains in
    route_studio_points for audit and later review.
    """
    result: list[dict] = []
    pending: dict | None = None
    for point in raw:
        try:
            latitude = float(point["latitude"])
            longitude = float(point["longitude"])
            accuracy = float(point.get("accuracy", 0))
        except (KeyError, TypeError, ValueError):
            continue
        if not all(math.isfinite(value) for value in (latitude, longitude, accuracy)):
            continue
        if not (-90 <= latitude <= 90 and -180 <= longitude <= 180) or accuracy < 0 or accuracy > 35:
            continue
        candidate = {**point, "latitude": latitude, "longitude": longitude, "accuracy": accuracy}
        if not result:
            result.append(candidate)
            continue
        anchor = result[-1]
        distance = _distance(anchor, candidate)
        uncertainty = anchor["accuracy"] + accuracy
        speed = candidate.get("speed")
        moving = speed is not None and math.isfinite(float(speed)) and float(speed) >= 1.2
        movement_floor = max(2.5, min(8, 0.3 * uncertainty)) if moving else max(10, 0.8 * uncertainty)
        if distance <= movement_floor:
            if not moving:
                pending = None
            continue
        try:
            start = datetime.fromisoformat(str(anchor["recorded_at"]).replace("Z", "+00:00"))
            end = datetime.fromisoformat(str(candidate["recorded_at"]).replace("Z", "+00:00"))
            elapsed = (end - start).total_seconds()
        except (KeyError, ValueError, TypeError):
            elapsed = 0
        if elapsed <= 0 or distance / elapsed > 45 or (speed is not None and float(speed) > 55):
            pending = None
            continue
        if moving:
            result.append(candidate)
            pending = None
            continue
        # Some phones report zero or no speed while moving. Wait for another
        # fix that continues away from the anchor before accepting that motion.
        if pending:
            forward = distance - _distance(anchor, pending)
            step = _distance(pending, candidate)
            required = max(12, 0.8 * (pending["accuracy"] + accuracy))
            if forward >= required and step >= required:
                result.extend((pending, candidate))
                pending = None
                continue
        if pending is None:
            pending = candidate
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
            "gaps": "split",
            "radiuses": ";".join(str(max(5, min(50, round(point["accuracy"])))) for point in points),
            "timestamps": ";".join(str(round(datetime.fromisoformat(str(point["recorded_at"]).replace("Z", "+00:00")).timestamp())) for point in points),
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
    if service == "match" and len(geometries or []) != 1:
        raise ValueError("OSRM split the trace into disconnected road matches.")
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


def planned_route(points: list[dict]) -> list[list[float]]:
    """Route an ordered set of administrator-selected anchors along roads.

    Unlike tracer map matching, this operation is deliberately explicit: it
    runs only after an administrator asks Route Studio to connect the named
    stops (and any fine-tuning guide points).  The public/configured OSRM
    service remains the source of road geometry; no straight-line fallback is
    returned because that could silently publish an invalid bus route.
    """
    if not 2 <= len(points) <= 200:
        raise ValueError("Choose between 2 and 200 ordered route anchors.")
    normalized: list[dict] = []
    for point in points:
        try:
            latitude = float(point["latitude"])
            longitude = float(point["longitude"])
        except (KeyError, TypeError, ValueError) as error:
            raise ValueError("Every route anchor needs valid coordinates.") from error
        if not all(math.isfinite(value) for value in (latitude, longitude)):
            raise ValueError("Route anchor coordinates must be finite.")
        if not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
            raise ValueError("Route anchor coordinates are outside the map.")
        normalized.append({"latitude": latitude, "longitude": longitude})
    return _request("route", normalized)


def road_geometry(raw: list[dict]) -> tuple[list[list[float]], bool]:
    """Return filtered GPS geometry, refined by OSRM only when it stays credible."""
    cleaned = _clean(raw)
    geometry = [[p["longitude"], p["latitude"]] for p in cleaned]
    if len(cleaned) < 2:
        return geometry, False
    if not _enabled():
        return geometry, False
    waypoints = _routing_points(cleaned)
    try:
        matched = _request("match", waypoints)
        raw_length = sum(_distance(cleaned[index - 1], cleaned[index]) for index in range(1, len(cleaned)))
        matched_points = [{"longitude": point[0], "latitude": point[1]} for point in matched]
        matched_length = sum(_distance(matched_points[index - 1], matched_points[index]) for index in range(1, len(matched_points)))
        if matched_length > max(raw_length * 1.8, raw_length + 300) or matched_length < raw_length * 0.45:
            raise ValueError("OSRM match length is inconsistent with the filtered GPS trail.")
        for waypoint in waypoints:
            corridor_distance = min(
                _point_segment_distance(waypoint, matched_points[index - 1], matched_points[index])
                for index in range(1, len(matched_points))
            )
            if corridor_distance > max(50, waypoint["accuracy"] * 3):
                raise ValueError("OSRM match left the trusted GPS corridor.")
        return matched, True
    except Exception as error:  # Filtered GPS geometry is the safe fallback.
        logger.warning("Route Studio OSRM match rejected: %s", error)
    return geometry, False
