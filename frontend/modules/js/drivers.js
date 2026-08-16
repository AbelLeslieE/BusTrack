/* =============================================================================
   BUSTRACK
   DRIVER MANAGEMENT MODULE
============================================================================= */

import { Modal } from "../../common/modal.js";
import { escapeHtml } from "../../common/security.js";

import {
    createDriverForm,
    getDriverFormData
} from "./driverForm.js";

/* =============================================================================
   CONFIGURATION
============================================================================= */

const API = {

    DRIVERS: "/api/drivers/",

    BUSES: "/api/buses/"

};

const DRIVER_STATUS = {

    AVAILABLE: "Available",

    ON_DUTY: "On Duty",

    OFF_DUTY: "Off Duty",

    ON_TRIP: "On Trip"

};

const PAGE_SIZE = 10;

/* =============================================================================
   MODULE STATE
============================================================================= */

const state = {

    /* Driver data */

    drivers: [],

    filteredDrivers: [],

    /* Bus lookup */

    buses: [],

    /* Selected driver */

    selectedDriver: null,

    /* Search */

    searchQuery: "",

    /* Pagination */

    currentPage: 1,

    pageSize: PAGE_SIZE,

    /* Loading */

    loading: false,

    /* Statistics */

    statistics: {

        total: 0,

        available: 0,

        onDuty: 0,

        offDuty: 0,

        onTrip: 0,

        expiring: 0

    }

};

/* =============================================================================
   DOM REFERENCES
============================================================================= */

const elements = {

    page: null,

    statistics: null,

    toolbar: null,

    table: null,

    tableBody: null,

    pagination: null

};
/* =============================================================================
   BACKEND API
============================================================================= */

/**
 * ============================================================================
 * Load Drivers
 * ============================================================================
 */

async function loadDrivers() {

    state.loading = true;

    try {

        const response = await fetch(API.DRIVERS);

        if (!response.ok) {

            throw new Error("Failed to load drivers.");

        }

        const drivers = await response.json();

        state.drivers = drivers;

        state.filteredDrivers = [...drivers];

        calculateStatistics();

    }

    catch (error) {

        console.error("Error loading drivers:", error);

        state.drivers = [];

        state.filteredDrivers = [];

    }

    finally {

        state.loading = false;

    }

}


/**
 * ============================================================================
 * Load Buses
 * ============================================================================
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
 * ============================================================================
 * Update Driver
 * ============================================================================
 */

async function updateDriver(driverId, driverData) {

    const response = await fetch(

        `${API.DRIVERS}${driverId}`,

        {

            method: "PUT",

            headers: {

                "Content-Type": "application/json"

            },

            body: JSON.stringify(driverData)

        }

    );

    if (!response.ok) {

        const error = await response.json();

        throw new Error(

            error.detail || "Failed to update driver."

        );

    }

    return await response.json();

}


/**
 * ============================================================================
 * Delete Driver
 * ============================================================================
 */

async function deleteDriver(driverId) {

    const response = await fetch(

        `${API.DRIVERS}${driverId}`,

        {

            method: "DELETE"

        }

    );

    if (!response.ok) {

        const error = await response.json();

        throw new Error(

            error.detail || "Failed to delete driver."

        );

    }

}


/**
 * ============================================================================
 * Get Bus By ID
 * ============================================================================
 */

function getBus(busId) {

    return state.buses.find(

        bus => bus.id === busId

    ) || null;

}
/* =============================================================================
   HERO SECTION
============================================================================= */

/**
 * ============================================================================
 * Render Hero
 * ============================================================================
 */

function renderHero() {

    return `

        <section class="module-hero glass-card">

            <div class="hero-content">

                <div class="hero-text">

                    <span class="hero-badge">

                        DRIVER MANAGEMENT

                    </span>

                    <h1 class="hero-title">

                        Driver Command Center

                    </h1>

                    <p class="hero-description">

                        Manage driver profiles, assignments, license validity,
                        and operational status across the entire fleet.

                    </p>

                    <div class="hero-tags">

                        <span class="hero-tag">

                            👤 Driver Records

                        </span>

                        <span class="hero-tag">

                            🚍 Bus Assignment

                        </span>

                        <span class="hero-tag">

                            🪪 License Tracking

                        </span>

                    </div>

                </div>

                <div class="hero-actions">

                </div>

            </div>

        </section>

    `;

}
/* =============================================================================
   STATISTICS SECTION
============================================================================= */

/**
 * ============================================================================
 * Render Statistics
 * ============================================================================
 */

function renderStatistics() {

    return `

        <section class="statistics-grid">

            <!-- ==========================================================
                 TOTAL DRIVERS
            =========================================================== -->

            <article class="stat-card glass-card">

                <div class="stat-icon">

                    👤

                </div>

                <div class="stat-content">

                    <span class="stat-title">

                        Total Drivers

                    </span>

                    <h2
                        id="stat-total-drivers"
                        class="stat-value"
                    >

                        ${state.statistics.total}

                    </h2>

                    <span class="stat-description">

                        Registered Drivers

                    </span>

                </div>

            </article>

            <!-- ==========================================================
                 AVAILABLE
            =========================================================== -->

            <article class="stat-card glass-card">

                <div class="stat-icon success">

                    🟢

                </div>

                <div class="stat-content">

                    <span class="stat-title">

                        Available

                    </span>

                    <h2
                        id="stat-available"
                        class="stat-value"
                    >

                        ${state.statistics.available}

                    </h2>

                    <span class="stat-description">

                        Ready for Assignment

                    </span>

                </div>

            </article>

            <!-- ==========================================================
                 ON DUTY
            =========================================================== -->

            <article class="stat-card glass-card">

                <div class="stat-icon primary">

                    🚍

                </div>

                <div class="stat-content">

                    <span class="stat-title">

                        On Duty

                    </span>

                    <h2
                        id="stat-on-duty"
                        class="stat-value"
                    >

                        ${state.statistics.onDuty}

                    </h2>

                    <span class="stat-description">

                        Currently Assigned

                    </span>

                </div>

            </article>

            <!-- ==========================================================
                 LICENSE EXPIRY
            =========================================================== -->

            <article class="stat-card glass-card">

                <div class="stat-icon warning">

                    🪪

                </div>

                <div class="stat-content">

                    <span class="stat-title">

                        Expiring Licenses

                    </span>

                    <h2
                        id="stat-expiring"
                        class="stat-value"
                    >

                        ${state.statistics.expiring}

                    </h2>

                    <span class="stat-description">

                        Next 30 Days

                    </span>

                </div>

            </article>

        </section>

    `;

}
/* =============================================================================
   TOOLBAR
============================================================================= */

/**
 * ============================================================================
 * Render Toolbar
 * ============================================================================
 */

function renderToolbar() {

    return `

        <section class="module-toolbar glass-card">

            <div class="toolbar-left">

                <div class="search-box">

                    <span class="search-icon">

                        🔍

                    </span>

                    <input
                        id="driver-search"
                        type="text"
                        placeholder="Search by name, driver code, phone, license..."
                    >

                </div>

            </div>

            <div class="toolbar-right">

                <button
                    id="refresh-drivers-btn"
                    class="secondary-btn"
                >

                    <span>

                        ↻

                    </span>

                    <span>

                        Refresh

                    </span>

                </button>

                <button
                    id="filter-driver-btn"
                    class="secondary-btn"
                    disabled
                >

                    <span>

                        ⚙

                    </span>

                    <span>

                        Filters

                    </span>

                </button>

            </div>

        </section>

    `;

}
/* =============================================================================
   DRIVER TABLE
============================================================================= */

/**
 * ============================================================================
 * Render Driver Table
 * ============================================================================
 */

function renderTable() {

    return `

        <section class="table-section glass-card">

            <div class="table-wrapper">

                <table class="data-table">

                    <thead>

                        <tr>

                            <th>Driver</th>

                            <th>Phone</th>

                            <th>License</th>

                            <th>Assigned Bus</th>

                            <th>Status</th>

                            <th>Actions</th>

                        </tr>

                    </thead>

                    <tbody id="driver-table-body">

                        ${renderTableRows()}

                    </tbody>

                </table>

            </div>

        </section>

    `;

}


/**
 * ============================================================================
 * Render Driver Rows
 * ============================================================================
 */

function renderTableRows() {

    if (!state.filteredDrivers.length) {

        return renderEmptyState();

    }

    const startIndex =

        (state.currentPage - 1) *

        state.pageSize;

    const endIndex =

        startIndex +

        state.pageSize;

    const pageDrivers =

        state.filteredDrivers.slice(

            startIndex,

            endIndex

        );

    return pageDrivers.map(driver => {

        const bus = getBus(driver.bus_id);

        return `

            <tr>

                <td>

                    <div class="table-user">

                        <div class="table-avatar">

                            ${driver.user.full_name
                                ? escapeHtml(driver.user.full_name.charAt(0).toUpperCase())
                                : "D"}

                        </div>

                        <div>

                            <div class="table-title">

                                ${escapeHtml(driver.user.full_name)}

                            </div>

                            <div class="table-subtitle">

                                ${escapeHtml(driver.driver_code)}

                            </div>

                        </div>

                    </div>

                </td>

                <td>

                    ${escapeHtml(driver.user?.phone || "-")}

                </td>

                <td>

                    ${escapeHtml(driver.license_number)}

                </td>

                <td>

                    ${bus ? bus.bus_number : "-"}

                </td>

                <td>

                    <span class="status-badge ${getStatusClass(driver.status)}">

                        ${escapeHtml(driver.status)}

                    </span>

                </td>

                <td>

                    <div class="table-actions">

                        <button
                            class="table-action-btn view-driver"
                            data-id="${driver.id}"
                            title="View Driver"
                        >

                            👁

                        </button>

                        <button
                            class="table-action-btn edit-driver"
                            data-id="${driver.id}"
                            title="Edit Driver"
                        >

                            ✏

                        </button>

                        <button
                            class="table-action-btn delete-driver"
                            data-id="${driver.id}"
                            title="Delete Driver"
                        >

                            🗑

                        </button>

                    </div>

                </td>

            </tr>

        `;

    }).join("");

}


/**
 * ============================================================================
 * Empty State
 * ============================================================================
 */

function renderEmptyState() {

    return `

        <tr>

            <td colspan="6">

                <div class="table-empty">

                    <div class="table-empty-icon">

                        👤

                    </div>

                    <h3>

                        No Drivers Found

                    </h3>

                    <p>

                        There are currently no registered drivers.

                    </p>

                    <div class="empty-message">

                        Create a user with the
                        <strong>Driver</strong>
                        role from the
                        <strong>Users</strong>
                        module.

                    </div>

                </div>

            </td>

        </tr>

    `;

}
/* =============================================================================
   PAGINATION
============================================================================= */

/**
 * ============================================================================
 * Render Pagination
 * ============================================================================
 */

function renderPagination() {

    const totalPages = Math.max(

        1,

        Math.ceil(

            state.filteredDrivers.length /

            state.pageSize

        )

    );

    return `

        <section class="pagination-section">

            <div class="pagination-info">

                Showing

                <strong>

                    ${state.filteredDrivers.length}

                </strong>

                Drivers

            </div>

            <div class="pagination-controls">

                <button
                    id="previous-page-btn"
                    class="secondary-btn"
                    ${state.currentPage === 1 ? "disabled" : ""}
                >

                    ← Previous

                </button>

                <span class="page-number">

                    Page

                    ${state.currentPage}

                    of

                    ${totalPages}

                </span>

                <button
                    id="next-page-btn"
                    class="secondary-btn"
                    ${state.currentPage >= totalPages ? "disabled" : ""}
                >

                    Next →

                </button>

            </div>

        </section>

    `;

}


/* =============================================================================
   PAGE LAYOUT
============================================================================= */

/**
 * ============================================================================
 * Render Driver Management Page
 * ============================================================================
 */

function renderPage() {

    return `

        <div class="driver-management-page">

            ${renderHero()}

            ${renderStatistics()}

            ${renderToolbar()}

            ${renderTable()}

            ${renderPagination()}

        </div>

    `;

}



/**
 * ============================================================================
 * Open Edit Driver Modal
 * ============================================================================
 */

async function openEditDriverModal(driverId) {

    const driver = state.drivers.find(

        item => item.id === driverId

    );

    if (!driver) {

        return;

    }

    const form = createDriverForm(driver);

    Modal.form({

        eyebrow: "DRIVER MANAGEMENT",

        title: "Edit Driver",

        subtitle: "Update driver information.",

        content: form,

        submitText: "Update Driver",

        onSubmit: async () => {

            await saveDriver(driver.id);

        }

    });

}


/**
 * ============================================================================
 * Save Driver
 * ============================================================================
 */

async function saveDriver(driverId) {

    try {

        const driver = getDriverFormData();

        validateDriver(driver);

        if (!driverId) {

            throw new Error(
                "Drivers can only be created from the Users module."
            );

        }

        await updateDriver(
            driverId,
            driver
        );

        Modal.close();

        await loadDrivers();

        refreshStatistics();

        refreshTable();

    }

    catch (error) {

        Modal.error({

            title: "Unable to Save Driver",

            subtitle: error.message

        });

    }

}


/**
 * ============================================================================
 * Delete Driver
 * ============================================================================
 */

function confirmDeleteDriver(driverId) {

    Modal.confirm({

        eyebrow: "DRIVER MANAGEMENT",

        title: "Delete Driver",

        subtitle: "This action cannot be undone.",

        content: `

            <p>

                Are you sure you want to delete this driver?

            </p>

        `,

        confirmText: "Delete",

        style: "danger",

        onConfirm: async () => {

            try {

                await deleteDriver(driverId);

                await loadDrivers();

                refreshStatistics();

                refreshTable();

            }

            catch (error) {

                Modal.error({

                    title: "Delete Failed",

                    subtitle: error.message

                });

            }

        }

    });

}


/* =============================================================================
   EVENTS & INITIALIZATION
============================================================================= */

/**
 * ============================================================================
 * Bind Events
 * ============================================================================
 */

function bindEvents() {

    bindToolbarEvents();

    bindTableEvents();

}


/**
 * ============================================================================
 * Toolbar Events
 * ============================================================================
 */

function bindToolbarEvents() {

    /* ---------------------------------------------------------
       Search
    --------------------------------------------------------- */

    const search = document.querySelector("#driver-search");

    if (search) {

        search.addEventListener("input", event => {

            state.searchQuery = event.target.value;

            filterDrivers();

            refreshTable();

            refreshPagination();

        });

    }

    /* ---------------------------------------------------------
       Refresh
    --------------------------------------------------------- */

    const refresh = document.querySelector("#refresh-drivers-btn");

    if (refresh) {

        refresh.addEventListener("click", async () => {

            await loadDrivers();

            refreshStatistics();

            refreshTable();

            refreshPagination();

        });

    }




    /* ---------------------------------------------------------
    Previous Page
    --------------------------------------------------------- */

    const previousButton = elements.page.querySelector(

        "#previous-page-btn"

    );

    if (previousButton) {

        previousButton.addEventListener("click", () => {

            if (state.currentPage > 1) {

                state.currentPage--;

                refreshTable();

                refreshPagination();
                

            }

        });

    }

    /* ---------------------------------------------------------
    Next Page
    --------------------------------------------------------- */

    const nextButton = elements.page.querySelector(

        "#next-page-btn"

    );

    if (nextButton) {

        nextButton.addEventListener("click", () => {

            const totalPages = Math.ceil(

                state.filteredDrivers.length /

                state.pageSize

            );

            if (state.currentPage < totalPages) {

                state.currentPage++;

                refreshTable();

                refreshPagination();

            }

        });

    }

}


/**
 * ============================================================================
 * Table Events
 * ============================================================================
 */

function bindTableEvents() {

    document
        .querySelectorAll(".view-driver")
        .forEach(button => {
            button.addEventListener("click", () => {
                openDriverViewModal(Number(button.dataset.id));
            });
        });

    document

        .querySelectorAll(".edit-driver")

        .forEach(button => {

            button.addEventListener("click", () => {

                openEditDriverModal(

                    Number(button.dataset.id)

                );

            });

        });

    document

        .querySelectorAll(".delete-driver")

        .forEach(button => {

            button.addEventListener("click", () => {

                confirmDeleteDriver(

                    Number(button.dataset.id)

                );

            });

        });

}

async function openDriverViewModal(driverId) {

    try {

        const response = await fetch(`${API.DRIVERS}${driverId}`);

        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.detail || "Failed to load driver details.");
        }

        const driver = await response.json();

        Modal.alert({
            eyebrow: "DRIVER MANAGEMENT",
            title: driver.user?.full_name || driver.driver_code,
            subtitle: "Driver profile",
            content: `
                <div class="detail-list">
                    <p><strong>Driver code:</strong> ${escapeHtml(driver.driver_code || "—")}</p>
                    <p><strong>License:</strong> ${escapeHtml(driver.license_number || "—")}</p>
                    <p><strong>License expiry:</strong> ${escapeHtml(driver.license_expiry || "—")}</p>
                    <p><strong>Phone:</strong> ${escapeHtml(driver.user?.phone || "—")}</p>
                    <p><strong>Status:</strong> ${escapeHtml(driver.status || "—")}</p>
                </div>`,
        });

    } catch (error) {

        Modal.error({ title: "Unable to Load Driver", subtitle: error.message });

    }
}


/**
 * ============================================================================
 * Filter Drivers
 * ============================================================================
 */

function filterDrivers() {

    const query =

        state.searchQuery

            .trim()

            .toLowerCase();

    if (!query) {

        state.filteredDrivers = [

            ...state.drivers

        ];

        return;

    }

    state.filteredDrivers = state.drivers.filter(driver => {

        return (

            driver.user.full_name

                ?.toLowerCase()

                .includes(query)

            ||

            driver.driver_code

                ?.toLowerCase()

                .includes(query)

            ||

            driver.user?.email
                ?.toLowerCase()
                .includes(query)

            ||

            driver.license_number

                ?.toLowerCase()

                .includes(query)

            ||

            driver.status

                ?.toLowerCase()

                .includes(query)

        );
        

    });
    state.currentPage = 1;
}


/**
 * ============================================================================
 * Refresh Statistics
 * ============================================================================
 */

function refreshStatistics() {

    calculateStatistics();

    const statistics = elements.page.querySelector(

        ".statistics-grid"

    );

    if (!statistics) {

        return;

    }

    statistics.outerHTML = renderStatistics();

    elements.statistics = elements.page.querySelector(

        ".statistics-grid"

    );

}


/**
 * ============================================================================
 * Refresh Table
 * ============================================================================
 */

function refreshTable() {

    const body = elements.page.querySelector(

        "#driver-table-body"

    );

    if (!body) {

        return;

    }

    body.innerHTML = renderTableRows();

    elements.tableBody = body;

    bindTableEvents();

}

/**
 * ============================================================================
 * Refresh Pagination
 * ============================================================================
 */

function refreshPagination() {

    const pagination = elements.page.querySelector(

        ".pagination-section"

    );

    if (!pagination) {

        return;

    }

    pagination.outerHTML = renderPagination();

    elements.pagination = elements.page.querySelector(

        ".pagination-section"

    );
    bindToolbarEvents();

}


/**
 * ============================================================================
 * Initialize Module
 * ============================================================================
 */

async function initialize() {

    try {

        await loadBuses();

        await loadDrivers();

        refreshStatistics();

        refreshTable();

        refreshPagination();

        bindEvents();

    }

    catch (error) {

        console.error(

            "Driver module initialization failed:",

            error

        );

    }

}
/* =============================================================================
   PUBLIC RENDER
============================================================================= */

/**
 * ============================================================================
 * Render Driver Module
 * ============================================================================
 */

export function render() {

    /* ---------------------------------------------------------
       Create Page
    --------------------------------------------------------- */

    const page = document.createElement("div");

    page.className = "driver-module";

    page.innerHTML = renderPage();

    /* ---------------------------------------------------------
       Store DOM References
    --------------------------------------------------------- */

    elements.page = page;

    elements.statistics = page.querySelector(".statistics-grid");

    elements.toolbar = page.querySelector(".module-toolbar");

    elements.table = page.querySelector(".table-section");

    elements.tableBody = page.querySelector("#driver-table-body");

    elements.pagination = page.querySelector(".pagination-section");

    /* ---------------------------------------------------------
       Initialize
    --------------------------------------------------------- */

    requestAnimationFrame(() => {

        initialize();

    });

    return page;

}
function calculateStatistics() {

    state.statistics.total = state.drivers.length;

    state.statistics.available =
        state.drivers.filter(
            d => d.status === DRIVER_STATUS.AVAILABLE
        ).length;

    state.statistics.onDuty =
        state.drivers.filter(
            d => d.status === DRIVER_STATUS.ON_DUTY
        ).length;

    state.statistics.offDuty =
        state.drivers.filter(
            d => d.status === DRIVER_STATUS.OFF_DUTY
        ).length;

    state.statistics.onTrip =
        state.drivers.filter(
            d => d.status === DRIVER_STATUS.ON_TRIP
        ).length;

    const today = new Date();

    const next30 = new Date();

    next30.setDate(today.getDate() + 30);

    state.statistics.expiring =
        state.drivers.filter(driver => {

            if (!driver.license_expiry) {

                return false;

            }

            const expiry = new Date(driver.license_expiry);

            return expiry >= today &&
                   expiry <= next30;

        }).length;

}
function getStatusClass(status) {

    switch (status) {

        case DRIVER_STATUS.AVAILABLE:
            return "success";

        case DRIVER_STATUS.ON_DUTY:
            return "primary";

        case DRIVER_STATUS.ON_TRIP:
            return "warning";

        case DRIVER_STATUS.OFF_DUTY:
            return "secondary";

        default:
            return "secondary";

    }

}
/* =============================================================================
   FORM VALIDATION
============================================================================= */

function validateDriver(driver) {

    if (!driver.driver_code) {
        throw new Error("Driver Code is required.");
    }

    if (!driver.license_number) {
        throw new Error("License Number is required.");
    }

    if (!driver.license_expiry) {
        throw new Error("License Expiry is required.");
    }

    return true;

}
/* =============================================================================
   MODULE CLEANUP
============================================================================= */

export function destroy() {

    state.drivers = [];

    state.filteredDrivers = [];

    state.buses = [];

    state.selectedDriver = null;

    state.currentPage = 1;

    state.searchQuery = "";

}
