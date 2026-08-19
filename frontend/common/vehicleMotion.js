/*
 * Shared road-following motion for every Leaflet vehicle marker.
 * Raw GPS points are never interpolated in a straight line: OSRM supplies a
 * drivable segment, then the marker travels its geometry at a steady pace.
 */

const ROAD_ROUTER = "https://router.project-osrm.org/route/v1/driving/";
const MIN_MOVEMENT_METERS = 7;
const MAX_SPEED_METERS_PER_SECOND = 45; // 162 km/h, allowing normal GPS gaps.
const MIN_PLAUSIBLE_JUMP_METERS = 220;
const ANIMATION_DURATION_MS = 17_000;

function radians(value) {
    return value * Math.PI / 180;
}

function distanceMeters(start, end) {
    const earthRadius = 6_371_000;
    const latitudeDelta = radians(end.lat - start.lat);
    const longitudeDelta = radians(end.lng - start.lng);
    const latitudeStart = radians(start.lat);
    const latitudeEnd = radians(end.lat);
    const a = Math.sin(latitudeDelta / 2) ** 2
        + Math.cos(latitudeStart) * Math.cos(latitudeEnd)
        * Math.sin(longitudeDelta / 2) ** 2;
    return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function bearingBetween(start, end) {
    const startLatitude = radians(start.lat);
    const endLatitude = radians(end.lat);
    const deltaLongitude = radians(end.lng - start.lng);
    const y = Math.sin(deltaLongitude) * Math.cos(endLatitude);
    const x = Math.cos(startLatitude) * Math.sin(endLatitude)
        - Math.sin(startLatitude) * Math.cos(endLatitude) * Math.cos(deltaLongitude);
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function shortestAngle(from, to) {
    return ((to - from + 540) % 360) - 180;
}

function interpolateHeading(from, to, progress) {
    return (from + shortestAngle(from, to) * progress + 360) % 360;
}

function pathLengths(path) {
    const cumulative = [0];
    for (let index = 1; index < path.length; index += 1) {
        cumulative.push(cumulative[index - 1] + distanceMeters(path[index - 1], path[index]));
    }
    return cumulative;
}

function positionOnPath(path, cumulative, distance) {
    const total = cumulative[cumulative.length - 1];
    const clamped = Math.min(Math.max(distance, 0), total);
    let index = 1;
    while (index < cumulative.length && cumulative[index] < clamped) index += 1;
    const start = path[Math.max(0, index - 1)];
    const end = path[Math.min(path.length - 1, index)];
    const segmentLength = Math.max(cumulative[index] - cumulative[index - 1], 0.001);
    const ratio = (clamped - cumulative[index - 1]) / segmentLength;
    return {
        point: {
            lat: start.lat + (end.lat - start.lat) * ratio,
            lng: start.lng + (end.lng - start.lng) * ratio,
        },
        heading: bearingBetween(start, end),
    };
}

async function roadPath(start, target, signal) {
    const coordinates = `${start.lng},${start.lat};${target.lng},${target.lat}`;
    const response = await fetch(
        `${ROAD_ROUTER}${coordinates}?overview=full&geometries=geojson&steps=false`,
        { signal }
    );
    if (!response.ok) throw new Error(`Road routing failed (${response.status}).`);
    const payload = await response.json();
    const coordinatesList = payload.routes?.[0]?.geometry?.coordinates;
    if (!Array.isArray(coordinatesList) || coordinatesList.length < 2) {
        throw new Error("Road routing returned no usable geometry.");
    }
    return coordinatesList.map(([longitude, latitude]) => ({
        lat: Number(latitude),
        lng: Number(longitude),
    })).filter(point => Number.isFinite(point.lat) && Number.isFinite(point.lng));
}

function rotateMarker(marker, selector, heading) {
    const visual = marker.getElement()?.querySelector(selector);
    if (visual) {
        // Remove transforms left by an older page bundle before applying the
        // mobile-safe CSS-variable transform.
        visual.style.transform = "";
        visual.style.setProperty("--vehicle-heading", `${heading}deg`);
    }
}

function stableHeading(motion, desiredHeading, frameTime) {
    if (!Number.isFinite(motion.heading)) {
        motion.lastHeadingFrameAt = frameTime;
        return desiredHeading;
    }

    const elapsed = Math.max(0, (frameTime - (motion.lastHeadingFrameAt || frameTime)) / 1000);
    // Cap each visual correction. This is particularly important on mobile
    // browsers where a delayed animation frame must never produce a full spin.
    const maximumTurn = Math.min(55, Math.max(2.5, elapsed * 55));
    const turn = shortestAngle(motion.heading, desiredHeading);
    motion.lastHeadingFrameAt = frameTime;
    return (motion.heading + Math.max(-maximumTurn, Math.min(maximumTurn, turn)) + 360) % 360;
}

/**
 * Moves a marker only over an OSRM road geometry. `motion` must be retained
 * per bus/marker so stale requests, GPS noise, and sudden bad fixes are
 * ignored rather than producing a spin or an off-road jump.
 */
export function animateVehicleMarker(marker, latitude, longitude, motion, visualSelector) {
    const start = marker?.getLatLng();
    const target = { lat: Number(latitude), lng: Number(longitude) };
    if (!start || !Number.isFinite(target.lat) || !Number.isFinite(target.lng)) return;

    const displacement = distanceMeters(start, target);
    if (displacement < MIN_MOVEMENT_METERS) return;

    const now = performance.now();
    const elapsedSeconds = motion.lastAcceptedAt ? (now - motion.lastAcceptedAt) / 1000 : null;
    const allowedJump = elapsedSeconds == null
        ? Infinity
        : Math.max(MIN_PLAUSIBLE_JUMP_METERS, elapsedSeconds * MAX_SPEED_METERS_PER_SECOND);
    if (displacement > allowedJump) {
        console.warn("Ignoring implausible GPS jump for vehicle marker.", { displacement, allowedJump });
        return;
    }

    if (motion.frame) cancelAnimationFrame(motion.frame);
    motion.abortController?.abort();
    const requestId = (motion.requestId || 0) + 1;
    const abortController = new AbortController();
    motion.requestId = requestId;
    motion.abortController = abortController;
    motion.lastAcceptedAt = now;

    // A failed road lookup deliberately leaves the bus at its previous
    // road-matched position. Drawing a straight fallback would put it off road.
    return roadPath(start, target, abortController.signal)
        .then(path => {
            if (motion.requestId !== requestId || path.length < 2) return;
            const cumulative = pathLengths(path);
            const totalDistance = cumulative[cumulative.length - 1];
            if (totalDistance < 1) return;

            const startedAt = performance.now();

            const render = frameTime => {
                if (motion.requestId !== requestId) return;
                const progress = Math.min(1, (frameTime - startedAt) / ANIMATION_DURATION_MS);
                // Gentle sine easing avoids the abrupt acceleration of the old animation.
                const eased = 0.5 - Math.cos(Math.PI * progress) / 2;
                const currentDistance = totalDistance * eased;
                const current = positionOnPath(path, cumulative, currentDistance);
                const lookAhead = positionOnPath(
                    path,
                    cumulative,
                    Math.min(totalDistance, currentDistance + 15)
                );
                marker.setLatLng([current.point.lat, current.point.lng]);

                // Read the road direction 15 m ahead rather than from tiny
                // geometry fragments under the bus; this keeps phone rotation
                // stable around junctions and on low-frame-rate browsers.
                const desiredHeading = distanceMeters(current.point, lookAhead.point) > .5
                    ? bearingBetween(current.point, lookAhead.point)
                    : current.heading;
                const heading = stableHeading(motion, desiredHeading, frameTime);
                rotateMarker(marker, visualSelector, heading);
                motion.heading = heading;

                if (progress < 1) {
                    motion.frame = requestAnimationFrame(render);
                } else {
                    motion.frame = null;
                    motion.abortController = null;
                    // The final coordinate is still the road-matched endpoint,
                    // never the raw off-road GPS coordinate.
                    marker.setLatLng([current.point.lat, current.point.lng]);
                }
            };

            motion.frame = requestAnimationFrame(render);
        })
        .catch(error => {
            if (error.name !== "AbortError") console.warn("Vehicle road animation skipped.", error);
        });
}
