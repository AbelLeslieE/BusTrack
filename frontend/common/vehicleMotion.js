/* Shared, noise-resistant vehicle animation for Leaflet map markers. */

function bearingBetween(start, end) {
    const radians = value => value * Math.PI / 180;
    const startLatitude = radians(start.lat);
    const endLatitude = radians(end.lat);
    const deltaLongitude = radians(end.lng - start.lng);
    const y = Math.sin(deltaLongitude) * Math.cos(endLatitude);
    const x = Math.cos(startLatitude) * Math.sin(endLatitude)
        - Math.sin(startLatitude) * Math.cos(endLatitude) * Math.cos(deltaLongitude);
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function distanceMeters(start, end) {
    const latitudeScale = 111_320;
    const longitudeScale = latitudeScale * Math.cos(start.lat * Math.PI / 180);
    return Math.hypot((end.lat - start.lat) * latitudeScale, (end.lng - start.lng) * longitudeScale);
}

function interpolateHeading(from, to, progress) {
    const difference = ((to - from + 540) % 360) - 180;
    return (from + difference * progress + 360) % 360;
}

/** Move and rotate a marker without reacting to small parked-GPS jitter. */
export function animateVehicleMarker(marker, latitude, longitude, motion, visualSelector) {
    const start = marker.getLatLng();
    const target = { lat: Number(latitude), lng: Number(longitude) };
    if (!Number.isFinite(target.lat) || !Number.isFinite(target.lng)) return;
    if (distanceMeters(start, target) < 1.5) return;

    const targetHeading = bearingBetween(start, target);
    const startHeading = Number.isFinite(motion.heading) ? motion.heading : targetHeading;
    if (motion.frame) cancelAnimationFrame(motion.frame);

    const startedAt = performance.now();
    // Vehicle devices normally publish while moving every 20 seconds. Leave a
    // small buffer before the next point so the motion remains continuous.
    const duration = 18_000;
    const render = now => {
        const progress = Math.min(1, (now - startedAt) / duration);
        const eased = progress < .5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2;
        marker.setLatLng([
            start.lat + (target.lat - start.lat) * eased,
            start.lng + (target.lng - start.lng) * eased,
        ]);
        const heading = interpolateHeading(startHeading, targetHeading, eased);
        const visual = marker.getElement()?.querySelector(visualSelector);
        if (visual) visual.style.transform = `rotate(${heading}deg)`;
        motion.heading = heading;
        motion.frame = progress < 1 ? requestAnimationFrame(render) : null;
    };
    motion.frame = requestAnimationFrame(render);
}
