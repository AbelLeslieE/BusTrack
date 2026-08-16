/**
 * Driver Live Tracking
 * UI only (Phase 1)
 */
import {

    initializeMap,

    startTrip,

    stopTrip,

    loadCurrentTrip,

    sendDriverFeedback,

    cleanupTracking

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

                <div class="tracking-card glass-panel driver-feedback-card">
                    <div class="feedback-heading">
                        <div>
                            <p class="tracking-title">SAFETY FEEDBACK</p>
                            <h3>Report an issue</h3>
                        </div>
                        <span id="feedbackStatus" class="feedback-status" role="status"></span>
                    </div>
                    <p class="feedback-help">Use a button to alert the admin team. Active trip, bus, and route details are attached automatically when available.</p>
                    <textarea id="feedbackMessage" maxlength="500" rows="2" placeholder="Optional details for the transport team"></textarea>
                    <div class="feedback-actions" role="group" aria-label="Report an operational issue">
                        <button type="button" class="feedback-button feedback-high" data-feedback-type="traffic">Traffic</button>
                        <button type="button" class="feedback-button feedback-critical" data-feedback-type="breakdown">Bus breakdown</button>
                        <button type="button" class="feedback-button feedback-critical" data-feedback-type="accident">Accident</button>
                        <button type="button" class="feedback-button feedback-critical" data-feedback-type="medical">Medical</button>
                        <button type="button" class="feedback-button feedback-medium" data-feedback-type="delay">Delay</button>
                        <button type="button" class="feedback-button feedback-medium" data-feedback-type="other">Other</button>
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

        console.log("Calling initializeMap()");

        initializeMap();

        console.log("initializeMap() finished");

        if (window.lucide) {
            lucide.createIcons();
        }

        console.log("Calling loadCurrentTrip()");

        loadCurrentTrip();

        const startButton = document.getElementById("startTripBtn");

        const stopButton = document.getElementById("stopTripBtn");

        if (startButton) {
            startButton.addEventListener("click", startTrip);
        }

        if (stopButton) {
            stopButton.addEventListener("click", stopTrip);
        }

        const feedbackStatus = document.getElementById("feedbackStatus");
        const feedbackMessage = document.getElementById("feedbackMessage");
        page.querySelectorAll("[data-feedback-type]").forEach(button => {
            button.addEventListener("click", async () => {
                const feedbackType = button.dataset.feedbackType;
                button.disabled = true;
                if (feedbackStatus) feedbackStatus.textContent = "Sending…";
                try {
                    await sendDriverFeedback(feedbackType, feedbackMessage?.value || "");
                    if (feedbackStatus) feedbackStatus.textContent = "Sent to management";
                    if (feedbackMessage) feedbackMessage.value = "";
                } catch (error) {
                    if (feedbackStatus) feedbackStatus.textContent = error.message;
                } finally {
                    button.disabled = false;
                    window.setTimeout(() => {
                        if (feedbackStatus) feedbackStatus.textContent = "";
                    }, 5000);
                }
            });
        });

    }, 100);


    /* ==========================================================
    MODULE CLEANUP
    ========================================================== */

    page.cleanup = cleanupTracking;

    return page;

    }
