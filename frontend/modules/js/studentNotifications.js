import { request } from "/static/common/api.js";
import { emptyState, errorState, formatDateTime, value } from "/static/common/portal.js";

export function render() {
    const page = document.createElement("section");
    page.className = "portal-page";
    page.innerHTML = `<div class="portal-loading">Checking your bus service…</div>`;
    void Promise.all([request("/students/me"), request("/students/me/tracking")]).then(([student, tracking]) => {
        const bus = student.assigned_bus;
        const trip = tracking.live_trip;
        const cards = [];
        if (!bus) cards.push(["Assignment needed", "You do not have a bus assignment yet. Contact the transport office."]);
        else if (!trip) cards.push(["No active trip", `${bus.bus_number} is assigned to you, but it is not sharing a live trip right now.`]);
        else cards.push(["Live tracking active", `${bus.bus_number} is currently sending location updates.`]);
        if (trip?.last_location_update) cards.push(["Last GPS update", `Received ${formatDateTime(trip.last_location_update)}.`]);
        if (student.assigned_stop) cards.push(["Your boarding stop", `${student.assigned_stop.stop_name} is your saved stop.`]);
        page.innerHTML = `<header class="portal-header"><p class="portal-eyebrow">STUDENT PORTAL</p><h1>Notifications</h1><p>Current service notices calculated from your actual assignment and live tracking data.</p></header><section class="portal-card portal-notice-list">${cards.length ? cards.map(([title, message]) => `<article class="portal-notice"><i class="fa-solid fa-circle-info" aria-hidden="true"></i><div><h2>${value(title)}</h2><p>${value(message)}</p></div></article>`).join("") : emptyState("No notices", "There are no service notices for your account.")}</section>`;
    }).catch(error => { page.innerHTML = `<div class="portal-card">${errorState(error)}</div>`; });
    return page;
}
