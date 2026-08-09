


/* ==========================================================
   ADMIN LIVE TRACKING SERVICE
========================================================== */

/* ==========================================================
   ADMIN LIVE TRACKING STATE
========================================================== */

let map = null;

/*
    Stores references to individual bus markers.
    Used for updating and selecting buses.
*/
const markers = new Map();
const lastServerUpdates = new Map();
const lastDisplayTimes = new Map();
/* ==========================================================
   LOCAL TIME FORMATTER
========================================================== */

/*
 * Converts the current browser time into the same format
 * used by the Driver Live Tracking page.
 */
function getCurrentLocalTime() {

    return new Date().toLocaleTimeString();

}
/* ==========================================================
   GET LOCAL GPS UPDATE TIME
========================================================== */

function getDisplayUpdateTime(trip) {

    const busId = String(trip.bus_id);

    const serverUpdate =
        trip.last_location_update
            ? String(trip.last_location_update)
            : null;


    /*
     * First time this bus appears.
     */
    if (!lastServerUpdates.has(busId)) {

        lastServerUpdates.set(
            busId,
            serverUpdate
        );

        const localTime =
            getCurrentLocalTime();

        lastDisplayTimes.set(
            busId,
            localTime
        );

        return localTime;

    }


    /*
     * Check whether a NEW GPS update
     * has arrived from the backend.
     */
    const previousServerUpdate =
        lastServerUpdates.get(busId);


    if (
        serverUpdate &&
        serverUpdate !== previousServerUpdate
    ) {

        lastServerUpdates.set(
            busId,
            serverUpdate
        );

        const localTime =
            getCurrentLocalTime();

        lastDisplayTimes.set(
            busId,
            localTime

        );

    }


    return (
        lastDisplayTimes.get(busId)
        || "--"
    );

}
/*
    Dedicated Leaflet layer for LIVE BUS MARKERS.

    IMPORTANT:
    Only actual active-bus markers are placed here.

    Therefore we can completely remove every bus marker
    without affecting the base map.
*/
let fleetMarkerLayer = null;

let refreshInterval = null;

/*
    Used to invalidate old admin tracking requests.
*/
let fleetSession = 0;
/* ==========================================================
   CLEAR ALL FLEET MARKERS
========================================================== */

/* ==========================================================
   CLEAR ALL FLEET MARKERS
========================================================== */

function clearFleetMarkers() {

    console.log(
        "Clearing all admin fleet markers..."
    );


    /* ======================================================
       1. CLEAR DEDICATED FLEET MARKER LAYER
    ====================================================== */

    if (fleetMarkerLayer) {

        fleetMarkerLayer.clearLayers();

    }


    /* ======================================================
       2. FORCE REMOVE ANY ORPHANED LEAFLET MARKERS
       
       This handles markers that may have been created by
       an older tracking session or older JavaScript instance.
    ====================================================== */

    if (map) {

        map.eachLayer((layer) => {

            if (layer instanceof L.Marker) {

                console.log(
                    "Removing orphaned fleet marker..."
                );

                map.removeLayer(layer);

            }

        });

    }


    /* ======================================================
       3. CLEAR MARKER REFERENCES
    ====================================================== */

    markers.clear();


    console.log(
        "All admin fleet markers cleared."
    );

}
/* ==========================================================
   INITIALIZE MAP
========================================================== */

export function initializeFleetMap(containerId = "fleetMap") {

        console.log("Initializing Admin Fleet Map...");


        /* ======================================================
        REMOVE EVERYTHING FROM PREVIOUS SESSION
        ====================================================== */

        clearFleetMarkers();


        if (map) {

            map.remove();

            map = null;

        }


        fleetMarkerLayer = null;


    /* ======================================================
       DEFAULT LOCATION
    ====================================================== */

    const DEFAULT_LOCATION = {

        lat: 10.359000,

        lng: 76.286100,

        zoom: 19

    };


    /* ======================================================
       CREATE MAP
    ====================================================== */

    map = L.map(containerId).setView(

        [

            DEFAULT_LOCATION.lat,

            DEFAULT_LOCATION.lng

        ],

        DEFAULT_LOCATION.zoom

    );
    /* ======================================================
    CREATE DEDICATED FLEET MARKER LAYER
    ====================================================== */

    fleetMarkerLayer =
        L.layerGroup().addTo(map);

    /* ======================================================
       OPENSTREETMAP
    ====================================================== */

    L.tileLayer(

        "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",

        {

            attribution:
                "&copy; OpenStreetMap contributors"

        }

    ).addTo(map);


    console.log(
        "Admin Fleet Map initialized successfully."
    );

}
/* ==========================================================
   LOAD LIVE BUSES
========================================================== */

/* ==========================================================
   LOAD LIVE BUSES
========================================================== */

export async function loadLiveTrips(
    session = fleetSession
) {

    const token = localStorage.getItem(
        "bus_tracker_access_token"
    );

    try {

        const response = await fetch(

            "/api/gps/live",

            {

                headers: {

                    Authorization:
                        `Bearer ${token}`

                }

            }

        );


        /* ======================================================
           CHECK WHETHER THIS REQUEST IS STILL VALID
        ====================================================== */

        if (session !== fleetSession) {

            console.log(
                "Ignoring old admin tracking request."
            );

            return;

        }


        if (!response.ok) {

            console.error(
                "Unable to load trips"
            );

            return;

        }


        const trips =
            await response.json();


        /* ======================================================
           CHECK AGAIN AFTER JSON RESPONSE
        ====================================================== */

        if (session !== fleetSession) {

            console.log(
                "Ignoring old admin tracking response."
            );

            return;

        }


        console.log(
            "LIVE RESPONSE:",
            trips
        );


        updateFleet(trips);

    }

    catch (error) {

        console.error(
            "Admin live tracking error:",
            error
        );

    }

}



/* ==========================================================
   START LIVE REFRESH
========================================================== */

/* ==========================================================
   START LIVE REFRESH
========================================================== */

export function startFleetRefresh() {

    /* ======================================================
       CREATE NEW TRACKING SESSION
    ====================================================== */

    fleetSession++;

    const session = fleetSession;


    /* ======================================================
       STOP OLD TIMER
    ====================================================== */

    if (refreshInterval) {

        clearInterval(
            refreshInterval
        );

        refreshInterval = null;

    }


    /* ======================================================
       FIRST LOAD
    ====================================================== */

    loadLiveTrips(session);


    /* ======================================================
       REFRESH EVERY 2 SECONDS
    ====================================================== */

    refreshInterval = setInterval(

        () => {

            loadLiveTrips(session);

        },

        2000

    );

}

/* ==========================================================
   UPDATE FLEET UI
========================================================== */

function updateFleet(trips) {

    /* ======================================================
       MAP MUST EXIST
    ====================================================== */

    if (!map) {

        console.log(
            "Admin fleet map is not active."
        );

        return;

    }


    /* ======================================================
       NORMALIZE API RESPONSE
    ====================================================== */

    if (!Array.isArray(trips)) {

        console.error(
            "Expected array but received:",
            trips
        );

        trips = [];

    }


    console.log(
        "Updating admin fleet:",
        trips
    );


    /* ======================================================
       UPDATE COUNTERS
    ====================================================== */

    const activeBusCount =
        document.getElementById("activeBusCount");

    const onlineDriverCount =
        document.getElementById("onlineDriverCount");


    if (activeBusCount) {

        activeBusCount.textContent =
            trips.length;

    }


    if (onlineDriverCount) {

        onlineDriverCount.textContent =
            trips.length;

    }


    /* ======================================================
       GET TRIP LIST
    ====================================================== */

    const tripList =
        document.getElementById("tripList");


    if (!tripList) {

        return;

    }


    tripList.innerHTML = "";


    /* ======================================================
       NO ACTIVE TRIPS
    ====================================================== */

    if (trips.length === 0) {

        clearFleetMarkers();

        lastServerUpdates.clear();
        lastDisplayTimes.clear();

        tripList.innerHTML = `

            <div class="empty-state">

                No active trips.

            </div>

        `;

        return;

    }


    /* ======================================================
       CURRENT ACTIVE BUS IDS
    ====================================================== */

    const activeBusIds = new Set(

        trips.map(
            trip => String(trip.bus_id)
        )

    );


    /* ======================================================
       REMOVE INACTIVE BUS MARKERS
    ====================================================== */

    markers.forEach(

        (marker, busId) => {

            if (
                !activeBusIds.has(
                    String(busId)
                )
            ) {

                console.log(
                    "Removing inactive bus marker:",
                    busId
                );


                if (fleetMarkerLayer) {

                    fleetMarkerLayer.removeLayer(
                        marker
                    );

                }


                markers.delete(
                    busId
                );

            }

        }

    );


    /* ======================================================
       PROCESS ACTIVE TRIPS
    ====================================================== */

    trips.forEach((trip) => {

        /* ==================================================
           CREATE DISPLAY VALUES
        ================================================== */

        /* ==================================================
        DISPLAY NAMES
        ================================================== */

        const busLabel =
            trip.bus_number
                ? trip.bus_number
                : `BUS-${String(
                    trip.bus_id
                ).padStart(3, "0")}`;


        const driverLabel =
            trip.driver_name
                ? trip.driver_name
                : "Unknown Driver";


        const routeLabel =
            trip.route_name
                ? trip.route_name
                : (
                    trip.route_code
                        ? trip.route_code
                        : `Route ${trip.route_id ?? "--"}`
                );

        const speedLabel =
            trip.speed != null
                ? `${Number(trip.speed).toFixed(1)} km/h`
                : "-- km/h";

        const accuracyLabel =
            trip.accuracy != null
                ? `${Number(trip.accuracy).toFixed(1)} m`
                : "--";


        const updateLabel =
            getDisplayUpdateTime(trip);


        /* ==================================================
           CREATE / UPDATE MARKER
        ================================================== */

        if (
            trip.latitude != null &&
            trip.longitude != null
        ) {

            let marker =
                markers.get(
                    trip.bus_id
                );


            /* ==============================================
               CREATE MARKER
            ============================================== */

            if (!marker) {

                console.log(
                    "Creating marker for:",
                    busLabel
                );


                marker = L.marker([

                    trip.latitude,
                    trip.longitude

                ]).addTo(
                    fleetMarkerLayer
                );


                markers.set(
                    trip.bus_id,
                    marker
                );

            }


            /* ==============================================
               UPDATE POSITION
            ============================================== */

            else {

                marker.setLatLng([

                    trip.latitude,
                    trip.longitude

                ]);

            }


            /* ==============================================
               UPDATE POPUP
            ============================================== */

            marker.bindPopup(`

                <div class="fleet-popup">

                    <strong>
                        ${busLabel}
                    </strong>

                    <br>

                    ${driverLabel}

                    <br>

                    ${routeLabel}

                    <br>

                    Speed :
                    ${speedLabel}

                    <br>

                    Accuracy :
                    ${accuracyLabel}

                    <br>

                    Updated :
                    ${updateLabel}

                </div>

            `);

        }


        /* ==================================================
           CREATE TRIP CARD
        ================================================== */

        const card =
            document.createElement("div");

        card.className =
            "trip-card";


        card.innerHTML = `

            <div class="trip-header">

                <strong>

                    ${busLabel}

                </strong>

                <span class="trip-status">

                    🟢 ${trip.status ?? "Running"}

                </span>

            </div>


            <div class="trip-body">

                <p>

                    Driver :

                    <strong>

                        ${driverLabel}

                    </strong>

                </p>


                <p>

                    Route :

                    <strong>

                        ${routeLabel}

                    </strong>

                </p>


                <p>

                    Speed :

                    <strong>

                        ${speedLabel}

                    </strong>

                </p>


                <p>

                    Accuracy :

                    <strong>

                        ${accuracyLabel}

                    </strong>

                </p>


                <p>

                    Updated :

                    <strong>

                        ${updateLabel}

                    </strong>

                </p>

            </div>

        `;


        /* ==================================================
           CARD CLICK
        ================================================== */

        card.addEventListener(

            "click",

            () => {

                document
                    .querySelectorAll(
                        ".trip-card"
                    )
                    .forEach(

                        c => {

                            c.classList.remove(
                                "selected"
                            );

                        }

                    );


                card.classList.add(
                    "selected"
                );


                const marker =
                    markers.get(
                        trip.bus_id
                    );


                if (!marker || !map) {

                    return;

                }


                map.flyTo(

                    marker.getLatLng(),

                    18,

                    {

                        animate: true,

                        duration: 1

                    }

                );


                marker.openPopup();

            }

        );


        tripList.appendChild(
            card
        );

    });

}
/* ==========================================================
   CLEANUP ADMIN LIVE TRACKING
========================================================== */

export function cleanupFleetTracking() {

    console.log(
        "=========================================="
    );

    console.log(
        "ADMIN TRACKING CLEANUP"
    );

    console.log(
        "=========================================="
    );


    /* ======================================================
       INVALIDATE OLD API REQUESTS
    ====================================================== */

    fleetSession++;


    /* ======================================================
       STOP REFRESH TIMER
    ====================================================== */

    if (refreshInterval !== null) {

        clearInterval(
            refreshInterval
        );

        refreshInterval = null;

    }


    /* ======================================================
       REMOVE ALL FLEET MARKERS
    ====================================================== */

    clearFleetMarkers();
    lastServerUpdates.clear();
    lastDisplayTimes.clear();


    /* ======================================================
       REMOVE FLEET MARKER LAYER
    ====================================================== */

    if (fleetMarkerLayer) {

        fleetMarkerLayer.clearLayers();

        fleetMarkerLayer = null;

    }


    /* ======================================================
       REMOVE MAP
    ====================================================== */

    if (map) {

        map.remove();

        map = null;

    }


    console.log(
        "Admin tracking cleanup completed."
    );

}