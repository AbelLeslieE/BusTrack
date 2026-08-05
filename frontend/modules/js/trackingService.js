/* ==========================================================
   DRIVER TRACKING SERVICE
========================================================== */

let map = null;
let marker = null;

/* ==========================================================
   TRACKING STATE
========================================================== */

let currentTripId = null;

let watchId = null;

let tracking = false;
/* ==========================================================
   INITIALIZE MAP
========================================================== */

export function initializeMap(containerId = "driverMap") {

    const container = document.getElementById(containerId);

    if (!container) return;

    if (map) {

        map.remove();

        map = null;

    }

    map = L.map(containerId).setView(
        [10.5276, 76.2144],   // Default: Sahrdaya College
        15
    );

    L.tileLayer(
        "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
        {
            attribution: "&copy; OpenStreetMap contributors"
        }
    ).addTo(map);

    marker = L.marker(
        [10.5276, 76.2144]
    ).addTo(map);

}


/* ==========================================================
   UPDATE DRIVER POSITION
========================================================== */

export function updateMarker(latitude, longitude) {

    if (!map || !marker) return;

    marker.setLatLng([latitude, longitude]);

    map.setView([latitude, longitude]);

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

        currentTripId = trip.id;

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

function startLocationTracking() {

    if (!navigator.geolocation) {

        alert("Geolocation is not supported.");

        return;

    }

    watchId = navigator.geolocation.watchPosition(

        onLocationSuccess,

        onLocationError,

        {

            enableHighAccuracy: true,

            maximumAge: 0,

            timeout: 10000,

        }

    );

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

    updateMarker(
        latitude,
        longitude
    );

    await sendLocation(
        latitude,
        longitude,
        speed,
        accuracy
    );

    document.getElementById("latitude").textContent =
        latitude.toFixed(6);

    document.getElementById("longitude").textContent =
        longitude.toFixed(6);

    document.getElementById("speed").textContent =
        speed
            ? `${speed.toFixed(1)} km/h`
            : "--";

    document.getElementById("accuracy").textContent =
        `${accuracy.toFixed(1)} m`;
    document.getElementById("lastUpdate").textContent =
        new Date().toLocaleTimeString();
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

export async function loadCurrentTrip() {

    const token = localStorage.getItem(
        "bus_tracker_access_token"
    );

    const response = await fetch(
        "/api/gps/current",
        {
            headers: {
                Authorization: `Bearer ${token}`
            }
        }
    );

    if (!response.ok) {

        return null;

    }

    const trip = await response.json();

    if (!trip) {

        return null;

    }

    currentTripId = trip.id;

    tracking = true;

    document.getElementById("tripStatus").textContent =
        "🟢 Running";

    document.getElementById("gpsStatus").textContent =
        "Tracking...";

    document.getElementById("startTripBtn").disabled = true;

    document.getElementById("stopTripBtn").disabled = false;
    


    return trip;

}
/* ==========================================================
   GPS ERROR
========================================================== */

function onLocationError(error) {

    console.error(error);

    alert(error.message);

}