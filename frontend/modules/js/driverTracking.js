/**
 * Driver Live Tracking
 * UI only (Phase 1)
 */
import {

    initializeMap,

    startTrip,

    stopTrip,

    loadCurrentTrip

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

                        <div class="tracking-row">

                            <span>Status</span>

                            <strong id="tripStatus">

                                ⚫ Ready

                            </strong>

                        </div>

                        <div class="tracking-row">

                            <span>Current Bus</span>

                            <strong id="tripBus">

                                BUS-014

                            </strong>

                        </div>

                        <div class="tracking-row">

                            <span>Current Route</span>

                            <strong id="tripRoute">

                                Route 5

                            </strong>

                        </div>

                        <div class="tracking-row">

                            <span>GPS</span>

                            <strong id="gpsStatus">

                                Waiting...

                            </strong>

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

                <h3>

                    Live Map

                </h3>

                <div id="driverMap">

                    <div class="map-placeholder">

                        Live map will appear here

                    </div>

                </div>

            </div>

        </section>

    `;

    setTimeout(() => {

        initializeMap();
        if (window.lucide) {
            lucide.createIcons();
        }
        loadCurrentTrip();
        const startButton = document.getElementById(
            "startTripBtn"
        );

        const stopButton = document.getElementById(
            "stopTripBtn"
        );

        startButton.addEventListener(
            "click",
            startTrip
        );

        stopButton.addEventListener(
            "click",
            stopTrip
        );

    },100);

    return page;

}