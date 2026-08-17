/* =============================================================================
   BUSTRACK
   USER MANAGEMENT MODULE
============================================================================= */

import { Modal } from "../../common/modal.js";
import { escapeHtml } from "../../common/security.js";

import {
    createUserForm,
    getUserFormData,
    validateUserForm
} from "./userForm.js";

import {
    getUsers,
    getUser,
    createUser,
    updateUser,
    deleteUser
} from "./usersApi.js";

/* =============================================================================
   CONFIGURATION
============================================================================= */

const PAGE_SIZE = 10;

const USER_STATUS = {

    ACTIVE: "Active",

    INACTIVE: "Inactive",

    LOCKED: "Locked"

};

const USER_ROLES = {

    ADMIN: "Admin",

    DRIVER: "Driver",

    USER: "User",

    TECHNICIAN: "Technician"

};


/* =============================================================================
   MODULE STATE
============================================================================= */

const state = {

    /* ---------------------------------------------------------
       User Data
    --------------------------------------------------------- */

    users: [],

    filteredUsers: [],

    /* ---------------------------------------------------------
       Selection
    --------------------------------------------------------- */

    selectedUser: null,

    /* ---------------------------------------------------------
       Search
    --------------------------------------------------------- */

    searchQuery: "",

    /* ---------------------------------------------------------
       Pagination
    --------------------------------------------------------- */

    currentPage: 1,

    pageSize: PAGE_SIZE,

    /* ---------------------------------------------------------
       Loading
    --------------------------------------------------------- */

    loading: false,

    /* ---------------------------------------------------------
       Statistics
    --------------------------------------------------------- */

    statistics: {

        total: 0,

        active: 0,

        inactive: 0,

        locked: 0,

        administrators: 0,

        drivers: 0,

        students: 0,

        technicians: 0

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
 * Load Users
 * ============================================================================
 */

async function loadUsers() {

    state.loading = true;
        if (elements.tableBody) {

        elements.tableBody.innerHTML = `

            <tr>

                <td colspan="6">

                    <div class="table-loading">

                        <div class="loader-orbit"></div>

                        <p>

                            Loading users...

                        </p>

                    </div>

                </td>

            </tr>

        `;

    }

    try {

        const users = await getUsers();

        state.users = users;

        state.filteredUsers = [...users];

        state.currentPage = 1;

        calculateStatistics();

    }

    catch (error) {

        console.error(

            "Error loading users:",

            error

        );

        state.users = [];

        state.filteredUsers = [];

        if (elements.tableBody) {

            elements.tableBody.innerHTML = `

                <tr>

                    <td colspan="6">

                        <div class="table-empty">

                            <div class="table-empty-icon">

                                ⚠

                            </div>

                            <h3>

                                Failed to load users

                            </h3>

                            <p>

                                ${error.message}

                            </p>

                        </div>

                    </td>

                </tr>

            `;

        }

    }

    finally {

        state.loading = false;

    }

}


/**
 * ============================================================================
 * Get User By ID
 * ============================================================================
 */

function getUserById(userId) {

    return state.users.find(

        user => user.id === userId

    ) || null;

}


/**
 * ============================================================================
 * Calculate Statistics
 * ============================================================================
 */

function calculateStatistics() {

    state.statistics.total = state.users.length;

    state.statistics.active =
        state.users.filter(
            user => user.status === USER_STATUS.ACTIVE
        ).length;

    state.statistics.inactive =
        state.users.filter(
            user => user.status === USER_STATUS.INACTIVE
        ).length;

    state.statistics.locked =
        state.users.filter(
            user => user.status === USER_STATUS.LOCKED
        ).length;

    state.statistics.administrators =
        state.users.filter(
            user => user.role === USER_ROLES.ADMIN
        ).length;

    state.statistics.drivers =
        state.users.filter(
            user => user.role === USER_ROLES.DRIVER
        ).length;

    state.statistics.students =
        state.users.filter(
            user => user.role === USER_ROLES.USER
        ).length;

    state.statistics.technicians =
        state.users.filter(
            user => user.role === USER_ROLES.TECHNICIAN
        ).length;

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

            <div class="hero-left">

                <span class="hero-badge">

                    USER MANAGEMENT

                </span>

                <h1 class="hero-title">

                    User Command Center

                </h1>

                <p class="hero-description">

                    Manage BusTrack user accounts, roles,
                    access permissions and account status.

                </p>

                <div class="hero-tags">

                    <span class="hero-tag">

                        👤 User Accounts

                    </span>

                    <span class="hero-tag">

                        🔐 Access Control

                    </span>

                    <span class="hero-tag">

                        🛡 Role Management

                    </span>

                </div>

            </div>

            <div class="hero-right">

                <button
                    id="add-user-btn"
                    class="primary-btn"
                >

                    +

                    Add User

                </button>

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
                 TOTAL USERS
            =========================================================== -->

            <article class="stat-card glass-card">

                <div class="stat-icon">

                    👥

                </div>

                <div class="stat-content">

                    <span class="stat-title">

                        Total Users

                    </span>

                    <h2
                        id="stat-total-users"
                        class="stat-value"
                    >

                        ${state.statistics.total}

                    </h2>

                    <span class="stat-description">

                        Registered Accounts

                    </span>

                </div>

            </article>

            <!-- ==========================================================
                 ACTIVE USERS
            =========================================================== -->

            <article class="stat-card glass-card">

                <div class="stat-icon success">

                    ✅

                </div>

                <div class="stat-content">

                    <span class="stat-title">

                        Active Users

                    </span>

                    <h2
                        id="stat-active-users"
                        class="stat-value"
                    >

                        ${state.statistics.active}

                    </h2>

                    <span class="stat-description">

                        Currently Active

                    </span>

                </div>

            </article>

            <!-- ==========================================================
                 ADMINISTRATORS
            =========================================================== -->

            <article class="stat-card glass-card">

                <div class="stat-icon primary">

                    🛡

                </div>

                <div class="stat-content">

                    <span class="stat-title">

                        Admins

                    </span>

                    <h2
                        id="stat-admin-users"
                        class="stat-value"
                    >

                        ${state.statistics.administrators}

                    </h2>

                    <span class="stat-description">

                        Full system access

                    </span>

                </div>

            </article>

            <!-- ==========================================================
                 DRIVERS
            =========================================================== -->

            <article class="stat-card glass-card">

                <div class="stat-icon warning">

                    🚍

                </div>

                <div class="stat-content">

                    <span class="stat-title">

                        Drivers

                    </span>

                    <h2
                        id="stat-driver-users"
                        class="stat-value"
                    >

                        ${state.statistics.drivers}

                    </h2>

                    <span class="stat-description">

                        Driver Accounts

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
                        id="user-search"
                        type="text"
                        placeholder="Search by name, username, email, phone or role..."
                    >

                </div>

            </div>

            <div class="toolbar-right">

                <button
                    id="refresh-users-btn"
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
                    id="filter-users-btn"
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
   USER TABLE
============================================================================= */

/**
 * ============================================================================
 * Render User Table
 * ============================================================================
 */

function renderTable() {

    return `

        <section class="table-section glass-card">

            <div class="table-wrapper">

                <table class="data-table">

                    <thead>

                        <tr>

                            <th>User</th>

                            <th>Email</th>

                            <th>Phone</th>

                            <th>Role</th>

                            <th>Status</th>

                            <th>Actions</th>

                        </tr>

                    </thead>

                    <tbody id="user-table-body">

                        ${renderTableRows()}

                    </tbody>

                </table>

            </div>

        </section>

    `;

}


/**
 * ============================================================================
 * Render User Rows
 * ============================================================================
 */

function renderTableRows() {

    if (!state.filteredUsers.length) {

        return renderEmptyState();

    }

    const startIndex =
        (state.currentPage - 1) *
        state.pageSize;

    const endIndex =
        startIndex +
        state.pageSize;

    const pageUsers =
        state.filteredUsers.slice(
            startIndex,
            endIndex
        );

    return pageUsers.map(user => `

        <tr>

            <td>

                <div class="table-user">

                    <div class="table-avatar">

                        ${escapeHtml((user.full_name || "U")
                            .trim()
                            .charAt(0)
                            .toUpperCase())}
                    </div>

                    <div>

                        <div class="table-title">

                        ${escapeHtml(user.full_name)}

                        </div>

                        <div class="table-subtitle">

                            ${escapeHtml(user.username)}

                        </div>

                    </div>

                </div>

            </td>

            <td>

                ${escapeHtml(user.email || "-")}

            </td>

            <td>

                ${escapeHtml(user.phone || "-")}

            </td>

            <td>

                ${escapeHtml(user.role)}

            </td>

            <td>

                <span class="status-badge ${getStatusClass(user.status)}">

                    ${escapeHtml(user.status)}

                </span>

            </td>

            <td>

                <div class="table-actions">

                    <button
                        class="table-action-btn view-user"
                        data-id="${user.id}"
                        title="View User"
                    >

                        👁

                    </button>

                    <button
                        class="table-action-btn edit-user"
                        data-id="${user.id}"
                        title="Edit User"
                    >

                        ✏

                    </button>

                    <button
                        class="table-action-btn delete-user"
                        data-id="${user.id}"
                        title="Delete User"
                    >

                        🗑

                    </button>

                </div>

            </td>

        </tr>

    `).join("");

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

                        No Users Found

                    </h3>

                    <p>

                        There are currently no registered users.

                    </p>

                    <button
                        id="empty-add-user-btn"
                        class="primary-btn empty-user-btn"
                    >

                        <span class="btn-icon">

                            +

                        </span>

                        <span>

                            Add User

                        </span>

                    </button>

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

            state.filteredUsers.length /

            state.pageSize

        )

    );

    return `

        <section class="pagination-section">

            <div class="pagination-info">

                Showing

                <strong>

                    ${state.filteredUsers.length}

                </strong>

                Users

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
 * Render User Management Page
 * ============================================================================
 */

function renderPage() {

    return `

        <div class="users-page">

            ${renderHero()}

            ${renderStatistics()}

            ${renderToolbar()}

            ${renderTable()}

            ${renderPagination()}

        </div>

    `;

}
/* =============================================================================
   USER CRUD
============================================================================= */

/**
 * ============================================================================
 * Open Create User Modal
 * ============================================================================
 */

async function openCreateUserModal() {

    console.log("1. openCreateUserModal()");

    try {

        console.log("2. Creating form...");

        const form = await createUserForm();

        console.log("3. Form created", form);

        console.log("4. Opening modal...");

        Modal.form({

            eyebrow: "USER MANAGEMENT",

            title: "Add User",

            subtitle: "Create a new BusTrack user account.",

            content: form,

            submitText: "Save User",

            onSubmit: async () => {

                await saveUser();

            }

        });

        console.log("5. Modal opened");

    }

    catch (error) {

        console.error("Create User Error:", error);

    }

}

/**
 * ============================================================================
 * Open Edit User Modal
 * ============================================================================
 */

async function openEditUserModal(userId) {

    let user = getUserById(userId);

    if (!user) {

        return;

    }

    try {
        user = await getUser(userId);
    } catch (error) {
        Modal.error({
            title: "Unable to Load User",
            subtitle: error.message || "The user details could not be loaded.",
        });
        return;
    }

    const editUser = {

        ...user,

        role: user.role

};

const form = await createUserForm(editUser);
    /* ---------------------------------------------------------
       Disable Username
    --------------------------------------------------------- */

    const username = form.querySelector("#username");

    if (username) {

        username.disabled = true;

    }

    /* ---------------------------------------------------------
       Disable Password Fields
    --------------------------------------------------------- */

    const password = form.querySelector("#password");

    const confirmPassword = form.querySelector("#confirm_password");

    if (password) {

        password.disabled = true;

        password.closest(".modal-group").style.display = "none";

    }

    if (confirmPassword) {

        confirmPassword.disabled = true;

        confirmPassword.closest(".modal-group").style.display = "none";

    }

    Modal.form({

        eyebrow: "USER MANAGEMENT",

        title: "Edit User",

        subtitle: "Update user account information.",

        content: form,

        submitText: "Update User",

        onSubmit: async () => {

            await saveUser(user.id);

        }

    });

}


/**
 * ============================================================================
 * Save User
 * ============================================================================
 */

async function saveUser(userId = null) {

    try {

        let user;

        if (userId) {

            const formData = getUserFormData();

            console.log("========== EDIT FORM ==========");
            console.log(formData);
            console.log("ROLE =", formData.role);
            console.log("STATUS =", formData.status);
            console.log("===============================");

            user = {
                full_name: formData.full_name,
                email: formData.email,
                phone: formData.phone,
                role: formData.role,
                status: formData.status,
                driver_code: formData.driver_code,
                license_number: formData.license_number,
                license_expiry: formData.license_expiry,
                address: formData.address,
                student_code: formData.student_code,
            };

            await updateUser(

                userId,

                user

            );

        }

        else {

            user = validateUserForm();

            console.log("USER SENT:", user);

            const result = await createUser(user);

            console.log("CREATE RESULT:", result);

        }

        console.log("1. Closing modal");
        Modal.close();

        console.log("2. Reloading users");
        await loadUsers();

        console.log("3. Refresh statistics");
        refreshStatistics();

        console.log("4. Refresh table");
        refreshTable();

        console.log("5. Refresh pagination");
        refreshPagination();

        console.log("6. Finished");
        Modal.success({

            eyebrow: "USER MANAGEMENT",

            title: userId
                ? "User Updated"
                : "User Created",

            subtitle: userId
                ? "User updated successfully."
                : "User created successfully."

        });

    }catch (error) {

        console.error("SAVE USER ERROR:", error);

        console.error("MESSAGE:", error.message);

        console.error("DETAIL:", error.detail);

        console.error("FULL:", JSON.stringify(error, null, 2));

        Modal.error({

            title: "Unable to Save User",

            subtitle:
                error.detail ||
                error.message ||
                JSON.stringify(error)

        });

    }

}


/**
 * ============================================================================
 * Delete User
 * ============================================================================
 */

function confirmDeleteUser(userId) {

    Modal.confirm({

        eyebrow: "USER MANAGEMENT",

        title: "Delete User",

        subtitle: "This action cannot be undone.",

        content: `

            <p>

                Are you sure you want to delete this user?

            </p>

        `,

        confirmText: "Delete",

        style: "danger",

        onConfirm: async () => {

            try {

                await deleteUser(userId);

                Modal.close();

                await loadUsers();

                refreshStatistics();

                refreshTable();

                refreshPagination();

                Modal.success({

                    eyebrow: "USER MANAGEMENT",

                    title: "User Deleted",

                    subtitle: "The user has been deleted successfully."

                });

            }catch (error) {

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

    const search = elements.page.querySelector("#user-search");

    if (search) {

        search.addEventListener("input", event => {

            state.searchQuery = event.target.value;

            filterUsers();

            refreshTable();

            refreshPagination();

        });

    }

    /* ---------------------------------------------------------
       Refresh
    --------------------------------------------------------- */

    const refresh = elements.page.querySelector("#refresh-users-btn");

    if (refresh) {

        refresh.addEventListener("click", async () => {

            await loadUsers();

            refreshStatistics();

            refreshTable();

            refreshPagination();

        });

    }

    /* ---------------------------------------------------------
       Add User
    --------------------------------------------------------- */

    const addButton = elements.page.querySelector("#add-user-btn");
    console.log("Add Button:", addButton);

    if (addButton) {

        addButton.addEventListener("click", () => {

            console.log("Add User clicked");

            openCreateUserModal();

        });

    }

    /* ---------------------------------------------------------
       Empty State Button
    --------------------------------------------------------- */

    const emptyButton = elements.page.querySelector(
        "#empty-add-user-btn"
    );

    if (emptyButton) {

        emptyButton.addEventListener(

            "click",

            openCreateUserModal

        );

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

                state.filteredUsers.length /

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

    elements.page
        .querySelectorAll(".view-user")
        .forEach(button => {
            button.addEventListener("click", () => {
                openUserViewModal(Number(button.dataset.id));
            });
        });

    elements.page

        .querySelectorAll(".edit-user")

        .forEach(button => {

            button.addEventListener("click", () => {

                openEditUserModal(

                    Number(button.dataset.id)

                );

            });

        });

    elements.page

        .querySelectorAll(".delete-user")

        .forEach(button => {

            button.addEventListener("click", () => {

                confirmDeleteUser(

                    Number(button.dataset.id)

                );

            });

        });

}

async function openUserViewModal(userId) {

    try {

        const user = await getUser(userId);
        const assignment = user.role === "User"
            ? (user.route_id ? `Route ID: ${user.route_id}` : "No route assigned")
            : user.role === "Driver"
                ? "Assignments are managed in Assignments."
                : "—";

        Modal.alert({
            eyebrow: "USER MANAGEMENT",
            title: user.full_name,
            subtitle: "User account details",
            content: `
                <div class="detail-list">
                    <p><strong>Username:</strong> ${escapeHtml(user.username)}</p>
                    <p><strong>Email:</strong> ${escapeHtml(user.email || "—")}</p>
                    <p><strong>Phone:</strong> ${escapeHtml(user.phone || "—")}</p>
                    <p><strong>Role:</strong> ${escapeHtml(user.role)}</p>
                    <p><strong>Status:</strong> ${escapeHtml(user.status)}</p>
                    <p><strong>Transport:</strong> ${escapeHtml(assignment)}</p>
                </div>`,
        });
    } catch (error) {
        Modal.error({ title: "Unable to Load User", subtitle: error.message });
    }
}

/**
 * ============================================================================
 * Filter Users
 * ============================================================================
 */

function filterUsers() {

    const query =

        state.searchQuery

            .trim()

            .toLowerCase();

    if (!query) {

        state.filteredUsers = [

            ...state.users

        ];

        state.currentPage = 1;

        return;

    }

    state.filteredUsers = state.users.filter(user => {

        return (

            (user.full_name || "").toLowerCase().includes(query) ||

            (user.username || "").toLowerCase().includes(query) ||

            (user.email || "").toLowerCase().includes(query) ||

            (user.phone || "").toLowerCase().includes(query) ||

            (user.role || "").toLowerCase().includes(query) ||

            (user.status || "").toLowerCase().includes(query)

        );

    });

    state.currentPage = 1;

}
/* =============================================================================
   REFRESH HELPERS
============================================================================= */

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

        "#user-table-body"

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


/* =============================================================================
   STATUS HELPER
============================================================================= */

function getStatusClass(status) {

    switch (status) {

        case USER_STATUS.ACTIVE:

            return "success";

        case USER_STATUS.INACTIVE:

            return "secondary";

        case USER_STATUS.LOCKED:

            return "warning";

        default:

            return "secondary";

    }

}


/* =============================================================================
   INITIALIZE MODULE
============================================================================= */

async function initialize() {

    try {

        await loadUsers();

        refreshStatistics();

        refreshTable();

        refreshPagination();

        bindEvents();

    }

    catch (error) {

        console.error(

            "User module initialization failed:",

            error

        );

    }

}


/* =============================================================================
   PUBLIC RENDER
============================================================================= */

export function render() {

    const page = document.createElement("div");

    page.className = "user-module";

    page.innerHTML = renderPage();

    elements.page = page;

    elements.statistics = page.querySelector(".statistics-grid");

    elements.toolbar = page.querySelector(".module-toolbar");

    elements.table = page.querySelector(".table-section");

    elements.tableBody = page.querySelector("#user-table-body");

    elements.pagination = page.querySelector(".pagination-section");

    requestAnimationFrame(() => {

        initialize();

    });

    return page;

}


/* =============================================================================
   MODULE CLEANUP
============================================================================= */

export function destroy() {

    state.users = [];

    state.filteredUsers = [];

    state.selectedUser = null;

    state.currentPage = 1;

    state.searchQuery = "";

}
