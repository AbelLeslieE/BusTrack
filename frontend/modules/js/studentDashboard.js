/* ==========================================================
   BUSTRACK
   STUDENT DASHBOARD
   ========================================================== */

import { escapeHtml } from "/static/common/security.js";
import { animateVehicleMarker } from "/static/common/vehicleMotion.js?v=road-safe-5";
import { createVehicleMarkerIcon } from "/static/common/vehicleMarker.js";




/* ==========================================================
   RENDER
========================================================== */

export function render() {

    /* ======================================================
       STUDENT PORTAL THEME
    ====================================================== */

    document.body.classList.add(
        "student-theme"
    );


    /* ======================================================
       CREATE STUDENT DASHBOARD PAGE
    ====================================================== */

    const page =
        document.createElement("section");


    page.className =
        "student-dashboard-page";


    page.innerHTML = `

        <!-- ==================================================
             DASHBOARD HEADER
        =================================================== -->

        <div class="student-dashboard-header">

            <div>

                <p class="student-dashboard-eyebrow">
                    STUDENT PORTAL
                </p>

                <h2>
                    Where Is My Bus?
                </h2>

                <p class="student-dashboard-description">
                    Track your assigned bus and see when it
                    will arrive at your stop.
                </p>

            </div>


            <!-- ==============================================
                 LIVE STATUS
            =============================================== -->

            <div class="student-live-status">

                <span
                    class="student-live-status-dot"
                    aria-hidden="true">
                </span>

                <span>
                    Live tracking
                </span>

            </div>

        </div>


        <!-- ==================================================
             STATUS CARDS
        =================================================== -->

        <section
            class="student-status-grid"
            aria-label="Bus status">

            <!-- ==============================================
                 MY BUS
            =============================================== -->

            <article class="student-status-card">

                <div class="student-status-card-header">

                    <span class="student-status-icon">

                        <i
                            class="fa-solid fa-bus"
                            aria-hidden="true">
                        </i>

                    </span>

                    <span class="student-status-label">
                        My Bus
                    </span>

                </div>


                <strong
                    id="student-bus-number">

                    Not Assigned

                </strong>


                <span
                    class="student-status-secondary"
                    id="student-bus-status">

                    No bus assigned yet

                </span>

            </article>


            <!-- ==============================================
                 CURRENT STATUS
            =============================================== -->

            <article class="student-status-card">

                <div class="student-status-card-header">

                    <span class="student-status-icon">

                        <i
                            class="fa-solid fa-satellite-dish"
                            aria-hidden="true">
                        </i>

                    </span>

                    <span class="student-status-label">
                        Current Status
                    </span>

                </div>


                <strong
                    id="student-current-status">

                    Not Active

                </strong>


                <span
                    class="student-status-secondary">

                    Waiting for live tracking

                </span>

            </article>


            <!-- ==============================================
                 NEXT STOP
            =============================================== -->

            <article class="student-status-card">

                <div class="student-status-card-header">

                    <span class="student-status-icon">

                        <i
                            class="fa-solid fa-location-dot"
                            aria-hidden="true">
                        </i>

                    </span>

                    <span class="student-status-label">
                        Next Stop
                    </span>

                </div>


                <strong
                    id="student-next-stop">

                    —

                </strong>


                <span
                    class="student-status-secondary"
                    id="student-next-stop-distance">

                    No active route

                </span>

            </article>


            <!-- ==============================================
                 ETA
            =============================================== -->

            <article class="student-status-card">

                <div class="student-status-card-header">

                    <span class="student-status-icon">

                        <i
                            class="fa-solid fa-clock"
                            aria-hidden="true">
                        </i>

                    </span>

                    <span class="student-status-label">
                        Estimated Arrival
                    </span>

                </div>


                <strong
                    id="student-eta">

                    —

                </strong>


                <span
                    class="student-status-secondary">

                    Waiting for bus location

                </span>

            </article>

        </section>


        <!-- ==================================================
             LIVE MAP
        =================================================== -->

        <section
            class="student-map-panel glass-panel">

            <div class="student-section-header">

                <div>

                    <p class="student-section-eyebrow">
                        LIVE LOCATION
                    </p>

                    <h3>
                        Bus Location
                    </h3>

                </div>


                <div
                    class="student-map-status"
                    id="student-map-status">

                    <span></span>

                    No active bus

                </div>

            </div>


            <div
                class="student-map"
                id="student-bus-map"
                aria-label="Live bus location map">
            </div>


            <!-- ==============================================
                 MAP EMPTY OVERLAY
            =============================================== -->

            <div
                class="student-map-empty"
                id="student-map-empty">

                <div class="student-map-empty-icon">

                    <i
                        class="fa-solid fa-bus"
                        aria-hidden="true">
                    </i>

                </div>


                <h4>
                    No active bus
                </h4>


                <p>
                    Your bus location will appear here
                    once a bus is assigned and live tracking
                    begins.
                </p>

            </div>

        </section>


        <!-- ==================================================
             LOWER DASHBOARD GRID
        =================================================== -->

        <section class="student-dashboard-grid">


            <!-- ==============================================
                 ROUTE PROGRESS
            =============================================== -->

            <article
                class="student-dashboard-panel glass-panel">

                <div class="student-section-header">

                    <div>

                        <p class="student-section-eyebrow">
                            YOUR ROUTE
                        </p>

                        <h3>
                            Route Progress
                        </h3>

                    </div>

                </div>


                <div
                    class="student-route-progress"
                    id="student-route-progress">

                    <div class="student-empty-state">

                        <div class="student-empty-icon">

                            <i
                                class="fa-solid fa-route"
                                aria-hidden="true">
                            </i>

                        </div>


                        <h4>
                            No active route
                        </h4>


                        <p>
                            Your route and stop progress
                            will appear here.
                        </p>

                    </div>

                </div>

            </article>


            <!-- ==============================================
                 BUS INFORMATION
            =============================================== -->

            <article
                class="student-dashboard-panel glass-panel">

                <div class="student-section-header">

                    <div>

                        <p class="student-section-eyebrow">
                            BUS INFORMATION
                        </p>

                        <h3>
                            Assigned Bus
                        </h3>

                    </div>

                </div>


                <div class="student-bus-information">

                    <div class="student-info-row">

                        <span>
                            Bus Number
                        </span>

                        <strong
                            id="student-info-bus">
                            —
                        </strong>

                    </div>


                    <div class="student-info-row">

                        <span>
                            Route
                        </span>

                        <strong
                            id="student-info-route">
                            —
                        </strong>

                    </div>


                    <div class="student-info-row">

                        <span>
                            Driver
                        </span>

                        <strong
                            id="student-info-driver">
                            —
                        </strong>

                    </div>


                    <div class="student-info-row">

                        <span>
                            Current Speed
                        </span>

                        <strong
                            id="student-info-speed">
                            —
                        </strong>

                    </div>


                    <div class="student-info-row">

                        <span>
                            Last Updated
                        </span>

                        <strong
                            id="student-info-updated">
                            —
                        </strong>

                    </div>

                </div>

            </article>

        </section>


        <!-- ==================================================
             NOTIFICATION / INFORMATION PANEL
        =================================================== -->

        <section
            class="student-information-panel glass-panel">

            <div class="student-information-icon">

                <i
                    class="fa-solid fa-circle-info"
                    aria-hidden="true">
                </i>

            </div>


            <div>

                <h3>
                    Your bus tracker
                </h3>

                <p>
                    Once an admin assigns
                    a bus and route to your account, your
                    live location, next stop and estimated
                    arrival time will appear automatically.
                </p>

            </div>

        </section>

    `;


        /* ======================================================
       INITIALIZE MAP
    ====================================================== */

    initializeStudentMap(page);


    /* ======================================================
       LOAD CURRENT STUDENT DATA
    ====================================================== */

    loadCurrentStudent(page);

    // Assignment details are loaded once; this endpoint supplies the changing
    // GPS position, speed, and next-stop state for the dashboard itself.
    startDashboardTracking(page);

    page.cleanup = () => cleanupStudentDashboard(page);


    return page;

}
/* ==========================================================
   LOAD CURRENT STUDENT
========================================================== */

async function loadCurrentStudent(page) {

    if (!page) {
        return;
    }


    /* ======================================================
       GET ACCESS TOKEN
    ====================================================== */

    const token =
        localStorage.getItem(
            "bus_tracker_access_token"
        );


    if (!token) {

        console.error(
            "BusTrack: Student access token not found."
        );

        return;

    }


    try {

        /* ==================================================
           REQUEST CURRENT STUDENT
        ================================================== */

        const response =
            await fetch(
                "/api/students/me",
                {
                    method: "GET",

                    headers: {
                        "Authorization":
                            `Bearer ${token}`
                    }
                }
            );


        const data =
            await response.json();


        /* ==================================================
           API ERROR
        ================================================== */

        if (!response.ok) {

            console.error(
                "BusTrack: Unable to load student profile.",
                data
            );

            return;

        }


        /* ==================================================
           UPDATE ASSIGNED BUS
        ================================================== */

        if (data.assigned_bus) {

            updateStudentBusInformation(
                page,
                data.assigned_bus
            );

            updateStudentAssignmentStatus(
                page,
                data.assigned_bus
            );

        } else {

            clearStudentBusInformation(
                page
            );

        }


        /* ==================================================
           UPDATE ASSIGNED STOP
        ================================================== */

        if (data.assigned_stop) {

            updateStudentStopInformation(
                page,
                data.assigned_stop
            );

        } else {

            clearStudentStopInformation(
                page
            );

        }


        /* ==================================================
           UPDATE MAP
        ================================================== */

        updateStudentStopMap(
            page,
            data.assigned_stop
        );


    } catch (error) {

        console.error(
            "BusTrack: Student API request failed.",
            error
        );

    }

}

/* ==========================================================
   INITIALIZE STUDENT MAP
========================================================== */

function initializeStudentMap(page) {

    /*
        Leaflet is loaded globally by dashboard.html.

        We check for it before creating the map so that
        the Student Dashboard does not crash if Leaflet
        has not finished loading.
    */

    if (
        typeof window.L ===
        "undefined"
    ) {

        console.error(
            "BusTrack: Leaflet is not available."
        );

        return;

    }


    const mapElement =
        page.querySelector(
            "#student-bus-map"
        );


    if (!mapElement) {

        return;

    }


    /*
        Default map position.

        This is only the initial map view.
        It does NOT represent the student's bus.
    */

    const map =
        window.L.map(
            mapElement,
            {
                zoomControl: true
            }
        );


    map.setView(
        [10.2398, 76.2644],
        12
    );


    /* ======================================================
       OPENSTREETMAP TILE LAYER
    ====================================================== */

    window.L.tileLayer(
        "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
        {
            maxZoom: 19,

            attribution:
                '&copy; OpenStreetMap contributors'
        }
    ).addTo(map);


    /*
        Store the map instance on the page.

        The tracking module can use this later without
        creating another map.
    */

    page.studentMap =
        map;


    /*
        Leaflet sometimes calculates the map dimensions
        before the modal / SPA container has fully settled.

        invalidateSize() ensures the map renders correctly.
    */

    requestAnimationFrame(
        () => {

            map.invalidateSize();

        }
    );

}
/* ==========================================================
   UPDATE STUDENT STOP MAP
========================================================== */

function updateStudentStopMap(
    page,
    stop
) {

    if (!page || !page.studentMap) {
        return;
    }


    const map =
        page.studentMap;


    const mapStatus =
        page.querySelector(
            "#student-map-status"
        );


    const emptyOverlay =
        page.querySelector(
            "#student-map-empty"
        );


    /* ======================================================
       NO ASSIGNED STOP
    ====================================================== */

    if (
        !stop ||
        stop.latitude == null ||
        stop.longitude == null
    ) {

        if (mapStatus) {

            mapStatus.innerHTML =
                "<span></span> No active bus";

        }


        if (emptyOverlay) {

            emptyOverlay.style.display =
                "";

        }


        return;

    }


    /* ======================================================
       ASSIGNED STOP EXISTS
    ====================================================== */

    const latitude =
        Number(stop.latitude);


    const longitude =
        Number(stop.longitude);


    if (
        !Number.isFinite(latitude) ||
        !Number.isFinite(longitude)
    ) {

        return;

    }


    /* ======================================================
       CENTER MAP ON STUDENT STOP
    ====================================================== */

    map.setView(
        [
            latitude,
            longitude
        ],
        15
    );


    /* ======================================================
       CREATE STOP MARKER
    ====================================================== */

    if (page.studentStopMarker) {
        map.removeLayer(page.studentStopMarker);
    }

    const stopMarker =
        window.L.marker(
            [
                latitude,
                longitude
            ]
        ).addTo(map);

    page.studentStopMarker = stopMarker;


    stopMarker.bindPopup(
        `
            <strong>
                ${escapeHtml(stop.stop_name || "Assigned Stop")}
            </strong>
            <br>
            ${escapeHtml(stop.stop_code || "")}
        `
    );


    /* ======================================================
       UPDATE MAP STATUS
    ====================================================== */

    if (mapStatus) {

        mapStatus.innerHTML =
            `
                <span></span>
                Stop assigned
            `;

    }


    /* ======================================================
       HIDE EMPTY BUS OVERLAY
       Only when we actually have a stop.
    ====================================================== */

    if (emptyOverlay) {

        emptyOverlay.style.display =
            "none";

    }

}

/* ==========================================================
   UPDATE BUS INFORMATION
   Future API integration will use these functions.
========================================================== */

export function updateStudentBusInformation(
    page,
    bus
) {

    if (!page || !bus) {

        return;

    }


    const busNumber =
        page.querySelector(
            "#student-bus-number"
        );


    const infoBus =
        page.querySelector(
            "#student-info-bus"
        );


    if (busNumber) {

        busNumber.textContent =
            bus.bus_number ||
            "—";

    }


    if (infoBus) {

        infoBus.textContent =
            bus.bus_number ||
            "—";

    }


    const route =
        page.querySelector(
            "#student-info-route"
        );


    if (route) {

        route.textContent =
            bus.route?.route_name ||
            bus.route?.route_code ||
            bus.route ||
            "—";

    }


    const driver =
        page.querySelector(
            "#student-info-driver"
        );


    if (driver) {

        driver.textContent =
            bus.driver_name ||
            "—";

    }

}
/* ==========================================================
   UPDATE STUDENT ASSIGNMENT STATUS
========================================================== */

function updateStudentAssignmentStatus(
    page,
    bus
) {

    if (!page || !bus) {
        return;
    }


    const currentStatus =
        page.querySelector(
            "#student-current-status"
        );


    const busStatus =
        page.querySelector(
            "#student-bus-status"
        );


    if (currentStatus) {

        currentStatus.textContent =
            "Assigned";

    }


    if (busStatus) {

        busStatus.textContent = bus.status
            ? `Bus status: ${bus.status}`
            : "Bus assigned";

    }

}
/* ==========================================================
   UPDATE ASSIGNED STOP
========================================================== */

function updateStudentStopInformation(
    page,
    stop
) {

    if (!page || !stop) {
        return;
    }


    const nextStop =
        page.querySelector(
            "#student-next-stop"
        );


    const nextStopDistance =
        page.querySelector(
            "#student-next-stop-distance"
        );


    if (nextStop) {

        nextStop.textContent =
            stop.stop_name ||
            "Assigned Stop";

    }


    if (nextStopDistance) {

        nextStopDistance.textContent =
            stop.stop_code
                ? `Stop ${stop.stop_code}`
                : "Assigned stop";

    }

}
/* ==========================================================
   CLEAR BUS INFORMATION
========================================================== */

function clearStudentBusInformation(page) {

    if (!page) {
        return;
    }


    const busNumber =
        page.querySelector(
            "#student-bus-number"
        );


    const busStatus =
        page.querySelector(
            "#student-bus-status"
        );


    const currentStatus =
        page.querySelector(
            "#student-current-status"
        );


    const infoBus =
        page.querySelector(
            "#student-info-bus"
        );


    const infoRoute =
        page.querySelector(
            "#student-info-route"
        );


    const infoDriver =
        page.querySelector(
            "#student-info-driver"
        );


    if (busNumber) {

        busNumber.textContent =
            "Not Assigned";

    }


    if (busStatus) {

        busStatus.textContent =
            "No bus assigned yet";

    }


    if (currentStatus) {

        currentStatus.textContent =
            "Not Active";

    }


    if (infoBus) {

        infoBus.textContent =
            "—";

    }


    if (infoRoute) {

        infoRoute.textContent =
            "—";

    }


    if (infoDriver) {

        infoDriver.textContent =
            "—";

    }

}


/* ==========================================================
   CLEAR STOP INFORMATION
========================================================== */

function clearStudentStopInformation(page) {

    if (!page) {
        return;
    }


    const nextStop =
        page.querySelector(
            "#student-next-stop"
        );


    const nextStopDistance =
        page.querySelector(
            "#student-next-stop-distance"
        );


    if (nextStop) {

        nextStop.textContent =
            "—";

    }


    if (nextStopDistance) {

        nextStopDistance.textContent =
            "No active route";

    }

}
/* ==========================================================
   UPDATE LIVE STATUS
   Future tracking service will call this.
========================================================== */

export function updateStudentLiveStatus(
    page,
    trackingData
) {

    if (!page || !trackingData) {

        return;

    }


    const status =
        page.querySelector(
            "#student-current-status"
        );


    const speed =
        page.querySelector(
            "#student-info-speed"
        );


    const updated =
        page.querySelector(
            "#student-info-updated"
        );


    if (status) {

        status.textContent =
            trackingData.status ||
            "Active";

    }


    if (speed) {

        speed.textContent =
        (trackingData.speed ?? trackingData.current_speed) != null
                ? `${Number(trackingData.speed ?? trackingData.current_speed).toFixed(1)} km/h`
                : "—";

    }


    if (updated) {

        updated.textContent =
            trackingData.last_location_update
                ? formatUpdateTime(
                    trackingData.last_location_update
                )
                : "—";

    }

}


/* ==========================================================
   FORMAT LAST UPDATE TIME
========================================================== */

function formatUpdateTime(
    value
) {

    const date =
        new Date(value);


    if (
        Number.isNaN(
            date.getTime()
        )
    ) {

        return "—";

    }


    return date.toLocaleTimeString(
        [],
        {
            hour: "2-digit",
            minute: "2-digit"
        }
    );

}

/* ==========================================================
   LIVE DASHBOARD TRACKING
========================================================== */

async function fetchDashboardTracking() {
    const token = localStorage.getItem("bus_tracker_access_token");
    if (!token) throw new Error("Student access token not found.");

    const response = await fetch("/api/students/me/tracking", {
        method: "GET",
        cache: "no-store",
        headers: {
            "Authorization": `Bearer ${token}`,
            "Accept": "application/json",
            "Cache-Control": "no-cache"
        }
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(data?.detail || "Unable to load live tracking.");
    return data;
}

function dashboardTrackingLabel(trip) {
    if (!trip) return "Waiting for live tracking";
    if (!trip.telemetry?.is_fresh) return "Last known location";
    if (trip.telemetry?.moving === true) return "Bus moving";
    if (trip.telemetry?.ignition_on === false) return "Bus parked";
    return "Live tracking";
}

function updateStudentLiveMap(page, trip, bus) {
    if (!page?.studentMap || !trip) return;
    const latitude = Number(trip.latitude);
    const longitude = Number(trip.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;

    const map = page.studentMap;
    if (!page.studentBusMarker) {
        page.studentBusMarker = window.L.marker([latitude, longitude], {
            icon: createVehicleMarkerIcon(),
            zIndexOffset: 1000
        }).addTo(map);
        page.studentBusMotion = { heading: null, frame: null, followMap: true };
        map.setView([latitude, longitude], Math.max(map.getZoom(), 15));
    } else {
        animateVehicleMarker(
            page.studentBusMarker,
            latitude,
            longitude,
            page.studentBusMotion,
            ".fleet-vehicle-marker__visual"
        );
    }

    page.studentBusMarker.bindPopup(
        `<strong>${escapeHtml(bus?.bus_number || "Bus")}</strong><br>Speed: ${
            trip.speed == null ? "—" : `${Number(trip.speed).toFixed(1)} km/h`
        }`
    );
    const emptyOverlay = page.querySelector("#student-map-empty");
    if (emptyOverlay) emptyOverlay.style.display = "none";
    const mapStatus = page.querySelector("#student-map-status");
    if (mapStatus) mapStatus.innerHTML = `<span></span> ${escapeHtml(dashboardTrackingLabel(trip))}`;
}

function applyDashboardTracking(page, data) {
    if (!page.isConnected) return;

    const trip = data?.trip || null;
    const bus = data?.bus || null;
    if (bus) {
        updateStudentBusInformation(page, { ...bus, route: data.route || null });
        updateStudentAssignmentStatus(page, bus);
    }

    updateStudentLiveStatus(page, {
        status: dashboardTrackingLabel(trip),
        speed: trip?.speed,
        last_location_update: trip?.last_location_update
    });

    const nextStop = trip?.next_stop || data?.assigned_stop;
    if (nextStop) updateStudentStopInformation(page, nextStop);
    updateStudentLiveMap(page, trip, bus);

    const liveStatus = page.querySelector(".student-live-status span:last-child");
    if (liveStatus) liveStatus.textContent = dashboardTrackingLabel(trip);
}

async function refreshDashboardTracking(page) {
    if (!page.isConnected || page.dashboardTrackingInFlight) return;
    page.dashboardTrackingInFlight = true;
    try {
        applyDashboardTracking(page, await fetchDashboardTracking());
    } catch (error) {
        console.error("BusTrack: Student dashboard live tracking failed.", error);
    } finally {
        page.dashboardTrackingInFlight = false;
    }
}

function startDashboardTracking(page) {
    void refreshDashboardTracking(page);
    page.dashboardTrackingTimer = window.setInterval(
        () => void refreshDashboardTracking(page),
        3_000
    );
    page.dashboardVisibilityHandler = () => {
        if (document.visibilityState === "visible") void refreshDashboardTracking(page);
    };
    document.addEventListener("visibilitychange", page.dashboardVisibilityHandler);
}

function cleanupStudentDashboard(page) {
    if (page.dashboardTrackingTimer) window.clearInterval(page.dashboardTrackingTimer);
    if (page.dashboardVisibilityHandler) {
        document.removeEventListener("visibilitychange", page.dashboardVisibilityHandler);
    }
    if (page.studentBusMotion?.frame) cancelAnimationFrame(page.studentBusMotion.frame);
    if (page.studentMap) page.studentMap.remove();
    page.studentMap = null;
}
