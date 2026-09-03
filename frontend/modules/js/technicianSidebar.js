import { logoutSession } from "/static/common/auth.js";

const workspaceItems = [
    ["technicianDashboard", "GPS Integration", "⌘"],
    ["providerHealth", "Provider Health", "⌁"],
];

function navItem([route, label, icon], activeRoute) {
    return `<a class="nav-item${route === activeRoute ? " is-active" : ""}" href="#${route}" data-route="${route}">
        <span class="nav-icon">${icon}</span><span>${label}</span>
    </a>`;
}

export function createTechnicianSidebar(activeRoute, onNavigate) {
    const sidebar = document.createElement("aside");
    sidebar.className = "sidebar glass-panel";
    sidebar.innerHTML = `
        <div class="sidebar-mobile-header">
            <a class="brand" href="#technicianDashboard"><span class="brand-mark">⌘</span><div class="brand-text"><span class="brand-title">BusTrack</span><span class="brand-subtitle">Technician Portal</span></div></a>
            <button type="button" class="sidebar-close" aria-label="Close navigation"><span aria-hidden="true">×</span></button>
        </div>
        <nav class="sidebar-nav"><p class="nav-label">Integration</p>${workspaceItems.map(item => navItem(item, activeRoute)).join("")}</nav>
        <div class="sidebar-footer">
            <p class="nav-label">Restricted access</p>
            <p class="sidebar-help">Manage GPS integration and inspect each provider heartbeat.</p>
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
