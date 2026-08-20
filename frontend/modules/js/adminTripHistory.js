import { request } from "/static/common/api.js";
import { escapeHtml } from "/static/common/security.js";
import { formatDateTime } from "/static/common/portal.js";

const state = { buses: [], selectedBusId: null, history: null, type: "all", search: "" };

function ensureStyles() {
    if (document.getElementById("admin-trip-history-styles")) return;
    const style = document.createElement("style");
    style.id = "admin-trip-history-styles";
    style.textContent = `.history-page{display:grid;gap:20px}.history-page .portal-header{padding:24px}.history-page .portal-eyebrow{color:var(--primary);font-weight:800;letter-spacing:.16em}.history-controls,.history-bus-grid,.history-summary{display:flex;gap:12px;flex-wrap:wrap}.history-controls input,.history-controls select{width:auto;min-width:150px;padding:11px 13px}.history-bus-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr))}.history-bus{padding:16px;text-align:left;border:1px solid rgba(255,255,255,.12);border-radius:16px;background:rgba(9,24,50,.55);color:var(--text);cursor:pointer}.history-bus.is-selected{border-color:var(--primary);box-shadow:0 0 0 2px rgba(79,209,255,.18)}.history-bus strong,.history-bus small{display:block}.history-bus small{margin-top:7px;color:var(--muted)}.history-section{padding:22px}.history-section h3{margin:24px 0 12px}.portal-table-wrap{overflow:auto}.portal-table{width:100%;border-collapse:collapse}.portal-table th,.portal-table td{padding:12px;text-align:left;border-bottom:1px solid rgba(255,255,255,.1)}.history-timeline{display:grid;gap:10px}.history-event{display:grid;grid-template-columns:110px 1fr auto;gap:12px;align-items:start;padding:13px;border-left:3px solid var(--primary);border-radius:10px;background:rgba(255,255,255,.045)}.history-event.feedback{border-color:var(--danger)}.history-event time{font-size:.8rem;color:var(--muted)}.history-event p{margin:4px 0 0;font-size:.88rem}.history-empty{padding:25px;color:var(--muted);text-align:center}@media(max-width:650px){.history-controls>*{width:100%!important}.history-event{grid-template-columns:1fr}.history-section{padding:17px}}`;
    document.head.append(style);
}

function eventMarkup(event) {
    if (event.kind === "feedback") return `<article class="history-event feedback"><time>${formatDateTime(event.occurred_at)}</time><div><strong>${escapeHtml(event.title)}</strong><p>${escapeHtml(event.message || "No additional driver notes.")}</p><small>${escapeHtml(event.feedback_type)} · ${escapeHtml(event.severity)} · ${escapeHtml(event.status)}</small></div><span>Feedback</span></article>`;
    return `<article class="history-event"><time>${formatDateTime(event.occurred_at)}</time><div><strong>${escapeHtml(event.event_type)} · ${escapeHtml(event.stop_name)}</strong><p>Stop ${escapeHtml(event.sequence)}${event.distance_meters != null ? ` · ${Math.round(event.distance_meters)}m from stop` : ""}</p></div><span>Stop</span></article>`;
}

function dwellTime(arrivedAt, departedAt) {
    if (!arrivedAt) return "Arrival was not recorded";
    if (!departedAt) return "Currently at stop";
    const milliseconds = Date.parse(departedAt) - Date.parse(arrivedAt);
    if (!Number.isFinite(milliseconds) || milliseconds < 0) return "—";
    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    return minutes ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
}

function stopVisitMarkup(visit) {
    return `<tr><td>${escapeHtml(String(visit.trip_id))}</td><td>${escapeHtml(visit.stop_name)}${visit.stop_code ? `<small> · ${escapeHtml(visit.stop_code)}</small>` : ""}</td><td>${formatDateTime(visit.arrived_at, "—")}</td><td>${formatDateTime(visit.departed_at, "Currently at stop")}</td><td>${escapeHtml(dwellTime(visit.arrived_at, visit.departed_at))}</td></tr>`;
}

function renderDetails(page) {
    const target = page.querySelector("#history-details");
    if (!state.history) { target.innerHTML = `<div class="history-empty">Select a bus to view its complete trip timeline.</div>`; return; }
    const { bus, trips, timeline, stop_visits: stopVisits = [] } = state.history;
    const events = state.type === "all" ? timeline : timeline.filter(item => item.kind === state.type);
    target.innerHTML = `<section class="glass-panel history-section"><div class="history-summary"><div><p class="eyebrow">Selected bus</p><h2>${escapeHtml(bus.bus_number)}</h2><p>${escapeHtml(bus.registration_number)} · ${escapeHtml(bus.manufacturer)} ${escapeHtml(bus.model)}</p></div><div><strong>${trips.length}</strong><small> trips</small></div></div><h3>Trip records</h3>${trips.length ? `<div class="portal-table-wrap"><table class="portal-table"><thead><tr><th>Route</th><th>Driver</th><th>Started</th><th>Ended</th><th>Direction</th></tr></thead><tbody>${trips.map(trip => `<tr><td>${escapeHtml(trip.route_name || trip.route_code || "—")}</td><td>${escapeHtml(trip.driver_name || "—")}</td><td>${formatDateTime(trip.started_at)}</td><td>${formatDateTime(trip.ended_at,"In progress")}</td><td>${escapeHtml(trip.direction)}</td></tr>`).join("")}</tbody></table></div>` : `<p>No trips match this date range.</p>`}<h3>Stop-by-stop movement</h3>${stopVisits.length ? `<div class="portal-table-wrap"><table class="portal-table"><thead><tr><th>Trip</th><th>Stop</th><th>Entered stop radius</th><th>Exited stop radius</th><th>Time at stop</th></tr></thead><tbody>${stopVisits.map(stopVisitMarkup).join("")}</tbody></table></div>` : `<div class="history-empty">No stop movements have been recorded for these trips yet.</div>`}<h3>Stop events and driver feedback</h3><div class="history-timeline">${events.length ? events.map(eventMarkup).join("") : `<div class="history-empty">No ${state.type === "all" ? "history" : state.type} records match these filters.</div>`}</div></section>`;
}

function renderBuses(page) {
    const target = page.querySelector("#history-buses");
    const term = page.querySelector("#history-bus-search").value.trim().toLowerCase();
    const buses = state.buses.filter(bus => `${bus.bus_number} ${bus.registration_number}`.toLowerCase().includes(term));
    target.innerHTML = buses.length ? buses.map(bus => `<button class="history-bus ${bus.id === state.selectedBusId ? "is-selected" : ""}" data-bus-id="${bus.id}"><strong>${escapeHtml(bus.bus_number)}</strong><small>${escapeHtml(bus.registration_number)}</small><small>${bus.trip_count} trips · ${bus.feedback_count} feedback</small></button>`).join("") : `<div class="history-empty">No buses found.</div>`;
}

async function selectBus(page, busId) {
    state.selectedBusId = Number(busId);
    const from = page.querySelector("#history-from").value;
    const to = page.querySelector("#history-to").value;
    const search = page.querySelector("#history-detail-search").value.trim();
    const query = new URLSearchParams();
    if (from) query.set("date_from", from);
    if (to) query.set("date_to", to);
    if (search) query.set("search", search);
    page.querySelector("#history-details").innerHTML = `<div class="history-empty">Loading bus history…</div>`;
    state.history = await request(`/trip-history/buses/${busId}?${query}`);
    renderBuses(page); renderDetails(page);
}

export function render() {
    ensureStyles();
    const page = document.createElement("section");
    page.className = "history-page";
    page.innerHTML = `<header class="portal-header"><p class="portal-eyebrow">Management</p><h1>Trip history</h1><p>Select a bus to review trips, exact stop-radius times, and driver feedback.</p></header><section class="glass-panel history-section"><div class="history-controls"><input id="history-bus-search" type="search" placeholder="Search bus or registration"><input id="history-from" type="date" aria-label="From date"><input id="history-to" type="date" aria-label="To date"><select id="history-type" aria-label="Record type"><option value="all">All records</option><option value="stop">Stop arrivals</option><option value="feedback">Driver feedback</option></select><input id="history-detail-search" type="search" placeholder="Search selected history"></div><div id="history-buses" class="history-bus-grid"><div class="history-empty">Loading buses…</div></div></section><div id="history-details"></div>`;
    const reload = () => state.selectedBusId && selectBus(page, state.selectedBusId).catch(error => page.querySelector("#history-details").textContent = error.message);
    page.querySelector("#history-bus-search").addEventListener("input", () => renderBuses(page));
    page.querySelector("#history-type").addEventListener("change", event => { state.type = event.target.value; renderDetails(page); });
    page.querySelector("#history-from").addEventListener("change", reload);
    page.querySelector("#history-to").addEventListener("change", reload);
    page.querySelector("#history-detail-search").addEventListener("change", reload);
    page.querySelector("#history-buses").addEventListener("click", event => { const button = event.target.closest("[data-bus-id]"); if (button) selectBus(page, button.dataset.busId).catch(error => page.querySelector("#history-details").textContent = error.message); });
    request("/trip-history/buses").then(buses => { state.buses = buses; renderBuses(page); }).catch(error => { page.querySelector("#history-buses").textContent = error.message; });
    return page;
}
