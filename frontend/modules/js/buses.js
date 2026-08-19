
 console.log("===== REAL BUSES.JS LOADED =====");
 /**    
 * =============================================================================
 * BUS TRACKER
 * Bus Management Module
 * =============================================================================
 *
 * Module Responsibilities
 * -----------------------
 * • Render the Bus Management workspace
 * • Load buses from the backend
 * • Display Fleet KPIs
 * • Handle searching
 * • Handle CRUD operations
 * • Display modals
 * • Update statistics
 *
 * NOTE
 * ----
 * This module is built in reusable sections so the same architecture can be
 * reused for Drivers, Routes, Stops, Students and every future CRUD module.
 *
 * =============================================================================
 */

import { Modal } from "../../common/modal.js";
import { escapeHtml } from "../../common/security.js";

import { createBusForm } from "./busForm.js";
import { getDrivers } from "./driversApi.js";

import { getRoutes } from "./routesApi.js";
/* =============================================================================
   CONFIGURATION
============================================================================= */

const API = {
    BUSES: "/api/buses/"
};

const STATUS = {
    ACTIVE: "Active",
    MAINTENANCE: "Maintenance",
    INACTIVE: "Inactive"
};

const PAGE_SIZE = 10;


/* =============================================================================
   MODULE STATE
============================================================================= */

const state = {

    /* All buses returned by the backend */
    buses: [],

    drivers: [],

    routes: [],

    /* Search results */
    filteredBuses: [],

    /* Currently selected bus */
    selectedBus: null,

    /* Search text */
    searchQuery: "",

    /* Current page */
    currentPage: 1,

    /* Page size */
    pageSize: PAGE_SIZE,

    /* Loading state */
    loading: false,

    /* Statistics */
    statistics: {

        total: 0,

        active: 0,

        maintenance: 0,

        inactive: 0

    }

};


/* =============================================================================
   DOM REFERENCES
============================================================================= */

const elements = {

    page: null,

    hero: null,

    statistics: null,

    toolbar: null,

    table: null,

    tableBody: null,

    pagination: null,

    modal: null

};


/* =============================================================================
   ICONS
============================================================================= */

const icons = {

    bus: "🚌",

    active: "🟢",

    maintenance: "🟠",

    inactive: "🔴",

    refresh: "↻",

    search: "🔍",

    add: "+",

    edit: "✏",

    delete: "🗑",

    view: "👁"

};
/* =============================================================================
   API FUNCTIONS
============================================================================= */

/**
 * Fetch all buses from the backend.
 */
async function loadBuses() {

    state.loading = true;

    try {

        const response = await fetch(API.BUSES);

        if (!response.ok) {
            throw new Error("Failed to load buses.");
        }

        const data = await response.json();

        state.buses = data;
        filterBuses();

        calculateStatistics();

    } catch (error) {

        console.error("Error loading buses:", error);

        state.buses = [];
        state.filteredBuses = [];

    } finally {

        state.loading = false;

    }


}
/* =============================================================================
   LOAD DRIVERS
============================================================================= */

async function loadDrivers() {

    state.drivers = await getDrivers();

}

/* =============================================================================
   LOAD ROUTES
============================================================================= */

async function loadRoutes() {

    state.routes = await getRoutes();

}

/**
 * Create a new bus.
 */
async function createBus(busData) {

    const response = await fetch(API.BUSES, {

        method: "POST",

        headers: {
            "Content-Type": "application/json"
        },

        body: JSON.stringify(busData)

    });

    if (!response.ok) {

        const contentType = response.headers.get("content-type") || "";
        const error = contentType.includes("application/json")
            ? await response.json()
            : { detail: await response.text() };

        throw new Error(error.detail || "Unable to create bus.");

    }

    await loadBuses();

    return true;

}


/**
 * Update an existing bus.
 */
async function updateBus(busId, busData) {

    try {

        const response = await fetch(`${API.BUSES}${busId}`, {

            method: "PUT",

            headers: {
                "Content-Type": "application/json"
            },

            body: JSON.stringify(busData)

        });

        if (!response.ok) {

            const error = await response.json();

            throw new Error(error.detail || "Unable to update bus.");

        }

        await loadBuses();

        return true;

    } catch (error) {

        console.error(error);

        return false;

    }

}


/**
 * Delete a bus.
 */
async function deleteBus(busId) {

    try {

        const response = await fetch(`${API.BUSES}${busId}`, {

            method: "DELETE"

        });

        if (!response.ok) {

            const contentType = response.headers.get("content-type") || "";
            const error = contentType.includes("application/json")
                ? await response.json()
                : { detail: await response.text() };

            throw new Error(error.detail || "Unable to delete bus.");

        }

        await loadBuses();

        return true;

    } catch (error) {

        console.error(error);

        return false;

    }

}
/* =============================================================================
   UI RENDERING
============================================================================= */

/**
 * =============================================================================
 * Fleet Command Center Hero
 * =============================================================================
 */

function renderHero() {

    return `

        <section class="hero-section glass-card">

            <div class="hero-left">

                <p class="hero-caption">

                    FLEET COMMAND CENTER

                </p>

                <h1 class="hero-title">

                    Bus Management

                </h1>

                <p class="hero-description">

                    Manage, monitor and organize every school bus from one
                    premium fleet dashboard.

                </p>

                <div class="hero-status">

                    <div class="status-chip">

                        <span class="status-dot green"></span>

                        Fleet Online

                    </div>

                    <div class="status-chip">

                        <span class="status-dot blue"></span>

                        GPS Ready

                    </div>

                    <div class="status-chip">

                        <span class="status-dot orange"></span>

                        Last Sync • Just Now

                    </div>

                </div>

            </div>

            <div class="hero-right">

                <button
                    id="add-bus-btn"
                    class="primary-btn"
                >

                    <span>+</span>

                    <span>Add Bus</span>

                </button>

            </div>

        </section>

    `;

}

/**
 * =============================================================================
 * Fleet Statistics
 * =============================================================================
 */

function renderStatistics() {

    return `

        <section class="statistics-grid">

            <!-- ==========================================================
                 TOTAL FLEET
            =========================================================== -->

            <article class="stat-card">

                <span class="stat-indicator blue"></span>

                <div class="stat-content">

                    <div class="stat-label">

                        Total Fleet

                    </div>

                    <div
                        id="total-buses"
                        class="stat-value"
                    >

                        ${state.statistics.total}

                    </div>

                    <div class="stat-subtitle">

                        Registered Buses

                    </div>

                </div>

                <div class="stat-icon blue">

                    🚌

                </div>

            </article>

            <!-- ==========================================================
                 ACTIVE
            =========================================================== -->

            <article class="stat-card">

                <span class="stat-indicator green"></span>

                <div class="stat-content">

                    <div class="stat-label">

                        Active

                    </div>

                    <div
                        id="active-buses"
                        class="stat-value"
                    >

                        ${state.statistics.active}

                    </div>

                    <div class="stat-subtitle">

                        Currently Running

                    </div>

                </div>

                <div class="stat-icon green">

                    🟢

                </div>

            </article>

            <!-- ==========================================================
                 MAINTENANCE
            =========================================================== -->

            <article class="stat-card">

                <span class="stat-indicator orange"></span>

                <div class="stat-content">

                    <div class="stat-label">

                        Maintenance

                    </div>

                    <div
                        id="maintenance-buses"
                        class="stat-value"
                    >

                        ${state.statistics.maintenance}

                    </div>

                    <div class="stat-subtitle">

                        Under Service

                    </div>

                </div>

                <div class="stat-icon orange">

                    🛠

                </div>

            </article>

            <!-- ==========================================================
                 INACTIVE
            =========================================================== -->

            <article class="stat-card">

                <span class="stat-indicator red"></span>

                <div class="stat-content">

                    <div class="stat-label">

                        Inactive

                    </div>

                    <div
                        id="inactive-buses"
                        class="stat-value"
                    >

                        ${state.statistics.inactive}

                    </div>

                    <div class="stat-subtitle">

                        Unavailable

                    </div>

                </div>

                <div class="stat-icon red">

                    ⛔

                </div>

            </article>

        </section>

    `;

}


/**
 * =============================================================================
 * Fleet Toolbar
 * =============================================================================
 */

function renderToolbar() {

    return `

        <section class="toolbar glass-card">

            <!-- ==========================================================
                 LEFT
            =========================================================== -->

            <div class="toolbar-left">

                <div class="search-wrapper">

                    <svg
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor">

                        <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="m21 21-4.35-4.35M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16Z"/>

                    </svg>

                    <input
                        id="bus-search"
                        class="search-box"
                        type="text"
                        placeholder="Search buses by number, registration, route or status..."
                    >

                </div>

            </div>

            <!-- ==========================================================
                 RIGHT
            =========================================================== -->

            <div class="toolbar-actions">

                <button
                    id="refresh-btn"
                    class="secondary-btn"
                >

                    ↻ Refresh

                </button>

                <button
                    id="filter-btn"
                    class="secondary-btn filter-btn"
                >

                    ⚙ Filters

                </button>

            </div>

        </section>

    `;

}
function renderTable() {

    return `

        <section class="fleet-table glass-card">

            <div class="table-header">

                <div>

                    <p class="table-caption">

                        REGISTERED FLEET

                    </p>

                    <h2 class="table-title">

                        School Buses

                    </h2>

                </div>

                <div class="table-count">

                    ${state.filteredBuses.length}

                    <span>Buses</span>

                </div>

            </div>

            <div class="table-wrapper">

                <table class="fleet-data-table">

                    <thead>

                        <tr>

                            <th>Bus</th>
                            <th>Registration</th>
                            <th>Capacity</th>
                            <th>Driver</th>
                            <th>Route</th>
                            <th>Status</th>
                            <th>Actions</th>

                        </tr>

                    </thead>

                    <tbody id="bus-table-body">

                        ${renderTableRows()}

                    </tbody>

                </table>

            </div>

        </section>

    `;

}

/**
 * =============================================================================
 * Fleet Table
 * =============================================================================
 */

function renderTableRows() {

    if (!state.filteredBuses.length) {

        return renderEmptyState();

    }

    return state.filteredBuses.map(bus => `

        <tr>

            <td>

                <div class="bus-info">

                    <div class="bus-avatar">

                        🚌

                    </div>

                    <div>

                        <strong>

                            ${escapeHtml(bus.bus_number)}

                        </strong>

                    </div>

                </div>

            </td>

            <td>

                ${formatValue(bus.registration_number)}

            </td>

            <td>

                ${formatValue(bus.capacity)}

            </td>

            <td>

                ${formatDriverName(bus.driver_id)}

            </td>

            <td>

                ${formatRouteName(bus.route)}

            </td>

            <td>

                <span class="status-badge ${getStatusClass(bus.status)}">

                    ${escapeHtml(bus.status)}

                </span>

            </td>

            <td>

                <div class="table-actions">

                    <button

                        class="icon-btn view-btn"

                        data-id="${bus.id}"

                        title="View Bus"

                    >

                        👁

                    </button>

                    <button

                        class="icon-btn edit-btn"

                        data-id="${bus.id}"

                        title="Edit Bus"

                    >

                        ✏

                    </button>

                    <button

                        class="icon-btn delete-btn"

                        data-id="${bus.id}"

                        title="Delete Bus"

                    >

                        🗑

                    </button>

                </div>

            </td>

        </tr>

    `).join("");

}


function formatRouteName(routeName) {

    const route = state.routes.find(

        r => r.route_name === routeName

    );

    return route

        ? `${escapeHtml(route.route_code)} • ${escapeHtml(route.route_name)}`

        : "—";

}


function renderEmptyState() {

    return `

        <tr>

            <td colspan="7">

                <div class="empty-state">

                    <div class="empty-icon">

                        🚌

                    </div>

                    <h3>

                        No buses available

                    </h3>

                    <p>

                        Your fleet is currently empty.
                        Click "Add Bus" to register your first vehicle.

                    </p>

                </div>

            </td>

        </tr>

    `;

}


/**
 * =============================================================================
 * Fleet Pagination
 * =============================================================================
 */

function renderPagination() {

    return `

        <section class="pagination">

            <div class="pagination-info">

                Showing

                <strong>

                    ${Math.min(
                        state.filteredBuses.length,
                        state.pageSize
                    )}

                </strong>

                of

                <strong>

                    ${state.filteredBuses.length}

                </strong>

                buses

            </div>

            <div class="pagination-controls">

                <button
                    class="page-btn"
                    id="previous-page"
                >

                    ← Previous

                </button>

                <button
                    class="page-btn active"
                >

                    1

                </button>

                <button
                    class="page-btn"
                    id="next-page"
                >

                    Next →

                </button>

            </div>

        </section>

    `;

}


/**
 * =============================================================================
 * Modal Placeholder
 * =============================================================================
 */

function renderModal() {

    return `

        <div
            id="bus-modal"
            class="modal-container"
        >

        </div>

    `;

}
/* =============================================================================
   EVENT HANDLING
============================================================================= */

/**
 * Initialize all module events.
 */
function bindEvents(root) {

    bindToolbarEvents(root);

    bindSearchEvents(root);

    bindTableEvents(root);

}


/**
 * Toolbar Events
 */
function bindToolbarEvents(root) {

    const refreshButton = root.querySelector("#refresh-btn");

    if (refreshButton) {

        refreshButton.addEventListener("click", async () => {

            await loadBuses();

            refreshUI(root);

        });

    }

    const addButton = root.querySelector("#add-bus-btn");

    if (addButton) {

        addButton.addEventListener("click", async () => {

            Modal.form({

                eyebrow: "Fleet Management",

                title: "Add Bus",

                subtitle: "Register a new school bus to the fleet.",

                size: "lg",

                content: await createBusForm({}),
                submitText: "Save Bus",

                onSubmit: async () => {

                    await saveBus(root);

                }

            });

        });

    }
}


/**
 * Search Events
 */
function bindSearchEvents(root) {

    const searchInput = root.querySelector("#bus-search");

    if (!searchInput) return;

    searchInput.addEventListener("input", (event) => {

        state.searchQuery = event.target.value.trim().toLowerCase();

        filterBuses();

        refreshTable(root);

        refreshStatistics(root);

    });

}


/**
 * Table Events
 */
function bindTableEvents(root) {

    const tableBody = root.querySelector("#bus-table-body");

    if (!tableBody) return;

    tableBody.addEventListener("click", async (event) => {

        const viewButton = event.target.closest(".view-btn");

        if (viewButton) {

            await openBusViewModal(Number(viewButton.dataset.id));

            return;

        }

        const editButton = event.target.closest(".edit-btn");

        if (editButton) {

            const busId = Number(editButton.dataset.id);

            const bus = state.buses.find(
                bus => bus.id === busId
            );

            state.selectedBus = bus;

            Modal.form({

                eyebrow: "Fleet Management",

                title: "Edit Bus",

                subtitle: "Update the selected bus details.",

                size: "lg",

                content: await createBusForm(bus),
                submitText: "Update Bus",

                onSubmit: async () => {

                    const busData = getBusFormData();

                    const success = await updateBus(bus.id, busData);

                    if (!success) {

                        showNotification(
                            "Unable to update bus.",
                            "error"
                        );

                        return;
                    }

                    Modal.close();

                    await loadBuses();

                    refreshUI(root);

                    showNotification(
                        "Bus updated successfully.",
                        "success"
                    );

                }

            });

            return;

        }

        const deleteButton = event.target.closest(".delete-btn");

        if (deleteButton) {

            const busId = Number(deleteButton.dataset.id);

            Modal.confirm({

            title: "Delete Bus",

            subtitle: "This action cannot be undone.",

            confirmText: "Delete",

            onConfirm: async () => {

                const success = await deleteBus(busId);

                if (success) {

                    await loadBuses();

                    refreshUI(root);

                }

            }

        });

        return;

            

        }

    });

}

async function openBusViewModal(busId) {

    try {

        const response = await fetch(`${API.BUSES}${busId}`);

        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.detail || "Failed to load bus details.");
        }

        const bus = await response.json();

        Modal.alert({
            eyebrow: "FLEET MANAGEMENT",
            title: bus.bus_number,
            subtitle: "Bus details",
            content: `
                <div class="detail-list">
                    <p><strong>Registration:</strong> ${formatValue(bus.registration_number)}</p>
                    <p><strong>Capacity:</strong> ${formatValue(bus.capacity)}</p>
                    <p><strong>Vehicle:</strong> ${formatValue(bus.manufacturer)} ${formatValue(bus.model)} (${formatValue(bus.year)})</p>
                    <p><strong>Fuel:</strong> ${formatValue(bus.fuel_type)}</p>
                    <p><strong>Status:</strong> ${formatValue(bus.status)}</p>
                    <p><strong>GPS Device:</strong> ${formatValue(bus.device_id)}</p>
                </div>`,
        });

    } catch (error) {

        Modal.error({ title: "Unable to Load Bus", subtitle: error.message });

    }
}
/* =============================================================================
   HELPER FUNCTIONS
============================================================================= */

/**
 * Calculate fleet statistics.
 */
function calculateStatistics() {

    state.statistics.total = state.buses.length;

    state.statistics.active = state.buses.filter(
        bus => bus.status === STATUS.ACTIVE
    ).length;

    state.statistics.maintenance = state.buses.filter(
        bus => bus.status === STATUS.MAINTENANCE
    ).length;

    state.statistics.inactive = state.buses.filter(
        bus => bus.status === STATUS.INACTIVE
    ).length;

}


/**
 * Filter buses based on search query.
 */
function filterBuses() {

    if (!state.searchQuery) {

        state.filteredBuses = [...state.buses];

        return;

    }

    const query = state.searchQuery;

    state.filteredBuses = state.buses.filter(bus => {

        return (

            bus.bus_number.toLowerCase().includes(query) ||

            bus.registration_number.toLowerCase().includes(query) ||

            (bus.route ?? "").toLowerCase().includes(query) ||

            (bus.status ?? "").toLowerCase().includes(query)

        );

    });

}


/**
 * Refresh KPI cards.
 */
function refreshStatistics(root) {

    root.querySelector("#total-buses").textContent =
        state.statistics.total;

    root.querySelector("#active-buses").textContent =
        state.statistics.active;

    root.querySelector("#maintenance-buses").textContent =
        state.statistics.maintenance;

    root.querySelector("#inactive-buses").textContent =
        state.statistics.inactive;

}


/**
 * Refresh only the table body.
 */
function refreshTable(root) {

    const tbody = root.querySelector("#bus-table-body");

    if (!tbody) return;

    tbody.innerHTML = renderTableRows();

}


/**
 * Refresh entire module UI.
 */
function refreshUI(root) {

    calculateStatistics();

    filterBuses();

    refreshStatistics(root);

    refreshTable(root);

    const count = root.querySelector(".table-count");

    if (count) {

        count.innerHTML = `
            ${state.filteredBuses.length}
            <span>Buses</span>
        `;

    }

}


/**
 * Get status badge class.
 */
function getStatusClass(status) {

    switch (status) {

        case STATUS.ACTIVE:
            return "active";

        case STATUS.MAINTENANCE:
            return "maintenance";

        case STATUS.INACTIVE:
            return "inactive";

        default:
            return "";

    }

}


/**
 * Show notification.
 *
 * Placeholder.
 * Later this will become a reusable toast component.
 */
function showNotification(message, type = "info") {

    console.log(

        `[${type.toUpperCase()}] ${message}`

    );

}


/**
 * Format empty values.
 */
function formatValue(value) {

    if (

        value === null ||

        value === undefined ||

        value === ""

    ) {

        return "—";

    }

    return escapeHtml(value);

}
function formatDriverName(driverId) {

    const driver = state.drivers.find(

        d => d.id === driverId

    );

    return driver

        ? escapeHtml(driver.user?.full_name ?? "—")

        : "—";

}
/* =============================================================================
   MODULE INITIALIZATION
============================================================================= */

/**
 * Initialize the Bus Management module.
 *
 * This function is responsible for:
 * • Loading data from the backend
 * • Preparing the UI
 * • Binding all events
 */
async function initialize(root) {

    elements.page = root;

    elements.tableBody = root.querySelector("#bus-table-body");

    elements.statistics =
        root.querySelector(".statistics-grid");

    elements.toolbar =
        root.querySelector(".toolbar");

    elements.table =
        root.querySelector(".fleet-table");

    try {

        // Load buses from FastAPI
        await Promise.all([

        loadBuses(),

        loadDrivers(),

        loadRoutes()

    ]);
    refreshUI(root);
    }
    
     catch (error) {

        console.error(
            "Failed to initialize Bus Management:",
            error
        );

        showNotification(
            "Unable to load buses.",
            "error"
        );

    }

    // Attach all event listeners
    bindEvents(root);

}


/**
 * Reset module state.
 * Useful when reopening the page.
 */
function resetState() {

    state.buses = [];

    state.filteredBuses = [];

    state.selectedBus = null;

    state.searchQuery = "";

    state.currentPage = 1;

    state.loading = false;

    state.statistics = {

        total: 0,

        active: 0,

        maintenance: 0,

        inactive: 0

    };

}
/* ==========================================================================
   READ BUS FORM
========================================================================== */

function getBusFormData() {

    return {

        bus_number:
            document.querySelector("#bus_number").value.trim(),

        registration_number:
            document.querySelector("#registration_number").value.trim(),

        manufacturer:
            document.querySelector("#manufacturer").value.trim(),

        model:
            document.querySelector("#model").value.trim(),

        year:
            Number(document.querySelector("#year").value),

        fuel_type:
            document.querySelector("#fuel_type").getValue(),

        capacity:
            Number(document.querySelector("#capacity").value),

        device_id:
            document.querySelector("#device_id").value || null,

        status:
            document.querySelector("#status").getValue(),

    };

}
/* ==========================================================================
   SAVE BUS
========================================================================== */

/* ==========================================================================
   SAVE BUS
========================================================================== */

function showBusFormError(message) {

    const form = document.querySelector(".bus-form");

    if (!form) {

        return;

    }

    form.querySelectorAll(".modal-error").forEach((input) => {

        input.classList.remove("modal-error");

    });

    let error = form.querySelector(".bus-save-error");

    if (!error) {

        error = document.createElement("p");
        error.className = "modal-error-text bus-save-error";
        form.prepend(error);

    }

    error.textContent = message;

    const normalizedMessage = message.toLowerCase();
    const fieldId = normalizedMessage.includes("registration")
        ? "registration_number"
        : normalizedMessage.includes("bus number")
            ? "bus_number"
            : null;
    const field = fieldId ? form.querySelector(`#${fieldId}`) : null;

    if (field) {

        field.classList.add("modal-error");
        field.focus();

    }

}

async function saveBus(root) {

    try{

        const bus = getBusFormData();

        await createBus(bus);

        Modal.close();

        await loadBuses();

        refreshUI(root);

        showNotification(

            "Bus added successfully.",

            "success"

        );

    }

    catch(error){

        console.error(error);

        showBusFormError(error.message || "Unable to save bus.");

    }

}
/* =============================================================================
   PUBLIC RENDER FUNCTION
============================================================================= */

/**
 * Public entry point for the Bus Management module.
 * This is the function called by router.js.
 */
export function render() {

    // Reset state whenever the module is opened
    resetState();

    // Create page container
    const page = document.createElement("section");
    page.className = "buses-page";

    // Build UI
    page.innerHTML = `
        ${renderHero()}
        ${renderStatistics()}
        ${renderToolbar()}
        ${renderTable()}
        ${renderPagination()}
        ${renderModal()}
    `;

    // Initialize module
    initialize(page);

    return page;

}
