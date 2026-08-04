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
   ADD STOP MODAL
========================================================================== */

function openAddStopModal(root){

    const content = document.createElement("div");

    content.innerHTML = `

        <section class="modal-section">

            <h3 class="modal-section-title">

                Stop Information

            </h3>

            <div class="modal-grid">

                <div class="modal-group">

                    <label class="modal-label">

                        Stop Code

                    </label>

                    <input
                        id="stop_code"
                        class="modal-input"
                        placeholder="ST0001"
                    >

                </div>

                <div class="modal-group">

                    <label class="modal-label">

                        Stop Name

                    </label>

                    <input
                        id="stop_name"
                        class="modal-input"
                        placeholder="Kodakara"
                    >

                </div>

                <div class="modal-group">

                    <label class="modal-label">

                        Latitude

                    </label>

                    <input
                        id="latitude"
                        class="modal-input"
                        type="number"
                        step="any"
                    >

                </div>

                <div class="modal-group">

                    <label class="modal-label">

                        Longitude

                    </label>

                    <input
                        id="longitude"
                        class="modal-input"
                        type="number"
                        step="any"
                    >

                </div>

                <div class="modal-group">

                    <label class="modal-label">

                        Radius

                    </label>

                    <input
                        id="radius"
                        class="modal-input"
                        type="number"
                        value="50"
                    >

                </div>

            </div>

        </section>

    `;

    Modal.form({

        eyebrow:"Master Stops",

        title:"Add Stop",

        subtitle:"Create a new stop for all routes.",

        size:"md",

        content,

        submitText:"Save Stop",

        onSubmit:async()=>{

            try{

                await StopsAPI.createStop({

                    stop_code:content.querySelector("#stop_code").value.trim(),

                    stop_name:content.querySelector("#stop_name").value.trim(),

                    latitude:content.querySelector("#latitude").value || null,

                    longitude:content.querySelector("#longitude").value || null,

                    radius:Number(content.querySelector("#radius").value),

                    status:"Active"

                });

                Modal.close();

                await refresh(root);

                Modal.success({

                    title:"Stop Created",

                    subtitle:"The stop has been added successfully."

                });

            }

            catch(error){

                Modal.error({

                    title:"Unable to Create Stop",

                    subtitle:error.message

                });

            }

        }

    });

}
/* ==========================================================================
   EDIT STOP MODAL
========================================================================== */

function openEditStopModal(root, stop){

    const content = document.createElement("div");

    content.innerHTML = `

        <section class="modal-section">

            <h3 class="modal-section-title">

                Stop Information

            </h3>

            <div class="modal-grid">

                <div class="modal-group">

                    <label class="modal-label">

                        Stop Code

                    </label>

                    <input
                        id="stop_code"
                        class="modal-input"
                        value="${stop.stop_code}"
                    >

                </div>

                <div class="modal-group">

                    <label class="modal-label">

                        Stop Name

                    </label>

                    <input
                        id="stop_name"
                        class="modal-input"
                        value="${stop.stop_name}"
                    >

                </div>

                <div class="modal-group">

                    <label class="modal-label">

                        Latitude

                    </label>

                    <input
                        id="latitude"
                        class="modal-input"
                        type="number"
                        step="any"
                        value="${stop.latitude ?? ""}"
                    >

                </div>

                <div class="modal-group">

                    <label class="modal-label">

                        Longitude

                    </label>

                    <input
                        id="longitude"
                        class="modal-input"
                        type="number"
                        step="any"
                        value="${stop.longitude ?? ""}"
                    >

                </div>

                <div class="modal-group">

                    <label class="modal-label">

                        Radius

                    </label>

                    <input
                        id="radius"
                        class="modal-input"
                        type="number"
                        value="${stop.radius}"
                    >

                </div>

            </div>

        </section>

    `;

    Modal.form({

        eyebrow:"Master Stops",

        title:"Edit Stop",

        subtitle:"Update stop information.",

        size:"md",

        content,

        submitText:"Update Stop",

        onSubmit:async()=>{

            try{

                await StopsAPI.updateStop(stop.id,{

                    stop_code:content.querySelector("#stop_code").value.trim(),

                    stop_name:content.querySelector("#stop_name").value.trim(),

                    latitude:content.querySelector("#latitude").value || null,

                    longitude:content.querySelector("#longitude").value || null,

                    radius:Number(content.querySelector("#radius").value),

                    status:stop.status

                });

                Modal.close();

                await refresh(root);

                Modal.success({

                    title:"Stop Updated",

                    subtitle:"Changes saved successfully."

                });

            }

            catch(error){

                Modal.error({

                    title:"Update Failed",

                    subtitle:error.message

                });

            }

        }

    });

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