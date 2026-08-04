/* ==========================================================
   BUS TRACK
   ROUTE VIEW MODAL
========================================================== */

import { Modal } from "./modal.js";

import { getRouteStops } from "../modules/js/routeStopsApi.js";
/* ==========================================================
   OPEN VIEW MODAL
========================================================== */

export async function openRouteViewModal(route) {

    const stops = route.stops || [];

    const stopList = stops.length
        ? stops.map(stop => `
            <div class="route-view-stop">

                <div class="route-view-stop-number">

                    ${stop.sequence}

                </div>

                <div class="route-view-stop-name">

                    ${stop.stop_name}

                </div>

            </div>
        `).join("")
        : `
            <div class="route-view-empty">

                No stops available.

            </div>
        `;

    Modal.open({

        size: "lg",

        title: "Route Details",

        subtitle: "View route information",

        content: `

            <div class="route-view">

                <div class="route-view-section">

                    <h3>Route Information</h3>

                    <div class="route-view-grid">

                        <div class="route-view-item">

                            <label>Route Code</label>

                            <span>${route.route_code}</span>

                        </div>

                        <div>

                            <label>Route Name</label>

                            <span>${route.route_name}</span>

                        </div>

                        <div>

                            <label>Status</label>

                            <span>${route.status}</span>

                        </div>

                        <div>

                            <label>Total Stops</label>

                            <span>${stops.length}</span>

                        </div>

                    </div>

                </div>

                <div class="route-view-section">

                    <h3>Stops</h3>

                    <div class="route-view-stop-list">

                        ${stopList}

                    </div>

                </div>

            </div>

        `,

        actions: [

            {

                text: "Close",

                style: "primary",

                close: true

            }

        ]

    });

}