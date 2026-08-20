/* ==========================================================
   BUSTRACK
   STUDENT PORTAL
   LIVE TRACKING MODULE
   ========================================================== */


/* ==========================================================
   CONFIGURATION
========================================================== */

import { animateVehicleMarker, snapVehicleMarkerToRoad } from "/static/common/vehicleMotion.js?v=road-safe-6";
import { createVehicleMarkerIcon } from "/static/common/vehicleMarker.js";
import { Modal } from "/static/common/modal.js";

const API = {

    STUDENT:
        "/api/students/me",

    TRACKING:
        "/api/students/me/tracking"

};


/* ==========================================================
   MODULE STATE
========================================================== */

const state = {

    student: null,

    assignedBus: null,

    liveTrip: null,

    loading: true,

    error: null,

    map: null,

    busMarker: null,

    busMotion: { heading: null, frame: null, followMap: true },

    busTargetLocation: null,

    stopMarkers: [],

    routeLine: null,

    roadRoute: [],

    roadRouteDistance: 0,

    roadRouteLoaded: false,

    roadRouteRequestId: 0,

    roadRouteDuration: 0,

    etaDistanceMeters: null,

    etaMinutes: null,

    etaLoading: false,

    etaRequestId: 0,

    etaOrigin: null,

    etaDestinationId: null,

    etaLastCalculatedAt: 0,

    refreshTimer: null,

    refreshInProgress: false,

    refreshRequestId: 0,

    lifecycleId: 0,

    visibilityHandler: null,

    routeDirection: null,

    routeDefinitionKey: null,

    terminalNoticeKey: null

};


/* ==========================================================
   AUTHENTICATED FETCH
========================================================== */

async function fetchAuthenticated(
    url
) {

    const token =
        localStorage.getItem(
            "bus_tracker_access_token"
        );


    if (!token) {

        throw new Error(
            "Authentication session not found."
        );

    }


    const response =
        await fetch(
            url,
            {

                method: "GET",

                cache: "no-store",

                headers: {

                    "Authorization":
                        `Bearer ${token}`,

                    "Accept":
                        "application/json"

                }

            }
        );


    if (!response.ok) {

        let message =
            "Unable to load tracking information.";


        try {

            const error =
                await response.json();

            message =
                error.detail ||
                message;

        }

        catch {

            // Keep default message.

        }


        throw new Error(
            message
        );

    }


    return await response.json();

}


/* ==========================================================
   HTML ESCAPE
========================================================== */

function escapeHTML(
    value
) {

    return String(
        value ?? ""
    )
        .replaceAll(
            "&",
            "&amp;"
        )
        .replaceAll(
            "<",
            "&lt;"
        )
        .replaceAll(
            ">",
            "&gt;"
        )
        .replaceAll(
            '"',
            "&quot;"
        )
        .replaceAll(
            "'",
            "&#039;"
        );

}


/* ==========================================================
   LOAD STUDENT
========================================================== */

async function loadStudent() {

    const student =
        await fetchAuthenticated(
            API.STUDENT
        );


    state.student =
        student;


    state.assignedBus =
        student?.assigned_bus ||
        null;


    return student;

}





/* ==========================================================
   FORMAT SPEED
========================================================== */

function formatSpeed(
    speed
) {

    if (
        speed === null ||
        speed === undefined ||
        Number.isNaN(
            Number(speed)
        )
    ) {

        return "—";

    }


    return `${Number(speed).toFixed(1)} km/h`;

}


/* ==========================================================
   FORMAT LAST UPDATE
========================================================== */

function formatLastUpdate(
    value
) {

    if (!value) {

        return "No location update";

    }


    /*
     * Backend timestamps are stored in UTC.
     *
     * If the timestamp does not contain an explicit
     * timezone, treat it as UTC rather than allowing
     * the browser to interpret it as local time.
     */

    let timestamp =
        String(value);


    if (
        !/[zZ]|[+-]\d{2}:\d{2}$/.test(
            timestamp
        )
    ) {

        timestamp += "Z";

    }


    const date =
        new Date(
            timestamp
        );


    if (
        Number.isNaN(
            date.getTime()
        )
    ) {

        return "Unknown";

    }


    /*
     * BusTrack operates in India.
     *
     * Explicitly use Asia/Kolkata so the displayed
     * time does not depend on the computer/browser
     * timezone.
     */

    return date.toLocaleTimeString(
        "en-IN",
        {
            timeZone:
                "Asia/Kolkata",

            hour:
                "2-digit",

            minute:
                "2-digit",

            second:
                "2-digit",

            hour12:
                true
        }
    );

}

/* ==========================================================
   STUDENT-SAFE GPS TELEMETRY
========================================================== */

function getTelemetry() {

    return state.liveTrip?.telemetry || state.trackingData?.telemetry || {};

}

function trackingSourceLabel() {

    return getTelemetry().source_label || "Waiting for GPS";

}

function vehicleTravelStatus() {

    const telemetry = getTelemetry();

    if (!state.liveTrip) return "Not live";
    if (!telemetry.is_fresh) return "Last known location";
    if (telemetry.moving === true) return "Moving";
    if (telemetry.ignition_on === false) return "Parked";
    return "Live location";

}

/* ==========================================================
   TRACKING STATUS
========================================================== */

function getTrackingStatus() {

    const telemetry = getTelemetry();

    if (!state.assignedBus) {

        return {

            label:
                "No Bus Assigned",

            className:
                "student-tracking-status-neutral"

        };

    }


    if (!state.liveTrip) {

        return {

            label:
                "Bus Not Live",

            className:
                "student-tracking-status-warning"

        };

    }


    if (!telemetry.is_fresh) {

        return {

            label:
                "Last known location",

            className:
                "student-tracking-status-warning"

        };

    }


    if (telemetry.moving === true) {

        return {

            label:
                "Bus moving",

            className:
                "student-tracking-status-live"

        };

    }


    if (telemetry.ignition_on === false) {

        return {

            label:
                "Bus parked",

            className:
                "student-tracking-status-neutral"

        };

    }


    if (
        state.liveTrip.status
            ?.toLowerCase() ===
        "running"
    ) {

        return {

            label:
                "Live",

            className:
                "student-tracking-status-live"

        };

    }


    return {

        label:
            state.liveTrip.status ||
            "Live Trip",

        className:
            "student-tracking-status-neutral"

    };

}
/* ==========================================================
   VIEW MODE
========================================================== */

let currentView = "map";


/* ==========================================================
   PAGE HEADER
========================================================== */

function renderHeader() {

    return `

        <section class="student-tracking-header">

            <div>

                <p class="student-section-eyebrow">
                    LIVE TRANSPORT
                </p>

                <h2>
                    Live Tracking
                </h2>

                <p>
                    Follow your bus in real time
                    and see its progress along the route.
                </p>

            </div>


            <div class="student-tracking-view-switcher">

                <button
                    type="button"
                    class="student-tracking-view-button active"
                    data-tracking-view="map"
                >

                    <i
                        class="fa-solid fa-map"
                        aria-hidden="true"
                    ></i>

                    Map

                </button>


                <button
                    type="button"
                    class="student-tracking-view-button"
                    data-tracking-view="track"
                >

                    <i
                        class="fa-solid fa-route"
                        aria-hidden="true"
                    ></i>

                    Track

                </button>

            </div>

        </section>

    `;

}


/* ==========================================================
   LIVE STATUS
========================================================== */

function renderLiveStatus() {

    const status =
        getTrackingStatus();


    return `

        <div
            class="student-tracking-status
            ${status.className}"
        >

            <span
                class="student-tracking-status-dot"
                aria-hidden="true"
            ></span>

            ${escapeHTML(
                status.label
            )}

        </div>

    `;

}


/* ==========================================================
   BUS INFORMATION BAR
========================================================== */

function renderBusInformation() {

    const bus =
        state.assignedBus;

    const trip =
        state.liveTrip;


    return `

        <section
            class="student-tracking-info-bar"
        >

            <div
                class="student-tracking-bus-identity"
            >

                <div
                    class="student-tracking-bus-icon"
                >

                    <i
                        class="fa-solid fa-bus"
                        aria-hidden="true"
                    ></i>

                </div>


                <div>

                    <span>
                        ASSIGNED BUS
                    </span>

                    <strong>

                        ${escapeHTML(
                            bus?.bus_number ||
                            "No Bus"
                        )}

                    </strong>

                </div>

            </div>


            <div
                class="student-tracking-info-item"
            >

                <span>
                    SPEED
                </span>

                <strong id="student-tracking-speed">

                    ${escapeHTML(
                        formatSpeed(
                            trip?.speed
                        )
                    )}

                </strong>

            </div>


            <div
                class="student-tracking-info-item"
            >

                <span>
                    LAST UPDATED
                </span>

                <strong id="student-tracking-last-updated">

                    ${escapeHTML(
                        formatLastUpdate(
                            trip?.last_location_update
                        )
                    )}

                </strong>

            </div>


            <div
                id="student-tracking-live-status"
                class="student-tracking-live-wrapper"
            >

                ${renderLiveStatus()}

            </div>

        </section>

    `;

}


/* ==========================================================
   MAP VIEW
========================================================== */

/* ==========================================================
   MAP VIEW
========================================================== */

function renderMapView() {

    const bus =
        state.assignedBus;

    const trip =
        state.liveTrip;


    return `

        <section
            class="student-tracking-map-section"
            data-tracking-panel="map"
        >

            <div
                class="student-tracking-map-container"
                id="student-tracking-map"
            >

                <div
                    class="student-tracking-map-loading"
                    id="student-tracking-map-loading"
                >

                    <div
                        class="student-loading-spinner"
                    ></div>

                    <p>
                        Loading live map...
                    </p>

                </div>

            </div>


            <!-- ==========================================
                 LIVE MAP INFORMATION OVERLAY
            =========================================== -->

            <div
                class="student-tracking-map-overlay"
                id="student-tracking-map-overlay"
            >

                <div>

                    <span>
                        CURRENT BUS
                    </span>

                    <strong
                        id="student-map-bus-number"
                    >

                        ${escapeHTML(
                            bus?.bus_number ||
                            "No Bus"
                        )}

                    </strong>

                </div>


                <div>

                    <span>
                        POSITION
                    </span>

                    <strong
                        id="student-map-position-status"
                    >

                        ${
                            trip
                                ? "Live"
                                : "Waiting"
                        }

                    </strong>

                </div>

            </div>

        </section>

    `;

}

/* ==========================================================
   TRACK VIEW
========================================================== */

function renderTrackView() {

    return `

        <section
            class="student-tracking-track-section"
            data-tracking-panel="track"
            hidden
        >

            <div
                class="student-track-card"
            >

                <div
                    class="student-track-card-header"
                >

                    <div>

                        <p
                            class="student-section-eyebrow"
                        >
                            ROUTE PROGRESS
                        </p>

                        <h3>

                            ${
                                escapeHTML(
                                    state.assignedBus
                                        ?.route
                                        ?.route_name ||
                                    "Assigned Route"
                                )
                            }

                        </h3>

                    </div>


                    ${renderLiveStatus()}

                </div>


                <div
                    id="student-route-timeline"
                    class="student-route-timeline"
                >

                    ${renderRouteTimeline()}

                </div>

            </div>

        </section>

    `;

}


/* ==========================================================
   ROUTE TIMELINE
========================================================== */

function renderRouteTimeline() {

    /*
     * The backend endpoint will eventually
     * provide the complete ordered stop list.
     *
     * Until that data is available, display
     * a safe empty state rather than inventing
     * stop information.
     */

    if (
        !state.liveTrip &&
        !state.assignedBus
    ) {

        return `

            <div
                class="student-route-empty"
            >

                <i
                    class="fa-solid fa-route"
                ></i>

                <p>
                    Route information is unavailable.
                </p>

            </div>

        `;

    }


    return `

        <div
            class="student-route-loading"
        >

            <div
                class="student-loading-spinner"
            ></div>

            <p>
                Loading route progress...
            </p>

        </div>

    `;

}


/* ==========================================================
   NO LIVE TRIP STATE
========================================================== */

function renderWaitingState() {

    if (
        state.liveTrip ||
        !state.assignedBus
    ) {

        return "";

    }


    return `

        <div
            class="student-tracking-waiting"
        >

            <div
                class="student-tracking-waiting-icon"
            >

                <i
                    class="fa-solid fa-satellite-dish"
                ></i>

            </div>


            <div>

                <p
                    class="student-section-eyebrow"
                >
                    TRACKING STANDBY
                </p>

                <h3>
                    Your bus is not live right now
                </h3>

                <p>
                    Live tracking will become available
                    when your assigned bus starts its trip.
                </p>

            </div>

        </div>

    `;

}


/* ==========================================================
   ERROR STATE
========================================================== */

function renderTrackingError() {

    if (!state.error) {

        return "";

    }


    return `

        <section
            class="student-tracking-error"
        >

            <div
                class="student-error-icon"
            >

                <i
                    class="fa-solid fa-triangle-exclamation"
                ></i>

            </div>


            <div>

                <p
                    class="student-section-eyebrow"
                >
                    TRACKING ERROR
                </p>

                <h3>
                    Unable to load live tracking
                </h3>

                <p>
                    ${escapeHTML(
                        state.error
                    )}
                </p>

            </div>

        </section>

    `;

}
/* ==========================================================
   ROUTE / STOP HELPERS
========================================================== */

function getRouteStops() {

    const stops =
        Array.isArray(
            state.trackingData?.stops
        )
            ? state.trackingData.stops
            : [];

    return [...stops].sort(
        (a, b) =>
            Number(a.sequence || 0) -
            Number(b.sequence || 0)
    );

}


/* ==========================================================
   FIND NEAREST STOP
========================================================== */

function calculateDistance(
    latitude1,
    longitude1,
    latitude2,
    longitude2
) {

    const earthRadius = 6371;

    const lat1 =
        Number(latitude1) *
        Math.PI / 180;

    const lat2 =
        Number(latitude2) *
        Math.PI / 180;

    const deltaLat =
        (
            Number(latitude2) -
            Number(latitude1)
        ) *
        Math.PI / 180;

    const deltaLng =
        (
            Number(longitude2) -
            Number(longitude1)
        ) *
        Math.PI / 180;


    const a =
        Math.sin(
            deltaLat / 2
        ) ** 2 +

        Math.cos(lat1) *
        Math.cos(lat2) *
        Math.sin(
            deltaLng / 2
        ) ** 2;


    const c =
        2 *
        Math.atan2(
            Math.sqrt(a),
            Math.sqrt(1 - a)
        );


    return earthRadius * c;

}


/* ==========================================================
   FIND CURRENT / NEXT STOP
========================================================== */
/* ==========================================================
   ROUTE PROGRESS
========================================================== */

function calculateRouteProgress() {

    const trip =
        state.trackingData?.trip;


    const stops =
        getRouteStops();


    if (!trip) {

        return {

            currentStop:
                null,

            nextStop:
                null,

            currentIndex:
                -1,

            nextIndex:
                -1,

            status:
                null

        };

    }


    const currentStop =
        trip.current_stop ||
        null;


    const nextStop =
        trip.next_stop ||
        null;


    /*
     * The tracking API provides the stop IDs that were selected by the
     * server-side GPS engine.  Resolve those IDs against the same ordered
     * list used by the timeline instead of assuming `sequence - 1` is the
     * array index.  That assumption breaks when an administrator reorders,
     * inserts, or removes stops while a trip is live, and can leave the
     * visual track at an earlier stop after the bus takes a shortcut.
     */
    const findStopIndex = (trackingStop) => {

        if (!trackingStop) {

            return -1;

        }


        const trackingStopId =
            trackingStop.id ??
            trackingStop.stop_id;


        if (trackingStopId != null) {

            const indexById =
                stops.findIndex(
                    (stop) =>
                        String(stop.id ?? stop.stop_id) ===
                        String(trackingStopId)
                );


            if (indexById >= 0) {

                return indexById;

            }

        }


        const trackingSequence =
            Number(trackingStop.sequence);


        return Number.isFinite(trackingSequence)
            ? stops.findIndex(
                (stop) =>
                    Number(stop.sequence) ===
                    trackingSequence
            )
            : -1;

    };


    return {

        currentStop,

        nextStop,

        currentIndex:
            findStopIndex(
                currentStop
            ),

        nextIndex:
            findStopIndex(
                nextStop
            ),

        status:
            trip.stop_status ||
            "Approaching"

    };

}

/* ==========================================================
   TRACKING DATA STATE
========================================================== */

state.trackingData = null;

function routeDefinitionKey(data) {
    const stops = Array.isArray(data?.stops) ? data.stops : [];
    return JSON.stringify({
        route: {
            id: data?.route?.id ?? null,
            code: data?.route?.route_code ?? null,
            name: data?.route?.route_name ?? null,
            status: data?.route?.status ?? null,
            totalStops: data?.route?.total_stops ?? null,
        },
        bus: {
            id: data?.bus?.id ?? null,
            number: data?.bus?.bus_number ?? null,
            registration: data?.bus?.registration_number ?? null,
            status: data?.bus?.status ?? null,
        },
        stops: stops.map(stop => ({
            id: stop.id,
            sequence: stop.sequence,
            latitude: stop.latitude,
            longitude: stop.longitude,
            radius: stop.radius,
            name: stop.stop_name,
            scheduledTime: stop.scheduled_time,
            estimatedMinutes: stop.estimated_minutes,
        })),
    });
}


/* ==========================================================
   LOAD STUDENT TRACKING DATA
========================================================== */

async function loadStudentTracking() {

    const requestId = ++state.refreshRequestId;
    const lifecycleId = state.lifecycleId;

    const data =
        await fetchAuthenticated(
            API.TRACKING
        );

    // A late response from a previous refresh or page instance must never
    // replace the newest bus position.
    if (
        requestId !== state.refreshRequestId ||
        lifecycleId !== state.lifecycleId
    ) {
        return null;
    }


    /*
     * DEBUG:
     * Show exactly what the student tracking API returns.
     *
     * This allows us to verify that the student page is
     * actually receiving the newest GPS position.
     */
    console.log(
        "BusTrack: STUDENT TRACKING RESPONSE",
        data
    );


    const nextRouteDirection =
        data?.trip?.route_direction ||
        "forward";

    const nextRouteDefinitionKey = routeDefinitionKey(data);

    if (
        (state.routeDirection && state.routeDirection !== nextRouteDirection)
        || (state.routeDefinitionKey && state.routeDefinitionKey !== nextRouteDefinitionKey)
    ) {
        resetRoadRouteForDirection();
        clearMapObjects();
    }

    state.routeDirection =
        nextRouteDirection;

    state.routeDefinitionKey =
        nextRouteDefinitionKey;

    state.trackingData =
        data;


    state.assignedBus =
        data?.bus ||
        state.assignedBus ||
        null;


    state.liveTrip =
        data?.trip ||
        null;


    /*
     * DEBUG:
     * These are the values that the student UI will use.
     */
    console.log(
        "BusTrack: LIVE TRIP UPDATED",
        {
            tripId:
                state.liveTrip?.id,

            latitude:
                state.liveTrip?.latitude,

            longitude:
                state.liveTrip?.longitude,

            speed:
                state.liveTrip?.speed,

            lastLocationUpdate:
                state.liveTrip?.last_location_update
        }
    );


    return data;

}

/* ==========================================================
   TERMINAL ARRIVAL NOTICE
========================================================== */

function showTerminalArrivalNotice() {

    const trip = state.liveTrip;
    if (!trip?.terminal_reached || !trip.terminal_reached_at) return;

    const noticeKey = `${trip.id}:${trip.terminal_reached_at}`;
    const storageKey = `busTrackTerminalNotice:${noticeKey}`;
    if (state.terminalNoticeKey === noticeKey || sessionStorage.getItem(storageKey)) return;

    state.terminalNoticeKey = noticeKey;
    sessionStorage.setItem(storageKey, "shown");
    const stopName = escapeHTML(trip.terminal_stop_name || "the final stop");
    Modal.open({
        eyebrow: "Trip leg completed",
        title: "Bus reached the terminal",
        subtitle: "The return direction is now ready.",
        content: `
            <div class="student-terminal-notice">
                <i class="fa-solid fa-flag-checkered" aria-hidden="true"></i>
                <p><strong>${stopName}</strong> is the end of this route leg.</p>
                <p>The same route is now shown in reverse order for the return journey.</p>
            </div>`,
        actions: [{
            text: "OK",
            style: "primary",
            close: true,
            onClick: async () => {
                // Re-read the student-specific provider projection after the
                // acknowledgement so the reversed route and terminal GPS
                // heartbeat are rendered from the backend source of truth.
                await refreshTracking();
            },
        }],
    });
}

/* ==========================================================
   REFRESH TRACKING
========================================================== */
/* ==========================================================
   REFRESH TRACKING
========================================================== */

async function refreshTracking() {

    /*
     * Prevent overlapping refresh requests.
     *
     * If the previous request is still running,
     * wait for that request instead of starting
     * another one.
     */
    if (state.refreshInProgress) {

        console.log(
            "BusTrack: Tracking refresh already in progress."
        );

        return;

    }


    state.refreshInProgress =
        true;


    try {

        /*
         * ======================================================
         * STEP 1
         * Get newest tracking information.
         * ======================================================
         */

        const data = await loadStudentTracking();

        if (!data) return;


        console.log(
            "BusTrack: Applying newest tracking data to UI."
        );


        /*
         * ======================================================
         * STEP 2
         * Clear previous error.
         * ======================================================
         */

        state.error =
            null;


        /*
         * ======================================================
         * STEP 3
         * UPDATE LIVE UI IMMEDIATELY.
         *
         * Do not wait for ETA.
         * ======================================================
         */

        updateTrackingInterface();

        showTerminalArrivalNotice();


        console.log(
            "BusTrack: Student tracking UI updated immediately."
        );


        /*
         * ======================================================
         * STEP 4
         * Calculate ETA separately.
         *
         * ETA must never block the live map.
         * ======================================================
         */

        calculateNextStopETA()
            .catch(
                error => {

                    console.error(
                        "BusTrack: Background ETA calculation failed.",
                        error
                    );

                }
            );

    }

    catch (error) {

        console.error(
            "BusTrack: Live tracking refresh failed.",
            error
        );


        state.error =
            error.message ||
            "Unable to refresh live tracking.";


        updateTrackingInterface();

    }

    finally {

        state.refreshInProgress =
            false;

    }

}
/* ==========================================================
   MAP INITIALIZATION
========================================================== */
/* ==========================================================
   MAP INITIALIZATION
========================================================== */

function initializeMap() {

    const mapElement =
        document.querySelector(
            "#student-tracking-map"
        );


    if (
        !mapElement ||
        typeof L === "undefined"
    ) {

        console.warn(
            "BusTrack: Leaflet is unavailable."
        );

        return;

    }


    /* ======================================================
       CREATE MAP ONLY ONCE
    ====================================================== */

    if (!state.map) {

        state.map =
            L.map(
                mapElement,
                {
                    zoomControl: true
                }
            );


        L.tileLayer(
            "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
            {
                maxZoom: 19,

                attribution:
                    "&copy; OpenStreetMap contributors"
            }
        ).addTo(
            state.map
        );


        state.map.setView(
            [
                10.25,
                76.38
            ],
            13
        );

    }


    /* ======================================================
       RENDER STATIC MAP DATA ONLY WHEN REQUIRED
    ====================================================== */

    if (
        state.stopMarkers.length === 0
    ) {

        renderMapObjects();

    }


    /* ======================================================
       HIDE MAP LOADING OVERLAY
    ====================================================== */

    const loadingOverlay =
        document.querySelector(
            "#student-tracking-map-loading"
        );


    if (loadingOverlay) {

        loadingOverlay.style.display =
            "none";

    }


    /* ======================================================
       FIX LEAFLET SIZE
    ====================================================== */

    requestAnimationFrame(
        () => {

            if (state.map) {

                state.map.invalidateSize();

            }

        }
    );

}
/* ==========================================================
   CLEAR MAP OBJECTS
========================================================== */

function clearMapObjects() {

    if (state.busMotion.frame) {

        cancelAnimationFrame(state.busMotion.frame);
        state.busMotion.frame = null;

    }

    state.busMotion.heading = null;
    state.busMotion.target = null;
    state.busMotion.stageDistance = null;
    state.busMotion.lastMapFollowAt = null;
    state.busTargetLocation = null;

    if (
        state.busMarker &&
        state.map
    ) {

        state.map.removeLayer(
            state.busMarker
        );

        state.busMarker =
            null;

    }


    if (state.map) {

        state.stopMarkers.forEach(
            marker => {

                state.map.removeLayer(
                    marker
                );

            }
        );

    }


    state.stopMarkers = [];


    if (
        state.routeLine &&
        state.map
    ) {

        state.map.removeLayer(
            state.routeLine
        );

        state.routeLine =
            null;

    }

}


/* ==========================================================
   BUS ICON
========================================================== */

function createBusIcon() {
    return createVehicleMarkerIcon();

}


/* ==========================================================
   STOP ICON
========================================================== */

function createStopIcon(
    sequence
) {

    return L.divIcon({

        className:
            "student-map-stop-marker",

        html: `

            <div
                class="student-map-stop-marker-inner"
            >

                ${escapeHTML(
                    sequence
                )}

            </div>

        `,

        iconSize: [
            30,
            30
        ],

        iconAnchor: [
            15,
            15
        ]

    });

}
/* ==========================================================
   LOAD ROAD-FOLLOWING ROUTE FROM OSRM
========================================================== */

function resetRoadRouteForDirection() {

    if (
        state.map &&
        state.routeLine
    ) {

        state.map.removeLayer(
            state.routeLine
        );

    }

    state.routeLine = null;
    state.roadRoute = [];
    state.roadRouteDistance = 0;
    state.roadRouteDuration = 0;
    state.roadRouteLoaded = false;
    state.roadRouteRequestId += 1;

}

async function loadRoadRoute() {

    /*
     * Make sure the map exists before attempting
     * to draw the road route.
     */

    if (!state.map) {

        return;

    }


    /*
     * Get the student's route stops in their
     * correct sequence.
     */

    const stops =
        getRouteStops();

    const requestId = state.roadRouteRequestId;


    /*
     * We need at least two valid stops to
     * calculate a road route.
     */

    const validStops =
        stops.filter(
            stop =>
                stop.latitude != null &&
                stop.longitude != null
        );


    if (
        validStops.length < 2
    ) {

        console.warn(
            "BusTrack: Not enough valid stops for road routing."
        );

        return;

    }


    /*
     * OSRM expects coordinates as:
     *
     * longitude,latitude
     *
     * NOT:
     *
     * latitude,longitude
     */

    const coordinates =
        validStops
            .map(
                stop =>
                    `${Number(stop.longitude)},${Number(stop.latitude)}`
            )
            .join(";");


    /*
     * Ask OSRM for the actual driving route.
     *
     * overview=full gives us the detailed road
     * geometry instead of a straight line.
     *
     * geometries=geojson makes the response easy
     * to use directly with Leaflet.
     */

    const url =
        `https://router.project-osrm.org/route/v1/driving/${coordinates}` +
        `?overview=full&geometries=geojson`;


    try {

        const response =
            await fetch(url);


        if (!response.ok) {

            throw new Error(
                `OSRM request failed: HTTP ${response.status}`
            );

        }


        const data =
            await response.json();

        // A direction change may have happened while OSRM was responding.
        // Never draw the old journey over the newly reversed route.
        if (requestId !== state.roadRouteRequestId) {

            return;

        }


        /*
         * OSRM returns "Ok" when the route was
         * calculated successfully.
         */

        if (
            data.code !== "Ok" ||
            !data.routes ||
            !data.routes.length
        ) {

            throw new Error(
                data.message ||
                "OSRM could not calculate the route."
            );

        }


        const geometry =
            data.routes[0]?.geometry;


        if (
            !geometry ||
            !Array.isArray(
                geometry.coordinates
            )
        ) {

            throw new Error(
                "OSRM returned no route geometry."
            );

        }


        /*
         * Remove the previous straight-line route.
         */

        if (
            state.routeLine &&
            state.map
        ) {

            state.map.removeLayer(
                state.routeLine
            );

            state.routeLine =
                null;

        }


        /*
         * GeoJSON coordinates are:
         *
         * [longitude, latitude]
         *
         * Leaflet accepts:
         *
         * [latitude, longitude]
         */

        const roadCoordinates =
            geometry.coordinates.map(
                coordinate => [
                    Number(coordinate[1]),
                    Number(coordinate[0])
                ]
            );


        /*
         * Draw the actual road-following route.
         */

        state.routeLine =
            L.polyline(
                roadCoordinates,
                {
                    weight: 5,

                    opacity: 0.85,

                    lineJoin: "round",

                    lineCap: "round"
                }
            ).addTo(
                state.map
            );


        /*
         * Save the route geometry.
         *
         * We will use this later for:
         *
         * - ETA
         * - route progress
         * - bus position along route
         * - Track interface
         */

        state.roadRoute =
            roadCoordinates;


        /*
         * Keep the route available for
         * future calculations.
         */

        state.roadRouteDistance =
            data.routes[0]?.distance ||
            0;


        state.roadRouteDuration =
            data.routes[0]?.duration ||
            0;
        state.roadRouteLoaded =
            true;


        console.log(
            "BusTrack: Road route loaded.",
            {
                distance:
                    state.roadRouteDistance,

                duration:
                    state.roadRouteDuration,

                points:
                    roadCoordinates.length
            }
        );

    }

    catch (error) {

        console.error(
            "BusTrack: Road route loading failed.",
            error
        );

    }

}

/* ==========================================================
   RENDER MAP OBJECTS
========================================================== */

function renderMapObjects() {

    if (!state.map) {

        return;

    }





    const stops =
        getRouteStops();


    const trip =
        state.trackingData?.trip;


    const coordinates = [];


    /* ========================================================
       STOP MARKERS
    ======================================================== */

    stops.forEach(
        stop => {

            if (
                stop.latitude == null ||
                stop.longitude == null
            ) {

                return;

            }


            const latitude =
                Number(
                    stop.latitude
                );

            const longitude =
                Number(
                    stop.longitude
                );


            const marker =
                L.marker(
                    [
                        latitude,
                        longitude
                    ],
                    {
                        icon:
                            createStopIcon(
                                stop.sequence
                            )
                    }
                ).addTo(
                    state.map
                );


            marker.bindPopup(
                `
                    <strong>
                        ${escapeHTML(
                            stop.stop_name
                        )}
                    </strong>
                    <br>
                    Stop ${
                        escapeHTML(
                            stop.sequence
                        )
                    }
                `
            );


            state.stopMarkers.push(
                marker
            );


            coordinates.push([
                latitude,
                longitude
            ]);


        }
    );


    /* ========================================================
       BUS MARKER
    ======================================================== */

    if (
        trip &&
        trip.latitude != null &&
        trip.longitude != null
    ) {

        const latitude =
            Number(
                trip.latitude
            );

        const longitude =
            Number(
                trip.longitude
            );


        state.busMarker =
            L.marker(
                [
                    latitude,
                    longitude
                ],
                {
                    icon:
                        createBusIcon(),
                    zIndexOffset:
                        1000
                }
            ).addTo(
                state.map
            );

        state.busTargetLocation = { latitude, longitude };
        void snapVehicleMarkerToRoad(
            state.busMarker,
            latitude,
            longitude,
            state.busMotion,
        );

        coordinates.push([latitude, longitude]);


        state.busMarker.bindPopup(
            `
                <strong>
                    ${escapeHTML(
                        state.assignedBus
                            ?.bus_number ||
                        "Bus"
                    )}
                </strong>
                <br>
                Speed:
                ${escapeHTML(
                    formatSpeed(
                        trip.speed
                    )
                )}
            `
        );


        

    }





    /* ========================================================
       FIT MAP TO DATA
    ======================================================== */

    if (
        coordinates.length
    ) {

        const bounds =
            L.latLngBounds(
                coordinates
            );


        state.map.fitBounds(
            bounds,
            {
                padding: [
                    50,
                    50
                ],

                maxZoom: 15
            }
        );

    }
    /* ========================================================
    LOAD ACTUAL ROAD-FOLLOWING ROUTE
    ======================================================== */

    if (
        !state.roadRouteLoaded
    ) {

        loadRoadRoute();

    }

}


/* ==========================================================
   UPDATE MAP POSITION
========================================================== */

/* ==========================================================
   UPDATE MAP BUS POSITION
========================================================== */

/* ==========================================================
   UPDATE LIVE BUS POSITION
========================================================== */

function updateBusPosition() {

    /*
     * The map and live trip must both exist.
     */
    if (
        !state.map ||
        !state.liveTrip
    ) {

        return;

    }

    const latitude =
        Number(
            state.liveTrip.latitude
        );

    const longitude =
        Number(
            state.liveTrip.longitude
        );

    /*
     * Ignore invalid GPS coordinates.
     */
    if (
        !Number.isFinite(latitude) ||
        !Number.isFinite(longitude)
    ) {

        console.warn(
            "BusTrack: Invalid live GPS coordinates.",
            {
                latitude,
                longitude
            }
        );

        return;

    }

    /*
     * Create the marker if it does not exist yet.
     */
    if (!state.busMarker) {

        renderMapObjects();

        return;

    }

    /* Compare with the received target, not the marker's in-flight position. */
    const positionChanged =
        !state.busTargetLocation ||
        Math.abs(state.busTargetLocation.latitude - latitude) > 0.0000001 ||
        Math.abs(state.busTargetLocation.longitude - longitude) > 0.0000001;

    /*
     * Log the server position so we can verify
     * automatic movement in DevTools.
     */
    console.log(
        "BusTrack: Updating student bus marker.",
        {
            newest: {
                latitude,
                longitude
            },

            changed:
                positionChanged
        }
    );

    /*
     * Move the marker to the newest GPS position.
     */
    if (positionChanged) {

        state.busTargetLocation = { latitude, longitude };

        animateVehicleMarker(
            state.busMarker,
            latitude,
            longitude,
            state.busMotion,
            ".fleet-vehicle-marker__visual"
        );

    }

    /*
     * Update popup information as well.
     */
    state.busMarker.setPopupContent(
        `
            <strong>
                ${escapeHTML(
                    state.assignedBus
                        ?.bus_number ||
                    "Bus"
                )}
            </strong>

            <br>

            Speed:
            ${escapeHTML(
                formatSpeed(
                    state.liveTrip.speed
                )
            )}

            <br>

            Updated:
            ${escapeHTML(
                formatLastUpdate(
                    state.liveTrip.last_location_update
                )
            )}
        `
    );

}
/* ==========================================================
   CALCULATE ETA TO NEXT STOP
========================================================== */

async function calculateNextStopETA() {

    const trip =
        state.trackingData?.trip ||
        state.liveTrip;


    const progress =
        calculateRouteProgress();


    const nextStop =
        progress.nextStop;


    /*
     * We need:
     *
     * 1. Current bus latitude
     * 2. Current bus longitude
     * 3. Next stop latitude
     * 4. Next stop longitude
     * 5. Current bus speed
     */

    if (
        !trip ||
        trip.latitude == null ||
        trip.longitude == null ||
        !nextStop ||
        nextStop.latitude == null ||
        nextStop.longitude == null
    ) {

        state.etaDistanceMeters =
            null;

        state.etaMinutes =
            null;

        state.etaOrigin = null;
        state.etaDestinationId = null;
        state.etaLastCalculatedAt = 0;

        updateETAInterface();

        return;

    }


    const speed =
        Number(
            trip.speed
        );


    /*
     * If the bus is stationary, ETA cannot be
     * calculated from speed.
     */

    if (
        !Number.isFinite(speed) ||
        speed <= 0
    ) {

        state.etaDistanceMeters =
            null;

        state.etaMinutes =
            null;

        state.etaOrigin = null;
        state.etaDestinationId = null;
        state.etaLastCalculatedAt = 0;

        updateETAInterface(
            "waiting"
        );

        return;

    }

    // Routing is comparatively expensive and does not need to run for every
    // two-second GPS poll. Reuse the result until the bus has moved 25 m, the
    // destination changes, or ten seconds pass.
    const now = Date.now();
    const origin = {
        latitude: Number(trip.latitude),
        longitude: Number(trip.longitude)
    };
    const movedKilometers = state.etaOrigin
        ? calculateDistance(
            state.etaOrigin.latitude,
            state.etaOrigin.longitude,
            origin.latitude,
            origin.longitude
        )
        : Infinity;
    const destinationId = nextStop.id ?? nextStop.stop_id ?? nextStop.sequence;
    if (
        state.etaDestinationId === destinationId &&
        movedKilometers < 0.025 &&
        now - state.etaLastCalculatedAt < 10_000
    ) {
        updateETAInterface();
        return;
    }

    state.etaOrigin = origin;
    state.etaDestinationId = destinationId;
    state.etaLastCalculatedAt = now;


    /*
     * Each refresh gets a unique request ID.
     *
     * This prevents an older OSRM response from
     * overwriting a newer GPS position.
     */

    const requestId =
        ++state.etaRequestId;


    state.etaLoading =
        true;


    updateETAInterface(
        "loading"
    );


    /*
     * OSRM expects:
     *
     * longitude,latitude
     *
     * Current bus -> next stop.
     *
     * This gives us the actual road distance.
     */

    const coordinates =
        `${Number(trip.longitude)},${Number(trip.latitude)}` +
        `;${Number(nextStop.longitude)},${Number(nextStop.latitude)}`;


    const url =
        `https://router.project-osrm.org/route/v1/driving/${coordinates}` +
        `?overview=false`;


    try {

        const response =
            await fetch(
                url
            );


        if (!response.ok) {

            throw new Error(
                `ETA routing failed: HTTP ${response.status}`
            );

        }


        const data =
            await response.json();


        if (
            requestId !==
            state.etaRequestId
        ) {

            return;

        }


        if (
            data.code !== "Ok" ||
            !data.routes ||
            !data.routes.length
        ) {

            throw new Error(
                data.message ||
                "No road route found."
            );

        }


        /*
         * OSRM distance is returned in metres.
         */

        const distanceMeters =
            Number(
                data.routes[0].distance
            );


        if (
            !Number.isFinite(
                distanceMeters
            )
        ) {

            throw new Error(
                "Invalid route distance."
            );

        }


        /*
         * ETA formula:
         *
         * distance / speed
         *
         * distance = metres
         * speed    = km/h
         *
         * Convert speed to metres/second:
         *
         * km/h × 1000 / 3600
         */

        const speedMetersPerSecond =
            speed *
            1000 /
            3600;


        const etaSeconds =
            distanceMeters /
            speedMetersPerSecond;


        const etaMinutes =
            etaSeconds /
            60;


        state.etaDistanceMeters =
            distanceMeters;


        state.etaMinutes =
            etaMinutes;


        state.etaLoading =
            false;


        updateETAInterface();

    }

    catch (error) {

        console.error(
            "BusTrack: ETA calculation failed.",
            error
        );


        if (
            requestId !==
            state.etaRequestId
        ) {

            return;

        }


        state.etaDistanceMeters =
            null;

        state.etaMinutes =
            null;

        state.etaLoading =
            false;


        updateETAInterface(
            "error"
        );

    }

}
/* ==========================================================
   FORMAT ETA
========================================================== */

function formatETA() {

    if (
        state.etaMinutes == null
    ) {

        return "Calculating...";

    }


    const minutes =
        Math.max(
            0,
            Math.ceil(
                state.etaMinutes
            )
        );


    if (
        minutes < 1
    ) {

        return "Arriving now";

    }


    if (
        minutes === 1
    ) {

        return "1 min";

    }


    return `${minutes} mins`;

}
/* ==========================================================
   FORMAT DISTANCE
========================================================== */

function formatDistance(
    meters
) {

    if (
        meters == null ||
        !Number.isFinite(
            Number(meters)
        )
    ) {

        return "—";

    }


    const distance =
        Number(
            meters
        );


    if (
        distance < 1000
    ) {

        return `${Math.round(distance)} m`;

    }


    return `${(
        distance / 1000
    ).toFixed(1)} km`;

}
/* ==========================================================
   VIEW SWITCHING
========================================================== */

function setTrackingView(
    view
) {

    currentView =
        view === "track"
            ? "track"
            : "map";


    const buttons =
        document.querySelectorAll(
            "[data-tracking-view]"
        );


    buttons.forEach(
        button => {

            button.classList.toggle(
                "active",
                button.dataset.trackingView ===
                    currentView
            );

        }
    );


    const mapPanel =
        document.querySelector(
            '[data-tracking-panel="map"]'
        );


    const trackPanel =
        document.querySelector(
            '[data-tracking-panel="track"]'
        );


    if (mapPanel) {

        mapPanel.hidden =
            currentView !== "map";

    }


    if (trackPanel) {

        trackPanel.hidden =
            currentView !== "track";

    }


    if (
        currentView === "map"
    ) {

        initializeMap();

        requestAnimationFrame(
            () => {

                if (state.map) {

                    state.map.invalidateSize();

                }

            }
        );

    }

}

/* ==========================================================
   AUTOMATIC LIVE TRACKING REFRESH
========================================================== */

function startTrackingRefresh() {

    /*
     * Always stop any previous timer first.
     *
     * This prevents multiple polling loops from running
     * at the same time.
     */
    stopTrackingRefresh();

    if (state.visibilityHandler) {

        document.removeEventListener(
            "visibilitychange",
            state.visibilityHandler
        );

    }


    /*
     * Fetch the latest tracking data immediately.
     *
     * The student should not have to wait for the first
     * 20-second moving-GPS interval.
     */
    refreshTracking();


    /*
     * Read the saved position every two seconds. Vehicle hardware still
     * publishes every 20 seconds while moving and every two minutes while parked.
     *
     * MVD provider → BusGPSState/LiveTrip → this student-specific endpoint
     * (the admin portal is never an intermediary).
     */
    state.refreshTimer =
        window.setInterval(
            () => {

                console.log(
                    "BusTrack: Automatic tracking refresh..."
                );

                refreshTracking();

            },
            2_000
        );

    state.visibilityHandler =
        () => {

            if (document.visibilityState === "visible") {

                void refreshTracking();

            }

        };

    document.addEventListener(
        "visibilitychange",
        state.visibilityHandler
    );

}



/* ==========================================================
   STOP REFRESH TIMER
========================================================== */

function stopTrackingRefresh() {

    if (
        state.refreshTimer
    ) {

        clearInterval(
            state.refreshTimer
        );

        state.refreshTimer =
            null;

    }

    if (state.visibilityHandler) {

        document.removeEventListener(
            "visibilitychange",
            state.visibilityHandler
        );

        state.visibilityHandler =
            null;

    }

}


/* ==========================================================
   CLEANUP
========================================================== */

function cleanupTracking() {

    state.lifecycleId++;
    state.refreshRequestId++;
    stopTrackingRefresh();


    if (state.map) {

        state.map.remove();

        state.map =
            null;

    }


    state.busMarker =
        null;

    if (state.busMotion.frame) {

        cancelAnimationFrame(state.busMotion.frame);

    }

    state.busMotion = { heading: null, frame: null, followMap: true };
    state.busTargetLocation = null;

    state.stopMarkers = [];

    state.routeLine =
        null;

    state.roadRoute =
        [];

    state.roadRouteDistance =
        0;

    state.roadRouteDuration =
        0;
    state.etaDistanceMeters =
        null;

    state.etaMinutes =
        null;

    state.etaLoading =
        false;

    state.etaRequestId =
        0;
    state.etaOrigin = null;
    state.etaDestinationId = null;
    state.etaLastCalculatedAt = 0;
    state.refreshInProgress =
       false;

    state.routeDirection =
        null;

    state.terminalNoticeKey =
        null;

}
/* ==========================================================
   ROUTE TIMELINE
========================================================== */

function renderTrackTimeline() {

    const container =
        document.querySelector(
            "#student-route-timeline"
        );


    if (!container) {

        return;

    }


    const stops =
        getRouteStops();


    const progress =
        calculateRouteProgress();


    if (!stops.length) {

        container.innerHTML = `

            <div
                class="student-route-empty"
            >

                <div
                    class="student-route-empty-icon"
                >

                    <i
                        class="fa-solid fa-route"
                    ></i>

                </div>


                <div>

                    <h4>
                        Route stops unavailable
                    </h4>

                    <p>
                        Stop information is not
                        available for this route yet.
                    </p>

                </div>

            </div>

        `;

        return;

    }


    container.innerHTML = `

        <div
            class="student-route-line"
        ></div>


        ${stops.map(
            (
                stop,
                index
            ) => {

                const isPassed =
                    progress.currentIndex >= 0 &&
                    index <
                        progress.currentIndex;


                const isCurrent =
                    index ===
                    progress.currentIndex;


                const isNext =
                    index ===
                    progress.nextIndex;


                let stateClass =
                    "upcoming";


                let statusText =
                    "Upcoming";


                let icon =
                    "fa-location-dot";


                if (isPassed) {

                    stateClass =
                        "passed";

                    statusText =
                        "Passed";

                    icon =
                        "fa-check";

                }


                else if (isCurrent) {

                    stateClass =
                        "current";

                    statusText =
                        "Current";

                    icon =
                        "fa-bus";

                }


                else if (isNext) {

                    stateClass =
                        "next";

                    statusText =
                        "Next Stop";

                    icon =
                        "fa-location-arrow";

                }


                return `

                    <article
                        class="
                            student-route-stop
                            student-route-stop-${stateClass}
                        "
                    >

                        <div
                            class="student-route-stop-marker"
                        >

                            <i
                                class="
                                    fa-solid
                                    ${icon}
                                "
                                aria-hidden="true"
                            ></i>

                        </div>


                        <div
                            class="student-route-stop-content"
                        >

                            <div
                                class="student-route-stop-heading"
                            >

                                <div>

                                    <span
                                        class="
                                            student-route-stop-sequence
                                        "
                                    >

                                        STOP
                                        ${escapeHTML(
                                            stop.sequence
                                        )}

                                    </span>


                                    <h4>

                                        ${escapeHTML(
                                            stop.stop_name
                                        )}

                                    </h4>

                                </div>


                                <span
                                    class="
                                        student-route-stop-status
                                    "
                                >

                                    ${statusText}

                                </span>

                            </div>


                            <div
                                class="
                                    student-route-stop-details
                                "
                            >

                                ${
                                    stop.stop_code
                                        ? `
                                            <span>
                                                <i
                                                    class="
                                                        fa-solid
                                                        fa-tag
                                                    "
                                                ></i>

                                                ${escapeHTML(
                                                    stop.stop_code
                                                )}
                                            </span>
                                          `
                                        : ""
                                }


                                ${
                                    stop.scheduled_time
                                        ? `
                                            <span>
                                                <i
                                                    class="
                                                        fa-solid
                                                        fa-clock
                                                    "
                                                ></i>

                                                ${escapeHTML(
                                                    stop.scheduled_time
                                                )}
                                            </span>
                                          `
                                        : ""
                                }

                            </div>

                        </div>

                    </article>

                `;

            }
        ).join("")}

    `;

}

/* ==========================================================
   UPDATE ETA INTERFACE
========================================================== */

function updateETAInterface(
    mode = "normal"
) {

    const etaElement =
        document.querySelector(
            "#student-next-stop-eta"
        );


    const distanceElement =
        document.querySelector(
            "#student-next-stop-distance"
        );


    if (!etaElement) {

        return;

    }


    if (
        mode === "waiting"
    ) {

        etaElement.textContent =
            "Waiting for movement";


        if (distanceElement) {

            distanceElement.textContent =
                state.etaDistanceMeters != null
                    ? formatDistance(
                        state.etaDistanceMeters
                    )
                    : "";

        }

        return;

    }


    if (
        mode === "loading"
    ) {

        etaElement.textContent =
            "Calculating...";


        return;

    }


    if (
        mode === "error"
    ) {

        etaElement.textContent =
            "Unable to calculate";


        if (distanceElement) {

            distanceElement.textContent =
                "";

        }

        return;

    }


    etaElement.textContent =
        formatETA();


    if (distanceElement) {

        distanceElement.textContent =
            state.etaDistanceMeters != null
                ? formatDistance(
                    state.etaDistanceMeters
                )
                : "";

    }

}
/* ==========================================================
   CURRENT / NEXT STOP INFORMATION
========================================================== */

function renderStopInformation() {

    const container =
        document.querySelector(
            "#student-tracking-stop-information"
        );


    if (!container) {

        return;

    }


    const progress =
        calculateRouteProgress();


    const currentStop =
        progress.currentStop;


    const nextStop =
        progress.nextStop;


    container.innerHTML = `

        <div
            class="student-tracking-stop-card"
        >

            <div
                class="student-tracking-stop-card-icon current"
            >

                <i
                    class="fa-solid fa-bus"
                    aria-hidden="true"
                ></i>

            </div>


            <div
                class="student-tracking-stop-card-content"
            >

                <span>
                    ${
                        progress.status === "Arrived"
                            ? "ARRIVED AT"
                            : "CURRENTLY NEAR"
                    }
                </span>

                <strong>

                    ${
                        currentStop
                            ? escapeHTML(
                                currentStop.stop_name
                            )
                            : "Location updating"
                    }

                </strong>

            </div>

        </div>


        <div
            class="student-tracking-stop-card"
        >

            <div
                class="student-tracking-stop-card-icon next"
            >

                <i
                    class="fa-solid fa-location-arrow"
                    aria-hidden="true"
                ></i>

            </div>


            <div
                class="student-tracking-stop-card-content"
            >

                <span>
                    NEXT STOP
                </span>

                <strong
                    id="student-next-stop"
                >

                    ${
                        nextStop
                            ? escapeHTML(
                                nextStop.stop_name
                            )
                            : "—"
                    }

                </strong>

            </div>

        </div>


        <div
            class="student-tracking-stop-card"
        >

            <div
                class="student-tracking-stop-card-icon eta"
            >

                <i
                    class="fa-solid fa-clock"
                    aria-hidden="true"
                ></i>

            </div>


            <div
                class="student-tracking-stop-card-content"
            >

                <span>
                    ESTIMATED ARRIVAL
                </span>

                <strong
                    id="student-next-stop-eta"
                >
                    ${escapeHTML(
                        formatETA()
                    )}
                </strong>
                <span
                    id="student-next-stop-distance"
                    class="student-tracking-eta-distance"
                >
                    ${
                        state.etaDistanceMeters != null
                            ? escapeHTML(
                                formatDistance(
                                    state.etaDistanceMeters
                                )
                            )
                            : ""
                    }
                </span>

            </div>

        </div>

    `;

}


/* ==========================================================
   TRACKING SUMMARY
========================================================== */

function renderTrackingSummary() {

    const container =
        document.querySelector(
            "#student-tracking-summary"
        );


    if (!container) {

        return;

    }


    const trip =
        state.liveTrip;


    const bus =
        state.assignedBus;


    const route =
        state.trackingData?.route;


    const telemetry =
        getTelemetry();


    container.innerHTML = `

        <div
            class="student-tracking-summary-card"
        >

            <span>
                BUS
            </span>

            <strong>

                ${escapeHTML(
                    bus?.bus_number ||
                    "—"
                )}

            </strong>

        </div>


        <div
            class="student-tracking-summary-card student-tracking-source-card ${
                telemetry.source === "vehicle_gps"
                    ? "is-vehicle"
                    : ""
            }"
        >

            <span>
                TRACKED BY
            </span>

            <strong>

                ${escapeHTML(
                    trackingSourceLabel()
                )}

            </strong>

        </div>


        <div
            class="student-tracking-summary-card"
        >

            <span>
                BUS STATUS
            </span>

            <strong>

                ${escapeHTML(
                    vehicleTravelStatus()
                )}

            </strong>

        </div>


        <div
            class="student-tracking-summary-card"
        >

            <span>
                ROUTE
            </span>

            <strong>

                ${escapeHTML(
                    route?.route_code ||
                    "—"
                )}

            </strong>

        </div>


        <div
            class="student-tracking-summary-card"
        >

            <span>
                SPEED
            </span>

            <strong
                id="student-live-speed"
            >

                ${escapeHTML(
                    formatSpeed(
                        trip?.speed
                    )
                )}

            </strong>

        </div>


        <div
            class="student-tracking-summary-card"
        >

            <span>
                JOURNEY
            </span>

            <strong>

                ${
                    trip?.route_direction === "reverse"
                        ? "Return journey"
                        : "Morning journey"
                }

            </strong>

        </div>


        <div
            class="student-tracking-summary-card"
        >

            <span>
                LAST UPDATE
            </span>

            <strong
                id="student-last-update"
            >

                ${escapeHTML(
                    formatLastUpdate(
                        trip?.last_location_update
                    )
                )}

            </strong>

        </div>

    `;

}


/* ==========================================================
   UPDATE TRACK VIEW
========================================================== */

function updateTrackView() {

    renderTrackTimeline();

    renderStopInformation();

    renderTrackingSummary();

}



/* ==========================================================
   PAGE STATE MESSAGE
========================================================== */

function renderTrackingMessage() {

    if (state.error) {

        return `

            <section
                class="student-tracking-message error"
            >

                <div
                    class="student-tracking-message-icon"
                >

                    <i
                        class="
                            fa-solid
                            fa-triangle-exclamation
                        "
                    ></i>

                </div>


                <div>

                    <span>
                        TRACKING ERROR
                    </span>

                    <h3>
                        Unable to load live tracking
                    </h3>

                    <p>
                        ${escapeHTML(
                            state.error
                        )}
                    </p>

                </div>

            </section>

        `;

    }


    if (
        state.loading
    ) {

        return `

            <section
                class="student-tracking-message"
            >

                <div
                    class="student-loading-spinner"
                ></div>

                <p>
                    Connecting to live tracking...
                </p>

            </section>

        `;

    }


    if (
        !state.assignedBus
    ) {

        return `

            <section
                class="student-tracking-message"
            >

                <div
                    class="student-tracking-message-icon"
                >

                    <i
                        class="
                            fa-solid
                            fa-bus
                        "
                    ></i>

                </div>


                <div>

                    <span>
                        TRANSPORT
                    </span>

                    <h3>
                        No bus assigned
                    </h3>

                    <p>
                        A bus has not been assigned
                        to your student account.
                    </p>

                </div>

            </section>

        `;

    }


    if (
        !state.liveTrip
    ) {

        return `

            <section
                class="
                    student-tracking-message
                    waiting
                "
            >

                <div
                    class="student-tracking-message-icon"
                >

                    <i
                        class="
                            fa-solid
                            fa-satellite-dish
                        "
                    ></i>

                </div>


                <div>

                    <span>
                        TRACKING STANDBY
                    </span>

                    <h3>
                        Your bus is not live right now
                    </h3>

                    <p>
                        Live tracking will appear
                        automatically when the bus
                        starts its trip.
                    </p>

                </div>

            </section>

        `;

    }


    return "";

}
/* ==========================================================
   EVENT BINDING
========================================================== */

function bindTrackingEvents() {

    const buttons =
        document.querySelectorAll(
            "[data-tracking-view]"
        );


    buttons.forEach(
        button => {

            button.addEventListener(
                "click",
                () => {

                    setTrackingView(
                        button.dataset.trackingView
                    );

                }
            );

        }
    );


    /* ========================================================
       MANUAL REFRESH
    ======================================================== */

    const refreshButton =
        document.querySelector(
            "#student-tracking-refresh"
        );


    if (refreshButton) {

        refreshButton.addEventListener(
            "click",
            async () => {

                refreshButton.disabled =
                    true;


                try {

                    await refreshTracking();

                }

                finally {

                    refreshButton.disabled =
                        false;

                }

            }
        );

    }

}


/* ==========================================================
   INITIAL PAGE RENDER
========================================================== */

function renderTrackingPage() {

    const root =
        document.createElement(
            "section"
        );


    root.className =
        "student-tracking-page";


    root.innerHTML = `

        <!-- ==============================================
             PAGE HEADER
        =============================================== -->

        ${renderHeader()}


        <!-- ==============================================
             TRACKING SUMMARY
        =============================================== -->

        <div
            id="student-tracking-summary"
            class="student-tracking-summary"
        >
        </div>


        <!-- ==============================================
             CURRENT / NEXT STOP INFORMATION
        =============================================== -->

        <div
            id="student-tracking-stop-information"
            class="student-tracking-stop-information"
        >
        </div>

        <!-- ==============================================
             TRACKING MESSAGE
        =============================================== -->

        <div
            id="student-tracking-message"
        >

            ${renderTrackingMessage()}

        </div>


        <!-- ==============================================
             MAP VIEW
        =============================================== -->

        ${renderMapView()}


        <!-- ==============================================
             TRACK VIEW
        =============================================== -->

        ${renderTrackView()}


        <!-- ==============================================
             REFRESH CONTROL
        =============================================== -->

        <div
            class="student-tracking-footer"
        >

            <button
                id="student-tracking-refresh"
                class="student-refresh-button"
                type="button"
            >

                <i
                    class="fa-solid fa-rotate"
                    aria-hidden="true"
                ></i>

                Refresh

            </button>


            <span
                class="student-tracking-refresh-note"
            >

                Live position updates automatically.

            </span>

        </div>

    `;


    return root;

}


/* ==========================================================
   UPDATE MESSAGE
========================================================== */

function updateTrackingMessage() {

    const container =
        document.querySelector(
            "#student-tracking-message"
        );


    if (!container) {

        return;

    }


    container.innerHTML =
        renderTrackingMessage();

}
/* ==========================================================
   UPDATE MAP OVERLAY
========================================================== */

function updateMapOverlay() {

    const busNumberElement =
        document.querySelector(
            "#student-map-bus-number"
        );


    const positionElement =
        document.querySelector(
            "#student-map-position-status"
        );


    /*
     * Update assigned bus number.
     */

    if (busNumberElement) {

        busNumberElement.textContent =
            state.assignedBus?.bus_number ||
            "No Bus";

    }


    /*
     * Update live position state.
     */

    if (positionElement) {

        positionElement.textContent =
            state.liveTrip
                ? `${vehicleTravelStatus()} · ${trackingSourceLabel()}`
                : "Waiting";

    }

}

/* ==========================================================
   UPDATE ALL TRACKING UI
========================================================== */
/* ==========================================================
   UPDATE TRACKING INTERFACE
========================================================== */

function updateTrackingInterface() {

    const root =
        document.querySelector(
            ".student-tracking-page"
        );


    if (!root) {

        return;

    }


    /*
     * Update the main tracking message.
     *
     * This removes:
     * "Connecting to live tracking..."
     *
     * once the API request has completed.
     */
    updateTrackingMessage();

    updateTrackingInfoBar();


    /*
     * Update the railway-style interface.
     */
    updateTrackView();


    /*
     * Update the map overlay.
     */
    updateMapOverlay();


    /*
     * Update the geographical map.
     */
    if (
        currentView === "map"
    ) {

        initializeMap();

        updateBusPosition();

    }

}
/* ==========================================================
   INITIALIZE MODULE
========================================================== */

async function initializeTrackingModule() {

    state.loading =
        true;

    state.refreshInProgress = false;

    state.error =
        null;


    /*
     * Load the initial student/tracking
     * information before starting the
     * automatic refresh cycle.
     */

    try {

        await loadStudentTracking();

    }

    catch (error) {

        console.error(
            "BusTrack: Student tracking initialization failed.",
            error
        );


        state.error =
            error.message ||
            "Unable to initialize live tracking.";

    }

    finally {

        state.loading =
            false;

    }


    /*
    * Render the initial tracking interface.
    */

    updateTrackingInterface();


    /*
    * Calculate the first ETA after the
    * initial GPS data has been loaded.
    */

    await calculateNextStopETA();

    /*
     * Initialize the default Map view.
     */

    setTrackingView(
        currentView
    );


    /*
     * Bind user interaction.
     */

    bindTrackingEvents();


    /*
     * Start automatic GPS refresh.
     */

    startTrackingRefresh();

}

/* ==========================================================
   PUBLIC MODULE RENDER
========================================================== */

export function render() {

    /*
     * Always reset the view to Map when
     * the student enters Live Tracking.
     */

    state.lifecycleId++;

    currentView =
        "map";


    /*
     * Reset temporary state.
     */

    state.student =
        null;

    state.assignedBus =
        null;

    state.liveTrip =
        null;

    state.trackingData =
        null;

    state.loading =
        true;

    state.error =
        null;


    /*
     * Make sure a previous timer cannot
     * continue running.
     */

    stopTrackingRefresh();


    /*
     * Clean up any previous Leaflet map.
     */

    if (state.map) {

        state.map.remove();

        state.map =
            null;

    }


    state.busMarker =
        null;

    state.stopMarkers = [];

    state.routeLine =
        null;

    state.roadRoute =
        [];

    state.roadRouteLoaded =
        false;

    state.roadRouteDistance =
        0;

    state.roadRouteDuration =
        0;
    state.etaDistanceMeters =
        null;

    state.etaMinutes =
        null;

    state.etaLoading =
        false;

    state.etaRequestId =
        0;

    state.etaOrigin = null;
    state.etaDestinationId = null;
    state.etaLastCalculatedAt = 0;

    state.routeDirection =
        null;


    /*
     * Create the module page.
     */

    const root =
        renderTrackingPage();

    // The router invokes cleanup on the rendered view, not the module object.
    // Register it here so polling, Leaflet, and animation frames cannot leak
    // into the next student page.
    root.cleanup = cleanupTracking;


    /*
     * Insert the page into the SPA.
     */

    requestAnimationFrame(
        () => {

            initializeTrackingModule();

        }
    );


    return root;

}


/* ==========================================================
   MODULE CLEANUP
========================================================== */

export function destroy() {

    cleanupTracking();

}

function updateTrackingInfoBar() {
    const speed = document.querySelector("#student-tracking-speed");
    if (speed) speed.textContent = formatSpeed(state.liveTrip?.speed);

    const updated = document.querySelector("#student-tracking-last-updated");
    if (updated) updated.textContent = formatLastUpdate(state.liveTrip?.last_location_update);

    const status = document.querySelector("#student-tracking-live-status");
    if (status) status.innerHTML = renderLiveStatus();
}
