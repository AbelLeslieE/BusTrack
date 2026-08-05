/**
 * Shared SPA sidebar navigation.
 * TODO: Add permission-aware navigation when user roles are implemented.
 */

const primaryItems = [
  ["dashboard", "Overview", "⌂"],
  ["live_tracking", "Live tracking", "◎"],
  ["buses", "Buses", "▣"],
  ["routes", "Routes", "⌁"],
  ["stops", "Stops", "⌖"],
];

const managementItems = [
  ["drivers", "Drivers", "◒"],
  ["students", "Students", "◉"],
  ["users", "Users", "♙"],
  ["notifications", "Notifications", "♧"],
];

function navigationItem([route, label, icon], activeRoute) {
  const activeClass = route === activeRoute ? " is-active" : "";
  return `<a class="nav-item${activeClass}" href="#${route}" data-route="${route}">
    <span class="nav-icon" aria-hidden="true">${icon}</span><span>${label}</span>
  </a>`;
}

export function createSidebar(activeRoute, onNavigate) {
  const sidebar = document.createElement("aside");
  sidebar.className = "sidebar glass-panel";
  sidebar.setAttribute("aria-label", "Primary navigation");
  sidebar.innerHTML = `
    <a class="brand" href="#dashboard">
        <span class="brand-mark">🚌</span>

        <div class="brand-text">
            <span class="brand-title">BusTrack</span>
            <span class="brand-subtitle">Fleet OS</span>
        </div>
    </a>
    <nav class="sidebar-nav">
      <p class="nav-label">Workspace</p>
      ${primaryItems.map((item) => navigationItem(item, activeRoute)).join("")}
      <p class="nav-label nav-label-spaced">Management</p>
      ${managementItems.map((item) => navigationItem(item, activeRoute)).join("")}
    </nav>
    <div class="sidebar-footer">

        <a class="nav-item" href="#settings" data-route="settings">
            <span class="nav-icon">⚙</span>
            <span>Settings</span>
        </a>

        <a class="nav-item logout-btn" href="#" data-action="logout">
            <span class="nav-icon">⇦</span>
            <span>Logout</span>
        </a>

        <div class="help-card">
            <span>Need help?</span>
            <small>View the fleet guide</small>
        </div>

    </div>
    `;

  sidebar.addEventListener("click", (event) => {

      const logout = event.target.closest("[data-action='logout']");

      if (logout) {

          event.preventDefault();

          localStorage.clear();

          window.location.href = "/";

          return;

      }

      const link = event.target.closest("[data-route]");

      if (!link) return;

      event.preventDefault();

      onNavigate(link.dataset.route);

      // Close drawer only on tablet/mobile
      if (window.innerWidth <= 1200) {

          document
              .querySelector(".app-shell")
              ?.classList.remove("sidebar-open");

      }



  });
  return sidebar;
}

export function setSidebarActive(sidebar, activeRoute) {
  sidebar.querySelectorAll("[data-route]").forEach((link) => {
    link.classList.toggle("is-active", link.dataset.route === activeRoute);
  });
}
