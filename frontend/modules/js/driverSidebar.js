/**
 * Driver sidebar.
 * Uses the shared sidebar.css styles.
 */

const primaryItems = [
    ["driverDashboard", "Dashboard", "⌂"],
    ["myBus", "My Bus", "▣"],
    ["myRoute", "My Route", "⌁"],
    ["driverTracking", "Live Tracking", "◎"],
    ["tripHistory", "Trip History", "◷"],
];

const accountItems = [
    ["notifications", "Notifications", "♧"],
    ["profile", "Profile", "◉"],
    ["driverSettings", "Settings", "⚙"],
];

function navigationItem([route, label, icon], activeRoute) {

    const activeClass =
        route === activeRoute
            ? " is-active"
            : "";

    return `
        <a class="nav-item${activeClass}"
           href="#${route}"
           data-route="${route}">

            <span class="nav-icon">${icon}</span>

            <span>${label}</span>

        </a>
    `;
}

export function createDriverSidebar(activeRoute, onNavigate) {

    const sidebar = document.createElement("aside");

    sidebar.className = "sidebar glass-panel";

    sidebar.innerHTML = `
        <a class="brand" href="#driverDashboard">

            <span class="brand-mark">🚌</span>

            <div class="brand-text">

                <span class="brand-title">
                    BusTrack
                </span>

                <span class="brand-subtitle">
                    Driver Portal
                </span>

            </div>

        </a>

        <nav class="sidebar-nav">

            <p class="nav-label">
                Workspace
            </p>

            ${primaryItems
                .map(item => navigationItem(item, activeRoute))
                .join("")}

            <p class="nav-label nav-label-spaced">
                Account
            </p>

            ${accountItems
                .map(item => navigationItem(item, activeRoute))
                .join("")}

        </nav>

        <div class="sidebar-footer">

            <a
                class="nav-item logout-btn"
                href="#"
                data-action="logout">

                <span class="nav-icon">⇦</span>

                <span>Logout</span>

            </a>

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

    });

    return sidebar;
}

export function setDriverSidebarActive(sidebar, activeRoute) {

    sidebar.querySelectorAll("[data-route]").forEach(link => {

        link.classList.toggle(
            "is-active",
            link.dataset.route === activeRoute
        );

    });

}