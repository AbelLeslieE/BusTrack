/**
 * SPA router and shared application-shell coordinator.
 * TODO: Add browser-history support and route-level authorization when APIs are available.
 */

import { createLoader } from "./loader.js";
import { createSidebar, setSidebarActive } from "./sidebar.js";
import { createTopbar, setTopbarTitle } from "./topbar.js";

const modules = {
  dashboard: { title: "Overview", load: () => import("../modules/js/dashboard.js") },
  live_tracking: { title: "Live tracking", load: () => import("../modules/js/live_tracking.js") },
  buses: {
      title: "Buses",
      load: () => import("../modules/js/buses.js?v=123456")
  },
  routes: { title: "Routes", load: () => import("../modules/js/routes.js") },
  stops: { title: "Stops", load: () => import("../modules/js/stops.js") },
  drivers: { title: "Drivers", load: () => import("../modules/js/drivers.js") },
  students: { title: "Students", load: () => import("../modules/js/students.js") },
  users: { title: "Users", load: () => import("../modules/js/users.js") },
  notifications: { title: "Notifications", load: () => import("../modules/js/notifications.js") },
  profile: { title: "Profile", load: () => import("../modules/js/profile.js") },
  settings: { title: "Settings", load: () => import("../modules/js/settings.js") },
};

let shell;

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
  let stylesheet = document.querySelector("#active-module-styles");
  if (!stylesheet) {
    stylesheet = document.createElement("link");
    stylesheet.id = "active-module-styles";
    stylesheet.rel = "stylesheet";
    document.head.append(stylesheet);
  }
  stylesheet.href = `/static/modules/css/${moduleName}.css`;
}

function createShell(initialRoute) {
  const root = document.querySelector("#app");
  if (!root) return null;
  const appShell = document.createElement("div");
  appShell.className = "app-shell";
  const navigate = (route) => {
    if (window.location.hash.slice(1) === route) loadModule(route);
    else window.location.hash = route;
  };
  const sidebar = createSidebar(initialRoute, navigate);
  const topbar = createTopbar(() => appShell.classList.toggle("sidebar-open"));
  const content = document.createElement("main");
  content.className = "page-content";
  content.id = "page-content";
  const workspace = document.createElement("div");
  workspace.className = "app-workspace";
  workspace.append(topbar, content);
  appShell.append(sidebar, workspace);
  root.replaceChildren(appShell);
  return { appShell, sidebar, topbar, content };
}

export async function loadModule(requestedRoute = "dashboard") {
  const route = modules[requestedRoute] ? requestedRoute : "dashboard";
  shell ??= createShell(route);
  if (!shell) return;

  shell.appShell.classList.remove("sidebar-open");
  setSidebarActive(shell.sidebar, route);
  setTopbarTitle(shell.topbar, modules[route].title);
  applyModuleStyles(route);
  shell.content.replaceChildren(createLoader(`Loading ${modules[route].title.toLowerCase()}`));

  try {
    const module = await modules[route].load();
    console.log("Imported module:", module);
  console.log("Module keys:", Object.keys(module));
  console.log("Render:", module.render);
    const view = typeof module.render === "function"
      ? module.render()
      : createFallback(modules[route].title, "This workspace is ready for its feature implementation.");
    shell.content.replaceChildren(view);
  } catch (error) {
    console.error("========== MODULE ERROR ==========");
    console.error(error);
    throw error;
  }
}

window.addEventListener("hashchange", () => loadModule(window.location.hash.slice(1) || "dashboard"));
