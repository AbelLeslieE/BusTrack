/* ==========================================================
   BUSTRACK
   STUDENT TOPBAR
========================================================== */


/* ==========================================================
   CREATE TOPBAR
========================================================== */

export function createStudentTopbar(
    toggleSidebar
){

    const topbar =
        document.createElement(
            "header"
        );


    topbar.className =
        "topbar";


    topbar.innerHTML = `

        <!-- ==================================================
             MOBILE MENU
        =================================================== -->

        <button
            type="button"
            class="topbar-menu-button"
            aria-label="Open navigation"
        >

            <i
                class="fa-solid fa-bars"
                aria-hidden="true"
            ></i>

        </button>


        <!-- ==================================================
             TITLE
        =================================================== -->

        <div class="topbar-title">

            <span
                class="topbar-eyebrow"
            >

                STUDENT PORTAL

            </span>


            <h1
                id="student-topbar-title"
            >

                Where Is My Bus?

            </h1>

        </div>


        <!-- ==================================================
             SEARCH
        =================================================== -->

        <div class="topbar-search">

            <i
                class="fa-solid fa-magnifying-glass"
                aria-hidden="true"
            ></i>


            <input
                type="search"
                placeholder="Search buses, routes or stops..."
                aria-label="Search buses, routes or stops"
            />

        </div>


        <!-- ==================================================
             ACTIONS
        =================================================== -->

        <div class="topbar-actions">

            <button
                type="button"
                class="topbar-icon-button"
                aria-label="Notifications"
                title="Notifications"
            >

                <i
                    class="fa-solid fa-bell"
                    aria-hidden="true"
                ></i>

            </button>


            <div
                class="topbar-profile"
            >

                <div
                    class="topbar-avatar"
                    id="student-topbar-avatar"
                >

                    U

                </div>


                <div
                    class="topbar-profile-text"
                >

                    <strong
                        id="student-topbar-name"
                    >

                        Student

                    </strong>


                    <span>

                        Student

                    </span>

                </div>

            </div>

        </div>

    `;


    /* ==========================================================
       MOBILE MENU
    ========================================================== */

    const menuButton =
        topbar.querySelector(
            ".topbar-menu-button"
        );


    menuButton?.addEventListener(
        "click",
        ()=>{

            if(
                typeof toggleSidebar ===
                "function"
            ){

                toggleSidebar();

            }

        }
    );


    /* ==========================================================
       PROFILE
    ========================================================== */

    populateStudentProfile(
        topbar
    );


    return topbar;

}


/* ==========================================================
   SET TOPBAR TITLE
========================================================== */

export function setStudentTopbarTitle(
    topbar,
    title
){

    const titleElement =
        topbar?.querySelector(
            "#student-topbar-title"
        );


    if(titleElement){

        titleElement.textContent =
            title;

    }

}


/* ==========================================================
   PROFILE DATA
========================================================== */

function populateStudentProfile(
    topbar
){

    const profile =
        JSON.parse(

            localStorage.getItem(
                "bus_tracker_profile"
            ) || "{}"

        );


    const name =
        profile.full_name ||
        profile.username ||
        "Student";


    const initials =
        getInitials(
            name
        );


    const nameElement =
        topbar.querySelector(
            "#student-topbar-name"
        );


    const avatarElement =
        topbar.querySelector(
            "#student-topbar-avatar"
        );


    if(nameElement){

        nameElement.textContent =
            name;

    }


    if(avatarElement){

        avatarElement.textContent =
            initials;

    }

}


/* ==========================================================
   INITIALS
========================================================== */

function getInitials(
    value
){

    return String(
        value
    )
        .trim()
        .split(/\s+/)
        .slice(0,2)
        .map(
            part =>
                part.charAt(0)
        )
        .join("")
        .toUpperCase()
        || "U";

}