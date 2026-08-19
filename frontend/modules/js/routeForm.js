/* ==========================================================================
   BUSTRACK
   ROUTE FORM
========================================================================== */

import { createDropdown } from "/static/common/dropdown.js";
import { escapeHtml } from "/static/common/security.js";
import { confirmDeletion, showOperationFeedback } from "/static/common/operationFeedback.js";
/* ==========================================================================
   ROUTE BUILDER STATE
========================================================================== */

// All stops loaded from the Master Stops database
let availableStops = [];

// Stops currently selected for this route
let selectedStops = [];
/* ==========================================================================
   ROUTE MAP STATE
========================================================================== */

let routeMap = null;

let routeMapContainer = null;

let routeLayer = null;

let routeStopMarkers = [];
/* ==========================================================================
   CREATE FORM
========================================================================== */

export function createRouteForm(
    route = {},
    _buses = [],
    _drivers = []
) {

    const wrapper = document.createElement("div");

    wrapper.className = "route-form";

    wrapper.innerHTML = `

        ${renderRouteInformation(route)}

        ${renderSchedule(route)}

        ${renderStatus(route)}

        ${renderRouteStops()}

    `;

    initializeDropdowns(
        wrapper,
        route
    );



    /* ==========================================================
    INITIALIZE ROUTE BUILDER
    ========================================================== */

    selectedStops = [];

    clearRouteMap();

    renderSelectedStops();


    loadMasterStops().then(()=>{

        initializeRouteBuilder();

    });

    return wrapper;

}
/* ==========================================================================
   ROUTE INFORMATION
========================================================================== */

function renderRouteInformation(route){

    return `

        <section class="modal-section">

            <h3 class="modal-section-title">

                Route Information

            </h3>

            <div class="modal-grid">

                ${createInput({
                    id:"route_code",
                    label:"Route Code",
                    value:route.route_code || "",
                    placeholder:"RT001",
                    required:true
                })}

                ${createInput({
                    id:"route_name",
                    label:"Route Name",
                    value:route.route_name || "",
                    placeholder:"Angamaly Route",
                    required:true
                })}

            </div>

        </section>

    `;

}
/* ==========================================================================
   SCHEDULE
========================================================================== */

function renderSchedule(route){

    return `

        <section class="modal-section">

            <h3 class="modal-section-title">

                Schedule

            </h3>

            <div class="modal-grid">

                ${createInput({
                    id:"departure_time",
                    label:"Departure Time",
                    type:"time",
                    value:route.departure_time || ""
                })}

                ${createInput({
                    id:"arrival_time",
                    label:"Arrival Time",
                    type:"time",
                    value:route.arrival_time || ""
                })}

            </div>

        </section>

    `;

}
/* ==========================================================================
   STATUS
========================================================================== */

function renderStatus(){

    return `

        <section class="modal-section">

            <h3 class="modal-section-title">

                Status

            </h3>

            <div class="modal-grid">

                <div class="modal-group">

                    <label class="modal-label">

                        Status

                    </label>

                    <div id="status_container"></div>

                </div>

            </div>

        </section>

    `;

}
/* ==========================================================================
   FORM COMPONENTS
========================================================================== */

function createInput({

    id,
    label,
    type = "text",
    value = "",
    placeholder = "",
    required = false

}){

    return `

        <div class="modal-group">

            <label class="modal-label" for="${id}">

                ${label}

                ${required ? '<span class="modal-required">*</span>' : ""}

            </label>

            <input
                id="${id}"
                class="modal-input"
                type="${type}"
                value="${value}"
                placeholder="${placeholder}"
            >

        </div>

    `;

}
/* ==========================================================================
   INITIALIZE DROPDOWNS
========================================================================== */

function initializeDropdowns(
    wrapper,
    route
){
    /* ==========================================================
       STATUS
    ========================================================== */

    const statusDropdown = createDropdown({

        id: "status",

        value: route.status || "Active",

        items: [

            "Active",

            "Inactive"

        ]

    });

    wrapper
        .querySelector("#status_container")
        .appendChild(statusDropdown);


    /* ==========================================================
       ROUTE STOP
       (Temporary Placeholder)
    ========================================================== */

    const stopDropdown = createDropdown({

        id: "stop_selector",

        placeholder: "Select Transport Stop",

        items: []

    });

    wrapper
        .querySelector("#stop_container")
        .appendChild(stopDropdown);
    wrapper.stopDropdown = stopDropdown;
}
/* ==========================================================================
   ROUTE MAP
========================================================================== */

/**
 * Initialize the Leaflet route preview map.
 *
 * The map is intentionally initialized after the form exists.
 */
/* ==========================================================================
   INITIALIZE ROUTE MAP
========================================================================== */

function initializeRouteMap(){

    const mapContainer =
        document.getElementById(
            "route-preview-map"
        );


    /* ==========================================================
       MAP CONTAINER CHECK
    ========================================================== */

    if(!mapContainer){

        console.warn(
            "BusTrack: Route map container was not found."
        );

        return false;

    }


    /* ==========================================================
       LEAFLET CHECK
    ========================================================== */

    if(!window.L){

        console.error(
            "BusTrack: Leaflet is not loaded."
        );

        updateRouteMapStatus(
            "Map engine is unavailable."
        );

        return false;

    }


    /* ==========================================================
       EXISTING MAP CHECK
    ========================================================== */

    /*
     * If the current map belongs to THIS exact DOM element,
     * simply refresh its dimensions.
     */

    if(
        routeMap &&
        routeMapContainer === mapContainer
    ){

        setTimeout(()=>{

            routeMap.invalidateSize();

        },100);

        return true;

    }


    /* ==========================================================
       DESTROY OLD MAP
    ========================================================== */

    /*
     * This is important for the SPA modal.
     *
     * A new Add Route modal creates a new
     * #route-preview-map element.
     *
     * The old Leaflet instance must not be
     * reused for that new element.
     */

    if(routeMap){

        try{

            routeMap.remove();

        }

        catch(error){

            console.warn(
                "BusTrack: Failed to remove previous route map.",
                error
            );

        }

    }


    routeMap = null;

    routeMapContainer = null;

    routeLayer = null;

    routeStopMarkers = [];


    /* ==========================================================
       CREATE NEW MAP
    ========================================================== */

    routeMap =
        window.L.map(

            mapContainer,

            {

                zoomControl:true,

                attributionControl:true

            }

        );


    routeMapContainer =
        mapContainer;


    /* ==========================================================
       DEFAULT VIEW
    ========================================================== */

    routeMap.setView(

        [10.45, 76.25],

        9

    );


    /* ==========================================================
       OPENSTREETMAP TILE LAYER
    ========================================================== */

    window.L.tileLayer(

        "https://tile.openstreetmap.org/{z}/{x}/{y}.png",

        {

            maxZoom:19,

            minZoom:2,

            attribution:
                "&copy; OpenStreetMap contributors"

        }

    ).addTo(routeMap);


    /* ==========================================================
       FORCE LEAFLET TO RECALCULATE SIZE
    ========================================================== */

    requestAnimationFrame(()=>{

        if(routeMap){

            routeMap.invalidateSize();

        }

    });


    setTimeout(()=>{

        if(routeMap){

            routeMap.invalidateSize();

        }

    },300);


    return true;

}
/* ==========================================================================
   GENERATE ROAD ROUTE
========================================================================== */

/**
 * Ask OSRM to calculate the actual driving route
 * through all selected Master Stops.
 */
/* ==========================================================================
   GENERATE ROAD ROUTE
========================================================================== */

async function generateRoadRoute(){

    if(selectedStops.length < 2){

        clearRouteLayer();

        updateRouteMapStatus();

        return;

    }


    /* ==========================================================
       VALIDATE EVERY SELECTED STOP
    ========================================================== */

    const coordinates = [];


    for(
        let index = 0;
        index < selectedStops.length;
        index++
    ){

        const stop =
            selectedStops[index];


        const latitude =
            Number(stop.latitude);


        const longitude =
            Number(stop.longitude);


        if(
            !Number.isFinite(latitude) ||
            !Number.isFinite(longitude) ||
            latitude < -90 ||
            latitude > 90 ||
            longitude < -180 ||
            longitude > 180
        ){

            console.error(

                "BusTrack: Invalid route stop coordinates.",

                stop

            );


            clearRouteLayer();


            updateRouteMapStatus(

                `${stop.stop_name} has invalid coordinates.`

            );


            return;

        }


        coordinates.push(

            `${longitude},${latitude}`

        );

    }


    /* ==========================================================
       OSRM COORDINATE STRING
    ========================================================== */

    const coordinateString =
        coordinates.join(";");


    /* ==========================================================
       OSRM REQUEST
    ========================================================== */

    const url =
        "https://router.project-osrm.org/route/v1/driving/" +

        coordinateString +

        "?overview=full&geometries=geojson&steps=false";


    try{

        updateRouteMapStatus(
            "Calculating road route..."
        );


        const response =
            await fetch(url);


        /* ======================================================
           HTTP ERROR
        ======================================================= */

        if(!response.ok){

            const responseText =
                await response.text();


            console.error(

                "BusTrack OSRM HTTP error:",

                {

                    status:response.status,

                    response:responseText,

                    url

                }

            );


            throw new Error(

                `Routing service returned HTTP ${response.status}.`

            );

        }


        /* ======================================================
           PARSE RESPONSE
        ======================================================= */

        const data =
            await response.json();


        /* ======================================================
           ROUTE VALIDATION
        ======================================================= */

        if(
            data.code !== "Ok" ||
            !Array.isArray(data.routes) ||
            data.routes.length === 0
        ){

            throw new Error(

                "No road route could be calculated."

            );

        }


        /* ======================================================
           DRAW ROUTE
        ======================================================= */

        drawRoadRoute(

            data.routes[0].geometry

        );


        updateRouteMapStatus(
            "Road route ready"
        );

    }

    catch(error){

        console.error(

            "BusTrack: Route generation error:",

            error

        );


        clearRouteLayer();


        updateRouteMapStatus(

            error.message ||

            "Unable to calculate road route."

        );

    }

}
/* ==========================================================================
   DRAW ROAD ROUTE
========================================================================== */
/* ==========================================================================
   DRAW ROAD ROUTE
========================================================================== */

function drawRoadRoute(geometry){

    if(!routeMap){

        return;

    }


    if(!geometry){

        console.error(
            "BusTrack: OSRM returned no route geometry."
        );

        return;

    }


    /* ==========================================================
       REMOVE PREVIOUS ROUTE
    ========================================================== */

    clearRouteLayer();


    /* ==========================================================
       DRAW GEOJSON
    ========================================================== */

    routeLayer =
        window.L.geoJSON(

            geometry,

            {

                style:{

                    color:"#4FD1FF",

                    weight:6,

                    opacity:.9,

                    lineCap:"round",

                    lineJoin:"round"

                }

            }

        ).addTo(routeMap);


    /* ==========================================================
       FIT MAP TO ROAD ROUTE
    ========================================================== */

    const bounds =
        routeLayer.getBounds();


    if(bounds.isValid()){

        routeMap.fitBounds(

            bounds,

            {

                padding:[50,50],

                maxZoom:17

            }

        );

    }


    /* ==========================================================
       RESTORE STOP MARKERS ABOVE ROUTE
    ========================================================== */

    renderRouteStopMarkers();

}
/* ==========================================================================
   ROUTE STOP MARKERS
========================================================================== */

/* ==========================================================================
   ROUTE STOP MARKERS
========================================================================== */

function renderRouteStopMarkers(){

    if(!routeMap){

        return;

    }


    /* ==========================================================
       REMOVE OLD MARKERS
    ========================================================== */

    routeStopMarkers.forEach(

        marker=>{

            routeMap.removeLayer(
                marker
            );

        }

    );


    routeStopMarkers = [];


    /* ==========================================================
       CREATE NEW MARKERS
    ========================================================== */

    selectedStops.forEach(

        (stop,index)=>{

            const latitude =
                Number(stop.latitude);


            const longitude =
                Number(stop.longitude);


            if(
                !Number.isFinite(latitude) ||
                !Number.isFinite(longitude)
            ){

                console.warn(

                    "BusTrack: Cannot place marker.",

                    stop

                );

                return;

            }


            const marker =
                window.L.marker(

                    [

                        latitude,

                        longitude

                    ]

                ).addTo(routeMap);


            marker.bindPopup(`

                <div class="route-stop-popup">

                    <strong>

                        ${index + 1}.
                        ${escapeRouteText(
                            stop.stop_name
                        )}

                    </strong>

                    <br>

                    <span>

                        ${latitude.toFixed(6)},
                        ${longitude.toFixed(6)}

                    </span>

                </div>

            `);


            routeStopMarkers.push(
                marker
            );

        }

    );

}


/* ==========================================================================
   ESCAPE ROUTE TEXT
========================================================================== */

function escapeRouteText(value){

    return String(value ?? "")

        .replaceAll("&","&amp;")

        .replaceAll("<","&lt;")

        .replaceAll(">","&gt;")

        .replaceAll('"',"&quot;")

        .replaceAll("'","&#039;");

}
/* ==========================================================================
   UPDATE ROUTE MAP
========================================================================== */

function updateRouteMap(){

    const mapReady =
        initializeRouteMap();


    if(!mapReady){

        return;

    }


    /* ==========================================================
       RENDER STOP MARKERS
    ========================================================== */

    renderRouteStopMarkers();


    /* ==========================================================
       NO STOPS
    ========================================================== */

    if(selectedStops.length === 0){

        clearRouteLayer();


        routeMap.setView(

            [10.45, 76.25],

            9

        );


        updateRouteMapStatus(
            "Waiting for stops"
        );


        return;

    }


    /* ==========================================================
       ONE STOP
    ========================================================== */

    if(selectedStops.length === 1){

        const stop =
            selectedStops[0];


        const latitude =
            Number(stop.latitude);


        const longitude =
            Number(stop.longitude);


        if(
            !Number.isFinite(latitude) ||
            !Number.isFinite(longitude)
        ){

            updateRouteMapStatus(
                `${stop.stop_name} has invalid coordinates.`
            );

            return;

        }


        clearRouteLayer();


        routeMap.setView(

            [

                latitude,

                longitude

            ],

            16

        );


        updateRouteMapStatus(
            "1 stop selected"
        );


        return;

    }


    /* ==========================================================
       TWO OR MORE STOPS
    ========================================================== */

    generateRoadRoute();

}
/* ==========================================================================
   CLEAR ROUTE LAYER
========================================================================== */

function clearRouteLayer(){

    if(routeLayer && routeMap){

        routeMap.removeLayer(
            routeLayer
        );

        routeLayer = null;

    }

}


/* ==========================================================================
   CLEAR COMPLETE ROUTE MAP
========================================================================== */

function clearRouteMap(){

    clearRouteLayer();


    routeStopMarkers.forEach(
        marker => {

            if(routeMap){

                routeMap.removeLayer(
                    marker
                );

            }

        }
    );


    routeStopMarkers = [];

}


/* ==========================================================================
   ROUTE MAP STATUS
========================================================================== */

function updateRouteMapStatus(
    message = null
){

    const status =
        document.getElementById(
            "route-map-status"
        );


    if(!status){

        return;

    }


    if(message){

        status.innerHTML = `

            <i class="fa-solid fa-route"></i>

            ${message}

        `;

        return;

    }


    if(selectedStops.length === 0){

        status.innerHTML = `

            <i class="fa-solid fa-route"></i>

            Waiting for stops

        `;

    }

    else if(selectedStops.length === 1){

        status.innerHTML = `

            <i class="fa-solid fa-location-dot"></i>

            1 stop selected

        `;

    }

    else{

        status.innerHTML = `

            <i class="fa-solid fa-route"></i>

            ${selectedStops.length} stops selected

        `;

    }

}
/* ==========================================================================
   LOAD MASTER STOPS
========================================================================== */

async function loadMasterStops() {

    try {

        const response = await fetch("/api/stops");

        if (!response.ok) {
            throw new Error("Failed to load stops.");
        }

        availableStops = await response.json();

    } catch (error) {

        console.error("Error loading stops:", error);

        availableStops = [];

    }

}
/* ==========================================================================
   INITIALIZE ROUTE BUILDER
========================================================================== */

/* ==========================================================================
   INITIALIZE ROUTE BUILDER
========================================================================== */

function initializeRouteBuilder() {

    const addButton = document.getElementById("add_stop_btn");

    if (!addButton) return;

    addButton.disabled = true;

    const stopDropdown = document.getElementById("stop_selector");

    if (!stopDropdown) return;

    /* ----------------------------------------------------------
       Load Master Stops into Dropdown
    ---------------------------------------------------------- */

    stopDropdown.setItems(

        availableStops.map(stop => ({

            value: stop.id,

            label: stop.stop_name

        }))

    );

    /* ----------------------------------------------------------
       Enable Add Button when a Stop is Selected
    ---------------------------------------------------------- */

    stopDropdown.addEventListener("change", () => {

        addButton.disabled = !stopDropdown.getValue();

    });

    addButton.onclick = () => {

        addStopToRoute();

    };

} 
/* ==========================================================================
   RENDER SELECTED STOPS
========================================================================== */

/* ==========================================================================
   RENDER SELECTED STOPS
========================================================================== */

function renderSelectedStops() {

    const container =
        document.getElementById("route-stop-list");

    if (!container) return;


    /* ==========================================================
       EMPTY STATE
    ========================================================== */

    if (selectedStops.length === 0) {

        container.innerHTML = `

            <div class="route-stop-empty">

                No stops added yet.

            </div>

        `;

        return;

    }


    /* ==========================================================
       RENDER SELECTED STOPS
    ========================================================== */

    container.innerHTML = selectedStops.map(
        (stop, index) => `

            <div class="route-stop-card">

                <div class="route-stop-left">

                    <div class="route-stop-number">

                        ${index + 1}

                    </div>


                    <div class="route-stop-details">

                        <div class="route-stop-title">

                            ${escapeHtml(stop.stop_name)}

                        </div>

                    </div>

                </div>


                <!-- ==========================================
                     ROUTE STOP ACTIONS
                =========================================== -->

                <div class="route-stop-actions">

                    <!-- MOVE UP -->

                    <button
                        type="button"
                        class="stop-action-btn move-up"
                        data-index="${index}"
                        title="Move Up"
                        aria-label="Move stop up"
                    >

                        <i
                            class="fa-solid fa-chevron-up"
                            aria-hidden="true"
                        ></i>

                    </button>


                    <!-- MOVE DOWN -->

                    <button
                        type="button"
                        class="stop-action-btn move-down"
                        data-index="${index}"
                        title="Move Down"
                        aria-label="Move stop down"
                    >

                        <i
                            class="fa-solid fa-chevron-down"
                            aria-hidden="true"
                        ></i>

                    </button>


                    <!-- REMOVE -->

                    <button
                        type="button"
                        class="stop-action-btn remove-stop"
                        data-index="${index}"
                        title="Remove Stop"
                        aria-label="Remove stop"
                    >

                        <i
                            class="fa-solid fa-trash"
                            aria-hidden="true"
                        ></i>

                    </button>

                </div>

            </div>

        `
    ).join("");


    /* ==========================================================
       BIND BUTTON EVENTS
    ========================================================== */

    bindRouteStopEvents();

}
/* ==========================================================================
   ROUTE STOP EVENTS
========================================================================== */

function bindRouteStopEvents() {

    document
        .querySelectorAll(".move-up")
        .forEach(button => {

            button.onclick = () => {

                moveStopUp(
                    Number(button.dataset.index)
                );

            };

        });

    document
        .querySelectorAll(".move-down")
        .forEach(button => {

            button.onclick = () => {

                moveStopDown(
                    Number(button.dataset.index)
                );

            };

        });

    document
        .querySelectorAll(".remove-stop")
        .forEach(button => {

            button.onclick = () => {
                void removeStop(Number(button.dataset.index));
            };

        });
        /* ==========================================================================
        MOVE STOP UP
        ========================================================================== */

        function moveStopUp(index) {

            if (index === 0) return;

            [

                selectedStops[index - 1],

                selectedStops[index]

            ] = [

                selectedStops[index],

                selectedStops[index - 1]

            ];

            renderSelectedStops();

            updateRouteMap();

        }



        /* ==========================================================================
        MOVE STOP DOWN
        ========================================================================== */

        function moveStopDown(index){

            if(
                index >=
                selectedStops.length - 1
            ){

                return;

            }


            [

                selectedStops[index + 1],

                selectedStops[index]

            ] = [

                selectedStops[index],

                selectedStops[index + 1]

            ];


            renderSelectedStops();


            /*
            * The order of the stops determines the
            * order in which OSRM calculates the route.
            */

            updateRouteMap();

        }


        /* ==========================================================================
        REMOVE STOP
        ========================================================================== */

        async function removeStop(index) {

            const stop = selectedStops[index];
            if (!stop) return;

            const confirmed = await confirmDeletion({
                title: `Remove ${stop.stop_name || "this stop"}?`,
                message: "The stop will be removed from this route. Save the route to apply the change."
            });

            if (!confirmed) return;

            selectedStops.splice(
                index,
                1
            );

            renderSelectedStops();

            updateRouteMap();

        }
}
/* ==========================================================================
   ADD STOP TO ROUTE
========================================================================== */

function addStopToRoute() {

    const stopDropdown = document.getElementById("stop_selector");

    const stopId = Number(stopDropdown.getValue());

    if (!stopId) return;

    const stop = availableStops.find(s => s.id === stopId);

    if (!stop) return;

    /* Prevent Duplicate Stops */

    if (selectedStops.some(s => s.id === stop.id)) {
        showOperationFeedback({
            type: "warning",
            title: "Stop already in this route",
            message: `${stop.stop_name} is already in the selected route stops.`
        });

        return;

    }

    selectedStops.push(stop);

    renderSelectedStops();

    stopDropdown.clear();

    document.getElementById(
        "add_stop_btn"
    ).disabled = true;


    /*
    * Recalculate the route whenever a new stop
    * is added.
    */

    updateRouteMap();

}
/* ==========================================================================
   ROUTE STOPS
========================================================================== */

function renderRouteStops() {

    return `

        <section class="modal-section">

            <h3 class="modal-section-title">

                Route Builder

            </h3>

            <div class="modal-grid">

                <div class="modal-group">

                    <label class="modal-label">

                        Search Master Stop

                    </label>

                    <div id="stop_container"></div>

                </div>

                <div
                    class="modal-group"
                    style="display:flex;align-items:flex-end;"
                >

                    <button
                        id="add_stop_btn"
                        type="button"
                        class="primary-btn"
                        disabled
                    >

                        + Add Stop

                    </button>

                </div>

            </div>

            <div
                id="route-stop-list"
                class="route-stop-list"
            >

                <div class="route-stop-empty">

                    No stops have been added yet.

                    <br><br>

                    Search for a stop above and click
                    <strong>Add Stop</strong>.

                </div>


            </div>
            <!-- ==========================================================
                ROUTE PREVIEW
            =========================================================== -->

            <div class="route-preview-section">

                <div class="route-preview-header">

                    <div>

                        <span class="route-preview-caption">

                            ROUTE PREVIEW

                        </span>

                        <h4 class="route-preview-title">

                            Road Route

                        </h4>

                        <p class="route-preview-description">

                            The route follows the actual road network
                            between the selected stops.

                        </p>

                    </div>


                    <div
                        id="route-map-status"
                        class="route-map-status"
                    >

                        <i class="fa-solid fa-route"></i>

                        Waiting for stops

                    </div>

                </div>


                <div
                    id="route-preview-map"
                    class="route-preview-map"
                ></div>

            </div>

        </section>

    `;

}
/* ==========================================================================
   GET SELECTED ROUTE STOPS
========================================================================== */

export function getSelectedStops() {

    return [...selectedStops];

}
/* ==========================================================================
   SET SELECTED ROUTE STOPS
========================================================================== */

export function setSelectedStops(
    stops = []
){

    selectedStops = [...stops];

    renderSelectedStops();

    updateRouteMap();

}
/* ==========================================================================
   DESTROY ROUTE MAP
========================================================================== */

export function destroyRouteMap(){

    if(routeMap){

        try{

            routeMap.remove();

        }

        catch(error){

            console.warn(

                "BusTrack: Failed to destroy route map.",

                error

            );

        }

    }


    routeMap = null;

    routeMapContainer = null;

    routeLayer = null;

    routeStopMarkers = [];

}
