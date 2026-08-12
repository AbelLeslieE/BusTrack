/* ==========================================================================
   BUSTRACK
   STOPS MODULE
========================================================================== */

import * as StopsAPI from "./stopsApi.js";
import { createDropdown } from "/static/common/dropdown.js";
import { Modal } from "/static/common/modal.js";
/* ==========================================================================
   MODULE STATE
========================================================================== */

let allStops = [];

let filteredStops = [];

let selectedRoute = "";

let currentPage = 1;

const rowsPerPage = 20;


/* ==========================================================================
   MAP PICKER STATE
========================================================================== */

/*
 * These variables belong only to the currently open
 * Add/Edit Stop modal.
 *
 * They are destroyed when the modal closes.
 */

let stopPickerMap = null;

let stopPickerMarker = null;

let stopPickerCircle = null;
/* ==========================================================================
   RENDER
========================================================================== */

export function render() {

    const root = document.createElement("div");

    root.className = "stops-page";

    root.innerHTML = `

        ${renderHero()}

        ${renderToolbar()}

        ${renderStatistics()}

        ${renderTable()}

    `;

    initialize(root);

    return root;

}

/* ==========================================================================
   INITIALIZE
========================================================================== */

async function initialize(root){

    bindEvents(root);

    await refresh(root);

    

}

/* ==========================================================================
   REFRESH
========================================================================== */

async function refresh(root){

    try{

        allStops = await StopsAPI.getStops();

        filteredStops = [...allStops];

        currentPage = 1;

        renderCurrentPage(root);

        updateStatistics(root);

    }

    catch(error){

        console.error(error);

    }

}
/* ==========================================================================
   ROUTE FILTER
========================================================================== */

function initializeRouteFilter(root){

    const container =

        root.querySelector("#route-filter");

    if(!container){

        return;

    }

    const routes = [

        ...new Set(

            allStops.map(stop=>({

                label: stop.route_name,

                value: stop.route_name

            }))

        )

    ];

    const dropdown = createDropdown({

        id:"route-dropdown",

        placeholder:"All Routes",

        items:[
            {

                label:"All Routes",

                value:""

            },

            ...routes

        ]

    });

    dropdown.addEventListener(

        "change",

        e=>{

            selectedRoute =

                e.detail;

            applyFilters(root);

        }

    );

    container.appendChild(dropdown);

}
/* ==========================================================================
   APPLY FILTERS
========================================================================== */

function applyFilters(root){

    const keyword =

        root.querySelector("#search-stop")

            .value

            .toLowerCase()

            .trim();

    let filtered = [...allStops];

    if(selectedRoute){

        filtered = filtered.filter(stop=>

            stop.route_name===selectedRoute

        );

    }

    if(keyword){

        filtered = filtered.filter(stop=>

            stop.stop_name

                .toLowerCase()

                .includes(keyword)

        );

    }

    filteredStops = filtered;

    currentPage = 1;

    renderCurrentPage(root);

}

/* ==========================================================================
   EVENTS
========================================================================== */

/* ==========================================================================
   EVENTS
========================================================================== */

function bindEvents(root){

    /* ==========================================================
       REFRESH
    ========================================================== */

    root.querySelector("#refresh-btn")

        .addEventListener(

            "click",

            async()=>{

                await refresh(root);

            }

        );
    /* ==========================================================
    ADD STOP
    ========================================================== */

    root.querySelector("#add-stop-btn")

        .addEventListener(

            "click",

            ()=>{

                openAddStopModal(root);

            }

        );

    /* ==========================================================
       SEARCH
    ========================================================== */

    root.querySelector("#search-stop")

        .addEventListener(

            "input",

            ()=>{

                applyFilters(root);

            }

        );

    /* ==========================================================
       IMPORT BUTTON
    ========================================================== */

    const importButton =

        root.querySelector("#import-stop-btn");

    const fileInput =

        root.querySelector("#stop-import-file");

    importButton.addEventListener(

        "click",

        ()=>{

            fileInput.click();

        }

    );
    /* ==========================================================
    EXPORT BUTTON
    ========================================================== */

    root.querySelector("#export-stop-btn")

        .addEventListener(

            "click",

            ()=>{

                StopsAPI.exportStops();

            }

        );

    /* ==========================================================
       FILE SELECTED
    ========================================================== */

    fileInput.addEventListener(

        "change",

        async()=>{

            const file = fileInput.files[0];

            if(!file){

                return;

            }

            try{

                const result =

                    await StopsAPI.importStops(file);

                alert(

`Import Completed

Imported : ${result.imported}

Skipped : ${result.skipped}`

                );

                await refresh(root);

            }

            catch(error){

                console.error(error);

                alert(error.message);

            }

            fileInput.value="";

        }

    );

}
/* ==========================================================================
   HERO
========================================================================== */

function renderHero(){

    return `

        <section class="hero-panel glass-panel">

            <div class="hero-content">

                <p class="hero-eyebrow">

                    BUS TRACKER

                </p>

                <h1 class="hero-title">

                    Stops Management

                </h1>

                <p class="hero-description">

                    View every stop imported from the
                    Route Excel file.

                </p>

                <div class="hero-badges">

                    <span>📍 Master Stops</span>

                    <span>🚌 Route Ready</span>

                    <span>📂 Excel Import & Export</span>

                </div>

            </div>

        </section>

    `;

}

/* ==========================================================================
   STATISTICS
========================================================================== */

function renderStatistics(){

    return `

        <section class="statistics-grid">

            <div class="stat-card">

                <span class="stat-title">

                    Total Stops

                </span>

                <h2 id="total-stops">

                    0

                </h2>

            </div>

            <div class="stat-card">

                <span class="stat-title">

                    Routes

                </span>

                <h2 id="total-routes">

                    0

                </h2>

            </div>

            <div class="stat-card">

                <span class="stat-title">

                    Avg Stops / Route

                </span>

                <h2 id="avg-stops">

                    0

                </h2>

            </div>

            <div class="stat-card">

                <span class="stat-title">

                    Imported

                </span>

                <h2 id="imported-stops">

                    0

                </h2>

            </div>

        </section>

    `;

}

/* ==========================================================================
   TOOLBAR
========================================================================== */

function renderToolbar(){

    return `

        <section class="toolbar glass-panel">

            <input

                id="search-stop"

                class="toolbar-search"

                type="text"

                placeholder="Search Stop..."

            >

            <div class="toolbar-actions">

                <button
                    id="add-stop-btn"
                    class="primary-btn"
                >

                    + Add Stop

                </button>

                <button
                    id="import-stop-btn"
                    class="secondary-btn"
                >

                    Import Stops

                </button>

                <button
                    id="export-stop-btn"
                    class="secondary-btn"
                >

                    Export Stops

                </button>

                <button
                    id="refresh-btn"
                >

                    Refresh

                </button>

            </div>

        </section>
        <input

            id="stop-import-file"

            type="file"

            accept=".xlsx,.xls"

            hidden

        ></input>
    `;

    
}

/* ==========================================================================
   TABLE
========================================================================== */

function renderTable(){

    return `

        <section class="table-panel glass-panel">

            <table class="data-table">

                <thead>

                    <tr>

                        <th>Stop Code</th>

                        <th>Stop Name</th>

                        <th>Latitude</th>

                        <th>Longitude</th>

                        <th>Radius</th>

                        <th>Status</th>

                        <th>Actions</th>

                    </tr>

                </thead>

                <tbody id="stops-table-body">

                    <tr>

                        <td colspan="5">

                            Loading Stops...

                        </td>

                    </tr>

                </tbody>

            </table>

            <div class="pagination-wrapper">

                <div id="pagination"></div>

            </div>

            </section>

    `;

}

/* ==========================================================================
   TABLE ROWS
========================================================================== */

function renderRows(root, stops){

    const tbody = root.querySelector("#stops-table-body");

    if(stops.length===0){

        tbody.innerHTML = `

            <tr>

                <td colspan="7">

                    No Stops Found

                </td>

            </tr>

        `;

        return;

    }

    tbody.innerHTML = stops.map(stop=>`

        <tr>

            <td><span class="stop-code">${stop.stop_code}</span></td>

            <td>${stop.stop_name}</td>

            <td>${stop.latitude ?? '<span class="muted-text">Not Set</span>'}</td>

            <td>${stop.longitude ?? '<span class="muted-text">Not Set</span>'}</td>

            <td>${stop.radius} m</td>

            <td>${stop.status}</td>

            <td class="action-cell">

                <button
                    class="action-btn edit-btn"
                    data-id="${stop.id}"
                    title="Edit Stop"
                >
                    <i class="fa-solid fa-pen-to-square"></i>
                </button>

                <button
                    class="action-btn delete-btn"
                    data-id="${stop.id}"    
                    title="Delete Stop"
                >
                   <i class="fa-solid fa-trash-can"></i>
                </button>

            </td>

        </tr>

    `).join("");
    /* ==========================================================
    EDIT EVENTS
    ========================================================== */

    tbody.querySelectorAll(".edit-btn")

        .forEach(button=>{

            button.addEventListener(

                "click",

                ()=>{

                    const id = Number(

                        button.dataset.id

                    );

                    const stop =

                        allStops.find(

                            s=>s.id===id

                        );

                    if(stop){

                        openEditStopModal(

                            root,

                            stop

                        );

                    }

                }

            );

        });
        /* ==========================================================
        DELETE EVENTS
        ========================================================== */

        tbody.querySelectorAll(".delete-btn")

            .forEach(button=>{

                button.addEventListener(

                    "click",

                    ()=>{

                        const id = Number(

                            button.dataset.id

                        );

                        const stop =

                            allStops.find(

                                s=>s.id===id

                            );

                        if(stop){

                            deleteStop(root, stop);

                        }

                    }

                );

            });
            

}
/* ==========================================================================
   RENDER CURRENT PAGE
========================================================================== */

function renderCurrentPage(root){

    const start = (currentPage - 1) * rowsPerPage;

    const end = start + rowsPerPage;

    const pageStops = filteredStops.slice(

        start,

        end

    );

    renderRows(

        root,

        pageStops

    );

    renderPagination(root);

}


/* ==========================================================================
   PAGINATION
========================================================================== */

function renderPagination(root){

    const container =

        root.querySelector("#pagination");

    if(!container){

        return;

    }

    container.innerHTML = "";

    const totalPages = Math.ceil(

        filteredStops.length /

        rowsPerPage

    );

    if(totalPages <= 1){

        return;

    }

    /* Previous */

    const previous = document.createElement("button");

    previous.textContent = "←";

    previous.disabled = currentPage === 1;

    previous.onclick = ()=>{

        currentPage--;

        renderCurrentPage(root);

    };

    container.appendChild(previous);

    /* Page Numbers */

    for(

        let page = 1;

        page <= totalPages;

        page++

    ){

        const button = document.createElement("button");

        button.textContent = page;

        if(page === currentPage){

            button.classList.add("active");

        }

        button.onclick = ()=>{

            currentPage = page;

            renderCurrentPage(root);

        };

        container.appendChild(button);

    }

    /* Next */

    const next = document.createElement("button");

    next.textContent = "→";

    next.disabled = currentPage === totalPages;

    next.onclick = ()=>{

        currentPage++;

        renderCurrentPage(root);

    };

    container.appendChild(next);

}
/* ==========================================================================
   UPDATE STATISTICS
========================================================================== */

function updateStatistics(root){

    const routes = new Set();

    allStops.forEach(stop=>{

        routes.add(

            stop.route_name ?? stop.route_id

        );

    });

    root.querySelector("#total-stops").textContent =

        allStops.length;

    root.querySelector("#total-routes").textContent =

        routes.size;

    root.querySelector("#avg-stops").textContent =

        routes.size

            ? Math.round(

                allStops.length /

                routes.size

            )

            : 0;

    root.querySelector("#imported-stops").textContent =

        allStops.length;

}
/* ==========================================================================
   STOP LOCATION MAP
========================================================================== */

/*
 * Default map position.
 *
 * This is only the initial view.
 * The actual stop location always comes from the
 * administrator's map selection.
 */

const DEFAULT_MAP_CENTER = [
    10.359000,
    76.286100
];

const DEFAULT_MAP_ZOOM = 19;


/* ==========================================================================
   INITIALIZE STOP MAP
========================================================================== */

function initializeStopMap(
    container,
    latitudeInput,
    longitudeInput,
    radiusInput,
    initialLatitude = null,
    initialLongitude = null,
    initialRadius = 50
){

    /*
     * Make sure any previous map instance
     * has been completely removed.
     */

    destroyStopMap();


    /*
     * Determine the initial map position.
     *
     * Existing stop coordinates are preferred
     * when editing a stop.
     */

    const hasInitialCoordinates =
        Number.isFinite(Number(initialLatitude)) &&
        Number.isFinite(Number(initialLongitude));


    const center =
        hasInitialCoordinates

            ? [
                Number(initialLatitude),
                Number(initialLongitude)
            ]

            : DEFAULT_MAP_CENTER;


    /*
     * Create the Leaflet map.
     */

    stopPickerMap =
        L.map(container, {

            zoomControl:true,

            attributionControl:true

        }).setView(

            center,

            hasInitialCoordinates
                ? 17
                : DEFAULT_MAP_ZOOM

        );


    /*
     * OpenStreetMap base layer.
     */

    /* ==========================================================
    OPENSTREETMAP BASE LAYER
    ========================================================== */

    const baseLayer = L.tileLayer(

        "https://tile.openstreetmap.org/{z}/{x}/{y}.png",

        {

            maxZoom:19,

            minZoom:2,

            attribution:
                '&copy; OpenStreetMap contributors'

        }

    );


    /*
    * Add the base map to Leaflet.
    */

    baseLayer.addTo(stopPickerMap);


    /*
    * Report tile-loading problems instead of silently
    * leaving the map blank.
    */

    baseLayer.on(

        "tileerror",

        event=>{

            console.error(
                "BusTrack map tile failed to load:",
                event.coords
            );

        }

    );


    /*
     * If editing an existing stop,
     * place its marker immediately.
     */

    if(hasInitialCoordinates){

        setStopPickerLocation(

            Number(initialLatitude),

            Number(initialLongitude),

            latitudeInput,

            longitudeInput,
            radiusInput,
            initialRadius,
            false

        );

    }


    /*
     * Clicking anywhere on the map selects
     * that exact geographical location.
     */

    stopPickerMap.on(

        "click",

        event=>{

            setStopPickerLocation(

                event.latlng.lat,

                event.latlng.lng,

                latitudeInput,

                longitudeInput,

                radiusInput,

                Number(radiusInput.value) || 50,

                true

            );

        }

    );


    /*
     * Leaflet sometimes initializes inside a
     * modal whose dimensions have not finished
     * rendering yet.
     *
     * invalidateSize() forces Leaflet to recalculate
     * the actual map dimensions.
     */

    /* ==========================================================
    FORCE LEAFLET TO RECALCULATE MAP SIZE
    ========================================================== */

    requestAnimationFrame(()=>{

        if(stopPickerMap){

            stopPickerMap.invalidateSize();

        }

    });


    setTimeout(()=>{

        if(stopPickerMap){

            stopPickerMap.invalidateSize();

        }

    }, 250);

}


/* ==========================================================================
   SET STOP LOCATION
========================================================================== */
/* ==========================================================================
   SET STOP LOCATION
========================================================================== */

function setStopPickerLocation(

    latitude,

    longitude,

    latitudeInput,

    longitudeInput,

    radiusInput,

    radius = 50,

    centerMap = true

){

    /* ==========================================================
       VALIDATE MAP STATE
    ========================================================== */

    if(!stopPickerMap){

        console.warn(
            "BusTrack: Stop map is not initialized."
        );

        return;

    }


    /* ==========================================================
       NORMALIZE COORDINATES
    ========================================================== */

    const lat =
        Number(latitude);


    const lng =
        Number(longitude);


    if(
        !Number.isFinite(lat) ||
        !Number.isFinite(lng)
    ){

        console.warn(
            "BusTrack: Invalid stop coordinates.",
            {
                latitude,
                longitude
            }
        );

        return;

    }


    /* ==========================================================
       SAVE COORDINATES INTO THE FORM
    ========================================================== */

    /*
     * THIS IS THE IMPORTANT FIX.
     *
     * These are the actual values that openAddStopModal()
     * reads when the user clicks "Save Stop".
     */

    latitudeInput.value =
        lat.toFixed(6);


    longitudeInput.value =
        lng.toFixed(6);


    /* ==========================================================
       UPDATE VISIBLE COORDINATES
    ========================================================== */

    const locationSection =
        latitudeInput.closest(
            ".stop-location-section"
        );


    const latitudeDisplay =
        locationSection?.querySelector(
            "#latitude-display"
        );


    const longitudeDisplay =
        locationSection?.querySelector(
            "#longitude-display"
        );


    if(latitudeDisplay){

        latitudeDisplay.textContent =
            latitudeInput.value;

    }


    if(longitudeDisplay){

        longitudeDisplay.textContent =
            longitudeInput.value;

    }


    /* ==========================================================
       CREATE OR MOVE MARKER
    ========================================================== */

    if(!stopPickerMarker){

        stopPickerMarker =
            L.marker(

                [lat, lng],

                {

                    draggable:true

                }

            ).addTo(
                stopPickerMap
            );


        /* ======================================================
           DRAG MARKER
        ======================================================= */

        stopPickerMarker.on(

            "dragend",

            event=>{

                const position =
                    event.target.getLatLng();


                setStopPickerLocation(

                    position.lat,

                    position.lng,

                    latitudeInput,

                    longitudeInput,

                    radiusInput,

                    Number(
                        radiusInput.value
                    ) || 50,

                    false

                );

            }

        );

    }

    else{

        stopPickerMarker.setLatLng(

            [lat, lng]

        );

    }


    /* ==========================================================
       GEOFENCE CIRCLE
    ========================================================== */

    const validRadius =
        Number(radius) > 0

            ? Number(radius)

            : 50;


    if(!stopPickerCircle){

        stopPickerCircle =
            L.circle(

                [lat, lng],

                {

                    radius:
                        validRadius,

                    color:
                        "#4FD1FF",

                    weight:
                        2,

                    fillColor:
                        "#4FD1FF",

                    fillOpacity:
                        0.12

                }

            ).addTo(
                stopPickerMap
            );

    }

    else{

        stopPickerCircle.setLatLng(

            [lat, lng]

        );


        stopPickerCircle.setRadius(

            validRadius

        );

    }


    /* ==========================================================
       CENTER MAP
    ========================================================== */

    if(centerMap){

        stopPickerMap.setView(

            [lat, lng],

            Math.max(

                stopPickerMap.getZoom(),

                17

            ),

            {

                animate:true

            }

        );

    }

}

/* ==========================================================================
   UPDATE GEOFENCE CIRCLE
========================================================================== */

function updateStopPickerRadius(

    radiusInput

){

    if(
        !stopPickerCircle ||
        !radiusInput
    ){

        return;

    }


    const radius =
        Number(radiusInput.value);


    if(
        !Number.isFinite(radius) ||
        radius <= 0
    ){

        return;

    }


    stopPickerCircle.setRadius(

        radius

    );

}


/* ==========================================================================
   DESTROY STOP MAP
========================================================================== */

function destroyStopMap(){

    if(stopPickerMap){

        stopPickerMap.remove();

    }


    stopPickerMap = null;

    stopPickerMarker = null;

    stopPickerCircle = null;

}
/* ==========================================================================
   LOCATION SEARCH
========================================================================== */

/*
 * Search for a place using a user-triggered geocoding request.
 *
 * IMPORTANT:
 * This is intentionally a normal Search button.
 * We are NOT implementing autocomplete requests.
 */

async function searchStopLocation(

    query,
    map,
    latitudeInput,
    longitudeInput,
    radiusInput,
    resultsContainer

){

    const trimmedQuery =
        query.trim();


    if(!trimmedQuery){

        resultsContainer.hidden = false;

        resultsContainer.innerHTML = `

            <div class="location-result-empty">

                <i class="fa-solid fa-circle-info"></i>

                Enter a place to search.

            </div>

        `;

        return;

    }


    /*
     * Show loading state.
     */

    resultsContainer.hidden = false;

    resultsContainer.innerHTML = `

        <div class="location-result-loading">

            <i class="fa-solid fa-spinner fa-spin"></i>

            Searching for "${trimmedQuery}"...

        </div>

    `;


    try{

        /*
         * Nominatim search endpoint.
         *
         * This request is only made when the administrator
         * explicitly presses Search.
         */

        const url =
            "https://nominatim.openstreetmap.org/search?" +
            new URLSearchParams({

                q:trimmedQuery,

                format:"jsonv2",

                limit:"5",

                addressdetails:"1"

            });


        const response =
            await fetch(url, {

                headers:{

                    Accept:
                        "application/json"

                }

            });


        if(!response.ok){

            throw new Error(

                `Location search failed (${response.status}).`

            );

        }


        const results =
            await response.json();


        if(
            !Array.isArray(results) ||
            results.length === 0
        ){

            resultsContainer.innerHTML = `

                <div class="location-result-empty">

                    <i class="fa-solid fa-location-dot"></i>

                    No matching places found.

                </div>

            `;

            return;

        }


        /*
         * Display the returned places.
         */

        resultsContainer.innerHTML = results.map(

            (result,index)=>`

                <button
                    type="button"
                    class="location-result"
                    data-result-index="${index}"
                >

                    <span class="location-result-icon">

                        <i class="fa-solid fa-location-dot"></i>

                    </span>


                    <span class="location-result-content">

                        <strong>

                            ${escapeLocationText(
                                result.display_name
                            )}

                        </strong>

                        <small>

                            ${Number(result.lat).toFixed(6)},
                            ${Number(result.lon).toFixed(6)}

                        </small>

                    </span>


                    <i class="fa-solid fa-chevron-right location-result-arrow"></i>

                </button>

            `

        ).join("");


        /*
         * Attach selection events.
         */

        resultsContainer
            .querySelectorAll(".location-result")
            .forEach(button=>{

                button.addEventListener(

                    "click",

                    ()=>{

                        const index =
                            Number(
                                button.dataset.resultIndex
                            );


                        const result =
                            results[index];


                        const latitude =
                            Number(result.lat);


                        const longitude =
                            Number(result.lon);


                        if(
                            !Number.isFinite(latitude) ||
                            !Number.isFinite(longitude)
                        ){

                            return;

                        }


                        /*
                         * Move the map to the searched
                         * geographical location.
                         */

                        map.setView(

                            [latitude,longitude],

                            17,

                            {

                                animate:true

                            }

                        );


                        /*
                         * Put the stop marker exactly
                         * at the selected search result.
                         *
                         * The administrator can then
                         * click a more precise location
                         * or drag the marker.
                         */

                        setStopPickerLocation(

                            latitude,

                            longitude,

                            latitudeInput,

                            longitudeInput,

                            radiusInput,

                            Number(radiusInput.value) || 50,

                            false

                        );


                        /*
                         * Hide the results after selection.
                         */

                        resultsContainer.hidden = true;

                        resultsContainer.innerHTML = "";

                    }

                );

            });

    }

    catch(error){

        console.error(

            "Stop location search failed:",

            error

        );


        resultsContainer.hidden = false;

        resultsContainer.innerHTML = `

            <div class="location-result-error">

                <i class="fa-solid fa-triangle-exclamation"></i>

                Unable to search for this location.
                Please try again.

            </div>

        `;

    }

}


/* ==========================================================================
   ESCAPE SEARCH RESULT TEXT
========================================================================== */

function escapeLocationText(value){

    return String(value ?? "")

        .replaceAll("&","&amp;")

        .replaceAll("<","&lt;")

        .replaceAll(">","&gt;")

        .replaceAll('"',"&quot;")

        .replaceAll("'","&#039;");

}
/* ==========================================================================
   STOP FORM VALIDATION
========================================================================== */

function showStopFormError(

    content,

    title,

    message,

    fieldId = null

){

    const errorBox =
        content.querySelector(
            "#stop-form-error"
        );


    const errorTitle =
        content.querySelector(
            "#stop-form-error-title"
        );


    const errorMessage =
        content.querySelector(
            "#stop-form-error-message"
        );


    const backButton =
        content.querySelector(
            "#stop-form-error-back"
        );


    if(!errorBox){

        console.error(
            "Stop form error container was not found."
        );

        return;

    }


    errorTitle.textContent =
        title;


    errorMessage.textContent =
        message;


    errorBox.hidden = false;


    /*
     * Scroll the error into view.
     */

    errorBox.scrollIntoView({

        behavior:"smooth",

        block:"nearest"

    });


    /*
     * Back to Edit does NOT close the form.
     *
     * It simply dismisses the validation message
     * and returns the user to the existing form.
     */

    backButton.onclick = ()=>{

        errorBox.hidden = true;


        if(fieldId){

            const field =
                content.querySelector(
                    `#${fieldId}`
                );


            if(field){

                field.focus();

            }

        }

    };

}
/* ==========================================================================
   ADD STOP MODAL
========================================================================== */
/* ==========================================================================
   ADD STOP MODAL
========================================================================== */

function openAddStopModal(root){

    const content =
        document.createElement("div");


    content.innerHTML = `

        <!-- ======================================================
             VALIDATION MESSAGE
        ======================================================= -->

        <div
            id="stop-form-error"
            class="stop-form-error"
            hidden
            role="alert"
            aria-live="polite"
        >

            <div class="stop-form-error-icon">

                <i class="fa-solid fa-triangle-exclamation"></i>

            </div>


            <div class="stop-form-error-content">

                <strong id="stop-form-error-title">

                    Missing Information

                </strong>


                <span id="stop-form-error-message">

                    Please correct the information below.

                </span>

            </div>


            <button
                type="button"
                id="stop-form-error-back"
                class="stop-form-error-back"
            >

                <i class="fa-solid fa-arrow-left"></i>

                Back to Edit

            </button>

        </div>


        <!-- ======================================================
             STOP INFORMATION
        ======================================================= -->

        <section class="modal-section">

            <h3 class="modal-section-title">

                Stop Information

            </h3>


            <div class="modal-grid">

                <div class="modal-group">

                    <label
                        class="modal-label"
                        for="stop_code"
                    >

                        Stop Code

                    </label>


                    <input
                        id="stop_code"
                        class="modal-input"
                        placeholder="ST0001"
                        required
                    >

                </div>


                <div class="modal-group">

                    <label
                        class="modal-label"
                        for="stop_name"
                    >

                        Stop Name

                    </label>


                    <input
                        id="stop_name"
                        class="modal-input"
                        placeholder="Kodakara"
                        required
                    >

                </div>

            </div>

        </section>


        <!-- ======================================================
             STOP LOCATION
        ======================================================= -->

        <section class="modal-section stop-location-section">

            <div class="stop-location-header">

                <div>

                    <h3 class="modal-section-title">

                        Stop Location

                    </h3>


                    <p class="stop-location-help">

                        Search for the area first, then click
                        the exact bus-stop location on the map.

                    </p>

                </div>


                <span class="location-status">

                    <i class="fa-solid fa-location-dot"></i>

                    Select on Map

                </span>

            </div>


            <!-- ==================================================
                 LOCATION SEARCH
            =================================================== -->

            <div class="stop-location-search">

                <label
                    class="modal-label"
                    for="stop-location-search-input"
                >

                    Find Place

                </label>


                <div class="location-search-row">

                    <div class="location-search-input-wrapper">

                        <i class="fa-solid fa-magnifying-glass"></i>


                        <input
                            id="stop-location-search-input"
                            class="modal-input"
                            type="text"
                            placeholder="Search place, town, landmark..."
                            autocomplete="off"
                        >

                    </div>


                    <button
                        id="stop-location-search-btn"
                        type="button"
                        class="location-search-btn"
                    >

                        <i class="fa-solid fa-magnifying-glass"></i>

                        Search

                    </button>

                </div>


                <p class="field-help">

                    Example: Mala, Kerala

                </p>


                <div
                    id="stop-location-results"
                    class="stop-location-results"
                    hidden
                ></div>

            </div>


            <!-- ==================================================
                 MAP
            =================================================== -->

            <div
                id="stop-location-map"
                class="stop-location-map"
            ></div>


            <!-- ==================================================
                 COORDINATES
            =================================================== -->

            <div class="stop-location-coordinates">

                <div class="coordinate-card">

                    <span class="coordinate-label">

                        Latitude

                    </span>


                    <strong
                        id="latitude-display"
                        class="coordinate-value"
                    >

                        Not selected

                    </strong>

                </div>


                <div class="coordinate-card">

                    <span class="coordinate-label">

                        Longitude

                    </span>


                    <strong
                        id="longitude-display"
                        class="coordinate-value"
                    >

                        Not selected

                    </strong>

                </div>

            </div>


            <!-- ==================================================
                 API VALUES
            =================================================== -->

            <input
                id="latitude"
                type="hidden"
            >


            <input
                id="longitude"
                type="hidden"
            >

        </section>


        <!-- ======================================================
             GEOFENCE
        ======================================================= -->

        <section class="modal-section">

            <div class="modal-group">

                <label
                    class="modal-label"
                    for="radius"
                >

                    Arrival / Departure Radius

                </label>


                <div class="radius-input-wrapper">

                    <input
                        id="radius"
                        class="modal-input"
                        type="number"
                        min="10"
                        max="2000"
                        step="5"
                        value="50"
                        required
                    >


                    <span class="radius-unit">

                        metres

                    </span>

                </div>


                <p class="field-help">

                    The bus will be considered to have
                    arrived when it enters this radius.

                </p>

            </div>

        </section>

    `;


    /* ==========================================================
       FORM MODAL
    ========================================================== */

    Modal.form({

        eyebrow:"Master Stops",

        title:"Add Stop",

        subtitle:
            "Create a stop by selecting its exact location on the map.",

        size:"lg",

        content,

        submitText:"Save Stop",


        onSubmit:async()=>{

            try{

                const stopCode =
                    content
                        .querySelector("#stop_code")
                        .value
                        .trim();


                const stopName =
                    content
                        .querySelector("#stop_name")
                        .value
                        .trim();


                const latitude =
                    Number(
                        content
                            .querySelector("#latitude")
                            .value
                    );


                const longitude =
                    Number(
                        content
                            .querySelector("#longitude")
                            .value
                    );


                const radius =
                    Number(
                        content
                            .querySelector("#radius")
                            .value
                    );


                /* ==================================================
                   VALIDATION
                =================================================== */

                if(!stopCode){

                    showStopFormError(

                        content,

                        "Stop Code Required",

                        "Please enter a stop code.",

                        "stop_code"

                    );

                    return;

                }


                if(!stopName){

                    showStopFormError(

                        content,

                        "Stop Name Required",

                        "Please enter a stop name.",

                        "stop_name"

                    );

                    return;

                }


                if(
                    !Number.isFinite(latitude) ||
                    !Number.isFinite(longitude) ||
                    latitude < -90 ||
                    latitude > 90 ||
                    longitude < -180 ||
                    longitude > 180
                ){

                    showStopFormError(

                        content,

                        "Location Required",

                        "Please select a valid location on the map."

                    );

                    return;

                }


                if(
                    !Number.isFinite(radius) ||
                    radius < 10
                ){

                    showStopFormError(

                        content,

                        "Invalid Radius",

                        "The geofence radius must be at least 10 metres.",

                        "radius"

                    );

                    return;

                }


                /* ==================================================
                   CREATE STOP
                =================================================== */

                await StopsAPI.createStop({

                    stop_code:stopCode,

                    stop_name:stopName,

                    latitude,

                    longitude,

                    radius,

                    status:"Active"

                });


                destroyStopMap();

                Modal.close();


                await refresh(root);


                Modal.success({

                    title:"Stop Created",

                    subtitle:
                        "The stop and its exact map location have been saved successfully."

                });

            }

            catch(error){

                console.error(error);


                /*
                 * Keep the form open when the server/API
                 * reports an error.
                 */

                showStopFormError(

                    content,

                    "Unable to Create Stop",

                    error.message ||
                        "An unexpected error occurred."

                );

            }

        }

    });


    /* ==========================================================
       FORM ELEMENTS
    ========================================================== */

    const mapContainer =
        content.querySelector(
            "#stop-location-map"
        );


    const latitudeInput =
        content.querySelector(
            "#latitude"
        );


    const longitudeInput =
        content.querySelector(
            "#longitude"
        );


    const radiusInput =
        content.querySelector(
            "#radius"
        );


    const searchInput =
        content.querySelector(
            "#stop-location-search-input"
        );


    const searchButton =
        content.querySelector(
            "#stop-location-search-btn"
        );


    const resultsContainer =
        content.querySelector(
            "#stop-location-results"
        );


    /* ==========================================================
       INITIALIZE MAP
    ========================================================== */

    initializeStopMap(

        mapContainer,

        latitudeInput,

        longitudeInput,

        radiusInput

    );


    /* ==========================================================
       LOCATION SEARCH
    ========================================================== */

    searchButton.addEventListener(

        "click",

        async()=>{

            await searchStopLocation(

                searchInput.value,

                stopPickerMap,

                latitudeInput,

                longitudeInput,

                radiusInput,

                resultsContainer

            );

        }

    );


    searchInput.addEventListener(

        "keydown",

        async event=>{

            if(event.key !== "Enter"){

                return;

            }


            event.preventDefault();


            await searchStopLocation(

                searchInput.value,

                stopPickerMap,

                latitudeInput,

                longitudeInput,

                radiusInput,

                resultsContainer

            );

        }

    );


    /* ==========================================================
       RADIUS
    ========================================================== */

    radiusInput.addEventListener(

        "input",

        ()=>{

            updateStopPickerRadius(

                radiusInput

            );

        }

    );

}

/* ==========================================================================
   EDIT STOP MODAL
========================================================================== */

function openEditStopModal(root, stop){

    const content =
        document.createElement("div");


    content.innerHTML = `

        <div
            id="stop-form-error"
            class="stop-form-error"
            hidden
            role="alert"
            aria-live="polite"
        >

            <div class="stop-form-error-icon">

                <i class="fa-solid fa-triangle-exclamation"></i>

            </div>


            <div class="stop-form-error-content">

                <strong id="stop-form-error-title">

                    Validation Error

                </strong>


                <span id="stop-form-error-message">

                    Please correct the information below.

                </span>

            </div>


            <button
                type="button"
                id="stop-form-error-back"
                class="stop-form-error-back"
            >

                <i class="fa-solid fa-arrow-left"></i>

                Back to Edit

            </button>

        </div>

        <section class="modal-section">

            <h3 class="modal-section-title">

                Stop Information

            </h3>


            <div class="modal-grid">

                <div class="modal-group">

                    <label
                        class="modal-label"
                        for="stop_code"
                    >

                        Stop Code

                    </label>


                    <input
                        id="stop_code"
                        class="modal-input"
                        value="${stop.stop_code ?? ""}"
                        required
                    >

                </div>


                <div class="modal-group">

                    <label
                        class="modal-label"
                        for="stop_name"
                    >

                        Stop Name

                    </label>


                    <input
                        id="stop_name"
                        class="modal-input"
                        value="${stop.stop_name ?? ""}"
                        required
                    >

                </div>

            </div>

        </section>


        <!-- ======================================================
             LOCATION PICKER
        ======================================================= -->

        <section class="modal-section stop-location-section">

            <div class="stop-location-header">

                <div>

                    <h3 class="modal-section-title">

                        Stop Location

                    </h3>

                    <p class="stop-location-help">

                        Drag the marker or click another
                        location to update the stop.

                    </p>

                </div>

                <span class="location-status">

                    <i class="fa-solid fa-location-dot"></i>

                    Existing Location

                </span>

            </div>


            <div
                id="stop-location-map"
                class="stop-location-map"
            ></div>


            <div class="stop-location-coordinates">

                <div class="coordinate-card">

                    <span class="coordinate-label">

                        Latitude

                    </span>

                    <strong
                        id="latitude-display"
                        class="coordinate-value"
                    >

                        ${stop.latitude ?? "Not selected"}

                    </strong>

                </div>


                <div class="coordinate-card">

                    <span class="coordinate-label">

                        Longitude

                    </span>

                    <strong
                        id="longitude-display"
                        class="coordinate-value"
                    >

                        ${stop.longitude ?? "Not selected"}

                    </strong>

                </div>

            </div>


            <input
                id="latitude"
                type="hidden"
                value="${stop.latitude ?? ""}"
            >

            <input
                id="longitude"
                type="hidden"
                value="${stop.longitude ?? ""}"
            >

        </section>


        <!-- ======================================================
             GEOFENCE
        ======================================================= -->

        <section class="modal-section">

            <div class="modal-group">

                <label
                    class="modal-label"
                    for="radius"
                >

                    Arrival / Departure Radius

                </label>


                <div class="radius-input-wrapper">

                    <input
                        id="radius"
                        class="modal-input"
                        type="number"
                        min="10"
                        max="2000"
                        step="5"
                        value="${stop.radius ?? 50}"
                        required
                    >

                    <span class="radius-unit">

                        metres

                    </span>

                </div>


                <p class="field-help">

                    This radius determines when the bus
                    is considered to have arrived at the stop.

                </p>

            </div>

        </section>

    `;


    Modal.form({

        eyebrow:"Master Stops",

        title:"Edit Stop",

        subtitle:
            "Update the stop and its exact map location.",

        size:"lg",

        content,

        submitText:"Update Stop",


        onSubmit:async()=>{

            try{

                const latitude =
                    Number(
                        content
                            .querySelector("#latitude")
                            .value
                    );


                const longitude =
                    Number(
                        content
                            .querySelector("#longitude")
                            .value
                    );


                const radius =
                    Number(
                        content
                            .querySelector("#radius")
                            .value
                    );


                if(
                    !Number.isFinite(latitude) ||
                    !Number.isFinite(longitude)
                ){

                    showStopFormError(

                        content,

                        "Location Required",

                        "Please select a valid location on the map."

                    );

                    return;

                }


                if(
                    !Number.isFinite(radius) ||
                    radius < 10
                ){

                    showStopFormError(

                        content,

                        "Invalid Radius",

                        "The geofence radius must be at least 10 metres.",

                        "radius"

                    );

                    return;

                }


                await StopsAPI.updateStop(

                    stop.id,

                    {

                        stop_code:
                            content
                                .querySelector("#stop_code")
                                .value
                                .trim(),

                        stop_name:
                            content
                                .querySelector("#stop_name")
                                .value
                                .trim(),

                        latitude,

                        longitude,

                        radius,

                        status:
                            stop.status

                    }

                );


                destroyStopMap();

                Modal.close();


                await refresh(root);


                Modal.success({

                    title:"Stop Updated",

                    subtitle:
                        "The stop location and information have been updated."

                });

            }

            catch(error){

                console.error(error);


                Modal.error({

                    title:"Update Failed",

                    subtitle:error.message

                });

            }

        }

    });


    /*
     * Initialize the map at the stop's
     * existing coordinates.
     */

    const mapContainer =
        content.querySelector(
            "#stop-location-map"
        );


    const latitudeInput =
        content.querySelector(
            "#latitude"
        );


    const longitudeInput =
        content.querySelector(
            "#longitude"
        );


    const radiusInput =
        content.querySelector(
            "#radius"
        );


    initializeStopMap(

        mapContainer,

        latitudeInput,

        longitudeInput,

        radiusInput,

        stop.latitude,

        stop.longitude,

        stop.radius

    );


    radiusInput.addEventListener(

        "input",

        ()=>{

            updateStopPickerRadius(

                radiusInput

            );

        }

    );

}
/* ==========================================================================
   DELETE STOP
========================================================================== */

function deleteStop(root, stop){

    Modal.confirm({

        eyebrow:"Master Stops",

        title:"Delete Stop",

        subtitle:`Are you sure you want to delete "${stop.stop_name}"?`,

        confirmText:"Delete",

        cancelText:"Cancel",

        danger:true,

        onConfirm:async()=>{

            try{

                await StopsAPI.deleteStop(stop.id);

                Modal.close();

                await refresh(root);

                Modal.success({

                    title:"Stop Deleted",

                    subtitle:"The stop has been removed successfully."

                });

            }

            catch(error){

                Modal.error({

                    title:"Delete Failed",

                    subtitle:error.message

                });

            }

        }

    });

}