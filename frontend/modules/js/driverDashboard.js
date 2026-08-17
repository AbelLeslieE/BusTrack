import { request } from "/static/common/api.js";
import { errorState, formatDateTime, formatTime, value } from "/static/common/portal.js";

export function render() {
    const page = document.createElement("section");
    page.className = "driver-dashboard portal-page";
    page.innerHTML = `<div class="portal-loading">Loading your driving workspace…</div>`;
    void load(page);
    return page;
}

async function load(page) {
    try {
        const data = await request("/drivers/me");
        const trip = data.active_trip;
        const status = trip ? (trip.status || "Active trip") : (data.driver.status || "Unavailable");
        page.innerHTML = `<section class="driver-hero glass-panel"><div class="driver-hero-overlay"></div><div class="driver-hero-content">
            <div class="driver-hero-header"><p class="hero-date">${value(new Date().toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" }))}</p><h1>Welcome, ${value(data.driver.full_name, "Driver")}</h1><p class="hero-subtitle">Your live assignment information is shown below.</p></div>
            <div class="driver-status-grid">
                <div class="status-card"><span class="status-label">Current status</span><strong class="${trip ? "status-green" : ""}">${value(status)}</strong></div>
                <div class="status-card"><span class="status-label">Current bus</span><strong>${value(data.bus?.bus_number, "Not assigned")}</strong></div>
                <div class="status-card"><span class="status-label">Current route</span><strong>${value(data.route?.route_name || data.route?.route_code, "Not assigned")}</strong></div>
                <div class="status-card"><span class="status-label">Departure</span><strong>${formatTime(data.route?.departure_time)}</strong></div>
            </div>
        </div></section>
        <section class="portal-card portal-trip-summary"><div><p class="portal-eyebrow">LIVE TRIP</p><h2>${trip ? "Trip in progress" : "No active trip"}</h2><p>${trip ? `Last location received ${formatDateTime(trip.last_location_update)}.` : "Start a trip from Live Tracking when you are ready to share the bus location."}</p></div>${trip ? `<div class="portal-stat"><span>Current speed</span><strong>${value(trip.speed_kmh, "0")} km/h</strong></div>` : ""}</section>`;
    } catch (error) { page.innerHTML = `<div class="portal-card">${errorState(error)}</div>`; }
}
