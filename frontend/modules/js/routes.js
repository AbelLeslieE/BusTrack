/* ==========================================================================
   BUS TRACK
   ROUTE MANAGEMENT MODULE
========================================================================== */

import { Modal } from "../../common/modal.js";
import { confirmDeletion, showOperationFeedback } from "../../common/operationFeedback.js";
import { escapeHtml } from "../../common/security.js";
import { openRouteViewModal } from "../../common/routeViewModal.js";
import {
    createRouteForm,
    getSelectedStops,
    setSelectedStops
} from "./routeForm.js";
import { showRouteImportModal } from "./routeImport.js";
import { getStops } from "./stopsApi.js";

import {

    getRouteStops,

    replaceRouteStops

} from "./routeStopsApi.js";
/* ==========================================================================
   CONFIGURATION
========================================================================== */

const API = {

    ROUTES: "/api/routes",

    BUSES: "/api/buses",

    DRIVERS: "/api/drivers"

};

const STATUS = {

    ACTIVE: "Active",

    INACTIVE: "Inactive"

};

const PAGE_SIZE = 10;

/* ==========================================================================
   MODULE STATE
========================================================================== */

const state = {

    /* All routes returned from the backend */
    routes: [],

    /* Search results */
    filteredRoutes: [],

    /* Bus list */
    buses: [],

    /* Driver list */
    drivers: [],

    /* Master Stops */
    stops: [],

    /* Stops belonging to current route */
    routeStops: [],

    /* Current Route Builder */
    currentRouteId: null,

    /* Currently selected route */
    selectedRoute: null,

    /* Search text */
    searchQuery: "",

    /* Pagination */
    currentPage: 1,

    pageSize: PAGE_SIZE,

    /* Loading */
    loading: false,

    /* Statistics */
    statistics: {

        total: 0,

        active: 0,

        inactive: 0,

        totalStops: 0

    }

};

/* ==========================================================================
   DOM REFERENCES
========================================================================== */

const elements = {

    page: null,

    statistics: null,

    toolbar: null,

    table: null,

    tableBody: null,

    pagination: null

};
/* ==========================================================================
   API FUNCTIONS
========================================================================== */

/**
 * Load all routes.
 */
async function loadRoutes() {

    state.loading = true;

    try {

        const response = await fetch(API.ROUTES);

        if (!response.ok) {

            throw new Error("Failed to load routes.");

        }

        const data = await response.json();

        state.routes = data;

        state.filteredRoutes = [...data];

        calculateStatistics();

    }

    catch (error) {

        console.error("Error loading routes:", error);

        state.routes = [];

        state.filteredRoutes = [];

    }

    finally {

        state.loading = false;

    }

}


/**
 * Load all buses.
 * Used for the Route form dropdown.
 */
async function loadBuses() {

    try {

        const response = await fetch(API.BUSES);

        if (!response.ok) {

            throw new Error("Failed to load buses.");

        }

        state.buses = await response.json();

    }

    catch (error) {

        console.error("Error loading buses:", error);

        state.buses = [];

    }

}


/**
 * Load all drivers.
 * Used for the Route form dropdown.
 */
async function loadDrivers() {

    try {

        const response = await fetch(API.DRIVERS);

        if (!response.ok) {

            throw new Error("Failed to load drivers.");

        }

        state.drivers = await response.json();

    }

    catch (error) {

        console.error("Error loading drivers:", error);

        state.drivers = [];

    }

}

/* ==========================================================
   LOAD MASTER STOPS
========================================================== */

async function loadStops() {

    try {

        state.stops = await getStops();

    }

    catch (error) {

        console.error(error);

        state.stops = [];

    }

}
/**
 * Create a new route.
 */
async function createRoute(routeData) {

    const response = await fetch(API.ROUTES, {

            method: "POST",

            headers: {

                "Content-Type": "application/json"

            },

            body: JSON.stringify(routeData)

        });

    if (!response.ok) {

        const error = await response.json().catch(() => ({}));

        throw new Error(error.detail || "Unable to create route.");

    }

    const newRoute = await response.json();

    await loadRoutes();

    return newRoute;

}


/**
 * Update an existing route.
 */
async function updateRoute(routeId, routeData) {

    const response = await fetch(`${API.ROUTES}/${routeId}`, {

            method: "PUT",

            headers: {

                "Content-Type": "application/json"

            },

            body: JSON.stringify(routeData)

        });

    if (!response.ok) {

        const error = await response.json().catch(() => ({}));

        throw new Error(error.detail || "Unable to update route.");

    }

    const updatedRoute = await response.json();

    await loadRoutes();

    return updatedRoute;

}


/**
 * Delete a route.
 */
async function deleteRoute(routeId) {

    const response = await fetch(`${API.ROUTES}/${routeId}`, {

            method: "DELETE"

        });

    if (response.status === 404) {

        await loadRoutes();

        return { deleted: false, stale: true };

    }

    if (!response.ok) {

        const error = await response.json().catch(() => ({}));

        throw new Error(error.detail || "Unable to delete route.");

    }

    await loadRoutes();

    return { deleted: true, stale: false };

}
/* =============================================================================
   ROUTE HERO
============================================================================= */

function renderHero() {

    return `

        <section class="hero-section glass-card">

            <div class="hero-left">

                <p class="hero-caption">

                    TRANSPORT MANAGEMENT

                </p>

                <h1 class="hero-title">

                    Route Management

                </h1>

                <p class="hero-description">

                    Manage transport routes, assign buses and drivers,
                    and prepare your transport network for live GPS tracking.

                </p>

                <div class="hero-status">

                    <div class="status-chip">

                        <span class="status-dot green"></span>

                        Routes Active

                    </div>

                    <div class="status-chip">

                        <span class="status-dot blue"></span>

                        Drivers Assigned

                    </div>

                    <div class="status-chip">

                        <span class="status-dot orange"></span>

                        Ready for Live Tracking

                    </div>

                </div>

            </div>

            <div class="hero-right">

                <div class="toolbar-actions">

                    <button
                        id="refresh-btn"
                        class="secondary-btn refresh-btn"
                    >

                        Refresh

                    </button>

                    <button
                        id="import-route-btn"
                        class="secondary-btn export-btn"
                    >

                        📄 Import Excel

                    </button>

                    <button
                        id="add-route-btn"
                        class="primary-btn"
                    >

                        + Add Route

                    </button>

                </div>

            </div>

        </section>

    `;

}
/* =============================================================================
   ROUTE STATISTICS
============================================================================= */

function renderStatistics() {

    return `

        <section class="statistics-grid">

            <!-- ==========================================================
                 TOTAL ROUTES
            =========================================================== -->

            <article class="stat-card">

                <span class="stat-indicator blue"></span>

                <div class="stat-content">

                    <div class="stat-label">

                        Total Routes

                    </div>

                    <div
                        id="total-routes"
                        class="stat-value"
                    >

                        ${state.statistics.total}

                    </div>

                    <div class="stat-subtitle">

                        Registered Routes

                    </div>

                </div>

                <div class="stat-icon blue">

                    🛣️

                </div>

            </article>

            <!-- ==========================================================
                 ACTIVE ROUTES
            =========================================================== -->

            <article class="stat-card">

                <span class="stat-indicator green"></span>

                <div class="stat-content">

                    <div class="stat-label">

                        Active Routes

                    </div>

                    <div
                        id="active-routes"
                        class="stat-value"
                    >

                        ${state.statistics.active}

                    </div>

                    <div class="stat-subtitle">

                        Currently Operating

                    </div>

                </div>

                <div class="stat-icon green">

                    🟢

                </div>

            </article>

            <!-- ==========================================================
                 INACTIVE ROUTES
            =========================================================== -->

            <article class="stat-card">

                <span class="stat-indicator red"></span>

                <div class="stat-content">

                    <div class="stat-label">

                        Inactive Routes

                    </div>

                    <div
                        id="inactive-routes"
                        class="stat-value"
                    >

                        ${state.statistics.inactive}

                    </div>

                    <div class="stat-subtitle">

                        Not in Service

                    </div>

                </div>

                <div class="stat-icon red">

                    ⛔

                </div>

            </article>

            <!-- ==========================================================
                 TOTAL STOPS
            =========================================================== -->

            <article class="stat-card">

                <span class="stat-indicator orange"></span>

                <div class="stat-content">

                    <div class="stat-label">

                        Total Stops

                    </div>

                    <div
                        id="total-stops"
                        class="stat-value"
                    >

                        ${state.statistics.totalStops}

                    </div>

                    <div class="stat-subtitle">

                        Across All Routes

                    </div>

                </div>

                <div class="stat-icon orange">

                    📍

                </div>

            </article>

        </section>

    `;

}
/* =============================================================================
   ROUTE TOOLBAR
============================================================================= */

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
                        id="route-search"
                        class="search-box"
                        type="text"
                        placeholder="Search routes by code, route name, bus, driver or status..."
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
/* =============================================================================
   ROUTE TABLE
============================================================================= */

function renderTable() {

    return `

        <section class="fleet-table glass-card">

            <div class="table-header">

                <div>

                    <p class="table-caption">

                        TRANSPORT ROUTES

                    </p>

                    <h2 class="table-title">

                        Registered Routes

                    </h2>

                </div>

                <div class="table-count">

                    ${state.filteredRoutes.length}

                    <span>Routes</span>

                </div>

            </div>

            <div class="table-wrapper">

                <table class="fleet-data-table">

                    <thead>

                        <tr>

                            <th>Route Code</th>

                            <th>Route Name</th>

                            <th>Bus</th>

                            <th>Driver</th>

                            <th>Stops</th>

                            <th>Status</th>

                            <th>Actions</th>

                        </tr>

                    </thead>

                    <tbody id="route-table-body">

                        ${renderTableRows()}

                    </tbody>

                </table>

            </div>

        </section>

    `;

}
/* =============================================================================
   ROUTE TABLE ROWS
============================================================================= */

function renderTableRows() {

    if (!state.filteredRoutes.length) {

        return renderEmptyState();

    }

    return getVisibleRoutes().map(route => `

        <tr>

            <td>

                <strong>

                    ${escapeHtml(route.route_code)}

                </strong>

            </td>

            <td>

                ${formatValue(route.route_name)}

            </td>

            <td>

                ${getBusName(route.bus_id)}

            </td>

            <td>

                ${getDriverName(route.driver_id)}

            </td>

            <td>

                ${route.total_stops ?? 0}

            </td>

            <td>

                <span class="status-badge ${getStatusClass(route.status)}">

                    ${escapeHtml(route.status)}

                </span>

            </td>

            <td>

                <div class="table-actions">

                        <button
                            class="icon-btn view-btn"
                            data-id="${route.id}"
                            title="View Route"
                        >
                            <i class="fa-solid fa-eye"></i>
                        </button>

                        <button
                            class="icon-btn edit-btn"
                            data-id="${route.id}"
                            title="Edit Route"
                        >
                            <i class="fa-solid fa-pen-to-square"></i>
                        </button>

                        <button
                            class="icon-btn delete-btn"
                            data-id="${route.id}"
                            title="Delete Route"
                        >
                            <i class="fa-solid fa-trash"></i>
                        </button>

                    </div>

            </td>

        </tr>

    `).join("");

}
/* =============================================================================
   EMPTY STATE
============================================================================= */

function renderEmptyState() {

    return `

        <tr>

            <td colspan="7">

                <div class="empty-state">

                    <div class="empty-icon">

                        🛣️

                    </div>

                    <h3>

                        No routes available

                    </h3>

                    <p>

                        Create your first transport route to begin managing
                        your school's transport network.

                    </p>

                </div>

            </td>

        </tr>

    `;

}
/* =============================================================================
   ROUTE PAGINATION
============================================================================= */

function renderPagination() {

    const total = state.filteredRoutes.length;

    const pageCount = Math.max(1, Math.ceil(total / state.pageSize));

    const start = total ? ((state.currentPage - 1) * state.pageSize) + 1 : 0;

    const end = Math.min(total, state.currentPage * state.pageSize);

    return `

        <section class="pagination">

            <div class="pagination-info">

                Showing

                <strong>

                    ${start}–${end}

                </strong>

                of

                <strong>

                    ${total}

                </strong>

                routes

            </div>

            <div class="pagination-controls">

                <button
                    class="page-btn"
                    id="previous-page"
                    ${state.currentPage === 1 ? "disabled" : ""}
                >

                    ← Previous

                </button>

                <button
                    class="page-btn active"
                    disabled
                >

                    ${state.currentPage} / ${pageCount}

                </button>

                <button
                    class="page-btn"
                    id="next-page"
                    ${state.currentPage === pageCount ? "disabled" : ""}
                >

                    Next →

                </button>

            </div>

        </section>

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

}


/**
 * =============================================================================
 * Toolbar Events
 * =============================================================================
 */

function bindToolbarEvents(root) {

    /* ----------------------------------------------------------
       Refresh
    ---------------------------------------------------------- */

    const refreshButton = root.querySelector("#refresh-btn");

    if (refreshButton) {

        refreshButton.addEventListener("click", async () => {

            await Promise.all([

                loadRoutes(),

                loadBuses(),

                loadDrivers()

            ]);

            refreshUI(root);

        });

    }
    /* ----------------------------------------------------------
    Import Excel
    ---------------------------------------------------------- */

    const importButton =
        root.querySelector("#import-route-btn");

    if (importButton) {

        importButton.addEventListener("click", () => {

            showRouteImportModal(async () => {

                await loadRoutes();

                calculateStatistics();

                refreshUI(root);

            });

        });

    }
    /* ----------------------------------------------------------
       Add Route
    ---------------------------------------------------------- */

    const addButton = root.querySelector("#add-route-btn");

    if (addButton) {

        addButton.addEventListener("click", () => {

            // A cancelled edit must not turn the next Add action into an
            // accidental update of the previously selected route.
            state.selectedRoute = null;

            Modal.form({

                eyebrow: "Transport Management",

                title: "Add Route",

                subtitle: "Create a new transport route.",

                size: "lg",

                content: createRouteForm(

                    {},

                    state.buses,

                    state.drivers

                ),

                submitText: "Save Route",

                onSubmit: async () => {

                    await saveRoute(root);

                }

            });

        });

    }

}


/**
 * =============================================================================
 * Search Events
 * =============================================================================
 */

function bindSearchEvents(root) {

    const searchInput = root.querySelector("#route-search");

    if (!searchInput) return;

    searchInput.addEventListener("input", (event) => {

        state.searchQuery = event.target.value.trim().toLowerCase();

        state.currentPage = 1;

        filterRoutes();

        refreshTable(root);

        refreshStatistics(root);

    });

}


function bindPaginationEvents(root) {

    root.querySelector("#previous-page")?.addEventListener("click", () => {

        if (state.currentPage > 1) {

            state.currentPage -= 1;

            refreshUI(root);

        }

    });

    root.querySelector("#next-page")?.addEventListener("click", () => {

        const pageCount = Math.ceil(state.filteredRoutes.length / state.pageSize);

        if (state.currentPage < pageCount) {

            state.currentPage += 1;

            refreshUI(root);

        }

    });

}


/**
 * =============================================================================
 * Table Events
 * =============================================================================
 */

function bindTableEvents(root) {

    const tableBody = root.querySelector("#route-table-body");

    if (!tableBody) return;

    tableBody.addEventListener("click", async (event) => {
        /* ----------------------------------------------------------
        VIEW
        ---------------------------------------------------------- */

        const viewButton = event.target.closest(".view-btn");

        if (viewButton) {

            const routeId = Number(viewButton.dataset.id);

            const route = state.routes.find(

                route => route.id === routeId

            );

            if (!route) {

                return;

            }

            const routeStops = await getRouteStops(routeId);

            openRouteViewModal({

                ...route,

                stops: routeStops

            });

            return;

        }
        /* ----------------------------------------------------------
           EDIT
        ---------------------------------------------------------- */

        const editButton = event.target.closest(".edit-btn");

        if (editButton) {

            const routeId = Number(editButton.dataset.id);

            const route = state.routes.find(

                route => route.id === routeId

            );

            state.selectedRoute = route;

            Modal.form({

                eyebrow: "Transport Management",

                title: "Edit Route",

                subtitle: "Update the selected route.",

                size: "lg",

                content: createRouteForm(
                    route,
                    state.buses,
                    state.drivers
                ),

                submitText: "Update Route",

                onSubmit: async () => {

                    await saveRoute(root);

                }

            });

            /* ----------------------------------------------------------
            LOAD EXISTING ROUTE STOPS
            ---------------------------------------------------------- */

            const routeStops =
                await getRouteStops(
                    route.id
                );


            const formattedStops =
                routeStops.map(
                    routeStop => {

                        /*
                        * RouteStop stores the stop_id.
                        * The actual coordinates belong to
                        * the master Stop record in state.stops.
                        */

                        const stopId =
                            routeStop.stop_id ??
                            routeStop.stop?.id;


                        const masterStop =
                            state.stops.find(
                                stop =>
                                    Number(stop.id) ===
                                    Number(stopId)
                            );


                        if (!masterStop) {

                            console.warn(
                                "BusTrack: Master stop not found.",
                                routeStop
                            );

                            return {

                                id:
                                    stopId,

                                stop_name:
                                    routeStop.stop_name ||
                                    routeStop.name ||
                                    "Transport Stop"

                            };

                        }


                        return {

                            id:
                                masterStop.id,

                            stop_name:
                                masterStop.stop_name,

                            latitude:
                                masterStop.latitude,

                            longitude:
                                masterStop.longitude

                        };

                    }
                );


            setSelectedStops(
                formattedStops
            );

            return;

        }

        /* ----------------------------------------------------------
           DELETE
        ---------------------------------------------------------- */

        const deleteButton = event.target.closest(".delete-btn");

        if (deleteButton) {

            const routeId = Number(deleteButton.dataset.id);
            const route = state.routes.find(item => item.id === routeId);
            const routeName = route?.route_code || route?.route_name || `route #${routeId}`;
            const confirmed = await confirmDeletion({
                title: `Delete ${routeName}?`,
                message: `${routeName} and its stop assignments will be removed. This action cannot be undone.`
            });

            if (!confirmed) return;

            try {
                await deleteRoute(routeId);
                refreshUI(root);
                showOperationFeedback({
                    type: "success",
                    title: "Route deleted",
                    message: `${routeName} was deleted successfully.`
                });
            } catch (error) {
                showOperationFeedback({
                    type: "error",
                    title: "Route was not deleted",
                    message: error.message || "Please refresh and try again."
                });
            }

        }

    });

}
/* =============================================================================
   HELPER FUNCTIONS
============================================================================= */

/**
 * Calculate dashboard statistics.
 */
function calculateStatistics() {

    state.statistics.total = state.routes.length;

    state.statistics.active = state.routes.filter(

        route => route.status === STATUS.ACTIVE

    ).length;

    state.statistics.inactive = state.routes.filter(

        route => route.status === STATUS.INACTIVE

    ).length;

    state.statistics.totalStops = state.routes.reduce(

        (total, route) => total + (route.total_stops || 0),

        0

    );

}


/**
 * Filter routes using the search box.
 */
function filterRoutes() {

    const query = state.searchQuery;

    if (!query) {

        state.filteredRoutes = [...state.routes];

        return;

    }

    state.filteredRoutes = state.routes.filter(route => {

        const bus = state.buses.find(item => item.id === route.bus_id);

        const driver = state.drivers.find(item => item.id === route.driver_id);

        const busName = `${bus?.bus_number || ""} ${bus?.registration_number || ""}`.toLowerCase();

        const driverName = `${driver?.user?.full_name || ""} ${driver?.driver_code || ""}`.toLowerCase();

        return (

            (route.route_code || "").toLowerCase().includes(query) ||

            (route.route_name || "").toLowerCase().includes(query) ||

            busName.includes(query) ||

            driverName.includes(query) ||

            (route.status || "").toLowerCase().includes(query)

        );

    });

}


/**
 * Refresh statistics cards.
 */
function refreshStatistics(root) {

    const statistics = root.querySelector(".statistics-grid");

    if (!statistics) return;

    calculateStatistics();

    statistics.outerHTML = renderStatistics();

}


/**
 * Refresh table only.
 */
function refreshTable(root) {

    const table = root.querySelector(".fleet-table");

    if (!table) return;

    table.outerHTML = renderTable();
    
    bindTableEvents(root);

}


function getVisibleRoutes() {

    const pageCount = Math.max(1, Math.ceil(state.filteredRoutes.length / state.pageSize));

    state.currentPage = Math.min(Math.max(1, state.currentPage), pageCount);

    const start = (state.currentPage - 1) * state.pageSize;

    return state.filteredRoutes.slice(start, start + state.pageSize);

}


/**
 * Refresh the entire UI.
 */
function refreshUI(root) {

    calculateStatistics();

    refreshStatistics(root);

    refreshTable(root);

    refreshPagination(root);

}


function refreshPagination(root) {

    const pagination = root.querySelector(".pagination");

    if (!pagination) return;

    pagination.outerHTML = renderPagination();

    bindPaginationEvents(root);

}


/**
 * Get Bus Name from ID.
 */
function getBusName(busId) {

    if (!busId) {

        return `
            <span class="table-empty">
                Unassigned
            </span>
        `;

    }

    const bus = state.buses.find(

        bus => bus.id === busId

    );

    if (!bus) {

        return `
            <span class="table-empty">
                Unknown
            </span>
        `;

    }

    return `

        <div class="table-bus">

            <div class="table-bus-title">

                ${escapeHtml(bus.bus_number)}

            </div>

            <div class="table-bus-sub">

                ${escapeHtml(bus.registration_number)}

            </div>

        </div>

    `;

}


/**
 * Get Driver Name from ID.
 */
function getDriverName(driverId) {

    if (!driverId) {

        return `
            <span class="table-empty">
                Unassigned
            </span>
        `;

    }

    const driver = state.drivers.find(
        d => d.id === driverId
    );

    if (!driver) {

        return `
            <span class="table-empty">
                Unknown
            </span>
        `;

    }

    return `

        <div class="table-driver">

            <div class="table-driver-title">

                ${escapeHtml(driver.user?.full_name ?? "Unknown")}

            </div>

            <div class="table-driver-sub">

                ${escapeHtml(driver.driver_code)}

            </div>

        </div>

    `;

}


/**
 * Return CSS class for status badge.
 */
function getStatusClass(status) {

    switch (status) {

        case STATUS.ACTIVE:

            return "status-active";

        case STATUS.INACTIVE:

            return "status-inactive";

        default:

            return "status-default";

    }

}


/**
 * Display placeholder for empty values.
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
/* =============================================================================
   SAVE ROUTE
============================================================================= */

function showRouteFormError(form, message) {

    const existing = form.querySelector(".route-save-error");

    if (existing) {

        existing.textContent = message;

    } else {

        const error = document.createElement("p");

        error.className = "modal-error-text route-save-error";

        error.textContent = message;

        form.prepend(error);

    }

    const codeInput = form.querySelector("#route_code");

    if (codeInput) {

        codeInput.classList.add("modal-error");

        codeInput.focus();

    }

}

async function saveRoute(root) {

    const form = document.querySelector(".route-form");

    if (!form) {

        return;

    }

    const routeData = {

        route_code:
            form.querySelector("#route_code")?.value.trim(),

        route_name:
            form.querySelector("#route_name")?.value.trim(),

        departure_time:
            form.querySelector("#departure_time")?.value || null,

        arrival_time:
            form.querySelector("#arrival_time")?.value || null,

        status:
            form.querySelector("#status")?.getValue() || "Active"

    };

    /* ----------------------------------------------------------
       Basic Validation
    ---------------------------------------------------------- */

    if (

        !routeData.route_code ||

        !routeData.route_name

    ) {

        const message = "Enter both a route code and route name before saving.";
        showRouteFormError(form, message);
        showOperationFeedback({ type: "warning", title: "Route needs more details", message });

        return;

    }

    const editingRoute = state.selectedRoute;
    let savedRoute = null;

    try {

        savedRoute = editingRoute
            ? await updateRoute(editingRoute.id, routeData)
            : await createRoute(routeData);

    }

    catch (error) {
        const message = error.message || "Unable to save this route.";
        showRouteFormError(form, message);
        showOperationFeedback({ type: "error", title: "Route was not saved", message });

        return;

    }

    /* ==========================================================
    SAVE ROUTE STOPS
    ========================================================== */

    const selectedStops = getSelectedStops();

    try {

        await replaceRouteStops(

            savedRoute.id,

            selectedStops.map(stop => ({ stop_id: stop.id }))

        );

    }

    catch (error) {

        // A newly created route already has a database ID. Keep it selected
        // so correcting the stop list retries the update instead of creating
        // a duplicate route.
        state.selectedRoute = savedRoute;

        const message = error.message || "Unable to save route stops.";
        showRouteFormError(form, message);
        showOperationFeedback({ type: "error", title: "Route stops were not saved", message });

        return;

    }

    await Promise.all([

        loadRoutes(),

        loadBuses(),

        loadDrivers(),

        loadStops()

    ]);

    refreshUI(root);
    state.selectedRoute = null;
    Modal.close();
    showOperationFeedback({
        type: "success",
        title: editingRoute ? "Route updated" : "Route created",
        message: `${savedRoute.route_code || savedRoute.route_name} was saved successfully.`
    });
    /* ==========================================================
    ROUTE CREATED
    ========================================================== */



    }
/* =============================================================================
   ENABLE ROUTE BUILDER
============================================================================= */

function enableRouteBuilder(routeId){

    const form = document.querySelector(".route-form");

    if(!form){

        return;

    }

    /* Store current route */

    form.dataset.routeId = routeId;

    /* Enable Add Stop button */


    /* Update Placeholder */

    const list = form.querySelector("#route-stop-list");

    if(list){

        list.innerHTML = `

            <div class="route-stop-empty">

                Route created successfully.

                You can now start adding stops.

            </div>

        `;

    }

}
/* =============================================================================
   BIND ROUTE BUILDER
============================================================================= */

function bindRouteBuilder(form){

    // Route Builder is now fully handled by routeForm.js

}

/* =============================================================================
   INITIALIZE MODULE
============================================================================= */

async function initialize(root) {

    try {

        await Promise.all([

        loadRoutes(),

        loadBuses(),

        loadDrivers(),

        loadStops()

    ]);

        calculateStatistics();
        refreshUI(root);
        bindEvents(root);

    }

    catch (error) {

        console.error(error);

    }

}


/* =============================================================================
   RENDER MODULE
============================================================================= */

export function render() {

    const root = document.createElement("div");

    root.className = "routes-page";

    root.innerHTML = `

        ${renderHero()}

        ${renderStatistics()}

        ${renderToolbar()}

        ${renderTable()}

        ${renderPagination()}
        
    `;
    
    initialize(root);

    return root;

}
