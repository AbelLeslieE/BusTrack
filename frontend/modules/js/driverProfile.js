import { request } from "/static/common/api.js";
import { emptyState, errorState, value } from "/static/common/portal.js";

export function render() {
    const page = document.createElement("section");
    page.className = "portal-page";
    page.innerHTML = `<div class="portal-loading">Loading your profile…</div>`;
    void request("/drivers/me").then(data => {
        const driver = data.driver;
        page.innerHTML = `<header class="portal-header"><p class="portal-eyebrow">DRIVER PORTAL</p><h1>My profile</h1><p>Your driver identity and current operational assignment.</p></header><section class="portal-card"><div class="portal-title-row"><div><h2>${value(driver.full_name, "Driver")}</h2><p>${value(driver.driver_code, "Driver code not recorded")}</p></div><span class="portal-badge">${value(driver.status)}</span></div><dl class="portal-details"><div><dt>Email</dt><dd>${value(driver.email, "Not provided")}</dd></div><div><dt>Phone</dt><dd>${value(driver.phone, "Not provided")}</dd></div><div><dt>Licence number</dt><dd>${value(driver.license_number, "Not recorded")}</dd></div><div><dt>Licence expiry</dt><dd>${value(driver.license_expiry, "Not recorded")}</dd></div></dl></section>${!data.bus && !data.route ? emptyState("No current assignment", "Your bus and route will appear here once an administrator assigns them.") : ""}`;
    }).catch(error => { page.innerHTML = `<div class="portal-card">${errorState(error)}</div>`; });
    return page;
}
