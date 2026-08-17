import { request } from "/static/common/api.js";
import { emptyState, errorState, formatTime, value } from "/static/common/portal.js";

export function render() {
    const page = document.createElement("section");
    page.className = "portal-page";
    page.innerHTML = `<div class="portal-loading">Loading your route…</div>`;
    void request("/drivers/me").then(data => {
        const route = data.route;
        page.innerHTML = `<header class="portal-header"><p class="portal-eyebrow">DRIVER PORTAL</p><h1>My route</h1><p>Stops and scheduled times for your current assignment.</p></header>${route ? `<section class="portal-card"><div class="portal-title-row"><div><h2>${value(route.route_name)}</h2><p>${value(route.route_code)}</p></div><span class="portal-badge">${value(route.status)}</span></div><div class="portal-stats"><div><span>Departure</span><strong>${formatTime(route.departure_time)}</strong></div><div><span>Arrival</span><strong>${formatTime(route.arrival_time)}</strong></div><div><span>Stops</span><strong>${route.stops.length}</strong></div></div><ol class="portal-stop-list">${route.stops.length ? route.stops.map(stop => `<li><span>${value(stop.sequence)}</span><div><strong>${value(stop.stop_name)}</strong><small>${value(stop.stop_code)}</small></div></li>`).join("") : `<li class="portal-muted">No stops have been saved for this route.</li>`}</ol></section>` : emptyState("No route assigned", "An administrator has not assigned a route to your driver profile yet.")}`;
    }).catch(error => { page.innerHTML = `<div class="portal-card">${errorState(error)}</div>`; });
    return page;
}
