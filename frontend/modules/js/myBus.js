import { request } from "/static/common/api.js";
import { emptyState, errorState, value } from "/static/common/portal.js";

export function render() {
    const page = document.createElement("section");
    page.className = "portal-page";
    page.innerHTML = `<div class="portal-loading">Loading your bus…</div>`;
    void request("/drivers/me").then(data => {
        const bus = data.bus;
        page.innerHTML = `<header class="portal-header"><p class="portal-eyebrow">DRIVER PORTAL</p><h1>My bus</h1><p>Your bus assignment is managed by the transport team.</p></header>${bus ? `<article class="portal-card portal-asset-card"><div class="portal-asset-icon"><i class="fa-solid fa-bus"></i></div><div><h2>${value(bus.bus_number)}</h2><p>${value(bus.registration_number, "Registration not recorded")}</p></div><span class="portal-badge">${value(bus.status)}</span><dl class="portal-details"><div><dt>Model</dt><dd>${value([bus.manufacturer, bus.model].filter(Boolean).join(" "), "Not recorded")}</dd></div><div><dt>Capacity</dt><dd>${value(bus.capacity, "Not recorded")}</dd></div><div><dt>Fuel type</dt><dd>${value(bus.fuel_type, "Not recorded")}</dd></div><div><dt>Year</dt><dd>${value(bus.year, "Not recorded")}</dd></div></dl></article>` : emptyState("No bus assigned", "An administrator has not assigned a bus to your driver profile yet.")}`;
    }).catch(error => { page.innerHTML = `<div class="portal-card">${errorState(error)}</div>`; });
    return page;
}
