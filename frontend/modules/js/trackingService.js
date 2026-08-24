/* ==========================================================
   DRIVER TRACKING SERVICE
========================================================== */
import { animateVehicleMarker, snapVehicleMarkerToRoad } from "/static/common/vehicleMotion.js?v=road-safe-6";
import { createVehicleMarkerIcon } from "/static/common/vehicleMarker.js";

console.log("trackingService.js loaded");
let map = null;
let marker = null;
const markerMotion = { heading: null, frame: null, followMap: true };
let markerTargetLocation = null;
console.log(
    "Driver map initialized WITHOUT bus marker."
);
/* ==========================================================
   TRACKING STATE
========================================================== */

let currentTripId = null;

let watchId = null;

let tracking = false;

// Phone sharing is independent from the GPS-module tracking session. Turning
// it on or off must never start or stop the bus's server-side tracking.
let mobileTrackingEnabled = false;

let trackingAccessToken = null;

// The persisted direction belongs to the live trip, not the route itself.
// Keeping it locally lets the driver UI update at once while other portals
// receive the same value from their normal polling response.
let currentRouteDirection = "forward";
let terminalMessageTimer = null;

// The MVD unit is primary. Phone GPS runs only while that signal is stale.
let activeTrackingSource = "unavailable";
let sourcePollTimer = null;

/*
 * Timestamp of the last GPS position successfully sent
 * to the BusTrack backend.
 *
 * The driver map can update immediately from GPS,
 * but the server/database will receive an update
 * at most once every two seconds.
 */
let lastServerUpdateTime = 0;

// GPS callbacks and network responses are independent. Queue the most recent
// fix so a slow request cannot cause stale positions to be written afterward.
let locationUpdateInFlight = false;
let pendingLocation = null;
let locationFlushTimer = null;

/*
 * Server update interval.
 *
 * Two seconds keeps student tracking responsive without flooding the API.
 */
const SERVER_UPDATE_INTERVAL = 2000;

const MOBILE_GPS_INITIAL_FIX_TIMEOUT_MS = 45_000;

// Used to invalidate old GPS callbacks when leaving the page.
let trackingSession = 0;
/* ==========================================================
   LOCAL GPS SPEED CALCULATION
========================================================== */

/*
 * Some browsers/GPS devices return:
 *
 *     position.coords.speed = null
 *
 * Therefore we keep the previous GPS point and calculate
 * speed ourselves when necessary.
 */

let previousGpsSample = null;

/* ==========================================================
INITIALIZE MAP
========================================================== */

export function initializeMap(containerId = "driverMap") {

    console.log("==================================");
    console.log("DRIVER MAP INITIALIZED");
    console.log("==================================");

    const container = document.getElementById(containerId);

    if (!container) {

        console.log("driverMap DIV NOT FOUND");

        return;

    }

    console.log("driverMap DIV FOUND");

    if (map) {

        map.remove();

        map = null;

    }

    // Reset the old marker reference.
    // The previous marker belonged to the old Leaflet map.
    marker = null;
    markerTargetLocation = null;
    if (markerMotion.frame) cancelAnimationFrame(markerMotion.frame);
    markerMotion.heading = null;
    markerMotion.frame = null;
    markerMotion.target = null;
    markerMotion.duration = null;
    markerMotion.stageDistance = null;

    // ==========================================================
    // Default Location - Sahrdaya College
    // ==========================================================

    const DEFAULT_LOCATION = {

        lat: 10.359000,

        lng: 76.286100,

        zoom: 19

    };

    console.log(DEFAULT_LOCATION);

    map = L.map(containerId).setView(
        

        [
            DEFAULT_LOCATION.lat,
            DEFAULT_LOCATION.lng
        ],

        DEFAULT_LOCATION.zoom

    );
        console.log("Leaflet map created");
    L.tileLayer(

        "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",

        {

            attribution: "&copy; OpenStreetMap contributors"

        }

    ).addTo(map);



}


/* ==========================================================
   UPDATE DRIVER POSITION
========================================================== */

export function updateMarker(latitude, longitude, label = "Current Bus") {

    console.log("GPS RECEIVED:", latitude, longitude);

    if (!map) return;

    // Create the marker only once
    if (!marker) {

        marker = L.marker([
            latitude,
            longitude
        ], {
            icon: createVehicleMarkerIcon(),
        })
        .addTo(map)
        .bindPopup(label);

        markerTargetLocation = { latitude: Number(latitude), longitude: Number(longitude) };
        void snapVehicleMarkerToRoad(
            marker,
            Number(latitude),
            Number(longitude),
            markerMotion,
        );
        map.setView([latitude, longitude], Math.max(map.getZoom(), 15), { animate: true });

    } else {

        const isNewPosition =
            !markerTargetLocation ||
            Math.abs(markerTargetLocation.latitude - Number(latitude)) > 0.0000001 ||
            Math.abs(markerTargetLocation.longitude - Number(longitude)) > 0.0000001;

        if (isNewPosition) {

            markerTargetLocation = { latitude: Number(latitude), longitude: Number(longitude) };
            animateVehicleMarker(
                marker,
                latitude,
                longitude,
                markerMotion,
                ".fleet-vehicle-marker__visual"
            );

        }

    }

}
/* ==========================================================
   START TRIP
========================================================== */
/* ==========================================================
   START TRIP
   GPS permission is requested FIRST so that iPhone/Safari
   can show the location permission prompt directly from
   the driver's Start Trip button.
========================================================== */

export async function startTrip() {

    if (mobileTrackingEnabled) return;

    try {
        const source = await refreshTrackingSource();
        if (!source.active_trip_id) {
            throw new Error("Waiting for the vehicle GPS module to begin tracking this bus.");
        }

        // The vehicle module creates the session. Enabling phone GPS only
        // attaches an additional location source to that existing session.
        currentTripId = source.active_trip_id;
        tracking = true;
        trackingAccessToken = localStorage.getItem("bus_tracker_access_token");
        updateDirectionControls(source.route_direction || "forward");

        const initialPosition = await requestLocationPermission();
        mobileTrackingEnabled = true;
        activeTrackingSource = "mobile";
        previousGpsSample = null;
        startLocationTracking();
        onLocationSuccess(initialPosition);

        setText("gpsStatus", "Phone GPS sharing enabled");
        const startButton = document.getElementById("startTripBtn");
        const stopButton = document.getElementById("stopTripBtn");
        if (startButton) startButton.disabled = true;
        if (stopButton) stopButton.disabled = false;
    } catch (error) {
        console.error("Unable to enable phone GPS:", error);
        setText("gpsStatus", "Phone GPS unavailable");
        alert(error.message);
    }
}

// MVD is primary. This path is reached only after the source endpoint has
// confirmed that the MVD unit is stale, invalid, unavailable, or ignition-off.
async function startTripUsingMobileGpsFallback() {

    if (tracking) return;

    // Re-check immediately before requesting permission. A newly received MVD
    // fix wins, so the two devices never publish competing live positions.
    try {
        const source = await refreshTrackingSource();
        if (source.tracking_source === "vehicle_gps") {
            await startTripUsingVehicleGps();
            return;
        }
    } catch (error) {
        // If the source-status check is temporarily unavailable, the backend
        // still rejects phone updates as soon as vehicle GPS is authoritative.
        console.warn("Unable to pre-check vehicle GPS source:", error);
    }

    // ------------------------------------------------------
    // Check browser GPS support
    // ------------------------------------------------------

    if (!navigator.geolocation) {

        alert(
            "Location services are not supported by this browser."
        );

        return;

    }

    try {

        const startButton =
            document.getElementById("startTripBtn");

        const stopButton =
            document.getElementById("stopTripBtn");

        const tripStatus =
            document.getElementById("tripStatus");

        const gpsStatus =
            document.getElementById("gpsStatus");


        // --------------------------------------------------
        // Tell the user what is happening
        // --------------------------------------------------

        if (gpsStatus) {

            gpsStatus.textContent =
                "Requesting location...";

        }

        if (startButton) {

            startButton.disabled = true;

        }


        // ==================================================
        // REQUEST LOCATION PERMISSION FIRST
        //
        // IMPORTANT:
        // This happens directly from the Start Trip click.
        // This is important for iPhone/Safari.
        // ==================================================

        const initialPosition =
            await requestLocationPermission();


        // --------------------------------------------------
        // GPS permission/location successful
        // --------------------------------------------------

        console.log(
            "Initial GPS position:",
            initialPosition.coords.latitude,
            initialPosition.coords.longitude
        );


        if (gpsStatus) {

            gpsStatus.textContent =
                "Location available";

        }


        // ==================================================
        // NOW CREATE THE SERVER-SIDE TRIP
        // ==================================================

        const token =
            localStorage.getItem(
                "bus_tracker_access_token"
            );
        trackingAccessToken = token;


        const response = await fetch(

            "/api/gps/start",

            {

                method: "POST",

                headers: {

                    "Authorization":
                        `Bearer ${token}`,

                    "Content-Type":
                        "application/json"

                },

                body: JSON.stringify({
                    latitude: initialPosition.coords.latitude,
                    longitude: initialPosition.coords.longitude,
                    accuracy: initialPosition.coords.accuracy
                })

            }

        );


        if (!response.ok) {

            const error =
                await response.json();

            throw new Error(
                error.detail ||
                "Unable to start trip."
            );

        }


        const trip =
            await response.json();


        console.log(
            "CURRENT TRIP:",
            trip
        );


        // --------------------------------------------------
        // Store current trip
        // --------------------------------------------------

        currentTripId =
            trip.id;


        // ==================================================
        // UPDATE CURRENT BUS
        // ==================================================

        const tripBus =
            document.getElementById("tripBus");

        if (tripBus) {

            tripBus.textContent =
                trip.bus_id != null
                    ? `BUS-${String(
                        trip.bus_id
                    ).padStart(3, "0")}`
                    : "--";

        }


        // ==================================================
        // UPDATE CURRENT ROUTE
        // ==================================================

        const tripRoute =
            document.getElementById("tripRoute");

        if (tripRoute) {

            tripRoute.textContent =
                trip.route_id != null
                    ? `Route ${trip.route_id}`
                    : "--";

        }


        // ==================================================
        // UPDATE UI
        // ==================================================

        // This is the MVD-approved fallback path. Enable the watcher only
        // after the backend has created the mobile-sourced trip.
        activeTrackingSource = "mobile";
        tracking = true;
        updateDirectionControls(trip.route_direction || "forward");


        if (tripStatus) {

            tripStatus.textContent = `🟢 Running · ${directionLabel()}`;

        }


        if (gpsStatus) {

            gpsStatus.textContent =
                "Tracking...";

        }


        if (startButton) {

            startButton.disabled = true;

        }


        if (stopButton) {

            stopButton.disabled = false;

        }


        console.log(
            "Trip Started",
            trip
        );


        // ==================================================
        // START CONTINUOUS GPS TRACKING
        // ==================================================
        previousGpsSample = null;
        startLocationTracking();


        // --------------------------------------------------
        // Immediately process the position we already
        // received during the permission request.
        // --------------------------------------------------

        onLocationSuccess(
            initialPosition
        );

    }

    catch (error) {

        console.error(
            "Unable to start trip:",
            error
        );


        // --------------------------------------------------
        // Restore Start button
        // --------------------------------------------------

        const startButton =
            document.getElementById(
                "startTripBtn"
            );

        if (startButton) {

            startButton.disabled = false;

        }


        // --------------------------------------------------
        // Update GPS status
        // --------------------------------------------------

        const gpsStatus =
            document.getElementById(
                "gpsStatus"
            );

        if (gpsStatus) {

            gpsStatus.textContent =
                "Location unavailable";

        }


        alert(
            getLocationErrorMessage(error)
        );

    }

}
/* ==========================================================
   STOP TRIP
========================================================== */

export async function stopTrip() {

    if (!mobileTrackingEnabled) return;

    mobileTrackingEnabled = false;
    stopMobileLocationTracking();
    pendingLocation = null;
    lastServerUpdateTime = 0;
    activeTrackingSource = "vehicle_gps";

    setText("gpsStatus", "Phone GPS sharing paused · vehicle GPS continues");
    const startButton = document.getElementById("startTripBtn");
    const stopButton = document.getElementById("stopTripBtn");
    if (startButton) startButton.disabled = false;
    if (stopButton) stopButton.disabled = true;

    // The map, current bus, route direction, and stop progression remain
    // owned by the installed vehicle GPS after phone sharing is disabled.
    void refreshTrackingSource().catch(() => {});

}

function setText(id, text) {
    const element = document.getElementById(id);
    if (element) element.textContent = text;
}

function directionLabel(direction = currentRouteDirection) {
    return direction === "reverse" ? "Return journey" : "Outbound journey";
}

function updateDirectionControls(direction) {
    if (direction !== "forward" && direction !== "reverse") return;
    currentRouteDirection = direction;
    setText("routeDirection", directionLabel());

    const button = document.getElementById("reverseRouteBtn");
    if (!button) return;
    button.disabled = !tracking || !currentTripId;
    const label = button.querySelector("span");
    if (label) {
        label.textContent = direction === "reverse"
            ? "Change to Outbound"
            : "Change to Return";
    }
}

function showTerminalArrival(nextDirection) {
    updateDirectionControls(nextDirection);
    setText("tripStatus", `✅ Route finished · ${directionLabel()}`);
    setText("gpsStatus", "Reached final stop · route order reversed");

    if (terminalMessageTimer !== null) window.clearTimeout(terminalMessageTimer);
    terminalMessageTimer = window.setTimeout(() => {
        terminalMessageTimer = null;
        if (tracking) setText("tripStatus", `🟢 Running · ${directionLabel()}`);
    }, 4_000);
}

function showRunningTripStatus(direction = currentRouteDirection) {
    updateDirectionControls(direction);
    if (terminalMessageTimer === null) {
        setText("tripStatus", `🟢 Running · ${directionLabel()}`);
    }
}

function stopMobileLocationTracking() {
    // Invalidate callbacks before clearing the browser watcher so an old
    // callback cannot race a vehicle-GPS source change.
    trackingSession++;
    if (watchId !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
    }
    previousGpsSample = null;
}

function completeTripInDriverUi() {
    stopMobileLocationTracking();
    mobileTrackingEnabled = false;

    if (marker && map) {
        map.removeLayer(marker);
        marker = null;
    }

    tracking = false;
    currentTripId = null;
    trackingAccessToken = null;
    lastServerUpdateTime = 0;
    previousGpsSample = null;
    updateDirectionControls("forward");

    setText("tripStatus", "✅ Trip completed");
    setText("gpsStatus", "Reached terminal");

    const startButton = document.getElementById("startTripBtn");
    const stopButton = document.getElementById("stopTripBtn");
    if (startButton) startButton.disabled = false;
    if (stopButton) stopButton.disabled = true;
}

function stopTripBecauseAdminEndedIt() {
    stopMobileLocationTracking();
    mobileTrackingEnabled = false;

    if (marker && map) {
        map.removeLayer(marker);
        marker = null;
    }

    tracking = false;
    currentTripId = null;
    trackingAccessToken = null;
    lastServerUpdateTime = 0;
    pendingLocation = null;
    updateDirectionControls("forward");

    setText("tripStatus", "⏹ Trip stopped by admin");
    setText("gpsStatus", "Tracking stopped by admin");
    const startButton = document.getElementById("startTripBtn");
    const stopButton = document.getElementById("stopTripBtn");
    if (startButton) startButton.disabled = false;
    if (stopButton) stopButton.disabled = true;
}

function updateVehicleLocation(vehicle) {
    if (!vehicle || !Number.isFinite(vehicle.latitude) || !Number.isFinite(vehicle.longitude)) return;
    updateMarker(vehicle.latitude, vehicle.longitude, "Vehicle GPS");
    setText("latitude", vehicle.latitude.toFixed(6));
    setText("longitude", vehicle.longitude.toFixed(6));
    setText("speed", vehicle.speed_kmh != null ? `${Number(vehicle.speed_kmh).toFixed(1)} km/h` : "—");
    setText("accuracy", vehicle.accuracy != null ? `${Number(vehicle.accuracy).toFixed(1)} m` : "—");
    setText("lastUpdate", vehicle.received_at ? new Date(vehicle.received_at).toLocaleTimeString() : "Waiting for update");
}

function applyTrackingSource(source) {
    if (!source) return;

    // A GPS module may begin reporting after the driver portal has already
    // opened. Adopt that server-created session immediately; no driver button
    // click is needed for the live map or direction controls to work.
    if (!tracking && source.active_trip_id) {
        currentTripId = source.active_trip_id;
        tracking = true;
        updateDirectionControls(source.route_direction || "forward");
        setText("tripStatus", `🟢 Running · ${directionLabel()}`);
    }

    // Admin stop/cancel actions end the server trip. Stop the local phone
    // watcher too, so it cannot continue posting a location after that.
    if (
        tracking
        && currentTripId
        && source.active_trip_id !== currentTripId
    ) {
        stopTripBecauseAdminEndedIt();
    }

    const vehicleIsPrimary = source.tracking_source === "vehicle_gps";
    const mobileIsActive = source.tracking_source === "mobile";
    const mobileIsReady = source.tracking_source === "mobile_available";
    const hasVehiclePosition = Boolean(
        source.vehicle
        && Number.isFinite(source.vehicle.latitude)
        && Number.isFinite(source.vehicle.longitude)
    );
    const sourceDirection = source.route_direction;
    const directionChangedAtTerminal = Boolean(
        tracking
        && sourceDirection
        && sourceDirection !== currentRouteDirection
    );
    if (sourceDirection) {
        if (directionChangedAtTerminal) {
            // Provider GPS reached the final stop. The driver screen polls
            // this endpoint, so it can show the transition without reload.
            showTerminalArrival(sourceDirection);
        } else {
            updateDirectionControls(sourceDirection);
        }
    }
    // A running trip publishes phone readings even while a vehicle module is
    // fresh. The backend accepts both sources and applies each report as it
    // arrives, so neither source silently suppresses the other.
    const mobilePublishingEnabled = Boolean(
        mobileTrackingEnabled
        && tracking
        && currentTripId
        && source.mobile_tracking_allowed
    );
    activeTrackingSource = mobilePublishingEnabled || (mobileIsActive && mobileTrackingEnabled)
        ? "mobile"
        : vehicleIsPrimary
            ? "vehicle_gps"
            : "unavailable";
    const card = document.getElementById("trackingSourceCard");
    const button = document.getElementById("mobileFallbackBtn");
    card?.classList.toggle("is-vehicle", vehicleIsPrimary);
    setText(
        "trackingSourceValue",
        vehicleIsPrimary
            ? "Vehicle GPS (MVD)"
            : mobileIsActive
                ? "Phone GPS"
                : mobileIsReady
                    ? "Phone GPS fallback ready"
                    : "Vehicle GPS offline"
    );
    setText(
        "trackingSourcePill",
        vehicleIsPrimary ? "LIVE" : mobileIsActive ? "LIVE" : "WAITING"
    );
    setText("trackingSourceReason", source.reason || "Location-source status is unavailable.");
    setText(
        "activeTrackingSource",
        vehicleIsPrimary && mobilePublishingEnabled
            ? "🚌 Vehicle GPS + phone"
            : vehicleIsPrimary
                ? "🚌 Vehicle GPS"
            : source.vehicle?.ignition === false
                ? "🚌 Vehicle GPS · ignition off"
                : mobileIsActive && mobileTrackingEnabled ? "📱 Phone GPS" : "⚫ Waiting for vehicle GPS"
    );
    setText(
        "mapTrackingSource",
        vehicleIsPrimary && mobilePublishingEnabled
            ? "🚌 Vehicle GPS + phone"
            : vehicleIsPrimary
                ? "🚌 Vehicle GPS"
            : source.vehicle?.ignition === false
                ? "🚌 Vehicle GPS · ignition off"
                : mobilePublishingEnabled ? "📱 Phone GPS" : "⚫ GPS unavailable"
    );
    document.getElementById("mapTrackingSource")?.classList.toggle("is-vehicle", vehicleIsPrimary);
    // An ignition-off MVD heartbeat is still a timestamped last-known point.
    // Keep it on the driver map while the bus is parked at a stop.
    if (hasVehiclePosition && !vehicleIsPrimary) {
        updateVehicleLocation(source.vehicle);
    }
    if (button) button.hidden = true;

    if (vehicleIsPrimary) {
        // Refresh the driver map from the latest translated provider position.
        updateVehicleLocation(source.vehicle);
        setText(
            "gpsStatus",
            source.vehicle?.ignition === false
                ? "Vehicle GPS · ignition off (parked heartbeat)"
                : "Vehicle GPS · ignition on"
        );
        if (tracking && sourceDirection) {
            showRunningTripStatus(sourceDirection);
        }
        if (mobilePublishingEnabled && watchId === null) {
            startLocationTracking();
        }
        return;
    }

    if (mobilePublishingEnabled) {
        setText(
            "gpsStatus",
            source.vehicle?.ignition === false
                ? "Vehicle GPS · ignition off · last known position"
                : "Phone GPS sharing · waiting for vehicle GPS"
        );
        // Once browser permission has been granted, this begins automatically
        // whenever the fresh MVD signal disappears. Do not recreate the
        // watcher on every two-second source poll.
        if (mobilePublishingEnabled && watchId === null) {
            startLocationTracking();
        }
        return;
    }

    stopMobileLocationTracking();
    setText(
        "gpsStatus",
        mobileIsReady ? "Phone GPS fallback ready" : "Waiting for GPS"
    );
}

async function refreshTrackingSource() {
    const response = await fetch("/api/integrations/gps/driver/source");
    if (!response.ok) throw new Error("Unable to check vehicle GPS status.");
    const source = await response.json();
    applyTrackingSource(source);
    return source;
}

export function initializeTrackingSource() {
    const fallbackButton = document.getElementById("mobileFallbackBtn");
    if (fallbackButton) fallbackButton.hidden = true;
    void refreshTrackingSource().catch(error => setText("trackingSourceReason", error.message));
    if (sourcePollTimer !== null) window.clearInterval(sourcePollTimer);
    sourcePollTimer = window.setInterval(() => {
        void refreshTrackingSource().catch(() => {});
    }, 2_000);
}

export async function reverseRouteDirection() {
    if (!tracking || !currentTripId) return;

    const nextDirection = currentRouteDirection === "reverse"
        ? "forward"
        : "reverse";
    const button = document.getElementById("reverseRouteBtn");
    if (button) button.disabled = true;

    try {
        const token = trackingAccessToken || localStorage.getItem("bus_tracker_access_token");
        const response = await fetch("/api/gps/direction", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${token}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ trip_id: currentTripId, direction: nextDirection }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(typeof result.detail === "string"
                ? result.detail
                : "Unable to change route direction.");
        }

        if (terminalMessageTimer !== null) {
            window.clearTimeout(terminalMessageTimer);
            terminalMessageTimer = null;
        }
        showRunningTripStatus(result.route_direction);
        setText("gpsStatus", "Route direction changed");
    } catch (error) {
        console.error("Unable to change route direction:", error);
        setText("gpsStatus", "Unable to change route direction");
        alert(error.message);
    } finally {
        updateDirectionControls(currentRouteDirection);
    }
}

/**
 * Raise a driver-facing operational alert. The server attaches the active
 * trip or the driver's current assignment, so the management portal receives
 * the bus and route context without the driver having to enter it.
 */
export async function sendDriverFeedback(feedbackType, message = "") {
    const token = trackingAccessToken || localStorage.getItem("bus_tracker_access_token");
    const response = await fetch("/api/notifications/feedback", {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/json",
        },
        credentials: "same-origin",
        body: JSON.stringify({
            feedback_type: feedbackType,
            message: message.trim() || null,
        }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(
            typeof result.detail === "string"
                ? result.detail
                : "Unable to send feedback to the admin team."
        );
    }
    return result;
}

async function startTripUsingVehicleGps() {
    const startButton = document.getElementById("startTripBtn");
    const stopButton = document.getElementById("stopTripBtn");
    if (startButton) startButton.disabled = true;
    try {
        const token = localStorage.getItem("bus_tracker_access_token");
        const headers = { "Content-Type": "application/json" };
        if (token) headers.Authorization = `Bearer ${token}`;
        const response = await fetch("/api/gps/start", {
            method: "POST",
            headers,
            credentials: "same-origin",
        });
        const trip = await response.json().catch(() => ({}));
        if (!response.ok) {
            const message = typeof trip.detail === "string"
                ? trip.detail
                : trip.detail?.message || "Unable to start trip.";

            // The MVD can cross the 60-second freshness boundary between the
            // source check and this request. Retry through the authorised
            // mobile fallback instead of making the driver press Start again.
            if (
                response.status === 409
                && message.includes("Allow phone location to start the mobile fallback")
            ) {
                await startTripUsingMobileGpsFallback();
                return;
            }

            throw new Error(message);
        }
        currentTripId = trip.id;
        tracking = true;
        updateDirectionControls(trip.route_direction || "forward");
        // Keep the driver's GPS running as a second live source. The module
        // continues to post independently and the server merges both streams.
        activeTrackingSource = "mobile";
        startLocationTracking();
        setText("tripBus", trip.bus_number || (trip.bus_id != null ? `BUS-${String(trip.bus_id).padStart(3, "0")}` : "—"));
        setText("tripRoute", trip.route_name || (trip.route_id != null ? `Route ${trip.route_id}` : "—"));
        showRunningTripStatus(trip.route_direction || "forward");
        setText("gpsStatus", "Vehicle GPS · ignition on");
        if (stopButton) stopButton.disabled = false;
    } catch (error) {
        if (startButton) startButton.disabled = false;
        setText("gpsStatus", "Unable to start trip");
        alert(error.message);
    }
}

function prepareMobileFallbackPermission() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
        () => {},
        () => {},
        { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 }
    );
}

/* ==========================================================
   REQUEST LOCATION PERMISSION
========================================================== */

function requestLocationPermission() {

    return new Promise((resolve, reject) => {

        let accuracyWatchId = null;
        let completed = false;

        const finish = (callback, value) => {
            if (completed) return;
            completed = true;
            window.clearTimeout(timeoutId);
            if (accuracyWatchId !== null) {
                navigator.geolocation.clearWatch(accuracyWatchId);
            }
            callback(value);
        };

        const timeoutId = window.setTimeout(() => {
            finish(
                reject,
                new Error(
                    "Phone location was not received. Allow location access and try again."
                )
            );
        }, MOBILE_GPS_INITIAL_FIX_TIMEOUT_MS);

        accuracyWatchId = navigator.geolocation.watchPosition(
            (position) => {
                finish(resolve, position);
            },
            (error) => finish(reject, error),
            {
                enableHighAccuracy: true,
                maximumAge: 0,
                timeout: MOBILE_GPS_INITIAL_FIX_TIMEOUT_MS,
            }
        );
    });

}

/* ==========================================================
   START GPS WATCH
========================================================== */

function startLocationTracking() {

    if (!navigator.geolocation) {

        alert("Geolocation is not supported.");

        return;

    }

    // Stop an old watcher before starting a new one.
    if (watchId !== null) {

        navigator.geolocation.clearWatch(watchId);

        watchId = null;

    }

    // Create a new tracking session.
    trackingSession++;

    const session = trackingSession;

    watchId = navigator.geolocation.watchPosition(

        (position) => {

            // Ignore GPS callbacks from an old session.
            if (session !== trackingSession) {

                console.log(
                    "Ignoring old GPS callback."
                );

                return;

            }

            onLocationSuccess(position, session);

        },

        (error) => {

            // Ignore errors from an old session.
            if (session !== trackingSession) {

                return;

            }

            onLocationError(error);

        },

        {

            enableHighAccuracy: true,

            maximumAge: 0,

            timeout: 10000

        }

    );

    console.log(
        "GPS watcher started. Session:",
        session
    );

}
/* ==========================================================
   CALCULATE LOCAL GPS SPEED
========================================================== */

/*
 * Calculates speed using two GPS positions.
 *
 * Formula:
 *
 * speed = distance / time
 *
 * Distance is calculated using the Haversine formula.
 *
 * Returns speed in km/h.
 */

function calculateLocalSpeedKmh(
    latitude,
    longitude,
    timestamp
) {

    // ------------------------------------------------------
    // First GPS point
    // ------------------------------------------------------

    if (!previousGpsSample) {

        previousGpsSample = {
            latitude,
            longitude,
            timestamp
        };

        return null;
    }


    const previous =
        previousGpsSample;


    // ------------------------------------------------------
    // Calculate elapsed time in seconds
    // ------------------------------------------------------

    const elapsedSeconds =
        (timestamp - previous.timestamp) / 1000;


    // Invalid timestamp difference.
    if (elapsedSeconds <= 0) {

        return null;

    }


    // ------------------------------------------------------
    // Convert coordinates to radians
    // ------------------------------------------------------

    const toRadians =
        degrees =>
            degrees * Math.PI / 180;


    const lat1 =
        toRadians(previous.latitude);

    const lat2 =
        toRadians(latitude);

    const deltaLat =
        toRadians(
            latitude - previous.latitude
        );

    const deltaLng =
        toRadians(
            longitude - previous.longitude
        );


    // ------------------------------------------------------
    // Haversine formula
    // ------------------------------------------------------

    const earthRadiusMeters =
        6371000;

    const a =
        Math.sin(deltaLat / 2) ** 2 +
        Math.cos(lat1) *
        Math.cos(lat2) *
        Math.sin(deltaLng / 2) ** 2;


    const c =
        2 *
        Math.atan2(
            Math.sqrt(a),
            Math.sqrt(1 - a)
        );


    const distanceMeters =
        earthRadiusMeters * c;


    // ------------------------------------------------------
    // Update previous GPS point
    // ------------------------------------------------------

    previousGpsSample = {

        latitude,
        longitude,
        timestamp

    };


    // ------------------------------------------------------
    // Calculate km/h
    // ------------------------------------------------------

    const speedKmh =
        (
            distanceMeters /
            elapsedSeconds
        ) * 3.6;


    // ------------------------------------------------------
    // Ignore impossible GPS spikes.
    //
    // A school bus cannot realistically travel at
    // hundreds of km/h.
    // ------------------------------------------------------

    if (
        speedKmh < 0 ||
        speedKmh > 150
    ) {

        return null;

    }


    return speedKmh;

}
/* ==========================================================
   GPS SUCCESS
========================================================== */

async function onLocationSuccess(position) {

    // A provider signal can take priority between browser callbacks. Do not
    // render or send another phone coordinate after that source transition.
    if (activeTrackingSource !== "mobile") return;

    const {
        latitude,
        longitude,
        speed,
        accuracy
    } = position.coords;

    // ======================================================
    // GPS STATUS
    // ======================================================

    const gpsStatus =
        document.getElementById("gpsStatus");

    if (gpsStatus) {

        gpsStatus.textContent =
            "Tracking...";

    }


    // ======================================================
    // GPS TIMESTAMP
    // ======================================================

    const gpsTimestamp =
        position.timestamp ||
        Date.now();


    // ======================================================
    // CALCULATE SPEED
    // ======================================================

    let speedKmh = null;


    /*
     * Prefer the speed supplied by the GPS device when
     * available.
     *
     * position.coords.speed is in metres/second.
     */

    if (
        speed != null &&
        Number.isFinite(speed) &&
        speed >= 0
    ) {

        speedKmh =
            speed * 3.6;


        /*
         * Keep the previous GPS point synchronized so that
         * our fallback calculation remains valid.
         */

        previousGpsSample = {

            latitude,
            longitude,
            timestamp: gpsTimestamp

        };

    }

    else {

        /*
         * Browser did not provide speed.
         *
         * Calculate it ourselves from GPS movement.
         */

        speedKmh =
            calculateLocalSpeedKmh(
                latitude,
                longitude,
                gpsTimestamp
            );

    }


    // ======================================================
    // UPDATE DRIVER MAP IMMEDIATELY
    // ======================================================

    updateMarker(
        latitude,
        longitude
    );


    // ======================================================
    // UPDATE DRIVER GPS INFORMATION IMMEDIATELY
    // ======================================================

    const latitudeElement =
        document.getElementById("latitude");

    const longitudeElement =
        document.getElementById("longitude");

    const speedElement =
        document.getElementById("speed");

    const accuracyElement =
        document.getElementById("accuracy");

    const lastUpdateElement =
        document.getElementById("lastUpdate");


    if (latitudeElement) {

        latitudeElement.textContent =
            latitude.toFixed(6);

    }


    if (longitudeElement) {

        longitudeElement.textContent =
            longitude.toFixed(6);

    }


    if (speedElement) {

        speedElement.textContent =
            speedKmh != null
                ? `${speedKmh.toFixed(1)} km/h`
                : "Calculating...";

    }


    if (accuracyElement) {

        accuracyElement.textContent =
            accuracy != null
                ? `${accuracy.toFixed(1)} m`
                : "--";

    }


    if (lastUpdateElement) {

        lastUpdateElement.textContent =
            new Date(
                gpsTimestamp
            ).toLocaleTimeString();

    }


    // ======================================================
    // SEND GPS TO BACKEND
    // ======================================================

    /*
     * Backend receives the calculated speed instead of
     * receiving null when browser GPS does not provide speed.
     *
     * sendLocation() still controls the server-side update
     * update interval.
     */

    sendLocation(
        latitude,
        longitude,
        speedKmh != null
            ? speedKmh / 3.6
            : null,
        accuracy
    );

}
/* ==========================================================
   SEND LOCATION TO SERVER
========================================================== */

/*
 * Sends the latest GPS position to the backend.
 *
 * IMPORTANT:
 *
 * The browser GPS may generate positions more frequently
 * than we need.
 *
 * Therefore:
 *
 * - Driver map updates immediately.
 * - Backend receives a position at most every two seconds.
 *
 * This prevents unnecessary database/API traffic while
 * keeping the student live-tracking page responsive.
 */
function scheduleLocationFlush(delay) {
    if (locationFlushTimer !== null) return;
    locationFlushTimer = window.setTimeout(() => {
        locationFlushTimer = null;
        void flushPendingLocation();
    }, delay);
}

async function flushPendingLocation() {
    if (locationUpdateInFlight || activeTrackingSource !== "mobile" || !currentTripId) return;

    const elapsed = Date.now() - lastServerUpdateTime;
    if (lastServerUpdateTime !== 0 && elapsed < SERVER_UPDATE_INTERVAL) {
        scheduleLocationFlush(SERVER_UPDATE_INTERVAL - elapsed);
        return;
    }

    const location = pendingLocation;
    if (!location) return;
    pendingLocation = null;

    const token = trackingAccessToken || localStorage.getItem("bus_tracker_access_token");
    if (!token) {
        console.error("No authentication token found.");
        return;
    }

    locationUpdateInFlight = true;
    try {
        const response = await fetch("/api/gps/update", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${token}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                trip_id: currentTripId,
                latitude: location.latitude,
                longitude: location.longitude,
                speed: location.speed,
                accuracy: location.accuracy
            })
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            if (response.status === 409 && error.detail?.tracking_source === "vehicle_gps") {
                void refreshTrackingSource().catch(() => {});
                return;
            }
            throw new Error(typeof error.detail === "string"
                ? error.detail
                : error.detail?.message || `GPS update failed (${response.status}).`);
        }

        lastServerUpdateTime = Date.now();
        const result = await response.json();
        console.log("GPS sent to server successfully:", result);

        if (result.stop_progression_event?.trip_leg_completed) {
            showTerminalArrival(
                result.stop_progression_event.next_direction || currentRouteDirection
            );
        }
    } catch (error) {
        console.error("Unable to send GPS update:", error);
    } finally {
        locationUpdateInFlight = false;
        if (pendingLocation) void flushPendingLocation();
    }
}

async function sendLocation(latitude, longitude, speed, accuracy) {
    if (activeTrackingSource !== "mobile" || !currentTripId) return;
    // Preserve only the newest coordinate while the network is busy.
    pendingLocation = { latitude, longitude, speed, accuracy };
    await flushPendingLocation();
}
/* ==========================================================
   GET CURRENT ACTIVE TRIP
========================================================== */

/* ==========================================================
   GET CURRENT ACTIVE TRIP
========================================================== */

export async function loadCurrentTrip() {

    const session = trackingSession;

    const token = localStorage.getItem(
        "bus_tracker_access_token"
    );
    trackingAccessToken = token;

    try {

        const response = await fetch(
            "/api/gps/current",
            {
                headers: {
                    Authorization: `Bearer ${token}`
                }
            }
        );

        // Page was left while the request was running.
        if (session !== trackingSession) {

            console.log(
                "Ignoring current-trip response from old page."
            );

            return null;

        }

        if (!response.ok) {

            return null;

        }

        const trip = await response.json();

        // No active trip.
        if (!trip) {

            return null;

        }

        // Page was left while the request was running.
        if (session !== trackingSession) {

            return null;

        }

        currentTripId = trip.id;
        /*
        * Allow the first GPS position to be sent immediately.
        */
        lastServerUpdateTime = 0;

        /* ==========================================================
        RESTORE CURRENT BUS
        ========================================================== */

        const tripBus =
            document.getElementById("tripBus");

        if (tripBus) {

            tripBus.textContent =
                trip.bus_id != null
                    ? `BUS-${String(trip.bus_id).padStart(3, "0")}`
                    : "--";

        }

        /* ==========================================================
        RESTORE CURRENT ROUTE
        ========================================================== */

        const tripRoute =
            document.getElementById("tripRoute");

        if (tripRoute) {

            tripRoute.textContent =
                trip.route_id != null
                    ? `Route ${trip.route_id}`
                    : "--";

        }

        tracking = true;
        updateDirectionControls(trip.route_direction || "forward");

        const tripStatus =
            document.getElementById("tripStatus");

        const gpsStatus =
            document.getElementById("gpsStatus");

        const startButton =
            document.getElementById("startTripBtn");

        const stopButton =
            document.getElementById("stopTripBtn");


        if (tripStatus) {

            tripStatus.textContent = `🟢 Running · ${directionLabel()}`;

        }

        if (gpsStatus) {

            gpsStatus.textContent =
                "Tracking...";

        }

        if (startButton) {

            startButton.disabled = mobileTrackingEnabled;

        }

        if (stopButton) {

            stopButton.disabled = !mobileTrackingEnabled;

        }


        // Provider polling continues to refresh the map; this portal never
        // starts a browser GPS watcher.
        await refreshTrackingSource().catch(() => null);

        return trip;

    }

    catch (error) {

        console.error(
            "Failed to load current trip:",
            error
        );

        return null;

    }

}
/* ==========================================================
   GPS ERROR
========================================================== */

/* ==========================================================
   GPS ERROR
========================================================== */

function onLocationError(error) {

    console.error(
        "GPS ERROR:",
        error
    );


    const gpsStatus =
        document.getElementById(
            "gpsStatus"
        );


    let message =
        "Unable to access your location.";


    switch (error.code) {

        case error.PERMISSION_DENIED:

            message =
                "Location permission was denied. " +
                "Please allow location access for Safari " +
                "and try again.";

            break;


        case error.POSITION_UNAVAILABLE:

            message =
                "Your location is currently unavailable. " +
                "Please make sure Location Services and GPS " +
                "are enabled.";

            break;


        case error.TIMEOUT:

            message =
                "GPS location request timed out. " +
                "Please move to an area with a better GPS signal " +
                "and try again.";

            break;

    }


    if (gpsStatus) {

        gpsStatus.textContent =
            "Location unavailable";

    }


    console.error(
        "GPS MESSAGE:",
        message
    );

}
/* ==========================================================
   LOCATION ERROR MESSAGE
========================================================== */

function getLocationErrorMessage(error) {

    // ----------------------------------------------
    // Standard Geolocation error
    // ----------------------------------------------

    if (
        error &&
        typeof error.code === "number"
    ) {

        switch (error.code) {

            case error.PERMISSION_DENIED:

                return (
                    "Location permission was denied.\n\n" +
                    "Please allow location access for this " +
                    "website in Safari settings and try again."
                );


            case error.POSITION_UNAVAILABLE:

                return (
                    "Your location is currently unavailable.\n\n" +
                    "Make sure Location Services are enabled " +
                    "on your iPhone."
                );


            case error.TIMEOUT:

                return (
                    "The GPS request timed out.\n\n" +
                    "Please try again in an area with a better " +
                    "GPS signal."
                );

        }

    }


    // ----------------------------------------------
    // Normal JavaScript / API error
    // ----------------------------------------------

    if (error && error.message) {

        return error.message;

    }


    return (
        "Unable to start GPS tracking."
    );

}
/* ==========================================================
   CLEANUP DRIVER TRACKING
========================================================== */

/* ==========================================================
   CLEANUP DRIVER TRACKING
========================================================== */

export function cleanupTracking() {

    console.log(
        "Cleaning up driver tracking..."
    );


    /* ======================================================
       INVALIDATE ALL OLD GPS CALLBACKS
    ====================================================== */

    trackingSession++;

    if (markerMotion.frame) cancelAnimationFrame(markerMotion.frame);
    markerMotion.heading = null;
    markerMotion.frame = null;
    markerMotion.target = null;
    markerMotion.duration = null;
    markerMotion.stageDistance = null;
    markerTargetLocation = null;

    if (sourcePollTimer !== null) {
        window.clearInterval(sourcePollTimer);
        sourcePollTimer = null;
    }


    /* ======================================================
       STOP GPS WATCHER
    ====================================================== */

    if (watchId !== null) {

        navigator.geolocation.clearWatch(
            watchId
        );

        watchId = null;

    }


    /* ======================================================
       STOP LOCAL TRACKING STATE
    ====================================================== */

    tracking = false;

    mobileTrackingEnabled = false;

    currentTripId = null;

    trackingAccessToken = null;

    lastServerUpdateTime = 0;
    locationUpdateInFlight = false;
    pendingLocation = null;
    if (locationFlushTimer !== null) {
        window.clearTimeout(locationFlushTimer);
        locationFlushTimer = null;
    }
    if (terminalMessageTimer !== null) {
        window.clearTimeout(terminalMessageTimer);
        terminalMessageTimer = null;
    }
    previousGpsSample = null;


    /* ======================================================
       REMOVE BUS MARKER
    ====================================================== */

    if (marker && map) {

        map.removeLayer(marker);

    }

    marker = null;


    /* ======================================================
       DESTROY LEAFLET MAP
    ====================================================== */

    if (map) {

        map.remove();

        map = null;

    }


    console.log(
        "Driver tracking cleanup completed."
    );

}
