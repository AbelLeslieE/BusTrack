/* ==========================================================================
   BUSTRACK
   ROUTE FORM
========================================================================== */

import { createDropdown } from "/static/common/dropdown.js";
/* ==========================================================================
   ROUTE BUILDER STATE
========================================================================== */

// All stops loaded from the Master Stops database
let availableStops = [];

// Stops currently selected for this route
let selectedStops = [];
/* ==========================================================================
   CREATE FORM
========================================================================== */

export function createRouteForm(
    route = {},
    buses = [],
    drivers = []
) {

    const wrapper = document.createElement("div");

    wrapper.className = "route-form";

    wrapper.innerHTML = `

        ${renderRouteInformation(route)}

        ${renderAssignment(route)}

        ${renderSchedule(route)}

        ${renderStatus(route)}

        ${renderRouteStops()}

    `;

    initializeDropdowns(
        wrapper,
        route,
        buses,
        drivers
    );

    /* ==========================================================
    INITIALIZE ROUTE BUILDER
    ========================================================== */

    selectedStops = [];

    renderSelectedStops();

    loadMasterStops().then(() => {

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
   ASSIGNMENT
========================================================================== */

function renderAssignment(){

    return `

        <section class="modal-section">

            <h3 class="modal-section-title">

                Assignment

            </h3>

            <div class="modal-grid">

                <div class="modal-group">

                    <label class="modal-label">

                        Assigned Bus

                    </label>

                    <div id="bus_container"></div>

                </div>

                <div class="modal-group">

                    <label class="modal-label">

                        Assigned Driver

                    </label>

                    <div id="driver_container"></div>

                </div>

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
    route,
    buses,
    drivers
){

    /* ==========================================================
       BUS
    ========================================================== */

    const busDropdown = createDropdown({

        id: "bus_id",

        value: route.bus_id ?? "",

        placeholder: "Select Bus",

        items: buses.map(bus => ({

            label: bus.bus_number,

            value: bus.id

        }))

    });

    wrapper
        .querySelector("#bus_container")
        .appendChild(busDropdown);


    /* ==========================================================
       DRIVER
    ========================================================== */

    const driverDropdown = createDropdown({

        id: "driver_id",

        value: route.driver_id ?? "",

        placeholder: "Select Driver",

        items: drivers.map(driver => ({

            label: driver.full_name,

            value: driver.id

        }))

    });

    wrapper
        .querySelector("#driver_container")
        .appendChild(driverDropdown);


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

    const container = document.getElementById("route-stop-list");

    if (!container) return;

    if (selectedStops.length === 0) {

        container.innerHTML = `

            <div class="route-stop-empty">

                No stops added yet.

            </div>

        `;

        return;

    }

    container.innerHTML = selectedStops.map((stop, index) => `

        <div class="route-stop-card">

            <div class="route-stop-left">

                <div class="route-stop-number">

                    ${index + 1}

                </div>

                <div class="route-stop-details">

                    <div class="route-stop-title">

                        ${stop.stop_name}

                    </div>

                </div>

            </div>

            <div class="route-stop-actions">

                <button
                    class="stop-action-btn move-up"
                    data-index="${index}"
                    title="Move Up"
                >
                    <i data-lucide="chevron-up"></i>
                </button>

                <button
                    class="stop-action-btn move-down"
                    data-index="${index}"
                    title="Move Down"
                >
                    <i data-lucide="chevron-down"></i>
                </button>

                <button
                    class="stop-action-btn remove-stop"
                    data-index="${index}"
                    title="Remove Stop"
                >
                    <i data-lucide="trash-2"></i>
                </button>

            </div>

        </div>

    `).join("");

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

                removeStop(
                    Number(button.dataset.index)
                );

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

        }


        /* ==========================================================================
        MOVE STOP DOWN
        ========================================================================== */

        function moveStopDown(index) {

            if (index >= selectedStops.length - 1) return;

            [

                selectedStops[index + 1],

                selectedStops[index]

            ] = [

                selectedStops[index],

                selectedStops[index + 1]

            ];

            renderSelectedStops();

        }


        /* ==========================================================================
        REMOVE STOP
        ========================================================================== */

        function removeStop(index) {

            selectedStops.splice(index, 1);

            renderSelectedStops();

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

        alert("This stop has already been added.");

        return;

    }

    selectedStops.push(stop);

    renderSelectedStops();

    stopDropdown.clear();

    document.getElementById("add_stop_btn").disabled = true;

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

export function setSelectedStops(stops = []) {

    selectedStops = [...stops];

    renderSelectedStops();

}