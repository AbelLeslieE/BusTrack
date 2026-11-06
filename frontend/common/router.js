/** Role-aware hash router and shared application-shell coordinator. */

import { createLoader } from "./loader.js";
import { canonicalRole, ROLE_ADMIN, ROLE_DRIVER, ROLE_TECHNICIAN, ROLE_USER } from "./roles.js?v=20261105tracer1";

import {
    createSidebar,
    setSidebarActive
} from "./sidebar.js?v=20261105tracer1";

import {
    createDriverSidebar,
    setDriverSidebarActive
} from "../modules/js/driverSidebar.js?v=20261015logo2";

import {
    createStudentSidebar,
    setStudentSidebarActive
} from "../modules/js/studentSidebar.js?v=20261103authors2";

import {
    createTechnicianSidebar,
    createTracerSidebar,
    setTechnicianSidebarActive
} from "../modules/js/technicianSidebar.js?v=20261105tracerportal3";


import {
    createTopbar,
    setTopbarTitle
} from "./topbar.js?v=20261017fix1";

import {
    createDriverTopbar,
    setDriverTopbarTitle
} from "../modules/js/driverTopbar.js?v=20261017fix1";

import {
    createStudentTopbar,
    setStudentTopbarTitle
} from "../modules/js/studentTopbar.js?v=20261017fix1";
// ==========================================================
// ADMIN MODULES
// ==========================================================

const adminModules = {
    maintainRoute: { title: "Maintain route", load: () => import("../modules/js/routeStudio.js?v=20261106background1") },

    dashboard: {
        title: "Overview",
        load: () => import("../modules/js/adminDashboard.js?v=20261014b")
    },

    live_tracking: {
        title: "Live Tracking",
        load: () => import("../modules/js/live_tracking.js?v=20261105cardreset1")
    },

    tripHistory: {
        title: "Trip History",
        load: () => import("../modules/js/adminTripHistory.js")
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
        load: () => import("../modules/js/students.js?v=20261015d")
    },

    busPasses: {
        title: "Bus Passes",
        load: () => import("../modules/js/busPasses.js?v=20261015a")
    },

    users: {
        title: "Users",
        load: () => import("../modules/js/users.js?v=20261106delete1")
    },

    activeUsers: {
        title: "Active Users",
        load: () => import("../modules/js/activeUsers.js")
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
        load: () => import("../modules/js/settings.js?v=20261015d")
    }

};


// ==========================================================
// DRIVER MODULES
// ==========================================================

const driverModules = {

    verifyBusPass: {
        title: "Verify Bus Pass",
        load: () => import("../modules/js/verifyBusPass.js")
    },

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
        load: () => import("../modules/js/driverTracking.js?v=20261017reset4")
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
        load: () => import("../modules/js/driverSettings.js?v=20261015d")
    }

};
// ==========================================================
// STUDENT MODULES
// ==========================================================

const studentModules = {
    studentTracking: {
        title: "Live Tracking",
        load: () => import("../modules/js/studentTracking.js?v=20261103providerdelay1")
    },

    busPass: {
        title: "Bus Pass",
        load: () => import("../modules/js/busPass.js?v=20261015a")
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
        load: () => import("../modules/js/studentSettings.js?v=20261015d")
    }

};

const technicianModules = {
    traceAssignment: {
        title: "Assign tracer bus",
        load: () => import("../modules/js/traceAssignment.js?v=20261105assign1")
    },
    technicianDashboard: {
        title: "GPS Integration",
        load: () => import("../modules/js/technicianDashboard.js?v=20261105pagination1")
    },
    providerHealth: {
        title: "Provider Health",
        load: () => import("../modules/js/providerHealth.js?v=20261017fix1")
    }
};
const tracerModules = {
    routeStudio: { title: "Trace assigned bus", load: () => import("../modules/js/routeStudio.js?v=20261106background1") },
};

let shell;
let navigationVersion = 0;

const profile =
    JSON.parse(
        localStorage.getItem(
            "bus_tracker_profile"
        ) || "{}"
    );


/* ==========================================================
   ROLE DETECTION
========================================================== */

const activeRole = canonicalRole(profile.role);
const isAdmin = activeRole === ROLE_ADMIN;
const isDriver = activeRole === ROLE_DRIVER;
// User accounts use the existing student transport-profile tables and views.
const isStudent = activeRole === ROLE_USER;
const isTracer = activeRole === "tracer";
const isTechnician = activeRole === ROLE_TECHNICIAN;


/* ==========================================================
   MODULE COLLECTION
========================================================== */

const modules =
    isDriver
        ? driverModules
        : isStudent
            ? studentModules
            : isTracer
                ? tracerModules
            : isTechnician
                ? technicianModules
            : isAdmin
                ? adminModules
                : {};
function titleCase(value) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function createFallback(title, message) {
  const view = document.createElement("section");
  view.className = "module-placeholder glass-panel";
  view.innerHTML = `<p class="eyebrow">BUS TRACKER</p><h2>${title}</h2><p>${message}</p>`;
  return view;
}

const pendingStyleLoads = new Map();

function loadStylesheet(id, href) {
    const pending = pendingStyleLoads.get(id);
    if (pending?.href === href) return pending.promise;
    pending?.cancel();

    const current = document.getElementById(id);
    if (current?.getAttribute("href") === href) return Promise.resolve();

    // Keep the current page's CSS until the replacement has fully loaded.
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;

    let resolveLoad;
    let rejectLoad;
    const promise = new Promise((resolve, reject) => {
        resolveLoad = resolve;
        rejectLoad = reject;
    });
    const entry = {
        href,
        link,
        promise,
        cancel() {
            link.remove();
            pendingStyleLoads.delete(id);
            rejectLoad(new Error(`Stylesheet load superseded: ${href}`));
        }
    };
    pendingStyleLoads.set(id, entry);

    link.addEventListener("load", () => {
        if (pendingStyleLoads.get(id) !== entry) return;
        current?.remove();
        link.id = id;
        pendingStyleLoads.delete(id);
        resolveLoad();
    }, { once: true });
    link.addEventListener("error", () => {
        if (pendingStyleLoads.get(id) !== entry) return;
        link.remove();
        pendingStyleLoads.delete(id);
        rejectLoad(new Error(`Unable to load stylesheet: ${href}`));
    }, { once: true });
    document.head.appendChild(link);
    return promise;
}

function applyModuleStyles(moduleName) {

    // Some route keys are intentionally shared by the Driver and Student
    // portals. Use the matching role-specific styles instead of loading the
    // old generic placeholder stylesheet.
    const styleModuleName =
        isDriver && moduleName === "profile"
            ? "driverProfile"
            : moduleName === "maintainRoute"
                ? "routeStudio"
            : isStudent && moduleName === "notifications"
                ? "studentNotifications"
                : isStudent && moduleName === "profile"
                    ? "studentProfile"
                    : moduleName;

    const styles = [loadStylesheet(
        "active-module-styles",
        `/static/modules/css/${styleModuleName}.css?v=${styleModuleName === "routeStudio" ? "20261106roadeditor1" : styleModuleName === "traceAssignment" ? "20261105assign1" : styleModuleName === "live_tracking" ? "20261105cardreset1" : styleModuleName === "technicianDashboard" ? "20261105pagination1" : styleModuleName === "providerHealth" ? "20261105portals1" : "20261103providerdelay1"}`
    )];

    // Driver shared styles
    if (isDriver) {
        styles.push(loadStylesheet(
            "driver-topbar-style",
            "/static/modules/css/driverTopbar.css"
        ));
    }

    return Promise.all(styles);
}

function createShell(initialRoute) {
  const root = document.querySelector("#app");
  if (!root) return null;
  document.body.classList.remove(
        "admin-theme",
        "driver-theme",
        "student-theme",
        "technician-theme"
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
    else if (isTracer) {
        document.body.classList.add("tracer-theme");
    }

    else if (isTechnician) {

        document.body.classList.add(
            "technician-theme"
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
                : isTracer
                    ? createTracerSidebar(initialRoute, navigate)
                : isTechnician

                    ? createTechnicianSidebar(
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
  if (isTechnician || isTracer) {
      topbar.querySelector(".topbar-actions")?.remove();
  } else {
      topbar.querySelector(".notification-button")?.addEventListener("click", () => navigate("notifications"));
      topbar.querySelector(".profile-button")?.addEventListener("click", () => navigate("profile"));
  }
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
  const thisNavigation = ++navigationVersion;
  const currentProfile = JSON.parse(localStorage.getItem("bus_tracker_profile") || "{}");
  if (isStudent && currentProfile.must_change_password && requestedRoute !== "studentSettings") {
      requestedRoute = "studentSettings";
      if (window.location.hash !== "#studentSettings") {
          window.history.replaceState(null, "", "#studentSettings");
      }
  }
  // Bus document alerts retain their target in the hash query string.
  if (typeof requestedRoute === "string" && requestedRoute.startsWith("buses?")) {
      requestedRoute = "buses";
  }
  const defaultRoute =
        isDriver
            ? "driverDashboard"
            : isStudent
                ? "studentTracking"
                : isTracer
                    ? "routeStudio"
                : isTechnician
                    ? "technicianDashboard"
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

    else if (isTechnician || isTracer) {

        setTechnicianSidebarActive(
            shell.sidebar,
            route
        );

        setTopbarTitle(
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
  shell.content.replaceChildren(createLoader(`Loading ${modules[route].title.toLowerCase()}`));

  try {
    const [module] = await Promise.all([
        modules[route].load(),
        applyModuleStyles(route)
    ]);
    // A newer hash change may have started while this dynamic import was in
    // flight. Never render an older module over the current page; doing so can
    // orphan its polling timers, EventSource, map, or geolocation watcher.
    if (thisNavigation !== navigationVersion) return;
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
    document.getElementById("startup-loader")?.remove();

    // A route change must never leave the mobile drawer over the new page.
    // Removing this class is harmless on desktop, where it has no visual role.
    shell.appShell.classList.remove("sidebar-open");
  } catch (error) {
    if (thisNavigation !== navigationVersion) return;
    console.error("========== MODULE ERROR ==========");
    console.error(error);
    shell.content.replaceChildren(createFallback(
        "Unable to load this page",
        "Please check your connection and refresh the page."
    ));
    document.getElementById("startup-loader")?.remove();
  }
}

window.addEventListener(
    "hashchange",
    () => {

        const defaultRoute =
            isDriver
                ? "driverDashboard"
                : isStudent
                    ? "studentTracking"
                : isTracer
                    ? "routeStudio"
                : isTechnician
                        ? "technicianDashboard"
                    : "dashboard";


        loadModule(
            window.location.hash.slice(1)
            ||
            defaultRoute
        );

    }
);
