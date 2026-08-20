/* ==========================================================
   BUSTRACK
   STUDENT PORTAL
   MY BUSES MODULE
   ========================================================== */


/* ==========================================================
   CONFIGURATION
========================================================== */

const API = {

    STUDENT:
        "/api/students/me"

};


/* ==========================================================
   MODULE STATE
========================================================== */

const state = {

    student: null,

    loading: true,

    error: null,

    refreshTimer: null,

    refreshInProgress: false,

    assignmentFingerprint: null,

    visibilityHandler: null

};


/* ==========================================================
   AUTHENTICATED FETCH
========================================================== */

async function fetchStudent() {

    const token =
        localStorage.getItem(
            "bus_tracker_access_token"
        );

    if (!token) {

        throw new Error(
            "Authentication session not found."
        );

    }


    const response =
        await fetch(
            API.STUDENT,
            {

                method: "GET",

                cache: "no-store",

                headers: {

                    "Authorization":
                        `Bearer ${token}`,

                    "Accept":
                        "application/json"

                }

            }
        );


    if (!response.ok) {

        let message =
            "Unable to load your bus information.";


        try {

            const error =
                await response.json();

            message =
                error.detail ||
                message;

        }

        catch {

            // Keep the default message.

        }


        throw new Error(
            message
        );

    }


    return await response.json();

}


/* ==========================================================
   HTML ESCAPE
========================================================== */

function escapeHTML(value) {

    return String(
        value ?? ""
    )
        .replaceAll(
            "&",
            "&amp;"
        )
        .replaceAll(
            "<",
            "&lt;"
        )
        .replaceAll(
            ">",
            "&gt;"
        )
        .replaceAll(
            '"',
            "&quot;"
        )
        .replaceAll(
            "'",
            "&#039;"
        );

}


/* ==========================================================
   BUS STATUS
========================================================== */

function getBusStatus(bus) {

    if (!bus) {

        return {

            label:
                "Not Assigned",

            className:
                "student-bus-status-unassigned"

        };

    }


    const status =
        String(
            bus.status ||
            ""
        ).toLowerCase();


    if (
        status === "active" ||
        status === "running" ||
        status === "available"
    ) {

        return {

            label:
                "Active",

            className:
                "student-bus-status-active"

        };

    }


    if (
        status === "maintenance" ||
        status === "inactive"
    ) {

        return {

            label:
                status === "maintenance"
                    ? "Maintenance"
                    : "Inactive",

            className:
                "student-bus-status-warning"

        };

    }


    return {

        label:
            bus.status ||
            "Assigned",

        className:
            "student-bus-status-neutral"

    };

}


/* ==========================================================
   BUS CARD
========================================================== */

function renderBusCard(
    student
) {

    const bus =
        student?.assigned_bus;


    if (!bus) {

        return `

            <article
                class="student-bus-card student-bus-card-empty"
            >

                <div
                    class="student-bus-empty-icon"
                    aria-hidden="true"
                >

                    <i
                        class="fa-solid fa-bus"
                    ></i>

                </div>


                <div
                    class="student-bus-empty-content"
                >

                    <p
                        class="student-section-eyebrow"
                    >
                        TRANSPORT ASSIGNMENT
                    </p>

                    <h3>
                        No Bus Assigned
                    </h3>

                    <p>
                        A bus has not been assigned
                        to your student account yet.
                    </p>

                </div>

            </article>

        `;

    }


    const status =
        getBusStatus(
            bus
        );


    const stop =
        student?.assigned_stop;


    const route =
        bus.route;


    return `

        <article
            class="student-bus-card"
        >

            <!-- ==========================================
                 BUS HEADER
            =========================================== -->

            <div
                class="student-bus-card-header"
            >

                <div
                    class="student-bus-identity"
                >

                    <div
                        class="student-bus-icon"
                        aria-hidden="true"
                    >

                        <i
                            class="fa-solid fa-bus"
                        ></i>

                    </div>


                    <div>

                        <p
                            class="student-section-eyebrow"
                        >
                            ASSIGNED BUS
                        </p>

                        <h3>

                            ${escapeHTML(
                                bus.bus_number ||
                                "Bus"
                            )}

                        </h3>

                    </div>

                </div>


                <span
                    class="student-bus-status
                    ${status.className}"
                >

                    <span
                        class="student-bus-status-dot"
                        aria-hidden="true"
                    ></span>

                    ${escapeHTML(
                        status.label
                    )}

                </span>

            </div>


            <!-- ==========================================
                 BUS INFORMATION
            =========================================== -->

            <div
                class="student-bus-information"
            >

                <div
                    class="student-bus-information-item"
                >

                    <span>
                        Registration
                    </span>

                    <strong>

                        ${escapeHTML(
                            bus.registration_number ||
                            "—"
                        )}

                    </strong>

                </div>


                <div
                    class="student-bus-information-item"
                >

                    <span>
                        Manufacturer
                    </span>

                    <strong>

                        ${escapeHTML(
                            bus.manufacturer ||
                            "—"
                        )}

                    </strong>

                </div>


                <div
                    class="student-bus-information-item"
                >

                    <span>
                        Model
                    </span>

                    <strong>

                        ${escapeHTML(
                            bus.model ||
                            "—"
                        )}

                    </strong>

                </div>


                <div
                    class="student-bus-information-item"
                >

                    <span>
                        Capacity
                    </span>

                    <strong>

                        ${
                            bus.capacity != null
                                ? escapeHTML(
                                    bus.capacity
                                )
                                : "—"
                        }

                    </strong>

                </div>

            </div>


            <!-- ==========================================
                 ROUTE INFORMATION
            =========================================== -->

            <div
                class="student-bus-route"
            >

                <div
                    class="student-bus-route-icon"
                    aria-hidden="true"
                >

                    <i
                        class="fa-solid fa-route"
                    ></i>

                </div>


                <div>

                    <span>
                        Assigned Route
                    </span>

                    <strong>

                        ${escapeHTML(
                            route?.route_name ||
                            "Route not assigned"
                        )}

                    </strong>

                    ${
                        route?.route_code
                            ? `
                                <small>
                                    ${escapeHTML(
                                        route.route_code
                                    )}
                                </small>
                              `
                            : ""
                    }

                </div>

            </div>


            <!-- ==========================================
                 STUDENT STOP
            =========================================== -->

            <div
                class="student-bus-stop"
            >

                <div
                    class="student-bus-stop-icon"
                    aria-hidden="true"
                >

                    <i
                        class="fa-solid fa-location-dot"
                    ></i>

                </div>


                <div>

                    <span>
                        Your Assigned Stop
                    </span>

                    <strong>

                        ${escapeHTML(
                            stop?.stop_name ||
                            "Stop not assigned"
                        )}

                    </strong>

                    ${
                        stop?.stop_code
                            ? `
                                <small>
                                    ${escapeHTML(
                                        stop.stop_code
                                    )}
                                </small>
                              `
                            : ""
                    }

                </div>

            </div>


            <!-- ==========================================
                 ACTIONS
            =========================================== -->

            <div
                class="student-bus-card-actions"
            >

                <a
                    class="student-bus-action primary"
                    href="#studentTracking"
                    data-route="studentTracking"
                >

                    <i
                        class="fa-solid fa-location-arrow"
                        aria-hidden="true"
                    ></i>

                    Track This Bus

                </a>


                <a
                    class="student-bus-action secondary"
                    href="#studentDashboard"
                    data-route="studentDashboard"
                >

                    <i
                        class="fa-solid fa-house"
                        aria-hidden="true"
                    ></i>

                    Dashboard

                </a>

            </div>

        </article>

    `;

}
/* ==========================================================
   PAGE HEADER
========================================================== */

function renderHeader() {

    return `

        <section
            class="student-module-header"
        >

            <div>

                <p
                    class="student-section-eyebrow"
                >
                    TRANSPORT ASSIGNMENT
                </p>

                <h2>
                    My Buses
                </h2>

                <p>
                    View your assigned bus, route,
                    and boarding stop.
                </p>

            </div>


            <button
                id="student-buses-refresh"
                class="student-refresh-button"
                type="button"
            >

                <i
                    class="fa-solid fa-rotate"
                    aria-hidden="true"
                ></i>

                Refresh

            </button>

        </section>

    `;

}


/* ==========================================================
   SUMMARY
========================================================== */

function renderSummary(
    student
) {

    const bus =
        student?.assigned_bus;

    const stop =
        student?.assigned_stop;

    const route =
        bus?.route;


    return `

        <section
            class="student-bus-summary"
        >

            <article
                class="student-summary-card"
            >

                <div
                    class="student-summary-icon"
                    aria-hidden="true"
                >

                    <i
                        class="fa-solid fa-bus"
                    ></i>

                </div>

                <div>

                    <span>
                        Assigned Bus
                    </span>

                    <strong>

                        ${escapeHTML(
                            bus?.bus_number ||
                            "Not assigned"
                        )}

                    </strong>

                </div>

            </article>


            <article
                class="student-summary-card"
            >

                <div
                    class="student-summary-icon"
                    aria-hidden="true"
                >

                    <i
                        class="fa-solid fa-route"
                    ></i>

                </div>

                <div>

                    <span>
                        Route
                    </span>

                    <strong>

                        ${escapeHTML(
                            route?.route_name ||
                            "Not assigned"
                        )}

                    </strong>

                </div>

            </article>


            <article
                class="student-summary-card"
            >

                <div
                    class="student-summary-icon"
                    aria-hidden="true"
                >

                    <i
                        class="fa-solid fa-location-dot"
                    ></i>

                </div>

                <div>

                    <span>
                        Boarding Stop
                    </span>

                    <strong>

                        ${escapeHTML(
                            stop?.stop_name ||
                            "Not assigned"
                        )}

                    </strong>

                </div>

            </article>

        </section>

    `;

}


/* ==========================================================
   LOADING STATE
========================================================== */

function renderLoading() {

    return `

        <section
            class="student-buses-loading"
        >

            <div
                class="student-loading-spinner"
                aria-hidden="true"
            ></div>

            <p>
                Loading your bus information...
            </p>

        </section>

    `;

}


/* ==========================================================
   ERROR STATE
========================================================== */

function renderError() {

    return `

        <section
            class="student-buses-error"
        >

            <div
                class="student-error-icon"
                aria-hidden="true"
            >

                <i
                    class="fa-solid fa-triangle-exclamation"
                ></i>

            </div>


            <div>

                <p
                    class="student-section-eyebrow"
                >
                    SOMETHING WENT WRONG
                </p>

                <h3>
                    Unable to load your bus
                </h3>

                <p>
                    ${
                        escapeHTML(
                            state.error ||
                            "Please try again."
                        )
                    }
                </p>

            </div>


            <button
                id="student-buses-retry"
                class="student-refresh-button"
                type="button"
            >

                <i
                    class="fa-solid fa-rotate"
                    aria-hidden="true"
                ></i>

                Try Again

            </button>

        </section>

    `;

}


/* ==========================================================
   PAGE CONTENT
========================================================== */

function renderContent() {

    if (state.loading) {

        return renderLoading();

    }


    if (state.error) {

        return renderError();

    }


    if (!state.student) {

        return renderError();

    }


    return `

        ${renderSummary(
            state.student
        )}

        ${renderBusCard(
            state.student
        )}

    `;

}


/* ==========================================================
   REFRESH PAGE CONTENT
========================================================== */

function refreshPage(
    root
) {

    if (!root) {

        return;

    }


    const content =
        root.querySelector(
            "#student-buses-content"
        );


    if (!content) {

        return;

    }


    content.innerHTML =
        renderContent();


    bindEvents(
        root
    );

}


/* ==========================================================
   LOAD DATA
========================================================== */

async function loadData(
    root,
    { showLoading = true } = {}
) {

    if (state.refreshInProgress) {

        return;

    }

    state.refreshInProgress =
        true;

    if (showLoading) {

        state.loading =
            true;

        state.error =
            null;

        refreshPage(
            root
        );

    }

    try {

        const student =
            await fetchStudent();

        const nextFingerprint =
            JSON.stringify(student);

        const hasChanged =
            nextFingerprint !== state.assignmentFingerprint;

        state.student =
            student;

        state.assignmentFingerprint =
            nextFingerprint;

        if (!showLoading && hasChanged) {

            refreshPage(
                root
            );

        }

    }

    catch (error) {

        console.error(
            "BusTrack: Student buses load failed.",
            error
        );

        if (showLoading || !state.student) {

            state.student =
                null;

            state.error =
                error.message ||
                "Unable to load your bus information.";

        }

    }

    finally {

        state.loading =
            false;

        if (showLoading) {

            refreshPage(
                root
            );

        }

        state.refreshInProgress =
            false;

    }

}


/* ==========================================================
   LIVE ASSIGNMENT SYNCHRONIZATION
========================================================== */

function stopAssignmentSync() {

    if (state.refreshTimer) {

        clearInterval(state.refreshTimer);

        state.refreshTimer =
            null;

    }

    if (state.visibilityHandler) {

        document.removeEventListener(
            "visibilitychange",
            state.visibilityHandler
        );

        state.visibilityHandler =
            null;

    }

}


function startAssignmentSync(root) {

    stopAssignmentSync();

    state.refreshTimer =
        window.setInterval(
            () => {

                if (document.visibilityState === "visible") {

                    void loadData(root, { showLoading: false });

                }

            },
            2_000
        );

    state.visibilityHandler =
        () => {

            if (document.visibilityState === "visible") {

                void loadData(root, { showLoading: false });

            }

        };

    document.addEventListener(
        "visibilitychange",
        state.visibilityHandler
    );

}


/* ==========================================================
   EVENT BINDING
========================================================== */

function bindEvents(
    root
) {

    if (!root) {

        return;

    }


    /* ========================================================
       REFRESH
    ======================================================== */

    const refreshButton =
        root.querySelector(
            "#student-buses-refresh"
        );


    if (refreshButton) {

        refreshButton.onclick =
            async () => {

                await loadData(
                    root
                );

            };

    }


    /* ========================================================
       RETRY
    ======================================================== */

    const retryButton =
        root.querySelector(
            "#student-buses-retry"
        );


    if (retryButton) {

        retryButton.onclick =
            async () => {

                await loadData(
                    root
                );

            };

    }

}


/* ==========================================================
   PUBLIC RENDER
========================================================== */

export function render() {

    /*
     * Reset module state whenever
     * the student opens My Buses.
     */

    state.student =
        null;

    state.loading =
        true;

    state.error =
        null;

    state.assignmentFingerprint =
        null;


    /*
     * Create the page root expected
     * by the SPA router.
     */

    const root =
        document.createElement(
            "section"
        );


    root.className =
        "student-buses-page";


    root.innerHTML = `

        ${renderHeader()}


        <div
            id="student-buses-content"
        >

            ${renderContent()}

        </div>

    `;


    bindEvents(
        root
    );


    /*
     * Load the student's actual
     * assignment from the backend.
     */

    loadData(
        root
    );

    startAssignmentSync(
        root
    );

    root.cleanup =
        () => {

            stopAssignmentSync();

        };


    return root;

}
