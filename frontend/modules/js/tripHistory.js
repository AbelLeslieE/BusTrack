import { request } from "/static/common/api.js";
import { emptyState, errorState, formatDateTime, value } from "/static/common/portal.js";

export function render() {
    const page = document.createElement("section");
    page.className = "portal-page";
    page.innerHTML = `<div class="portal-loading">Loading trip history…</div>`;
    void request("/drivers/me/trips").then(trips => {
        page.innerHTML = `<header class="portal-header"><p class="portal-eyebrow">DRIVER PORTAL</p><h1>Trip history</h1><p>Your 100 most recent trips, including any currently active trip.</p></header><section class="portal-card">${trips.length ? `<div class="portal-table-wrap"><table class="portal-table"><thead><tr><th>Route</th><th>Bus</th><th>Started</th><th>Ended</th><th>Status</th></tr></thead><tbody>${trips.map(trip => `<tr><td>${value(trip.route_name || trip.route_code, "Not assigned")}</td><td>${value(trip.bus_number, "—")}</td><td>${formatDateTime(trip.started_at)}</td><td>${formatDateTime(trip.ended_at, "In progress")}</td><td><span class="portal-badge">${value(trip.status)}</span></td></tr>`).join("")}</tbody></table></div>` : emptyState("No trips yet", "Trips will appear here after you start and end them in Live Tracking.")}</section>`;
    }).catch(error => { page.innerHTML = `<div class="portal-card">${errorState(error)}</div>`; });
    return page;
}
