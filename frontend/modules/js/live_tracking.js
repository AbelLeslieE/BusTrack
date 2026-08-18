/** Live Tracking module placeholder. TODO: Generate this module's HTML and behavior here. */
/**
 * Admin Live Tracking
 * Phase 1 - UI
 */
import {

    initializeFleetMap,

    startFleetRefresh,

    cleanupFleetTracking

} from "./adminTrackingService.js";
export function render() {

    const page = document.createElement("div");

    page.className = "live-tracking-page";

    page.innerHTML = `

        <!-- ==========================================
             HEADER
        =========================================== -->

        <section class="tracking-header glass-panel">

            <div>

                <p class="tracking-title">

                    LIVE TRACKING

                </p>

                <h1>

                    Fleet Live Monitoring

                </h1>

                <p>

                    Buses appear here after their configured GPS device reports a position.

                </p>

                <p class="tracking-header-note">

                    Select a bus card to focus its real-time map pin. Only reported vehicle data is shown—there are no demo buses or placeholder status cards.

                </p>

            </div>

        </section>

        <!-- ==========================================
             MAIN GRID
        =========================================== -->

        <section class="live-grid">

            <!-- LEFT -->

            <div class="live-sidebar glass-panel">

                <h3>

                    Tracked buses

                </h3>

                <p class="live-sidebar-note">

                    Each card shows the latest GPS status supplied by the tracker, including ignition state and when that reading was recorded.

                </p>

                <div
                    id="tripList"
                    class="trip-list">

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

    `;

    setTimeout(() => {

        initializeFleetMap();

        console.log("Map initialized");

        startFleetRefresh();

    }, 100);
    page.cleanup = cleanupFleetTracking;
    return page;
}
