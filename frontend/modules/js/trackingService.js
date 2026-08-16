/* ==========================================================
   DRIVER TRACKING SERVICE
========================================================== */
console.log("trackingService.js loaded");
let map = null;
let marker = null;
console.log(
    "Driver map initialized WITHOUT bus marker."
);
/* ==========================================================
   TRACKING STATE
========================================================== */

let currentTripId = null;

let watchId = null;

let tracking = false;

let trackingAccessToken = null;

/*
 * Timestamp of the last GPS position successfully sent
 * to the BusTrack backend.
 *
 * The driver map can update immediately from GPS,
 * but the server/database will receive an update
 * at most once every 10 seconds.
 */
let lastServerUpdateTime = 0;

/*
 * Server update interval.
 *
 * 10 seconds = 10000 milliseconds.
 */
const SERVER_UPDATE_INTERVAL = 2000;

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

export function updateMarker(latitude, longitude) {

    console.log("GPS RECEIVED:", latitude, longitude);

    if (!map) return;

    // Create the marker only once
    if (!marker) {

        marker = L.marker([
            latitude,
            longitude
        ])
        .addTo(map)
        .bindPopup("Current Bus");

    } else {

        marker.setLatLng([
            latitude,
            longitude
        ]);

    }

    map.flyTo(

        [
            latitude,
            longitude
        ],

        map.getZoom(),

        {

            animate: true,

            duration: 0.5

        }

    );

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

    if (tracking) return;

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

                }

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

        tracking = true;


        if (tripStatus) {

            tripStatus.textContent =
                "🟢 Running";

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

    if (!tracking || !currentTripId) return;

    try {

        const token = localStorage.getItem(
            "bus_tracker_access_token"
        );



        const response = await fetch(

            "/api/gps/stop",

            {

                method: "POST",

                headers: {

                    "Authorization": `Bearer ${token}`,

                    "Content-Type": "application/json"

                },

                body: JSON.stringify({

                    trip_id: currentTripId

                })

            }

        );

        if (!response.ok) {

            const error = await response.json();

            throw new Error(error.detail);

        }

        // Stop browser GPS

        if (watchId !== null) {

            navigator.geolocation.clearWatch(watchId);

            watchId = null;

        }
        // Remove the bus marker when the trip ends.
        if (marker && map) {

            map.removeLayer(marker);

            marker = null;

        }

        tracking = false;

        currentTripId = null;

        trackingAccessToken = null;

        lastServerUpdateTime = 0;
        previousGpsSample = null;

        document.getElementById("tripStatus").textContent =
            "⚫ Ready";

        document.getElementById("gpsStatus").textContent =
            "Stopped";

        document.getElementById("startTripBtn").disabled = false;

        document.getElementById("stopTripBtn").disabled = true;

        console.log("Trip Stopped");

    }

    catch (error) {

        console.error(error);

        alert(error.message);

    }

}

export async function sendDriverFeedback(feedbackType, message = "") {
    const token = localStorage.getItem("bus_tracker_access_token");
    const headers = { "Content-Type": "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch("/api/notifications/feedback", {
        method: "POST",
        headers,
        credentials: "same-origin",
        body: JSON.stringify({
            feedback_type: feedbackType,
            message: message.trim() || null,
        }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || "Unable to send feedback.");
    return data;
}

/* ==========================================================
   REQUEST LOCATION PERMISSION
========================================================== */

function requestLocationPermission() {

    return new Promise(
        (resolve, reject) => {

            navigator.geolocation.getCurrentPosition(

                (position) => {

                    resolve(position);

                },

                (error) => {

                    reject(error);

                },

                {

                    enableHighAccuracy: true,

                    maximumAge: 0,

                    timeout: 15000

                }

            );

        }
    );

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
     * sendLocation() still controls the 10-second server
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
 * - Backend receives a position at most every 10 seconds.
 *
 * This prevents unnecessary database/API traffic while
 * keeping the student live-tracking page responsive.
 */
async function sendLocation(
    latitude,
    longitude,
    speed,
    accuracy
) {

    // ------------------------------------------------------
    // There is nothing to send without an active trip.
    // ------------------------------------------------------

    if (!currentTripId) {

        return;

    }


    // ------------------------------------------------------
    // Check whether 10 seconds have passed since the last
    // server update.
    // ------------------------------------------------------

    const now = Date.now();

    const elapsed =
        now - lastServerUpdateTime;


    if (
        lastServerUpdateTime !== 0 &&
        elapsed < SERVER_UPDATE_INTERVAL
    ) {

        console.log(
            "GPS received locally. " +
            "Server update throttled."
        );

        return;

    }


    // ------------------------------------------------------
    // Get authentication token.
    // ------------------------------------------------------

    const token =
        trackingAccessToken ||
        localStorage.getItem(
            "bus_tracker_access_token"
        );


    if (!token) {

        console.error(
            "No authentication token found."
        );

        return;

    }


    // ------------------------------------------------------
    // Send GPS position to backend.
    // ------------------------------------------------------

    try {

        const response =
            await fetch(
                "/api/gps/update",
                {
                    method: "POST",

                    headers: {
                        "Authorization":
                            `Bearer ${token}`,

                        "Content-Type":
                            "application/json"
                    },

                    body: JSON.stringify({

                        trip_id:
                            currentTripId,

                        latitude:
                            latitude,

                        longitude:
                            longitude,

                        speed:
                            speed,

                        accuracy:
                            accuracy
                    })
                }
            );


        // --------------------------------------------------
        // IMPORTANT:
        // fetch() does NOT throw for HTTP 4xx/5xx.
        //
        // Therefore we MUST check response.ok.
        // --------------------------------------------------

        if (!response.ok) {

            let errorMessage =
                `GPS update failed (${response.status}).`;

            try {

                const error =
                    await response.json();

                if (error.detail) {

                    errorMessage =
                        error.detail;

                }

            }
            catch {

                // Keep the default error message.
            }


            console.error(
                "BusTrack GPS update failed:",
                errorMessage
            );

            return;

        }


        // --------------------------------------------------
        // Read backend response.
        // --------------------------------------------------

        const result =
            await response.json();


        // --------------------------------------------------
        // Only mark the timestamp after the server accepted
        // the GPS update.
        // --------------------------------------------------

        lastServerUpdateTime =
            Date.now();


        console.log(
            "GPS sent to server successfully:",
            result
        );

    }

    catch (error) {

        console.error(
            "Unable to send GPS update:",
            error
        );

    }

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

        const tripStatus =
            document.getElementById("tripStatus");

        const gpsStatus =
            document.getElementById("gpsStatus");

        const startButton =
            document.getElementById("startTripBtn");

        const stopButton =
            document.getElementById("stopTripBtn");


        if (tripStatus) {

            tripStatus.textContent =
                "🟢 Running";

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


        // Restart GPS only if this page is still active.
        if (session === trackingSession) {

            startLocationTracking();

        }

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

    currentTripId = null;

    trackingAccessToken = null;

    lastServerUpdateTime = 0;
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
