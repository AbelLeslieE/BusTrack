import { requireAuthenticatedSession } from "/static/common/auth.js";
import { canonicalRole, ROLE_ADMIN, ROLE_DRIVER, ROLE_TECHNICIAN, ROLE_USER } from "/static/common/roles.js";
import { installHardRefreshShortcut } from "/static/common/cacheRefresh.js";

installHardRefreshShortcut();

try {
const profile = await requireAuthenticatedSession();

if (!profile) {
    throw new Error("No authenticated session.");
}

// Import the role-sensitive router only after the server session has refreshed
// localStorage. Otherwise a previous account's cached role can build the wrong
// sidebar when a technician opens or reloads a bookmarked module.
const { loadModule } = await import("/static/common/router.js?v=20261015b");

const role = canonicalRole(profile.role);
let moduleName;

switch (role) {
    case ROLE_ADMIN:
        moduleName = window.location.hash.slice(1) || "dashboard";
        break;
    case ROLE_DRIVER:
        if (!window.location.hash) window.location.hash = "driverDashboard";
        moduleName = "driverDashboard";
        break;
    case ROLE_USER:
        // The student dashboard was retired.  Bookmarked dashboard hashes are
        // normalised before the shell is created so Live Tracking is active.
        if (!window.location.hash || window.location.hash === "#studentDashboard") {
            window.location.hash = "studentTracking";
        }
        moduleName = window.location.hash.slice(1);
        break;
    case ROLE_TECHNICIAN:
        if (!window.location.hash) window.location.hash = "technicianDashboard";
        moduleName = window.location.hash.slice(1);
        break;
    default:
        throw new Error(`Unsupported user role: ${profile.role}`);
}

await loadModule(moduleName);
} catch (error) {
    // Authentication redirects on an expired session; keep the loader in place
    // until navigation completes. Other startup failures need a visible retry.
    if (error.message !== "No authenticated session.") {
        console.error("Unable to start BusTrack:", error);
        const loader = document.getElementById("startup-loader");
        const message = loader?.querySelector(".startup-loader__message");
        if (message) message.textContent = "Unable to load BusTrack. Please try again.";
        loader?.querySelector(".startup-loader__spinner")?.remove();
        if (loader && !loader.querySelector(".startup-loader__retry")) {
            const retry = document.createElement("button");
            retry.className = "startup-loader__retry";
            retry.type = "button";
            retry.textContent = "Try again";
            retry.addEventListener("click", () => window.location.reload());
            loader.querySelector(".startup-loader__content")?.append(retry);
        }
    }
}
