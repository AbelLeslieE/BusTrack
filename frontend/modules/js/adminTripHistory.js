import { request } from "/static/common/api.js";
import { escapeHtml } from "/static/common/security.js";
import { formatDateTime } from "/static/common/portal.js";

const HISTORY_REFRESH_INTERVAL_MS = 2000;
const state = { buses: [], selectedBusId: null, history: null, type: "all", search: "", historyRequestId: 0 };

function eventMarkup(event) {
    if (event.kind === "feedback") return `<article class="history-event feedback"><span class="history-event-icon"><i class="fa-solid fa-comment-dots" aria-hidden="true"></i></span><time>${formatDateTime(event.occurred_at)}</time><div><strong>${escapeHtml(event.title)}</strong><p>${escapeHtml(event.message || "No additional driver notes.")}</p><small>${escapeHtml(event.feedback_type)} · ${escapeHtml(event.severity)} · ${escapeHtml(event.status)}</small></div><span class="history-event-kind">Feedback</span></article>`;
    const completedLeg = event.event_type === "Leg completed";
    return `<article class="history-event"><span class="history-event-icon"><i class="fa-solid ${completedLeg ? "fa-flag-checkered" : "fa-location-dot"}" aria-hidden="true"></i></span><time>${formatDateTime(event.occurred_at)}</time><div><strong>${escapeHtml(event.event_type)} · ${escapeHtml(event.stop_name)}</strong><p>${completedLeg ? "Reached terminal — journey completed" : `Stop ${escapeHtml(event.sequence)}${event.distance_meters != null ? ` · ${Math.round(event.distance_meters)}m from stop` : ""}`}</p></div><span class="history-event-kind">${completedLeg ? "Journey" : "Stop"}</span></article>`;
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
    return `<tr role="row">${historyCell("Trip", escapeHtml(String(visit.trip_id)))}${historyCell("Stop", `${escapeHtml(visit.stop_name)}${visit.stop_code ? `<small> · ${escapeHtml(visit.stop_code)}</small>` : ""}`)}${historyCell("Entered stop radius", formatDateTime(visit.arrived_at, "—"))}${historyCell("Exited stop radius", formatDateTime(visit.departed_at, "Currently at stop"))}${historyCell("Time at stop", escapeHtml(dwellTime(visit.arrived_at, visit.departed_at)))}</tr>`;
}

function historyCell(label, content) {
    return `<td role="cell" data-label="${label}"><span class="history-cell-value">${content}</span></td>`;
}

function tripLegMarkup(leg) {
    const terminal = leg.terminal_stop_name
        ? `${escapeHtml(leg.terminal_stop_name)}${leg.terminal_stop_code ? ` · ${escapeHtml(leg.terminal_stop_code)}` : ""}`
        : "In progress";
    return `<tr role="row">${historyCell("Route", escapeHtml(leg.route_name || leg.route_code || "—"))}${historyCell("Driver", escapeHtml(leg.driver_name || "—"))}${historyCell("Direction", escapeHtml(leg.direction))}${historyCell("Started", formatDateTime(leg.started_at))}${historyCell("Terminal", terminal)}${historyCell("Reached terminal", formatDateTime(leg.terminal_reached_at, "In progress"))}${historyCell("Status", escapeHtml(leg.status))}</tr>`;
}

function renderDetails(page) {
    const target = page.querySelector("#history-details");
    if (!state.history) { target.innerHTML = `<div class="history-empty"><i class="fa-solid fa-bus-simple" aria-hidden="true"></i><strong>Select a bus to review its history</strong><span>Trips, stop-radius records, and driver feedback will appear here.</span></div>`; return; }
    const { bus, timeline, stop_visits: stopVisits = [], trip_legs: tripLegs = [] } = state.history;
    const events = state.type === "all" ? timeline : timeline.filter(item => item.kind === state.type);
    const completedLegs = tripLegs.filter(leg => leg.status === "Completed").length;
    target.innerHTML = `<section class="glass-panel history-section"><button type="button" class="history-back">← Choose another bus</button><div class="history-summary"><div class="history-summary-main"><span class="history-summary-icon"><i class="fa-solid fa-bus-simple" aria-hidden="true"></i></span><div><p class="eyebrow">Selected bus</p><h2>${escapeHtml(bus.bus_number)}</h2><p>${escapeHtml(bus.registration_number)} · ${escapeHtml(bus.manufacturer)} ${escapeHtml(bus.model)}</p></div></div><div class="history-summary-stat"><strong>${completedLegs}</strong><small>completed journey legs</small></div></div><h3><i class="fa-solid fa-road" aria-hidden="true"></i> Journey legs</h3>${tripLegs.length ? `<div class="portal-table-wrap"><table class="portal-table history-records" role="table"><thead><tr><th>Route</th><th>Driver</th><th>Direction</th><th>Started</th><th>Terminal</th><th>Reached terminal</th><th>Status</th></tr></thead><tbody>${tripLegs.map(tripLegMarkup).join("")}</tbody></table></div>` : `<div class="history-empty">No completed journey legs match this date range.</div>`}<h3><i class="fa-solid fa-route" aria-hidden="true"></i> Stop-by-stop movement</h3>${stopVisits.length ? `<div class="portal-table-wrap"><table class="portal-table history-records" role="table"><thead><tr><th>Trip</th><th>Stop</th><th>Entered stop radius</th><th>Exited stop radius</th><th>Time at stop</th></tr></thead><tbody>${stopVisits.map(stopVisitMarkup).join("")}</tbody></table></div>` : `<div class="history-empty">No stop movements have been recorded for these trips yet.</div>`}<h3><i class="fa-solid fa-clock-rotate-left" aria-hidden="true"></i> Stop events and driver feedback</h3><div class="history-timeline">${events.length ? events.map(eventMarkup).join("") : `<div class="history-empty">No ${state.type === "all" ? "history" : state.type} records match these filters.</div>`}</div></section>`;
}

function renderBuses(page) {
    const target = page.querySelector("#history-buses");
    const term = page.querySelector("#history-bus-search").value.trim().toLowerCase();
    const buses = state.buses.filter(bus => `${bus.bus_number} ${bus.registration_number}`.toLowerCase().includes(term));
    target.innerHTML = buses.length ? buses.map(bus => `<button type="button" class="history-bus ${bus.id === state.selectedBusId ? "is-selected" : ""}" data-bus-id="${bus.id}" aria-pressed="${bus.id === state.selectedBusId}" aria-controls="history-details"><span class="history-bus-icon"><i class="fa-solid fa-bus-simple" aria-hidden="true"></i></span><span><strong>${escapeHtml(bus.bus_number)}</strong><small>${escapeHtml(bus.registration_number)}</small><small>${bus.trip_count} trips · ${bus.feedback_count} feedback</small></span><i class="fa-solid fa-chevron-right history-bus-arrow" aria-hidden="true"></i></button>`).join("") : `<div class="history-empty">No buses found.</div>`;
}

async function selectBus(page, busId, { showLoading = true, revealDetails = false } = {}) {
    state.selectedBusId = Number(busId);
    const requestId = ++state.historyRequestId;
    const from = page.querySelector("#history-from").value;
    const to = page.querySelector("#history-to").value;
    const search = page.querySelector("#history-detail-search").value.trim();
    const query = new URLSearchParams();
    if (from) query.set("date_from", from);
    if (to) query.set("date_to", to);
    if (search) query.set("search", search);
    if (showLoading) page.querySelector("#history-details").innerHTML = `<div class="history-empty">Loading bus history…</div>`;
    const history = await request(`/trip-history/buses/${busId}?${query}`);
    if (requestId !== state.historyRequestId || !page.isConnected) return;
    state.history = history;
    renderBuses(page); renderDetails(page);
    // Only a deliberate bus selection moves the viewport, never background polling.
    if (revealDetails && window.matchMedia("(max-width: 720px)").matches) {
        const details = page.querySelector("#history-details");
        details.focus({ preventScroll: true });
        details.scrollIntoView({ block: "start", behavior: "auto" });
    }
}

export function render() {
    const page = document.createElement("section");
    page.className = "history-page";
    page.innerHTML = `<header class="portal-header history-header"><div><p class="portal-eyebrow">FLEET COMMAND CENTER</p><h1>Trip history</h1><p>Review completed journeys, exact stop-radius times, and driver feedback from one timeline.</p></div><span class="history-header-icon"><i class="fa-solid fa-clock-rotate-left" aria-hidden="true"></i></span></header><section class="glass-panel history-section history-selector"><div class="history-section-heading"><div><p class="eyebrow">Find a vehicle</p><h2>Choose a bus</h2><p>Use the filters below, then select a bus to inspect its trip record.</p></div><span id="history-bus-count" class="history-count">Loading…</span></div><div class="history-controls"><label><span>Bus</span><i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i><input id="history-bus-search" type="search" placeholder="Bus number or registration"></label><label><span>From</span><input id="history-from" type="date" aria-label="From date"></label><label><span>To</span><input id="history-to" type="date" aria-label="To date"></label><label><span>Show</span><select id="history-type" aria-label="Record type"><option value="all">All records</option><option value="stop">Stop arrivals</option><option value="feedback">Driver feedback</option></select></label><label class="history-detail-filter"><span>Search selected history</span><input id="history-detail-search" type="search" placeholder="Route, stop, or feedback"></label></div><div id="history-buses" class="history-bus-grid"><div class="history-empty">Loading buses…</div></div></section><div id="history-details" tabindex="-1" role="region" aria-label="Selected bus trip history"></div>`;
    const reload = () => state.selectedBusId && selectBus(page, state.selectedBusId).catch(error => page.querySelector("#history-details").textContent = error.message);
    const refreshSelectedBus = () => {
        if (!state.selectedBusId || !page.isConnected) return;
        selectBus(page, state.selectedBusId, { showLoading: false }).catch(() => {
            // Keep the last known history visible if a transient poll fails.
        });
    };
    const refreshWhenVisible = () => {
        if (document.visibilityState === "visible") refreshSelectedBus();
    };
    page.querySelector("#history-bus-search").addEventListener("input", () => renderBuses(page));
    page.querySelector("#history-type").addEventListener("change", event => { state.type = event.target.value; renderDetails(page); });
    page.querySelector("#history-from").addEventListener("change", reload);
    page.querySelector("#history-to").addEventListener("change", reload);
    page.querySelector("#history-detail-search").addEventListener("change", reload);
    page.querySelector("#history-buses").addEventListener("click", event => { const button = event.target.closest("[data-bus-id]"); if (button) selectBus(page, button.dataset.busId, { revealDetails: true }).catch(error => page.querySelector("#history-details").textContent = error.message); });
    request("/trip-history/buses").then(buses => { state.buses = buses; page.querySelector("#history-bus-count").textContent = `${buses.length} buses`; renderBuses(page); }).catch(error => { page.querySelector("#history-buses").textContent = error.message; });
    page.querySelector("#history-details").addEventListener("click", event => {
        if (!event.target.closest(".history-back")) return;
        const selected = page.querySelector(`.history-bus[data-bus-id="${state.selectedBusId}"]`);
        const destination = selected || page.querySelector("#history-bus-search");
        destination.focus({ preventScroll: true });
        destination.scrollIntoView({ block: "center", behavior: "auto" });
    });
    const refreshTimer = window.setInterval(refreshSelectedBus, HISTORY_REFRESH_INTERVAL_MS);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    page.cleanup = () => {
        window.clearInterval(refreshTimer);
        document.removeEventListener("visibilitychange", refreshWhenVisible);
        state.historyRequestId += 1;
    };
    return page;
}
