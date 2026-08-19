


/* ==========================================================
   ADMIN LIVE TRACKING SERVICE
========================================================== */

import { request } from "/static/common/api.js";
import { Modal } from "/static/common/modal.js";
import { escapeHtml } from "/static/common/security.js";

/* ==========================================================
   ADMIN LIVE TRACKING STATE
========================================================== */

let map = null;

const markers = new Map();
const lastServerUpdates = new Map();
const lastDisplayTimes = new Map();

/* ==========================================================
   BUS HEADING STATE
========================================================== */

/*
    Stores the previous GPS position of every bus.

    We use the previous and current coordinates to calculate
    the direction in which the bus is travelling.
*/
const previousBusPositions = new Map();

/*
    Stores the current visual heading of every bus.

    This allows us to smoothly rotate the bus instead of
    snapping directly to a new angle.
*/
const busHeadings = new Map();

/* ==========================================================
   SMOOTH MARKER ANIMATION
========================================================== */

/*
    Stores the active animation frame for each bus.

    Each bus gets its own animation so multiple buses can
    move smoothly at the same time.
*/
const markerAnimations = new Map();



/*
    Stores the currently selected bus.

    Only this bus will automatically keep the map centered
    while it moves.
*/
let selectedBusId = null;

/*
    Controls whether the map should follow the selected bus.
*/
let followSelectedBus = false;

/*
    Prevents our own automatic map movement from being
    interpreted as manual user interaction.

    When the map moves because the selected bus is being
    followed,
    this becomes true temporarily.
*/
let isAutoFollowing = false;
let hasFittedFleetMap = false;
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

    if (!trip.last_location_update) return "No GPS timestamp";

    const timestamp = new Date(trip.last_location_update);

    if (Number.isNaN(timestamp.getTime())) {

        return String(trip.last_location_update);

    }

    return new Intl.DateTimeFormat(undefined, {

        dateStyle: "medium",

        timeStyle: "medium",

    }).format(timestamp);

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
let visibilityRefreshHandler = null;

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
    CANCEL ALL BUS ANIMATIONS
    ====================================================== */

    markerAnimations.forEach(
        (animationId) => {

            cancelAnimationFrame(
                animationId
            );

        }
    );

    markerAnimations.clear();
    previousBusPositions.clear();

    busHeadings.clear();

    /*
        Reset selection state.
    */
    selectedBusId = null;

    followSelectedBus = false;

    isAutoFollowing = false;
    /* ======================================================
       3. CLEAR MARKER REFERENCES
    ====================================================== */

    markers.clear();


    console.log(
        "All admin fleet markers cleared."  
    );

}
/* ==========================================================
   BUS MARKER ICON
========================================================== */

/*
    Creates the custom bus marker used on the live map.

    The outer wrapper is intentionally kept separate from
    the bus visual. This allows us to rotate the bus later
    according to its travel direction without changing the
    marker itself.
*/

/* ==========================================================
   PREMIUM BUS MARKER ICON
========================================================== */

/*
    Creates the top-down BusTrack vehicle marker.

    IMPORTANT:
    The bus is naturally facing NORTH / UP.

    Later, the entire .bus-marker-visual element can be
    rotated according to the GPS bearing.
*/

function createBusMarkerIcon() {

    return L.divIcon({

        className: "bus-marker",

        html: `

            <div class="bus-marker-visual">

                <svg
                    class="bus-marker-icon"
                    viewBox="0 0 64 88"
                    xmlns="http://www.w3.org/2000/svg"
                    aria-hidden="true"
                >

                    <!-- ==================================
                         SOFT VEHICLE SHADOW
                    =================================== -->

                    <rect
                        x="8"
                        y="5"
                        width="48"
                        height="78"
                        rx="14"
                        fill="rgba(0,0,0,0.28)"
                        transform="translate(0 3)"
                    />


                    <!-- ==================================
                         MAIN BUS BODY
                    =================================== -->

                    <rect
                        x="8"
                        y="4"
                        width="48"
                        height="78"
                        rx="14"
                        fill="#1688D8"
                        stroke="#E8F7FF"
                        stroke-width="2"
                    />


                    <!-- ==================================
                         FRONT CAP
                    =================================== -->

                    <path
                        d="
                            M 13 18
                            Q 13 8 22 8
                            L 42 8
                            Q 51 8 51 18
                            Z
                        "
                        fill="#0C6FB5"
                    />


                    <!-- ==================================
                         FRONT WINDSHIELD
                    =================================== -->

                    <path
                        d="
                            M 17 13
                            Q 17 10 21 10
                            L 43 10
                            Q 47 10 47 13
                            L 47 25
                            L 17 25
                            Z
                        "
                        fill="#0A2942"
                    />


                    <!-- Windshield reflection -->

                    <path
                        d="
                            M 19 12
                            L 29 12
                            L 22 22
                            L 18 22
                            Z
                        "
                        fill="#78D7FF"
                        opacity=".45"
                    />


                    <!-- ==================================
                         FRONT LIGHTS
                    =================================== -->

                    <rect
                        x="12"
                        y="17"
                        width="4"
                        height="8"
                        rx="2"
                        fill="#F8FDFF"
                    />

                    <rect
                        x="48"
                        y="17"
                        width="4"
                        height="8"
                        rx="2"
                        fill="#F8FDFF"
                    />


                    <!-- ==================================
                         SIDE WINDOWS
                    =================================== -->

                    <rect
                        x="16"
                        y="29"
                        width="32"
                        height="13"
                        rx="3"
                        fill="#123B59"
                    />

                    <line
                        x1="26.7"
                        y1="29"
                        x2="26.7"
                        y2="42"
                        stroke="#4E91B8"
                        stroke-width="1"
                    />

                    <line
                        x1="37.3"
                        y1="29"
                        x2="37.3"
                        y2="42"
                        stroke="#4E91B8"
                        stroke-width="1"
                    />


                    <!-- ==================================
                         LOWER WINDOWS
                    =================================== -->

                    <rect
                        x="16"
                        y="46"
                        width="32"
                        height="13"
                        rx="3"
                        fill="#123B59"
                    />

                    <line
                        x1="26.7"
                        y1="46"
                        x2="26.7"
                        y2="59"
                        stroke="#4E91B8"
                        stroke-width="1"
                    />

                    <line
                        x1="37.3"
                        y1="46"
                        x2="37.3"
                        y2="59"
                        stroke="#4E91B8"
                        stroke-width="1"
                    />


                    <!-- ==================================
                         CENTER BODY DETAIL
                    =================================== -->

                    <rect
                        x="18"
                        y="63"
                        width="28"
                        height="4"
                        rx="2"
                        fill="#0D6DAE"
                    />


                    <!-- ==================================
                         REAR LIGHTS
                    =================================== -->

                    <rect
                        x="13"
                        y="70"
                        width="5"
                        height="6"
                        rx="2"
                        fill="#FF5C5C"
                    />

                    <rect
                        x="46"
                        y="70"
                        width="5"
                        height="6"
                        rx="2"
                        fill="#FF5C5C"
                    />


                    <!-- ==================================
                         WHEELS
                    =================================== -->

                    <rect
                        x="4"
                        y="27"
                        width="7"
                        height="14"
                        rx="3"
                        fill="#111827"
                    />

                    <rect
                        x="53"
                        y="27"
                        width="7"
                        height="14"
                        rx="3"
                        fill="#111827"
                    />

                    <rect
                        x="4"
                        y="58"
                        width="7"
                        height="14"
                        rx="3"
                        fill="#111827"
                    />

                    <rect
                        x="53"
                        y="58"
                        width="7"
                        height="14"
                        rx="3"
                        fill="#111827"
                    />


                    <!-- ==================================
                         CENTER IDENTIFIER
                    =================================== -->

                    <circle
                        cx="32"
                        cy="68"
                        r="2.5"
                        fill="#FFFFFF"
                        opacity=".9"
                    />

                </svg>

            </div>

        `,

        iconSize: [
            54,
            74
        ],

        iconAnchor: [
            27,
            37
        ],

        popupAnchor: [
            0,
            -37
        ]

    });

}
/* ==========================================================
   CALCULATE GPS BEARING
========================================================== */

/*
    Calculates the geographic bearing between two GPS
    coordinates.

    Bearing:

        0°   = North
        90°  = East
        180° = South
        270° = West
*/
function calculateBearing(
    startLatitude,
    startLongitude,
    endLatitude,
    endLongitude
) {

    const startLat =
        startLatitude * Math.PI / 180;

    const endLat =
        endLatitude * Math.PI / 180;

    const longitudeDifference =
        (
            endLongitude -
            startLongitude
        ) * Math.PI / 180;


    const y =
        Math.sin(longitudeDifference) *
        Math.cos(endLat);


    const x =
        Math.cos(startLat) *
        Math.sin(endLat) -
        Math.sin(startLat) *
        Math.cos(endLat) *
        Math.cos(longitudeDifference);


    let bearing =
        Math.atan2(y, x) *
        180 / Math.PI;


    /*
        Convert negative bearings into the
        standard 0°–360° range.
    */
    bearing =
        (bearing + 360) % 360;


    return bearing;

}
/* ==========================================================
   SMOOTH HEADING INTERPOLATION
========================================================== */

/*
    Returns the shortest angular distance between two headings.

    Example:

        359° → 1°

    becomes:

        359° → 360° → 1°

    instead of rotating backwards through 180°.
*/
function getShortestAngleDifference(
    startAngle,
    endAngle
) {

    return (
        (
            endAngle -
            startAngle +
            540
        ) % 360
    ) - 180;

}


/*
    Interpolates between two headings using the shortest
    possible rotation path.
*/
function interpolateHeading(
    startAngle,
    endAngle,
    progress
) {

    const difference =
        getShortestAngleDifference(
            startAngle,
            endAngle
        );


    return (
        startAngle +
        difference * progress
    ) % 360;

}
/* ==========================================================
   SMOOTH BUS MARKER ANIMATION
========================================================== */

function animateBusMarker(
    marker,
    targetLatitude,
    targetLongitude,
    busId,
    targetHeading = null
) {

    if (!marker || !map) return;

    const currentPosition =
        marker.getLatLng();

    const startLatitude =
        currentPosition.lat;

    const startLongitude =
        currentPosition.lng;

    const startTime =
        performance.now();

    /*
        The admin refresh currently runs every 2 seconds.

        1800 ms gives the marker enough time to smoothly
        travel toward the next GPS position before the next
        server update normally arrives.
    */
    const duration = 1800;

    /*
        Cancel the previous animation for this bus.

        This is important when a new GPS update arrives before
        the previous animation has completely finished.
    */
    const previousAnimation =
        markerAnimations.get(String(busId));

    if (previousAnimation) {

        cancelAnimationFrame(
            previousAnimation
        );

    }

    function animate(currentTime) {

        /*
            If the map or marker was destroyed while the
            animation was running, stop immediately.
        */
        if (!map || !marker) {

            markerAnimations.delete(
                String(busId)
            );

            return;

        }

        const elapsed =
            currentTime - startTime;

        let progress =
            elapsed / duration;

        /*
            Keep progress between 0 and 1.
        */
        progress =
            Math.min(
                Math.max(progress, 0),
                1
            );

        /*
            Ease-in-out movement.

            This prevents the bus from starting and stopping
            abruptly.
        */
        const easedProgress =
            progress < 0.5
                ? 2 * progress * progress
                : 1 -
                  Math.pow(
                      -2 * progress + 2,
                      2
                  ) / 2;

        /*
            Calculate the current interpolated position.
        */
        const latitude =
            startLatitude +
            (
                targetLatitude -
                startLatitude
            ) * easedProgress;

        const longitude =
            startLongitude +
            (
                targetLongitude -
                startLongitude
            ) * easedProgress;


        /*
            Move the marker.
        */
        marker.setLatLng([
            latitude,
            longitude
        ]);
        /* ==================================================
        SMOOTH BUS ROTATION
        ================================================== */

        if (targetHeading !== null) {

            const currentHeading =
                busHeadings.has(String(busId))
                    ? busHeadings.get(String(busId))
                    : targetHeading;


            const heading =
                interpolateHeading(
                    currentHeading,
                    targetHeading,
                    easedProgress
                );


            const visual =
                marker
                    .getElement()
                    ?.querySelector(
                        ".bus-marker-visual"
                    );


            if (visual) {

                visual.style.transform =
                    `rotate(${heading}deg)`;

            }


            /*
                Save the current visual heading continuously.

                This is important because a new GPS update can arrive
                before the current animation has completely finished.
                The next animation will then start from the actual
                visible heading instead of an older heading.
            */
            busHeadings.set(
                String(busId),
                heading
            );

        }


        /* ==================================================
        FOLLOW SELECTED BUS
        ================================================== */

        if (
            followSelectedBus &&
            selectedBusId !== null &&
            String(selectedBusId) === String(busId)
        ) {

            /*
                Tell the map interaction handler that this movement
                is being caused by automatic bus following.

                Therefore our own map movement will not switch the
                application into manual mode.
            */
            isAutoFollowing = true;


            map.setView(

                [
                    latitude,
                    longitude
                ],

                map.getZoom(),

                {
                    animate: false
                }

            );


            /*
                Return control to normal user interaction handling
                on the next rendering frame.
            */
            requestAnimationFrame(() => {

                isAutoFollowing = false;

            });

        }

        /*
            Continue animation.
        */
        if (progress < 1) {

            const animationId =
                requestAnimationFrame(
                    animate
                );

            markerAnimations.set(
                String(busId),
                animationId
            );

        } else {

            /*
                Guarantee the final GPS position is exact.
            */
            marker.setLatLng([
                targetLatitude,
                targetLongitude
            ]);

            markerAnimations.delete(
                String(busId)
            );




        }

    }

    const animationId =
        requestAnimationFrame(
            animate
        );

    markerAnimations.set(
        String(busId),
        animationId
    );

}
/* ==========================================================
   INITIALIZE MAP
========================================================== */

export function initializeFleetMap(
    containerId = "fleetMap"
) {

    console.log(
        "Initializing Admin Fleet Map..."
    );


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

        lat: 20.5937,

        lng: 78.9629,

        zoom: 5

    };


    /* ======================================================
       CREATE LEAFLET MAP FIRST
    ====================================================== */

    map = L.map(
        containerId
    ).setView(

        [
            DEFAULT_LOCATION.lat,
            DEFAULT_LOCATION.lng
        ],

        DEFAULT_LOCATION.zoom

    );


    /* ======================================================
       MANUAL MAP INTERACTION HANDLER
    ====================================================== */

    /*
        If the admin manually interacts with the map while
        a bus is being followed, switch to manual mode.

        The selected bus remains selected.

        Clicking an Active Trip again will restore
        automatic following.
    */

    const stopAutomaticFollowing = () => {

        /*
            Ignore map interaction caused by BusTrack's
            own automatic-following movement.
        */
        if (isAutoFollowing) {

            return;

        }


        /*
            Admin manually interacted with the map.

            Disable automatic following.
        */
        if (followSelectedBus) {

            console.log(
                "Admin manually interacted with map."
            );

            console.log(
                "Switching to manual map mode."
            );

            followSelectedBus = false;

        }

    };


    /* ======================================================
       REGISTER MAP EVENTS
    ====================================================== */

    /*
        IMPORTANT:
        The map already exists at this point.
    */

    map.on(
        "dragstart",
        stopAutomaticFollowing
    );


    map.on(
        "zoomstart",
        stopAutomaticFollowing
    );


    map.on(
        "touchstart",
        stopAutomaticFollowing
    );


    /* ======================================================
       CREATE FLEET MARKER LAYER
    ====================================================== */

    fleetMarkerLayer =
        L.layerGroup().addTo(map);


    /* ======================================================
       OPENSTREETMAP TILE LAYER
    ====================================================== */

    L.tileLayer(

        "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",

        {

            attribution:
                "&copy; OpenStreetMap contributors"

        }

    ).addTo(map);


    /* ======================================================
       MAP READY
    ====================================================== */

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

        const headers = {
            Authorization: `Bearer ${token}`
        };
        const [response, busesResponse] = await Promise.all([
            fetch("/api/gps/live", { headers }),
            fetch("/api/buses/", { headers }),
        ]);


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
        const buses = busesResponse.ok
            ? await busesResponse.json()
            : [];


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


        updateFleet(trips, buses);

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

    if (visibilityRefreshHandler) {

        document.removeEventListener(
            "visibilitychange",
            visibilityRefreshHandler
        );

        visibilityRefreshHandler = null;

    }


    /* ======================================================
       FIRST LOAD
    ====================================================== */

    loadLiveTrips(session);


    /* ======================================================
       REFRESH EVERY 20 SECONDS
    ====================================================== */

    refreshInterval = setInterval(

        () => {

            loadLiveTrips(session);

        },

        20000

    );

    // A user returning to the tab should see the newest saved GPS reading
    // immediately, rather than waiting for the next 20-second UI refresh.
    visibilityRefreshHandler = () => {

        if (document.visibilityState === "visible") {

            loadLiveTrips(session);

        }

    };

    document.addEventListener(
        "visibilitychange",
        visibilityRefreshHandler
    );

}


/* ==========================================================
   ADMIN TRIP RECOVERY
========================================================== */

function endTripAsAdmin(trip, action) {

    if (!trip?.trip_id) return;

    const actionLabel = action === "Cancelled" ? "Cancel driver trip" : "Stop driver tracking";

    Modal.form({
        eyebrow: "ADMIN RECOVERY",
        title: `${actionLabel}?`,
        subtitle: "This ends the driver's live trip and mobile tracking immediately. Vehicle GPS from the provider can remain visible and is managed separately.",
        content: `<div class="modal-group modal-group-full"><label class="modal-label" for="admin-trip-end-reason">Reason (optional)</label><textarea class="modal-textarea" id="admin-trip-end-reason" rows="4" maxlength="300" placeholder="For example: trip started accidentally"></textarea></div>`,
        submitText: actionLabel,
        onSubmit: async () => {
            const reason = document.querySelector("#admin-trip-end-reason")?.value.trim() || null;
            try {
                await request(`/gps/admin/trips/${trip.trip_id}/end`, {
                    method: "POST",
                    body: JSON.stringify({ action, reason }),
                });
                Modal.close();
                await loadLiveTrips(fleetSession);
                Modal.success({
                    title: action === "Cancelled" ? "Driver trip cancelled" : "Driver tracking stopped",
                    subtitle: "The driver trip has ended. The driver may start another trip when needed. A provider GPS card may remain visible for the bus.",
                });
            } catch (error) {
                Modal.error({ title: `${actionLabel} failed`, subtitle: error.message });
            }
        },
    });
}

/* ==========================================================
   UPDATE FLEET UI
========================================================== */

function updateFleet(trips, buses = []) {

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

        appendWaitingBusCards(tripList, buses);

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

                /*
                    Stop any animation belonging to this bus.
                */
                const animationId =
                    markerAnimations.get(
                        String(busId)
                    );

                if (animationId) {

                    cancelAnimationFrame(
                        animationId
                    );

                    markerAnimations.delete(
                        String(busId)
                    );

                }

                /*
                    If the removed bus was selected,
                    clear the follow state.
                */
                if (
                    selectedBusId !== null &&
                    String(selectedBusId) === String(busId)
                ) {

                    selectedBusId = null;

                    followSelectedBus = false;

                }

                markers.delete(
                    busId
                );
                previousBusPositions.delete(
                    String(busId)
                );

                busHeadings.delete(
                    String(busId)
                );

            }

        }

    );


    /* ======================================================
       PROCESS ACTIVE TRIPS
    ====================================================== */

    trips.forEach((trip) => {

        const isActiveTrip =
            trip.is_active_trip === true ||
            Boolean(trip.trip_id);

        /* ==================================================
           CREATE DISPLAY VALUES
        ================================================== */

        /* ==================================================
        DISPLAY NAMES
        ================================================== */

        const busLabel =
            trip.registration_number
                ? trip.registration_number
                : trip.bus_number
                ? trip.bus_number
                : `BUS-${String(
                    trip.bus_id
                ).padStart(3, "0")}`;


        const driverLabel =
            isActiveTrip
                ? (
                    trip.driver_name
                        ? trip.driver_name
                        : "Driver assignment unavailable"
                )
                : "Not running";


        const routeLabel =
            trip.route_name
                ? trip.route_name
                : (
                    trip.route_code
                        ? trip.route_code
                        : (isActiveTrip ? "Route assignment unavailable" : "No route assignment")
                );

        const providerGPS = trip.provider_gps || null;
        const ignitionLabel = providerGPS?.ignition === true
            ? "Ignition on"
            : providerGPS?.ignition === false
                ? "Ignition off"
                : null;
        const gpsStatus = providerGPS
            ? (providerGPS.is_fresh ? (ignitionLabel || "GPS reported") : "GPS signal stale")
            : (isActiveTrip ? "Driver tracking" : "Awaiting GPS");
        const statusLabel = isActiveTrip ? (trip.status ?? "Running") : gpsStatus;
        const statusClass = providerGPS?.is_fresh === false
            ? "stale"
            : providerGPS?.ignition === false
                ? "off"
                : "on";
        const tripControls = isActiveTrip ? `
            <div class="trip-admin-actions" aria-label="Administrator trip actions">
                <button type="button" class="trip-admin-button stop" data-stop-trip="${trip.trip_id}">Stop driver tracking</button>
                <button type="button" class="trip-admin-button cancel" data-cancel-trip="${trip.trip_id}">Cancel driver trip</button>
            </div>` : "";

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


                marker = L.marker(

                    [

                        Number(trip.latitude),

                        Number(trip.longitude)

                    ],

                    {

                        icon: createBusMarkerIcon()

                    }

                ).addTo(
                    fleetMarkerLayer
                );

                markers.set(
                    trip.bus_id,
                    marker
                );
                /* ==================================================
                STORE INITIAL GPS POSITION
                ================================================== */

                previousBusPositions.set(

                    String(trip.bus_id),

                    {

                        latitude:
                            Number(trip.latitude),

                        longitude:
                            Number(trip.longitude)

                    }

                );

            }



            /* ==============================================
            UPDATE POSITION SMOOTHLY
            ============================================== */

            else {

                /* ==================================================
                CURRENT GPS POSITION
                ================================================== */

                const latitude =
                    Number(trip.latitude);

                const longitude =
                    Number(trip.longitude);

                const busKey =
                    String(trip.bus_id);


                /* ==================================================
                PREVIOUS GPS POSITION
                ================================================== */

                const previousPosition =
                    previousBusPositions.get(
                        busKey
                    );


                let targetHeading = null;


                /* ==================================================
                CALCULATE BUS DIRECTION
                ================================================== */

                if (previousPosition) {

                    const latitudeDifference =
                        latitude -
                        previousPosition.latitude;

                    const longitudeDifference =
                        longitude -
                        previousPosition.longitude;


                    /*
                        Calculate how much the GPS position changed.

                        Very tiny changes are normally GPS noise.
                    */
                    const movement =
                        Math.sqrt(

                            (
                                latitudeDifference *
                                latitudeDifference
                            ) +

                            (
                                longitudeDifference *
                                longitudeDifference
                            )

                        );


                    /*
                        Only calculate a new heading when the bus has
                        actually moved a meaningful distance.
                    */
                    if (movement > 0.00001) {

                        targetHeading =
                            calculateBearing(

                                previousPosition.latitude,

                                previousPosition.longitude,

                                latitude,

                                longitude

                            );

                    }

                }


                /* ==================================================
                SAVE CURRENT GPS POSITION
                ================================================== */

                previousBusPositions.set(

                    busKey,

                    {

                        latitude,

                        longitude

                    }

                );


                /* ==================================================
                MOVE + ROTATE BUS
                ================================================== */

                animateBusMarker(

                    marker,

                    latitude,

                    longitude,

                    trip.bus_id,

                    targetHeading

                );

            }


            /* ==============================================
               UPDATE POPUP
            ============================================== */

            marker.bindPopup(`

                <div class="fleet-popup">

                    <strong>
                        ${escapeHtml(busLabel)}
                    </strong>

                    <br>

                    ${escapeHtml(driverLabel)}

                    <br>

                    ${escapeHtml(routeLabel)}

                    <br>

                    Speed :
                    ${escapeHtml(speedLabel)}

                    <br>

                    Accuracy :
                    ${escapeHtml(accuracyLabel)}

                    <br>

                    GPS status :
                    ${escapeHtml(gpsStatus)}

                    <br>

                    Updated :
                    ${escapeHtml(updateLabel)}

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

        if (
            selectedBusId !== null &&
            String(selectedBusId) === String(trip.bus_id)
        ) {

            card.classList.add(
                "selected"
            );

        }


        card.innerHTML = `

            <div class="trip-header">

                <strong>

                    ${escapeHtml(busLabel)}

                </strong>

                <span class="trip-status">

                    <span class="trip-status-dot ${statusClass}" aria-hidden="true"></span>
                    ${escapeHtml(statusLabel)}

                </span>

            </div>


            <div class="trip-body">

                <p>

                    GPS status :

                    <strong>

                        ${escapeHtml(gpsStatus)}

                    </strong>

                </p>

                <p>

                    ${isActiveTrip ? "Driver" : "Driver tracking"} :

                    <strong>

                        ${escapeHtml(driverLabel)}

                    </strong>

                </p>


                <p>

                    Route :

                    <strong>

                        ${escapeHtml(routeLabel)}

                    </strong>

                </p>


                <p>

                    Speed :

                    <strong>

                        ${escapeHtml(speedLabel)}

                    </strong>

                </p>


                <p>

                    Accuracy :

                    <strong>

                        ${escapeHtml(accuracyLabel)}

                    </strong>

                </p>


                <p>

                    Updated :

                    <strong>

                        ${escapeHtml(updateLabel)}

                    </strong>

                </p>

            </div>

            ${tripControls}

        `;

        card.querySelector("[data-stop-trip]")?.addEventListener("click", (event) => {
            event.stopPropagation();
            endTripAsAdmin(trip, "Stopped");
        });
        card.querySelector("[data-cancel-trip]")?.addEventListener("click", (event) => {
            event.stopPropagation();
            endTripAsAdmin(trip, "Cancelled");
        });


        /* ==================================================
           CARD CLICK
        ================================================== */

        /* ==================================================
        CARD CLICK
        ================================================== */

        card.addEventListener(

            "click",

            () => {

                /*
                    Store the selected bus globally.

                    This allows the selection to survive the
                    2-second fleet refresh.
                */
                /* ==================================================
                SELECT BUS
                ================================================== */

                selectedBusId =
                    trip.bus_id;


                /*
                    Selecting an Active Trip always returns the map
                    to automatic-follow mode.
                */
                followSelectedBus = true;


                /*
                    The following map movement will be initiated by
                    BusTrack itself.
                */
                isAutoFollowing = true;


                /* ==================================================
                UPDATE CARD SELECTION
                ================================================== */

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


                /* ==================================================
                GET BUS MARKER
                ================================================== */

                const marker =
                    markers.get(
                        trip.bus_id
                    );


                if (!marker || !map) {

                    return;

                }


                /* ==================================================
                CENTER MAP ON SELECTED BUS
                ================================================== */

                const busLocation = marker.getLatLng();

                // A dashboard reflow or an iPhone orientation change can
                // leave Leaflet with an outdated container size. Recalculate
                // it before positioning, then place the selected bus exactly
                // at the centre of the visible map.
                map.invalidateSize({ animate: false, pan: false });
                map.setView(
                    busLocation,
                    17,
                    { animate: true, duration: 0.45 }
                );

                requestAnimationFrame(() => {

                    isAutoFollowing = false;

                });

                /* ==================================================
                OPEN BUS INFORMATION
                ================================================== */

                marker.openPopup();

            }

        );


        tripList.appendChild(
            card
        );

    });

    appendWaitingBusCards(tripList, buses, activeBusIds);

    /* On first load, frame the map around only the GPS positions that were
       actually returned by the backend. A selected card keeps control of the
       map afterwards. */
    if (!hasFittedFleetMap && selectedBusId === null && markers.size > 0 && map) {
        const positions = [...markers.values()].map(marker => marker.getLatLng());
        if (positions.length === 1) {
            map.setView(positions[0], 15);
        } else {
            map.fitBounds(L.latLngBounds(positions), { padding: [36, 36], maxZoom: 15 });
        }
        hasFittedFleetMap = true;
    }

    if (!Array.isArray(buses)) {

        buses = [];

    }

}
function appendWaitingBusCards(tripList, buses, activeBusIds = new Set()) {

    const waitingBuses = buses.filter(
        (bus) => !activeBusIds.has(String(bus.id))
    );

    if (waitingBuses.length === 0 && activeBusIds.size === 0) {

        tripList.innerHTML = `
            <div class="empty-state">
                No buses have been added to the fleet yet.
            </div>
        `;

        return;

    }

    waitingBuses.forEach((bus) => {

        const card = document.createElement("div");
        card.className = "trip-card trip-card-unavailable";
        const gpsMessage = bus.device_id
            ? "Waiting for the first GPS report"
            : "GPS device not configured";

        card.innerHTML = `
            <div class="trip-header">
                <strong>${escapeHtml(bus.bus_number || bus.registration_number || `BUS-${bus.id}`)}</strong>
                <span class="trip-status">
                    <span class="trip-status-dot off" aria-hidden="true"></span>
                    GPS unavailable
                </span>
            </div>
            <div class="trip-body">
                <p>Registration: <strong>${escapeHtml(bus.registration_number || "Not set")}</strong></p>
                <p>Tracker: <strong>${escapeHtml(gpsMessage)}</strong></p>
                <p>Fleet status: <strong>${escapeHtml(bus.status || "Active")}</strong></p>
            </div>
        `;

        tripList.appendChild(card);

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
    /*
        Cancel every active marker animation.
    */
    markerAnimations.forEach(
        (animationId) => {

            cancelAnimationFrame(
                animationId
            );

        }
    );

    markerAnimations.clear();

    previousBusPositions.clear();

    busHeadings.clear();

    selectedBusId = null;

    followSelectedBus = false;

    isAutoFollowing = false;

    hasFittedFleetMap = false;

    
    /* ======================================================
       STOP REFRESH TIMER
    ====================================================== */

    if (refreshInterval !== null) {

        clearInterval(
            refreshInterval
        );

        refreshInterval = null;

    }

    if (visibilityRefreshHandler) {

        document.removeEventListener(
            "visibilitychange",
            visibilityRefreshHandler
        );

        visibilityRefreshHandler = null;

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
