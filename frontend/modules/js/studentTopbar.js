/* ==========================================================
   BUSTRACK
   STUDENT TOPBAR
   Uses the same shared BusTrack topbar design
   as Administrator and Driver portals.
   ========================================================== */


/* ==========================================================
   CREATE STUDENT TOPBAR
========================================================== */

export function createStudentTopbar(toggleSidebar) {

    const topbar =
        document.createElement("header");


    /*
        IMPORTANT:
        Use the exact shared topbar class.
    */

    topbar.className =
        "topbar glass-panel";


    /* ======================================================
       TOPBAR HTML
    ====================================================== */

    topbar.innerHTML = `

        <!-- ==============================================
             TITLE / MOBILE MENU
        =============================================== -->

        <div class="topbar-title">

            <button
                class="icon-button mobile-menu"
                type="button"
                aria-label="Toggle navigation"
                title="Toggle navigation">

                <i
                    class="fa-solid fa-bars"
                    aria-hidden="true">
                </i>

            </button>


            <div>

                <p class="section-kicker">
                    User portal
                </p>

                <h1 id="student-topbar-title">
                    Where Is My Bus?
                </h1>

            </div>

        </div>


        <!-- ==============================================
             SEARCH
        =============================================== -->

        <div class="topbar-actions">


            <label class="search-box">

                <span aria-hidden="true">
                    ⌕
                </span>

                <input
                    type="search"
                    placeholder="Search buses, routes or stops..."
                    aria-label="Search buses, routes or stops"
                >

            </label>


            <!-- ==========================================
                 NOTIFICATIONS
            =========================================== -->

            <button
                class="icon-button notification-button"
                type="button"
                aria-label="Notifications"
                title="Notifications">

                <i
                    class="fa-solid fa-bell"
                    aria-hidden="true">
                </i>

                <span></span>

            </button>


            <!-- ==========================================
                 STUDENT PROFILE
            =========================================== -->

            <button
                class="profile-button"
                type="button"
                aria-label="Open profile">

                <span
                    class="avatar"
                    id="student-topbar-avatar">

                    U

                </span>


                <span class="profile-copy">

                    <strong
                        id="student-topbar-name">

                        User

                    </strong>


                    <small>
                        User
                    </small>

                </span>


                <span
                    aria-hidden="true">

                    ⌄

                </span>

            </button>

        </div>

    `;


    /* ======================================================
       MOBILE SIDEBAR BUTTON
    ====================================================== */

    const menuButton =
        topbar.querySelector(
            ".mobile-menu"
        );


    menuButton?.addEventListener(
        "click",
        () => {

            if (
                typeof toggleSidebar ===
                "function"
            ) {

                toggleSidebar();

            }

        }
    );


    /* ======================================================
       LOAD AUTHENTICATED STUDENT PROFILE
    ====================================================== */

    populateStudentProfile(topbar);


    return topbar;

}


/* ==========================================================
   SET TOPBAR TITLE
========================================================== */

export function setStudentTopbarTitle(
    topbar,
    title
) {

    const titleElement =
        topbar?.querySelector(
            "#student-topbar-title"
        );


    if (!titleElement) {

        return;

    }


    titleElement.textContent =
        title;

}


/* ==========================================================
   POPULATE STUDENT PROFILE
========================================================== */

function populateStudentProfile(topbar) {

    let profile = {};


    /* ======================================================
       READ PROFILE FROM LOCAL STORAGE
    ====================================================== */

    try {

        profile =
            JSON.parse(
                localStorage.getItem(
                    "bus_tracker_profile"
                ) || "{}"
            );

    } catch (error) {

        console.error(
            "BusTrack: Unable to read student profile.",
            error
        );

    }


    /* ======================================================
       STUDENT NAME
    ====================================================== */

    const name =
        profile.full_name ||
        profile.username ||
        "User";


    /* ======================================================
       STUDENT INITIALS
    ====================================================== */

    const initials =
        getInitials(name);


    /* ======================================================
       UPDATE NAME
    ====================================================== */

    const nameElement =
        topbar.querySelector(
            "#student-topbar-name"
        );


    if (nameElement) {

        nameElement.textContent =
            name;

    }


    /* ======================================================
       UPDATE AVATAR
    ====================================================== */

    const avatarElement =
        topbar.querySelector(
            "#student-topbar-avatar"
        );


    if (avatarElement) {

        avatarElement.textContent =
            initials;

    }

}


/* ==========================================================
   CREATE INITIALS
========================================================== */

function getInitials(value) {

    return String(value)
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map(
            part =>
                part.charAt(0)
        )
        .join("")
        .toUpperCase()
        || "U";

}
