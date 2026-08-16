/**
 * SPA router and shared application-shell coordinator.
 * TODO: Add browser-history support and route-level authorization when APIs are available.
 */

import { createLoader } from "./loader.js";

import {
    createSidebar,
    setSidebarActive
} from "./sidebar.js";

import {
    createDriverSidebar,
    setDriverSidebarActive
} from "../modules/js/driverSidebar.js";

import {
    createStudentSidebar,
    setStudentSidebarActive
} from "../modules/js/studentSidebar.js";


import {
    createTopbar,
    setTopbarTitle
} from "./topbar.js";

import {
    createDriverTopbar,
    setDriverTopbarTitle
} from "../modules/js/driverTopbar.js";

import {
    createStudentTopbar,
    setStudentTopbarTitle
} from "../modules/js/studentTopbar.js";
// ==========================================================
// ADMIN MODULES
// ==========================================================

const adminModules = {

    dashboard: {
        title: "Overview",
        load: () => import("../modules/js/adminDashboard.js")
    },

    live_tracking: {
        title: "Live Tracking",
        load: () => import("../modules/js/live_tracking.js")
    },

    buses: {
        title: "Buses",
        load: () => import("../modules/js/buses.js")
    },

    routes: {
        title: "Routes",
        load: () => import("../modules/js/routes.js")
    },

    assignments: {
        title: "Assignments",
        load: () => import("../modules/js/assignments.js")
    },

    stops: {
        title: "Stops",
        load: () => import("../modules/js/stops.js")
    },

    drivers: {
        title: "Drivers",
        load: () => import("../modules/js/drivers.js")
    },

    students: {
        title: "Students",
        load: () => import("../modules/js/students.js")
    },

    users: {
        title: "Users",
        load: () => import("../modules/js/users.js")
    },

    notifications: {
        title: "Notifications",
        load: () => import("../modules/js/notifications.js")
    },

    profile: {
        title: "Profile",
        load: () => import("../modules/js/profile.js")
    },

    settings: {
        title: "Settings",
        load: () => import("../modules/js/settings.js")
    }

};


// ==========================================================
// DRIVER MODULES
// ==========================================================

const driverModules = {

    driverDashboard: {
        title: "Dashboard",
        load: () => import("../modules/js/driverDashboard.js")
    },

    myBus: {
        title: "My Bus",
        load: () => import("../modules/js/myBus.js")
    },

    myRoute: {
        title: "My Route",
        load: () => import("../modules/js/myRoute.js")
    },

    driverTracking: {
        title: "Live Tracking",
        load: () => import("../modules/js/driverTracking.js")
    },

    tripHistory: {
        title: "Trip History",
        load: () => import("../modules/js/tripHistory.js")
    },

    notifications: {
        title: "Notifications",
        load: () => import("../modules/js/driverNotifications.js")
    },

    profile: {
        title: "Profile",
        load: () => import("../modules/js/driverProfile.js")
    },

    driverSettings: {
        title: "Settings",
        load: () => import("../modules/js/driverSettings.js")
    }

};
// ==========================================================
// STUDENT MODULES
// ==========================================================

const studentModules = {

    studentDashboard: {
        title: "Where Is My Bus?",
        load: () => import("../modules/js/studentDashboard.js")
    },

    myBuses: {
        title: "My Buses",
        load: () => import("../modules/js/studentBuses.js")
    },

    studentTracking: {
        title: "Live Tracking",
        load: () => import("../modules/js/studentTracking.js")
    },

    notifications: {
        title: "Notifications",
        load: () => import("../modules/js/studentNotifications.js")
    },

    profile: {
        title: "Profile",
        load: () => import("../modules/js/studentProfile.js")
    },

    studentSettings: {
        title: "Settings",
        load: () => import("../modules/js/studentSettings.js")
    }

};
let shell;

const profile =
    JSON.parse(
        localStorage.getItem(
            "bus_tracker_profile"
        ) || "{}"
    );


/* ==========================================================
   ROLE DETECTION
========================================================== */

const isDriver =
    profile.role === "Driver";


const isStudent =
    profile.role === "Student";


/* ==========================================================
   MODULE COLLECTION
========================================================== */

const modules =
    isDriver
        ? driverModules
        : isStudent
            ? studentModules
            : adminModules;
function titleCase(value) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function createFallback(title, message) {
  const view = document.createElement("section");
  view.className = "module-placeholder glass-panel";
  view.innerHTML = `<p class="eyebrow">BUS TRACKER</p><h2>${title}</h2><p>${message}</p>`;
  return view;
}

function applyModuleStyles(moduleName) {

    // Main page stylesheet
    let pageStyle = document.querySelector("#active-module-styles");

    if (!pageStyle) {
        pageStyle = document.createElement("link");
        pageStyle.id = "active-module-styles";
        pageStyle.rel = "stylesheet";
        document.head.appendChild(pageStyle);
    }

    pageStyle.href = `/static/modules/css/${moduleName}.css`;

    // Driver shared styles
    if (isDriver) {
        let topbarStyle = document.querySelector("#driver-topbar-style");

        if (!topbarStyle) {
            topbarStyle = document.createElement("link");
            topbarStyle.id = "driver-topbar-style";
            topbarStyle.rel = "stylesheet";
            document.head.appendChild(topbarStyle);
        }

        topbarStyle.href = "/static/modules/css/driverTopbar.css";
    }

}

function createShell(initialRoute) {
  const root = document.querySelector("#app");
  if (!root) return null;
  document.body.classList.remove(
        "admin-theme",
        "driver-theme",
        "student-theme"
    );


    if (isDriver) {

        document.body.classList.add(
            "driver-theme"
        );

    }

    else if (isStudent) {

        document.body.classList.add(
            "student-theme"
        );

    }

    else {

        document.body.classList.add(
            "admin-theme"
        );

    }

    const appShell = document.createElement("div");

    appShell.className = "app-shell";
  const closeSidebar = () => {

        appShell.classList.remove("sidebar-open");

    };

  const isMobileDrawer = () =>
        window.matchMedia("(max-width: 900px)").matches;

  const navigate = (route) => {

        // ==========================================================
        // CLOSE SIDEBAR ON MOBILE / TABLET
        // ==========================================================

        closeSidebar();

        // ==========================================================
        // NAVIGATE TO REQUESTED MODULE
        // ==========================================================

        if (window.location.hash.slice(1) === route) {

            loadModule(route);

        } else {

            window.location.hash = route;

        }

        // ==========================================================
        // FINAL SAFETY CLOSE
        // ==========================================================
        // Ensures the drawer stays closed after the current browser
        // event cycle has completed.

        requestAnimationFrame(closeSidebar);

    };


  const sidebar =
        isDriver

            ? createDriverSidebar(
                initialRoute,
                navigate
            )

            : isStudent

                ? createStudentSidebar(
                    initialRoute,
                    navigate
                )

                : createSidebar(
                    initialRoute,
                    navigate
                );

  const toggleSidebar = () => {

        // Only open the drawer on smaller screens
        if (isMobileDrawer()) {

            appShell.classList.toggle("sidebar-open");

        }

    };
    const topbar =
        isDriver

            ? createDriverTopbar(
                toggleSidebar
            )

            : isStudent

                ? createStudentTopbar(
                    toggleSidebar
                )

                : createTopbar(
                    toggleSidebar
                );
  const sidebarBackdrop = document.createElement("button");
  sidebarBackdrop.type = "button";
  sidebarBackdrop.className = "sidebar-backdrop";
  sidebarBackdrop.setAttribute("aria-label", "Close navigation");
  sidebarBackdrop.addEventListener("click", closeSidebar);

  // Capture phase makes close actions reliable on touch browsers even when a
  // nested icon or link has its own click handler.
  appShell.addEventListener("click", event => {

        const target = event.target instanceof Element
            ? event.target
            : event.target?.parentElement;

        if (!target) return;

        if (
            target.closest(".sidebar-backdrop") ||
            target.closest(".sidebar-close") ||
            target.closest(".sidebar [data-route]")
        ) {

            closeSidebar();

        }

    }, true);
  window.addEventListener("resize", () => {

        if (!isMobileDrawer()) closeSidebar();

    });

  const content = document.createElement("main");
  content.className = "page-content";
  content.id = "page-content";
  const workspace = document.createElement("div");

    workspace.className = "app-workspace";

    // Apply driver workspace background only for driver pages
    if (isDriver) {

        workspace.classList.add("driver-workspace");

    }

    

    workspace.append(topbar, content);

    appShell.append(
        sidebarBackdrop,
        sidebar,
        workspace
    );
  /* ==========================================================
   ATTACH APPLICATION SHELL
========================================================== */

root.replaceChildren(appShell);


/* ==========================================================
   INITIALIZE LUCIDE ICONS
========================================================== */

/*
    The sidebar contains dynamically-created Lucide icons.

    createSidebar() runs before the sidebar is attached to
    #app, so Lucide must be initialized AFTER appShell has
    been inserted into the document.
*/

if (window.lucide) {

    window.lucide.createIcons();    

}


/* ==========================================================
   RETURN SHELL REFERENCES
========================================================== */

return {
    appShell,
    sidebar,
    topbar,
    content
};
}

export async function loadModule(requestedRoute) {
  const defaultRoute =
        isDriver
            ? "driverDashboard"
            : isStudent
                ? "studentDashboard"
                : "dashboard";

  if (!requestedRoute) {
      requestedRoute = defaultRoute;
  }

  const route =
      requestedRoute in modules
          ? requestedRoute
          : defaultRoute;
  shell ??= createShell(route);
  if (!shell) return;
  /* ==========================================================
    CLEANUP PREVIOUS MODULE
    ========================================================== */

    const previousView =
        shell.content.firstElementChild;

    if (
        previousView &&
        typeof previousView.cleanup === "function"
    ) {

        console.log(
            "Cleaning up previous module..."
        );

        previousView.cleanup();

    }


  if (isDriver) {

        setDriverSidebarActive(
            shell.sidebar,
            route
        );


        setDriverTopbarTitle(
            shell.topbar,
            modules[route].title
        );

    }

    else if (isStudent) {

        setStudentSidebarActive(
            shell.sidebar,
            route
        );


        setStudentTopbarTitle(
            shell.topbar,
            modules[route].title
        );

    }

    else {

        setSidebarActive(
            shell.sidebar,
            route
        );


        setTopbarTitle(
            shell.topbar,
            modules[route].title
        );

    }
  applyModuleStyles(route);
  shell.content.replaceChildren(createLoader(`Loading ${modules[route].title.toLowerCase()}`));

  try {
    const module = await modules[route].load();
    console.log("Imported module:", module);
  console.log("Module keys:", Object.keys(module));
  console.log("Render:", module.render);
    const view =
        typeof module.render === "function"
            ? module.render()
            : createFallback(
                modules[route].title,
                "This workspace is ready for its feature implementation."
            );

    shell.content.replaceChildren(view);

    // A route change must never leave the mobile drawer over the new page.
    // Removing this class is harmless on desktop, where it has no visual role.
    shell.appShell.classList.remove("sidebar-open");
  } catch (error) {
    console.error("========== MODULE ERROR ==========");
    console.error(error);
    throw error;
  }
}

window.addEventListener(
    "hashchange",
    () => {

        const defaultRoute =
            isDriver
                ? "driverDashboard"
                : isStudent
                    ? "studentDashboard"
                    : "dashboard";


        loadModule(
            window.location.hash.slice(1)
            ||
            defaultRoute
        );

    }
);
