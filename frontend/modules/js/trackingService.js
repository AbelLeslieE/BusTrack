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

// Used to invalidate old GPS callbacks when leaving the page.
let trackingSession = 0;

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
   GPS SUCCESS
========================================================== */
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


    // ------------------------------------------------------
    // GPS is now successfully receiving a location
    // ------------------------------------------------------

    const gpsStatus =
        document.getElementById("gpsStatus");

    if (gpsStatus) {

        gpsStatus.textContent = "Tracking...";

    }


    // ------------------------------------------------------
    // Update map marker
    // ------------------------------------------------------

    updateMarker(
        latitude,
        longitude
    );


    // ------------------------------------------------------
    // Send location to backend
    // ------------------------------------------------------

    await sendLocation(
        latitude,
        longitude,
        speed,
        accuracy
    );


    // ------------------------------------------------------
    // Update GPS information
    // ------------------------------------------------------

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
            speed != null
                ? `${(speed * 3.6).toFixed(1)} km/h`
                : "--";

    }


    if (accuracyElement) {

        accuracyElement.textContent =
            accuracy != null
                ? `${accuracy.toFixed(1)} m`
                : "--";

    }


    if (lastUpdateElement) {

        lastUpdateElement.textContent =
            new Date().toLocaleTimeString();

    }

}
/* ==========================================================
   SEND LOCATION TO SERVER
========================================================== */

async function sendLocation(latitude, longitude, speed, accuracy) {

    if (!currentTripId) return;

    const token = localStorage.getItem(
        "bus_tracker_access_token"
    );

    await fetch("/api/gps/update", {

        method: "POST",

        headers: {

            "Authorization": `Bearer ${token}`,

            "Content-Type": "application/json"

        },

        body: JSON.stringify({

            trip_id: currentTripId,

            latitude,

            longitude,

            speed,

            accuracy

        })

    });

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