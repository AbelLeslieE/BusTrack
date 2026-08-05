


/* ==========================================================
   ADMIN LIVE TRACKING SERVICE
========================================================== */

let map = null;

const markers = new Map();

/* ==========================================================
   INITIALIZE MAP
========================================================== */

export function initializeFleetMap(containerId = "fleetMap") {

    if (map) {

        map.remove();

    }

    map = L.map(containerId).setView(

        [10.5276, 76.2144],

        13

    );

    L.tileLayer(

        "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",

        {

            attribution: "&copy; OpenStreetMap contributors"

        }

    ).addTo(map);

}
/* ==========================================================
   LOAD LIVE BUSES
========================================================== */

export async function loadLiveTrips() {

    const token = localStorage.getItem(
        "bus_tracker_access_token"
    );

    const response = await fetch(

        "/api/gps/live",

        {

            headers: {

                Authorization: `Bearer ${token}`

            }

        }

    );

    if (!response.ok) {

        console.error("Unable to load trips");

        return;

    }

    const trips = await response.json();

    console.log("LIVE RESPONSE:", trips);

    updateFleet(trips);

}
/* ==========================================================
   LIVE REFRESH TIMER
========================================================== */

let refreshInterval = null;


/* ==========================================================
   START LIVE REFRESH
========================================================== */

export function startFleetRefresh() {

    // Prevent multiple timers

    if (refreshInterval) {

        clearInterval(refreshInterval);

    }

    // First load immediately

    loadLiveTrips();

    // Refresh every 2 seconds

    refreshInterval = setInterval(() => {

        loadLiveTrips();

    }, 2000);

}

/* ==========================================================
   UPDATE MAP
========================================================== */

/* ==========================================================
   UPDATE FLEET UI
========================================================== */

/* ==========================================================
   UPDATE FLEET UI
========================================================== */

/* ==========================================================
   UPDATE FLEET UI
========================================================== */

/* ==========================================================
   UPDATE FLEET UI
========================================================== */

function updateFleet(trips) {

    if (!Array.isArray(trips)) {

        console.error("Expected array but received:", trips);

        trips = [];

    }

    const activeBusCount =
        document.getElementById("activeBusCount");

    const onlineDriverCount =
        document.getElementById("onlineDriverCount");

    if (activeBusCount) {

        activeBusCount.textContent = trips.length;

    }

    if (onlineDriverCount) {

        onlineDriverCount.textContent = trips.length;

    }

    const tripList =
        document.getElementById("tripList");

    if (!tripList) {

        return;

    }

    tripList.innerHTML = "";

    // Remove old markers
    markers.forEach(marker => marker.remove());

    markers.clear();

    if (trips.length === 0) {

        tripList.innerHTML = `

            <div class="empty-state">

                No active trips.

            </div>

        `;

        return;

    }

    trips.forEach((trip) => {

        // ---------------------------------------------
        // Create Marker
        // ---------------------------------------------

        if (
            trip.latitude != null &&
            trip.longitude != null
        ) {

            const marker = L.marker([

                trip.latitude,

                trip.longitude

            ]).addTo(map);

            marker.bindPopup(`

                <strong>

                    BUS-${String(trip.bus_id).padStart(3,"0")}

                </strong>

                <br>

                Driver : ${trip.driver_id}

                <br>

                Route : ${trip.route_id}

                <br>

                Speed : ${trip.speed ?? "--"} km/h

            `);

            markers.set(

                trip.bus_id,

                marker

            );

        }

        // ---------------------------------------------
        // Card
        // ---------------------------------------------

        const card = document.createElement("div");

        card.className = "trip-card";

        card.innerHTML = `

            <div class="trip-header">

                <strong>

                    BUS-${String(trip.bus_id).padStart(3,"0")}

                </strong>

                <span class="trip-status">

                    🟢 ${trip.status ?? "Running"}

                </span>

            </div>

            <div class="trip-body">

                <p>

                    Driver ID :

                    <strong>${trip.driver_id ?? "--"}</strong>

                </p>

                <p>

                    Route :

                    <strong>${trip.route_id ?? "--"}</strong>

                </p>

                <p>

                    Speed :

                    <strong>${trip.speed ?? "--"} km/h</strong>

                </p>

                <p>

                    Updated :

                    <strong>

                        ${
                            trip.last_location_update
                            ? new Date(
                                trip.last_location_update
                              ).toLocaleTimeString()
                            : "--"
                        }

                    </strong>

                </p>

            </div>

        `;

        // ---------------------------------------------
        // Click Card
        // ---------------------------------------------

        card.addEventListener("click", () => {

            document
                .querySelectorAll(".trip-card")
                .forEach(c =>

                    c.classList.remove("selected")

                );

            card.classList.add("selected");

            const marker =
                markers.get(trip.bus_id);

            if (!marker) return;

            map.flyTo(

                marker.getLatLng(),

                18,

                {

                    animate:true,

                    duration:1

                }

            );

            marker.openPopup();

        });

        tripList.appendChild(card);

    });

}