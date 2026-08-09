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
========================================================== */

export async function startTrip() {

    if (tracking) return;

    try {

        const token = localStorage.getItem("bus_tracker_access_token");

        const response = await fetch(

            "/api/gps/start",

            {

                method: "POST",

                headers: {

                    "Authorization": `Bearer ${token}`,
                    "Content-Type": "application/json"

                }

            }

        );

        if (!response.ok) {

            const error = await response.json();

            throw new Error(error.detail);

        }

        const trip = await response.json();

        console.log("CURRENT TRIP:", trip);

        currentTripId = trip.id;

        // ==========================================================
        // UPDATE CURRENT BUS
        // ==========================================================

        const tripBus =
            document.getElementById("tripBus");

        if (tripBus) {

            tripBus.textContent =
                trip.bus_id != null
                    ? `BUS-${String(trip.bus_id).padStart(3, "0")}`
                    : "--";

        }

        // ==========================================================
        // UPDATE CURRENT ROUTE
        // ==========================================================

        const tripRoute =
            document.getElementById("tripRoute");

        if (tripRoute) {

            tripRoute.textContent =
                trip.route_id != null
                    ? `Route ${trip.route_id}`
                    : "--";

        }

        tracking = true;

        document.getElementById("tripStatus").textContent =
            "🟢 Running";   

        document.getElementById("gpsStatus").textContent =
            "Searching...";

        document.getElementById("startTripBtn").disabled = true;

        document.getElementById("stopTripBtn").disabled = false;

        console.log("Trip Started", trip);

        startLocationTracking();

    }

    catch (error) {

        console.error(error);

        alert(error.message);

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
   START GPS WATCH
========================================================== */

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

function onLocationError(error) {

    console.error(error);

    alert(error.message);

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