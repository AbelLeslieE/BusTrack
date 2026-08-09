


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
   UPDATE MAP
========================================================== */

/* ==========================================================
   UPDATE FLEET UI
========================================================== */

/* ==========================================================
   UPDATE FLEET UI
========================================================== */

/* ==========================================================
   UPDATE FLEET UI
========================================================== */

/* ==========================================================
   UPDATE FLEET UI
========================================================== */

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
        document.getElementById(
            "activeBusCount"
        );

    const onlineDriverCount =
        document.getElementById(
            "onlineDriverCount"
        );


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
        document.getElementById(
            "tripList"
        );


    if (!tripList) {

        return;

    }


    tripList.innerHTML = "";


    /* ======================================================
    NO ACTIVE TRIPS
    ====================================================== */

    if (trips.length === 0) {

        console.log(
            "No active trips."
        );

        console.log(
            "Removing every fleet marker from map."
        );


        /* ==================================================
        REMOVE ALL BUS MARKERS
        ================================================== */

        clearFleetMarkers();


        /* ==================================================
        UPDATE UI
        ================================================== */

        tripList.innerHTML = `

            <div class="empty-state">

                No active trips.

            </div>

        `;


        return;

    }


    /* ======================================================
       GET CURRENT ACTIVE BUS IDS
    ====================================================== */

    const activeBusIds = new Set(

        trips.map(

            trip => String(trip.bus_id)

        )

    );


    /* ======================================================
       REMOVE MARKERS THAT ARE NO LONGER ACTIVE
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


                /* ==========================================
                Remove marker from fleet layer
                ========================================== */

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

        if (
            trip.latitude == null ||
            trip.longitude == null
        ) {

            return;

        }


        /* ==================================================
           CREATE / UPDATE MARKER
        ================================================== */

        let marker =
            markers.get(
                trip.bus_id
            );


        if (!marker) {

            console.log(
                "Creating marker for:",
                trip.bus_id
            );


            marker = L.marker(

                [

                    trip.latitude,

                    trip.longitude

                ]

            ).addTo(
                fleetMarkerLayer
            );

            markers.set(

                trip.bus_id,

                marker

            );

        }

        else {

            marker.setLatLng(

                [

                    trip.latitude,

                    trip.longitude

                ]

            );

        }


        /* ==================================================
           UPDATE POPUP
        ================================================== */

        marker.bindPopup(`

            <strong>

                BUS-${String(
                    trip.bus_id
                ).padStart(3, "0")}

            </strong>

            <br>

            Driver :
            ${trip.driver_id ?? "--"}

            <br>

            Route :
            ${trip.route_id ?? "--"}

            <br>

            Speed :
            ${trip.speed ?? "--"} km/h

        `);


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

                    BUS-${String(
                        trip.bus_id
                    ).padStart(3, "0")}

                </strong>

                <span class="trip-status">

                    🟢 ${trip.status ?? "Running"}

                </span>

            </div>


            <div class="trip-body">

                <p>

                    Driver ID :

                    <strong>

                        ${trip.driver_id ?? "--"}

                    </strong>

                </p>


                <p>

                    Route :

                    <strong>

                        ${trip.route_id ?? "--"}

                    </strong>

                </p>


                <p>

                    Speed :

                    <strong>

                        ${trip.speed ?? "--"} km/h

                    </strong>

                </p>


                <p>

                    Updated :

                    <strong>

                        ${
                            trip.last_location_update

                            ? new Date(
                                trip.last_location_update
                              ).toLocaleTimeString()

                            : "--"
                        }

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