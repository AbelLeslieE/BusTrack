/* ==========================================================
   BUSTRACK
   STUDENT SIDEBAR
   Uses the same shared BusTrack sidebar design
   as Administrator and Driver portals.
   ========================================================== */


/* ==========================================================
   STUDENT NAVIGATION ITEMS
========================================================== */

const studentItems = [

    [
        "studentDashboard",
        "Dashboard",
        "⌂"
    ],

    [
        "myBuses",
        "My Buses",
        "▣"
    ],

    [
        "studentTracking",
        "Live Tracking",
        "◎"
    ],

    [
        "notifications",
        "Notifications",
        "♧"
    ]

];


/* ==========================================================
   NAVIGATION ITEM
========================================================== */

function navigationItem(
    [route, label, icon],
    activeRoute
) {

    const activeClass =
        route === activeRoute
            ? " is-active"
            : "";

    return `

        <a
            class="nav-item${activeClass}"
            href="#${route}"
            data-route="${route}">

            <span
                class="nav-icon"
                aria-hidden="true">

                ${icon}

            </span>

            <span>
                ${label}
            </span>

        </a>

    `;

}


/* ==========================================================
   CREATE STUDENT SIDEBAR
========================================================== */

export function createStudentSidebar(
    activeRoute,
    onNavigate
) {

    const sidebar =
        document.createElement("aside");

    /*
        IMPORTANT:
        These are the exact same classes
        used by the main BusTrack sidebar.
    */

    sidebar.className =
        "sidebar glass-panel";

    sidebar.setAttribute(
        "aria-label",
        "Student navigation"
    );


    /* ======================================================
       SIDEBAR HTML
    ====================================================== */

    sidebar.innerHTML = `

        <!-- ==============================================
             MOBILE HEADER / BRAND
        =============================================== -->

        <div class="sidebar-mobile-header">

            <a
                class="brand"
                href="#studentDashboard">

                <span class="brand-mark">
                    🚌
                </span>

                <div class="brand-text">

                    <span class="brand-title">
                        BusTrack
                    </span>

                    <span class="brand-subtitle">
                        Student Portal
                    </span>

                </div>

            </a>


            <!-- ==========================================
                 MOBILE CLOSE BUTTON
            =========================================== -->

            <button
                type="button"
                class="sidebar-close"
                aria-label="Close navigation"
                title="Close navigation">

                <i
                    data-lucide="x"
                    aria-hidden="true">
                </i>

            </button>

        </div>


        <!-- ==============================================
             NAVIGATION
        =============================================== -->

        <nav class="sidebar-nav">

            <p class="nav-label">
                Workspace
            </p>

            ${studentItems
                .map((item) =>
                    navigationItem(
                        item,
                        activeRoute
                    )
                )
                .join("")}


            <p class="nav-label nav-label-spaced">
                Account
            </p>


            <!-- ==========================================
                 PROFILE
            =========================================== -->

            <a
                class="nav-item"
                href="#profile"
                data-route="profile">

                <span
                    class="nav-icon"
                    aria-hidden="true">

                    ◉

                </span>

                <span>
                    Profile
                </span>

            </a>

        </nav>


        <!-- ==============================================
             SIDEBAR FOOTER
        =============================================== -->

        <div class="sidebar-footer">


            <!-- ==========================================
                 SETTINGS
            =========================================== -->

            <a
                class="nav-item"
                href="#studentSettings"
                data-route="studentSettings">

                <span
                    class="nav-icon"
                    aria-hidden="true">

                    ⚙

                </span>

                <span>
                    Settings
                </span>

            </a>


            <!-- ==========================================
                 LOGOUT
            =========================================== -->

            <a
                class="nav-item logout-btn"
                href="#"
                data-action="logout">

                <span
                    class="nav-icon"
                    aria-hidden="true">

                    ⇦

                </span>

                <span>
                    Logout
                </span>

            </a>


            <!-- ==========================================
                 HELP
            =========================================== -->

            <div class="help-card">

                <span>
                    Need help?
                </span>

                <small>
                    Track your bus easily.
                </small>

            </div>

        </div>

    `;


    /* ======================================================
       SIDEBAR CLICK HANDLER
    ====================================================== */

    sidebar.addEventListener(
        "click",
        (event) => {


            /* ==============================================
               MOBILE CLOSE
            =============================================== */

            const closeButton =
                event.target.closest(
                    ".sidebar-close"
                );


            if (closeButton) {

                event.preventDefault();

                const appShell =
                    document.querySelector(
                        ".app-shell"
                    );

                if (appShell) {

                    appShell.classList.remove(
                        "sidebar-open"
                    );

                }

                return;

            }


            /* ==============================================
               LOGOUT
            =============================================== */

            const logout =
                event.target.closest(
                    "[data-action='logout']"
                );


            if (logout) {

                event.preventDefault();

                localStorage.clear();

                window.location.href = "/";

                return;

            }


            /* ==============================================
               NAVIGATION
            =============================================== */

            const link =
                event.target.closest(
                    "[data-route]"
                );


            if (!link) return;

            event.preventDefault();


            /* ==============================================
               CLOSE MOBILE SIDEBAR
            =============================================== */

            if (
                window.innerWidth <= 1200
            ) {

                const appShell =
                    document.querySelector(
                        ".app-shell"
                    );

                if (appShell) {

                    appShell.classList.remove(
                        "sidebar-open"
                    );

                }

            }


            /* ==============================================
               NAVIGATE
            =============================================== */

            onNavigate(
                link.dataset.route
            );

        }
    );


    return sidebar;

}


/* ==========================================================
   SET ACTIVE STUDENT NAVIGATION ITEM
========================================================== */

export function setStudentSidebarActive(
    sidebar,
    activeRoute
) {

    sidebar
        .querySelectorAll(
            "[data-route]"
        )
        .forEach(
            (link) => {

                link.classList.toggle(
                    "is-active",
                    link.dataset.route === activeRoute
                );

            }
        );

}