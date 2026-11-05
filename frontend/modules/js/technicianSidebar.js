import { logoutSession } from "/static/common/auth.js?v=20261015d";

const technicianItems = [
    ["technicianDashboard", "GPS Integration", "⌘"],
    ["providerHealth", "Provider Health", "⌁"],
    ["routeStudio", "Traced paths", "⌁"],
];

function navItem([route, label, icon], activeRoute) {
    return `<a class="nav-item${route === activeRoute ? " is-active" : ""}" href="#${route}" data-route="${route}">
        <span class="nav-icon">${icon}</span><span>${label}</span>
    </a>`;
}

export function createTechnicianSidebar(activeRoute, onNavigate, {tracerPortal = false} = {}) {
    const profile = JSON.parse(localStorage.getItem("bus_tracker_profile") || "{}");
    const isTracer = tracerPortal || String(profile.role || "").toLowerCase() === "tracer";
    const workspaceItems = isTracer ? [["routeStudio", "Trace assigned bus", "⌁"]] : technicianItems;
    const sidebar = document.createElement("aside");
    sidebar.className = `sidebar glass-panel${isTracer ? " tracer-sidebar" : " technician-sidebar"}`;
    sidebar.innerHTML = `
        <div class="sidebar-mobile-header">
            <a class="brand" href="${isTracer ? "#routeStudio" : "#technicianDashboard"}"><span class="brand-mark"><img src="/static/assets/images/logo.png?v=20261015logo2" alt="" aria-hidden="true"></span><div class="brand-text"><span class="brand-title">BusTrack</span><span class="brand-subtitle">${isTracer ? "Tracer Portal" : "Technician Portal"}</span></div></a>
            <button type="button" class="sidebar-close" aria-label="Close navigation"><span aria-hidden="true">×</span></button>
        </div>
        <nav class="sidebar-nav"><p class="nav-label">${isTracer ? "Bus route" : "Technician workspace"}</p>${workspaceItems.map(item => navItem(item, activeRoute)).join("")}</nav>
        <div class="sidebar-footer">
            <p class="nav-label">Restricted access</p>
            <p class="sidebar-help">${isTracer ? "Record the assigned bus route and review recording status." : "Manage GPS integrations, review traces, and prepare routes for admin approval."}</p>
            <a class="nav-item logout-btn" href="#" data-action="logout"><span class="nav-icon">⇦</span><span>Logout</span></a>
        </div>`;
    sidebar.addEventListener("click", event => {
        const close = event.target.closest(".sidebar-close");
        if (close) { document.querySelector(".app-shell")?.classList.remove("sidebar-open"); return; }
        if (event.target.closest("[data-action='logout']")) { event.preventDefault(); void logoutSession(); return; }
        const link = event.target.closest("[data-route]");
        if (!link) return;
        event.preventDefault();
        document.querySelector(".app-shell")?.classList.remove("sidebar-open");
        onNavigate(link.dataset.route);
    });
    return sidebar;
}


export function setTechnicianSidebarActive(sidebar, activeRoute) {
    sidebar.querySelectorAll("[data-route]").forEach(link => link.classList.toggle("is-active", link.dataset.route === activeRoute));
}

export function createTracerSidebar(activeRoute, onNavigate) {
    return createTechnicianSidebar(activeRoute, onNavigate, {tracerPortal:true});
}
