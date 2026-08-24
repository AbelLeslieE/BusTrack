/**
 * Driver Live Tracking
 * UI only (Phase 1)
 */
import {

    initializeMap,

    startTrip,

    stopTrip,

    reverseRouteDirection,

    sendDriverFeedback,

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

                    Vehicle GPS tracks the bus automatically. Enable phone GPS only when you want to share the driver's location too.

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

                            <span>Tracked Bus</span>

                            <strong id="tripBus">
                                --
                            </strong>

                        </div>

                        <div class="tracking-row">

                            <span>Assigned Route</span>

                            <strong id="tripRoute">
                                --
                            </strong>

                        </div>

                        <div class="tracking-row">

                            <span>Location Source</span>

                            <strong id="gpsStatus">

                                Waiting...

                            </strong>

                        </div>

                        <div class="tracking-row tracking-active-source-row">

                            <span>Active Tracking</span>

                            <strong id="activeTrackingSource">

                                Checking…

                            </strong>

                        </div>

                        <div class="tracking-row">

                            <span>Route Direction</span>

                            <strong id="routeDirection">Outbound journey</strong>

                        </div>

                        <div class="tracking-row">

                            <span>Module Update</span>

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

                            <span>Enable Mobile GPS</span>

                        </button>

                        <button 
                            id="stopTripBtn"
                            class="stop-trip-btn"
                            disabled>

                            <i data-lucide="square"></i>

                            <span>Disable Mobile GPS</span>

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

                <section class="tracking-card glass-panel driver-feedback-card" aria-labelledby="driverFeedbackHeading">

                    <div class="feedback-heading">
                        <div>
                            <p class="tracking-title">SAFETY &amp; OPERATIONS</p>
                            <h3 id="driverFeedbackHeading">Send feedback</h3>
                        </div>
                        <span id="feedbackStatus" class="feedback-status" role="status" aria-live="polite"></span>
                    </div>

                    <p class="feedback-help">Send an immediate alert to the transport admin. Your assigned bus and route are included automatically.</p>

                    <label class="feedback-message-label" for="driverFeedbackMessage">Optional details</label>
                    <textarea id="driverFeedbackMessage" rows="3" maxlength="500" placeholder="Add location, delay details, or assistance needed…"></textarea>

                    <div class="feedback-actions" role="group" aria-label="Send operational feedback">
                        <button type="button" class="feedback-button feedback-high" data-feedback-type="traffic"><i data-lucide="traffic-cone" aria-hidden="true"></i>Traffic</button>
                        <button type="button" class="feedback-button feedback-medium" data-feedback-type="delay"><i data-lucide="clock-3" aria-hidden="true"></i>Delay</button>
                        <button type="button" class="feedback-button feedback-critical" data-feedback-type="breakdown"><i data-lucide="wrench" aria-hidden="true"></i>Breakdown</button>
                        <button type="button" class="feedback-button feedback-critical" data-feedback-type="medical"><i data-lucide="heart-pulse" aria-hidden="true"></i>Emergency</button>
                    </div>

                </section>


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

        const feedbackButtons = page.querySelectorAll("[data-feedback-type]");
        const feedbackStatus = page.querySelector("#feedbackStatus");
        const feedbackMessage = page.querySelector("#driverFeedbackMessage");

        feedbackButtons.forEach(button => {
            button.addEventListener("click", async () => {
                const feedbackType = button.dataset.feedbackType;
                feedbackButtons.forEach(item => { item.disabled = true; });
                feedbackStatus.textContent = "Sending alert…";
                feedbackStatus.className = "feedback-status";

                try {
                    const result = await sendDriverFeedback(
                        feedbackType,
                        feedbackMessage?.value || "",
                    );
                    if (feedbackMessage) feedbackMessage.value = "";
                    feedbackStatus.textContent = result.message || "Alert sent to the admin team.";
                    feedbackStatus.className = "feedback-status is-success";
                } catch (error) {
                    feedbackStatus.textContent = error.message || "Unable to send alert.";
                    feedbackStatus.className = "feedback-status is-error";
                } finally {
                    feedbackButtons.forEach(item => { item.disabled = false; });
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
