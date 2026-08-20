/* Shared, gap-hiding motion for every Leaflet vehicle marker. */

const MIN_MOVEMENT_METERS = 7;
const MAX_SPEED_METERS_PER_SECOND = 30; // 108 km/h; safely above a city bus.
const MIN_PLAUSIBLE_JUMP_METERS = 120;
// Moving MVD fixes arrive every 20 seconds. Reserve a few seconds at the end
// for an early next fix or a stationary bus, while following road geometry.
const LIVE_SEGMENT_DURATION_MS = 17_000;
const MIN_CATCH_UP_DURATION_MS = 500;
const MAX_CATCH_UP_DURATION_MS = 3_000;

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

function followMarkerSmoothly(marker, point, motion, frameTime) {
    if (!motion.followMap || frameTime - (motion.lastMapFollowAt || 0) < 350) return;

    const map = marker._map;
    if (!map?.getBounds) return;

    // Keep the vehicle within the middle of the viewport. This avoids the
    // distracting snap caused by recentering on every animation frame.
    const comfortableBounds = map.getBounds().pad(-0.22);
    if (!comfortableBounds.isValid() || comfortableBounds.contains(point)) return;

    motion.lastMapFollowAt = frameTime;
    map.panTo([point.lat, point.lng], {
        animate: true,
        duration: 0.65,
        noMoveStart: true,
    });
}

async function requestRoadPath(start, target, signal) {
    const coordinates = `${start.lng},${start.lat};${target.lng},${target.lat}`;
    const response = await fetch(
        `https://router.project-osrm.org/route/v1/driving/${coordinates}`
        + "?overview=full&geometries=geojson&steps=false",
        { signal },
    );
    if (!response.ok) throw new Error(`Road route failed (${response.status}).`);

    const data = await response.json();
    const geometry = data.routes?.[0]?.geometry?.coordinates;
    if (!Array.isArray(geometry) || geometry.length < 2) {
        throw new Error("Road route contains no usable geometry.");
    }

    return geometry
        .map(([longitude, latitude]) => ({ lat: Number(latitude), lng: Number(longitude) }))
        .filter(point => Number.isFinite(point.lat) && Number.isFinite(point.lng));
}

export async function snapVehicleMarkerToRoad(marker, latitude, longitude, motion = {}) {
    if (!marker || !Number.isFinite(Number(latitude)) || !Number.isFinite(Number(longitude))) return;

    motion.snapAbortController?.abort();
    const controller = new AbortController();
    motion.snapAbortController = controller;
    const requestId = (motion.snapRequestId || 0) + 1;
    motion.snapRequestId = requestId;

    try {
        const response = await fetch(
            `https://router.project-osrm.org/nearest/v1/driving/${Number(longitude)},${Number(latitude)}?number=1`,
            { signal: controller.signal },
        );
        if (!response.ok) throw new Error(`Road snap failed (${response.status}).`);
        const location = (await response.json()).waypoints?.[0]?.location;
        if (
            requestId !== motion.snapRequestId
            || !Array.isArray(location)
            || !Number.isFinite(Number(location[0]))
            || !Number.isFinite(Number(location[1]))
        ) return;
        marker.setLatLng([Number(location[1]), Number(location[0])]);
    } catch (error) {
        if (error.name !== "AbortError") {
            console.warn("Unable to snap vehicle marker to road; using raw GPS position.", error);
        }
    }
}

/**
 * `motion` must be retained per bus/marker. Each normal GPS segment follows
 * the road geometry for most of the 20-second moving-provider interval.
 */
export async function animateVehicleMarker(marker, latitude, longitude, motion, visualSelector) {
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

    const previousTarget = motion.target;
    const previousAnimationIsRunning = Boolean(
        motion.frame
        && previousTarget
        && Number.isFinite(previousTarget.lat)
        && Number.isFinite(previousTarget.lng)
    );
    if (motion.frame) cancelAnimationFrame(motion.frame);
    motion.abortController?.abort();
    const requestId = (motion.requestId || 0) + 1;
    motion.requestId = requestId;
    motion.lastAcceptedAt = now;
    const controller = new AbortController();
    motion.abortController = controller;

    let stages;
    try {
        if (previousAnimationIsRunning) {
            const [catchUpPath, nextPath] = await Promise.all([
                requestRoadPath(start, previousTarget, controller.signal),
                requestRoadPath(previousTarget, target, controller.signal),
            ]);
            const remainingDistance = distanceMeters(start, previousTarget);
            const catchUpDuration = Math.min(
                MAX_CATCH_UP_DURATION_MS,
                Math.max(
                    MIN_CATCH_UP_DURATION_MS,
                    Math.round(
                        MAX_CATCH_UP_DURATION_MS
                        * (remainingDistance / Math.max(motion.stageDistance || remainingDistance, 1))
                    )
                )
            );
            stages = [
                { path: catchUpPath, target: previousTarget, duration: catchUpDuration },
                {
                    path: nextPath,
                    target: nextPath[nextPath.length - 1],
                    duration: LIVE_SEGMENT_DURATION_MS - catchUpDuration,
                },
            ];
        } else {
            const roadPath = await requestRoadPath(start, target, controller.signal);
            stages = [{
                path: roadPath,
                target: roadPath[roadPath.length - 1],
                duration: LIVE_SEGMENT_DURATION_MS,
            }];
        }
    } catch (error) {
        if (error.name !== "AbortError") {
            console.warn("Unable to load road geometry; using a direct GPS segment.", error);
        }
        stages = [{ path: [start, target], target, duration: LIVE_SEGMENT_DURATION_MS }];
    }
    if (motion.requestId !== requestId) return;

    const routeStart = stages[0].path[0];
    const routeTarget = stages[stages.length - 1].target;
    // OSRM snaps both endpoints to the driveable network. Move an initially
    // off-road GPS fix to that first road point before animation begins.
    if (distanceMeters(marker.getLatLng(), routeStart) >= MIN_MOVEMENT_METERS) {
        marker.setLatLng([routeStart.lat, routeStart.lng]);
    }
    motion.target = routeTarget;
    motion.abortController = null;

    const animateStage = stageIndex => {
        if (motion.requestId !== requestId) return;
        const stage = stages[stageIndex];
        const stageTarget = stage.target;
        const path = stage.path;
        const cumulative = pathLengths(path);
        const totalDistance = cumulative[cumulative.length - 1];
        const startedAt = performance.now();
        motion.duration = stage.duration;
        motion.startedAt = startedAt;
        motion.stageDistance = totalDistance;

        const render = frameTime => {
            if (motion.requestId !== requestId) return;
            const progress = Math.min(1, (frameTime - startedAt) / stage.duration);
            const eased = progress * progress * (3 - 2 * progress);
            const current = positionOnPath(path, cumulative, totalDistance * eased);
            marker.setLatLng([current.point.lat, current.point.lng]);
            followMarkerSmoothly(marker, current.point, motion, frameTime);

            const heading = stableHeading(motion, current.heading, frameTime);
            rotateMarker(marker, visualSelector, heading);
            motion.heading = heading;

            if (progress < 1) {
                motion.frame = requestAnimationFrame(render);
            } else if (stageIndex + 1 < stages.length) {
                marker.setLatLng([stageTarget.lat, stageTarget.lng]);
                animateStage(stageIndex + 1);
            } else {
                motion.frame = null;
                marker.setLatLng([target.lat, target.lng]);
            }
        };

        motion.frame = requestAnimationFrame(render);
    };

    animateStage(0);
}
