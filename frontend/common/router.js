/**
 * SPA router and shared application-shell coordinator.
 * TODO: Add browser-history support and route-level authorization when APIs are available.
 */

import { createLoader } from "./loader.js";

import { createSidebar, setSidebarActive } from "./sidebar.js";
import { createDriverSidebar, setDriverSidebarActive } from "../modules/js/driverSidebar.js";

import { createTopbar, setTopbarTitle } from "./topbar.js";
import { createDriverTopbar, setDriverTopbarTitle } from "../modules/js/driverTopbar.js";
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

let shell;
const profile =
    JSON.parse(localStorage.getItem("bus_tracker_profile") || "{}");

const isDriver = profile.role === "Driver";
const modules = isDriver
    ? driverModules
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
        "driver-theme"
    );

    document.body.classList.add(
        isDriver
            ? "driver-theme"
            : "admin-theme"
    );

    const appShell = document.createElement("div");

    appShell.className = "app-shell";
  const navigate = (route) => {

    // ==========================================================
    // CLOSE SIDEBAR IMMEDIATELY WHEN A MODULE IS SELECTED
    // ==========================================================

    if (window.innerWidth <= 1200) {

        appShell.classList.remove("sidebar-open");

    }

    // ----------------------------------------------------------
    // Continue normal navigation
    // ----------------------------------------------------------

    if (window.location.hash.slice(1) === route) {

        loadModule(route);

    } else {

        window.location.hash = route;

    }

    // ==========================================================
    // SAFETY CLOSE
    // ==========================================================
    // Prevent the sidebar's click/toggle handler from reopening
    // it after the module click has bubbled through the DOM.

    if (window.innerWidth <= 1200) {

        setTimeout(() => {

            appShell.classList.remove("sidebar-open");

        }, 0);

    }

};
  const sidebar = isDriver
      ? createDriverSidebar(initialRoute, navigate)
      : createSidebar(initialRoute, navigate);

  const toggleSidebar = () => {

        // Only open the drawer on smaller screens
        if (window.innerWidth <= 1200) {

            appShell.classList.toggle("sidebar-open");

        }

    };
    const topbar = isDriver
        ? createDriverTopbar(toggleSidebar)
        : createTopbar(toggleSidebar);
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
        sidebar,
        workspace
    );
  root.replaceChildren(appShell);
  return { appShell, sidebar, topbar, content };
}

export async function loadModule(requestedRoute) {
  const defaultRoute = isDriver
      ? "driverDashboard"
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

      setDriverSidebarActive(shell.sidebar, route);

      setDriverTopbarTitle(
          shell.topbar,
          modules[route].title
      );

  }
  else {

      setSidebarActive(shell.sidebar, route);

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

    if (window.innerWidth <= 1200) {

        shell.appShell.classList.remove("sidebar-open");

    }
  } catch (error) {
    console.error("========== MODULE ERROR ==========");
    console.error(error);
    throw error;
  }
}

window.addEventListener("hashchange", () => {

    const defaultRoute = isDriver
        ? "driverDashboard"
        : "dashboard";

    loadModule(
        window.location.hash.slice(1) || defaultRoute
    );

});
