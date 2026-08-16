import { requireAuthenticatedSession } from "/static/common/auth.js";
import { loadModule } from "/static/common/router.js";
import { canonicalRole, ROLE_ADMIN, ROLE_DRIVER, ROLE_USER } from "/static/common/roles.js";

const profile = await requireAuthenticatedSession();

if (!profile) {
    throw new Error("No authenticated session.");
}

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
        if (!window.location.hash) window.location.hash = "studentDashboard";
        moduleName = "studentDashboard";
        break;
    default:
        throw new Error(`Unsupported user role: ${profile.role}`);
}

loadModule(moduleName);
