/** Live Tracking module placeholder. TODO: Generate this module's HTML and behavior here. */
/**
 * Admin Live Tracking
 * Phase 1 - UI
 */
import {

    initializeFleetMap,

    startFleetRefresh

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

                    Monitor every active bus in real time.

                </p>

            </div>

            <div class="tracking-stats">

                <div class="tracking-stat">

                    <span>Active Buses</span>

                    <strong id="activeBusCount">

                        0

                    </strong>

                </div>

                <div class="tracking-stat">

                    <span>Online Drivers</span>

                    <strong id="onlineDriverCount">

                        0

                    </strong>

                </div>

            </div>

        </section>

        <!-- ==========================================
             MAIN GRID
        =========================================== -->

        <section class="live-grid">

            <!-- LEFT -->

            <div class="live-sidebar glass-panel">

                <h3>

                    Active Trips

                </h3>

                <div
                    id="tripList"
                    class="trip-list">

                    <div class="empty-state">

                        No active trips.

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

        startFleetRefresh();

    }, 100);
    return page;
}