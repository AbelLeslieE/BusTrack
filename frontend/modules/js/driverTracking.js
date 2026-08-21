/**
 * Driver Live Tracking
 * UI only (Phase 1)
 */
import {

    initializeMap,

    startTrip,

    stopTrip,

    reverseRouteDirection,

    loadCurrentTrip,

    cleanupTracking,

    initializeTrackingSource

} from "./trackingService.js";
export function render() {

    const page = document.createElement("div");

    page.className = "driver-tracking";

    page.innerHTML = `

        <!-- ==========================================
             TRACKING HERO
        =========================================== -->

        <section class="tracking-hero glass-panel">

            <div class="tracking-header">

                <p class="tracking-title">

                    LIVE GPS TRACKING

                </p>

                <h1>

                    Driver Live Tracking

                </h1>

                <p class="tracking-subtitle">

                    Start your assigned trip and share your live location.

                </p>

            </div>

        </section>


        <!-- ==========================================
             MAIN GRID
        =========================================== -->

        <section class="tracking-grid">

            <!-- LEFT SIDE -->

            <div class="tracking-left">

                <div class="tracking-card glass-panel">

                    <h3>

                        Trip Status

                    </h3>

                    <div class="tracking-info">

                        <div class="tracking-source" id="trackingSourceCard">
                            <div class="tracking-source-heading">
                                <span class="tracking-source-icon" aria-hidden="true"><i data-lucide="radio-tower"></i></span>
                                <div>
                                    <span class="tracking-source-label">PRIMARY LOCATION SOURCE</span>
                                    <strong id="trackingSourceValue">Checking vehicle GPS…</strong>
                                </div>
                                <span id="trackingSourcePill" class="tracking-source-pill">Checking</span>
                            </div>
                            <p id="trackingSourceReason">Vehicle GPS is preferred whenever its ignition-on signal is fresh.</p>
                            <p class="tracking-source-policy"><i data-lucide="shield-check" aria-hidden="true"></i> Vehicle and phone GPS updates are combined to keep the trip continuous.</p>
                            <button type="button" id="mobileFallbackBtn" class="mobile-fallback-btn" hidden>Start with phone GPS (testing)</button>
                        </div>

                        <div class="tracking-row">

                            <span>Status</span>

                            <strong id="tripStatus">

                                ⚫ Ready

                            </strong>

                        </div>

                        <div class="tracking-row">

                            <span>Current Bus</span>

                            <strong id="tripBus">
                                --
                            </strong>

                        </div>

                        <div class="tracking-row">

                            <span>Current Route</span>

                            <strong id="tripRoute">
                                --
                            </strong>

                        </div>

                        <div class="tracking-row">

                            <span>GPS</span>

                            <strong id="gpsStatus">

                                Waiting...

                            </strong>

                        </div>

                        <div class="tracking-row tracking-active-source-row">

                            <span>Tracked by</span>

                            <strong id="activeTrackingSource">

                                Checking…

                            </strong>

                        </div>

                        <div class="tracking-row">

                            <span>Route Direction</span>

                            <strong id="routeDirection">Outbound journey</strong>

                        </div>

                        <div class="tracking-row">

                            <span>Last Update</span>

                            <strong id="lastUpdate">

                                --

                            </strong>

                        </div>

                    </div>

                    <div class="tracking-actions">

                        <button
                            id="startTripBtn"
                            class="start-trip-btn">

                            <i data-lucide="play"></i>

                            <span>Start Trip</span>

                        </button>

                        <button 
                            id="stopTripBtn"
                            class="stop-trip-btn"
                            disabled>

                            <i data-lucide="square"></i>

                            <span>Stop Trip</span>

                        </button>

                        <button
                            id="reverseRouteBtn"
                            class="reverse-route-btn"
                            disabled>

                            <i data-lucide="repeat-2"></i>

                            <span>Change Direction</span>

                        </button>

                    </div>

                </div>


                <div class="tracking-card glass-panel">

                    <h3>

                        Live GPS

                    </h3>

                    <div class="tracking-info">

                        <div class="tracking-row">

                            <span>Latitude</span>

                            <strong id="latitude">

                                --

                            </strong>

                        </div>

                        <div class="tracking-row">

                            <span>Longitude</span>

                            <strong id="longitude">

                                --

                            </strong>

                        </div>

                        <div class="tracking-row">

                            <span>Speed</span>

                            <strong id="speed">

                                --

                            </strong>

                        </div>

                        <div class="tracking-row">

                            <span>Accuracy</span>

                            <strong id="accuracy">

                                --

                            </strong>

                        </div>

                    </div>

                </div>

            </div>


            <!-- RIGHT SIDE -->

            <div class="tracking-map glass-panel">

                <div class="tracking-map-heading">
                    <h3>

                        Live Map

                    </h3>
                    <span id="mapTrackingSource" class="map-tracking-source">Checking source…</span>
                </div>

                <div id="driverMap">

                    <div class="map-placeholder">

                        Live map will appear here

                    </div>

                </div>

            </div>

        </section>

    `;

    setTimeout(() => {

        console.log("Calling initializeMap()");

        initializeMap();

        initializeTrackingSource();

        console.log("initializeMap() finished");

        if (window.lucide) {
            lucide.createIcons();
        }

        console.log("Calling loadCurrentTrip()");

        loadCurrentTrip();

        const startButton = document.getElementById("startTripBtn");

        const stopButton = document.getElementById("stopTripBtn");

        const reverseButton = document.getElementById("reverseRouteBtn");

        if (startButton) {
            startButton.addEventListener("click", startTrip);
        }

        if (stopButton) {
            stopButton.addEventListener("click", stopTrip);
        }

        if (reverseButton) {
            reverseButton.addEventListener("click", reverseRouteDirection);
        }

    }, 100);


    /* ==========================================================
    MODULE CLEANUP
    ========================================================== */

    page.cleanup = cleanupTracking;

    return page;

    }
