/** Admin fleet map shell backed by the shared live-tracking service. */
import {

    initializeFleetMap,

    startFleetRefresh,

    resizeFleetMap,

    cleanupFleetTracking

} from "./adminTrackingService.js?v=20261017reset4";
export function render() {

    const page = document.createElement("div");

    page.className = "live-tracking-page";

    page.innerHTML = `

        <!-- ==========================================
             HEADER
        =========================================== -->

        <section class="tracking-header glass-panel">

            <div class="tracking-header-copy">

                <p class="tracking-title">

                    LIVE TRACKING

                </p>

                <h1>

                    Fleet Live Monitoring

                </h1>

                <p>

                    Registered buses appear here. Switch views to see every bus's live stop-by-stop route progress or its map position.

                </p>

                <p class="tracking-header-note">

                    Buses without a GPS report clearly show that tracking is waiting to start. In map view, select a reported bus card to focus its real-time pin.

                </p>

            </div>

            <button class="tracking-view-toggle" id="trackingViewToggle" type="button" aria-controls="fleetMapView fleetTrackUpdates" aria-pressed="false">View route progress</button>

        </section>

        <!-- ==========================================
             MAIN GRID
        =========================================== -->

        <section class="live-grid" id="fleetMapView">

            <!-- LEFT -->

            <div class="live-sidebar glass-panel">

                <h3>

                    Tracked buses

                </h3>

                <p class="live-sidebar-note">

                    Each bus is visible here. Reported buses include the latest tracker status, ignition state, and reading time.

                </p>

                <div
                    id="tripList"
                    class="trip-list"
                    tabindex="0"
                    role="region"
                    aria-label="Tracked buses list">

                    <div class="empty-state">

                        Loading tracked buses…

                    </div>

                </div>

            </div>

            <!-- RIGHT -->

            <div class="live-map glass-panel">

                <h3>

                    Fleet Map

                </h3>

                <div id="fleetMap"></div>

            </div>

        </section>

        <section class="track-monitor glass-panel" id="fleetTrackUpdates" role="region" aria-label="Fleet track updates" hidden>
            <p class="empty-state">Loading fleet route progress…</p>
        </section>

    `;

    const toggle = page.querySelector("#trackingViewToggle");
    const mapView = page.querySelector("#fleetMapView");
    const trackView = page.querySelector("#fleetTrackUpdates");
    toggle.addEventListener("click", () => {
        const showTracks = trackView.hidden;
        trackView.hidden = !showTracks;
        mapView.hidden = showTracks;
        toggle.textContent = showTracks ? "View live map" : "View route progress";
        toggle.setAttribute("aria-pressed", String(showTracks));
        if (!showTracks) requestAnimationFrame(resizeFleetMap);
    });

    setTimeout(() => {

        initializeFleetMap();

        console.log("Map initialized");

        startFleetRefresh();

    }, 100);
    page.cleanup = cleanupFleetTracking;
    return page;
}
