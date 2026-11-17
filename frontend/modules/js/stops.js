import * as StopsAPI from "./stopsApi.js?v=20261117busstops1";
import { Modal } from "/static/common/modal.js";
import { escapeHtml as esc } from "/static/common/security.js";

const PAGE_SIZE = 6;

function routeStops(route) {
    return Array.isArray(route?.stops)
        ? [...route.stops].sort((left, right) => left.sequence - right.sequence || left.route_stop_id - right.route_stop_id)
        : [];
}

function routeMarkup(route, bus, unassigned = false) {
    const stops = routeStops(route);
    return `
        <section class="bus-stop-route">
            <header class="bus-stop-route__header">
                <div><span class="route-code">${esc(route.route_code)}</span><h3>${esc(route.route_name)}</h3></div>
                <div class="bus-stop-route__meta">
                    ${unassigned ? '<span class="stop-route-state is-waiting">Awaiting bus assignment</span>' : ""}
                    <span>${stops.length} stop${stops.length === 1 ? "" : "s"}</span>
                </div>
            </header>
            ${stops.length ? `
                <ol class="ordered-stop-list" aria-label="Stops for ${esc(route.route_name)}">
                    ${stops.map(stop => `
                        <li class="ordered-stop" data-route-stop-id="${stop.route_stop_id}">
                            <div class="ordered-stop__rail" aria-hidden="true"><span>${stop.sequence}</span></div>
                            <div class="ordered-stop__identity">
                                <strong>${esc(stop.stop_name)}</strong>
                                <span>${esc(stop.stop_code)} · ${esc(stop.radius)} m geofence</span>
                            </div>
                            <div class="ordered-stop__location">
                                ${stop.latitude == null || stop.longitude == null
                                    ? '<span class="stop-location-missing">Location not set</span>'
                                    : `<span>${Number(stop.latitude).toFixed(5)}, ${Number(stop.longitude).toFixed(5)}</span>`}
                                <small>${esc(stop.status)}</small>
                            </div>
                            <div class="ordered-stop__actions">
                                <button type="button" data-action="view" data-route-stop-id="${stop.route_stop_id}">View</button>
                                <button type="button" data-action="edit" data-route-stop-id="${stop.route_stop_id}">Edit</button>
                                <button type="button" class="is-danger" data-action="remove" data-route-stop-id="${stop.route_stop_id}">Delete</button>
                            </div>
                        </li>`).join("")}
                </ol>` : `
                <div class="bus-stop-route__empty">
                    <strong>No stops saved for this route</strong>
                    <span>Add stops from Maintain route, then they will appear here in order.</span>
                </div>`}
        </section>`;
}

function busMarkup(bus) {
    const routes = Array.isArray(bus.routes) ? bus.routes : [];
    const stopCount = routes.reduce((total, route) => total + routeStops(route).length, 0);
    return `
        <article class="bus-stop-card glass-panel" data-bus-id="${bus.id}">
            <header class="bus-stop-card__header">
                <div class="bus-stop-card__icon" aria-hidden="true">🚌</div>
                <div class="bus-stop-card__identity"><span>BUS</span><h2>${esc(bus.bus_number)}</h2><p>${esc(bus.registration_number || "Registration unavailable")}</p></div>
                <div class="bus-stop-card__summary"><span class="bus-status">${esc(bus.status)}</span><strong>${stopCount}</strong><small>ordered stops</small></div>
            </header>
            <div class="bus-stop-card__routes">
                ${routes.length
                    ? routes.map(route => routeMarkup(route, bus)).join("")
                    : `<div class="bus-without-route"><strong>No route assigned</strong><span>Assign a route to ${esc(bus.bus_number)} in Assignments to show its ordered stops.</span></div>`}
            </div>
        </article>`;
}

function findStopContext(data, routeStopId) {
    for (const bus of data.buses || []) {
        for (const route of bus.routes || []) {
            const stop = routeStops(route).find(item => item.route_stop_id === routeStopId);
            if (stop) return { stop, route, bus };
        }
    }
    for (const route of data.unassigned_routes || []) {
        const stop = routeStops(route).find(item => item.route_stop_id === routeStopId);
        if (stop) return { stop, route, bus: null };
    }
    return null;
}

function stopDetailContent({ stop, route, bus }) {
    const locationReady = Number.isFinite(Number(stop.latitude)) && Number.isFinite(Number(stop.longitude));
    const mapUrl = locationReady
        ? `https://www.openstreetmap.org/?mlat=${encodeURIComponent(stop.latitude)}&mlon=${encodeURIComponent(stop.longitude)}#map=18/${encodeURIComponent(stop.latitude)}/${encodeURIComponent(stop.longitude)}`
        : null;
    const shared = Number(stop.route_usage_count) > 1;
    const content = document.createElement("div");
    content.className = "stop-detail";
    content.innerHTML = `
        <div class="stop-detail__route"><span>${bus ? esc(bus.bus_number) : "Unassigned route"}</span><strong>${esc(route.route_name)}</strong><small>Stop ${esc(stop.sequence)} of ${routeStops(route).length}</small></div>
        <dl class="stop-detail__grid">
            <div><dt>Stop code</dt><dd>${esc(stop.stop_code)}</dd></div><div><dt>Status</dt><dd>${esc(stop.status)}</dd></div>
            <div><dt>Geofence</dt><dd>${esc(stop.radius)} metres</dd></div><div><dt>Used by</dt><dd>${esc(stop.route_usage_count)} route${Number(stop.route_usage_count) === 1 ? "" : "s"}</dd></div>
            <div><dt>Latitude</dt><dd>${stop.latitude == null ? "Not set" : esc(stop.latitude)}</dd></div><div><dt>Longitude</dt><dd>${stop.longitude == null ? "Not set" : esc(stop.longitude)}</dd></div>
        </dl>
        ${shared ? '<p class="stop-shared-note">This is a shared master stop. Editing it updates every route that uses it.</p>' : ""}
        ${mapUrl ? `<a class="stop-map-link" href="${mapUrl}" target="_blank" rel="noopener noreferrer">View exact location on map ↗</a>` : '<p class="stop-location-missing">This stop does not have a map location yet.</p>'}`;
    return content;
}

function editStop(context, reload) {
    const { stop } = context;
    const content = document.createElement("form");
    content.className = "stop-edit-form";
    content.innerHTML = `
        <p class="stop-form-note">Stop code <strong>${esc(stop.stop_code)}</strong> stays unchanged. This stop is used by ${esc(stop.route_usage_count)} route${Number(stop.route_usage_count) === 1 ? "" : "s"}.</p>
        <label><span>Stop name</span><input name="stop_name" maxlength="150" required value="${esc(stop.stop_name)}"></label>
        <div class="stop-edit-form__row"><label><span>Latitude</span><input name="latitude" type="number" min="-90" max="90" step="any" value="${stop.latitude ?? ""}"></label><label><span>Longitude</span><input name="longitude" type="number" min="-180" max="180" step="any" value="${stop.longitude ?? ""}"></label></div>
        <div class="stop-edit-form__row"><label><span>Geofence radius</span><div class="stop-radius-field"><input name="radius" type="number" min="10" max="1000" step="10" required value="${esc(stop.radius)}"><b>m</b></div></label><label><span>Status</span><select name="status"><option value="Active"${stop.status === "Active" ? " selected" : ""}>Active</option><option value="Inactive"${stop.status === "Inactive" ? " selected" : ""}>Inactive</option></select></label></div>`;
    Modal.open({
        eyebrow: "EDIT MASTER STOP", title: stop.stop_name, subtitle: "Update its name, location, status, or geofence.", size: "lg", content,
        actions: [
            { text: "Cancel", style: "secondary", close: true },
            { text: "Save changes", onClick: async () => {
                const form = new FormData(content);
                const stopName = String(form.get("stop_name") || "").trim();
                const latitudeText = String(form.get("latitude") || "").trim();
                const longitudeText = String(form.get("longitude") || "").trim();
                const radius = Number(form.get("radius"));
                if (!stopName) throw new Error("Enter a stop name.");
                if ((latitudeText === "") !== (longitudeText === "")) throw new Error("Set both latitude and longitude, or leave both empty.");
                if (!Number.isInteger(radius) || radius < 10 || radius > 1000) throw new Error("Geofence radius must be a whole number from 10 to 1000 metres.");
                await StopsAPI.updateStop(stop.id, { stop_name: stopName, latitude: latitudeText === "" ? null : Number(latitudeText), longitude: longitudeText === "" ? null : Number(longitudeText), radius, status: String(form.get("status") || "Active") });
                Modal.close(); await reload(); Modal.success({ title: "Stop updated", subtitle: `${stopName} has been saved everywhere it is used.` });
            }}
        ]
    });
}

function viewStop(context, reload) {
    const { stop, route } = context;
    Modal.open({ eyebrow: "ORDERED STOP", title: stop.stop_name, subtitle: `${route.route_code} · stop ${stop.sequence}`, size: "lg", content: stopDetailContent(context), actions: [
        { text: "Close", style: "secondary", close: true },
        { text: "Edit stop", onClick: () => { Modal.close(); editStop(context, reload); } }
    ]});
}

function removeStop(context, reload) {
    const { stop, route, bus } = context;
    Modal.confirm({ eyebrow: "ROUTE STOP", title: "Delete this stop from the route?", subtitle: `${stop.stop_name} will be removed from ${route.route_name}.`,
        content: `<p>The remaining stops will be reordered automatically. The master stop and any other routes using it will not be deleted.</p><p><strong>${bus ? esc(bus.bus_number) : "Unassigned route"}</strong> · ${esc(route.route_code)} · stop ${esc(stop.sequence)}</p>`,
        confirmText: "Delete from route", cancelText: "Keep stop", danger: true,
        onConfirm: async () => { await StopsAPI.removeRouteStop(stop.route_stop_id); Modal.close(); await reload(); Modal.success({ title: "Stop removed", subtitle: `${stop.stop_name} was removed and the route order was updated.` }); }
    });
}

export function render() {
    const root = document.createElement("section");
    root.className = "stops-page bus-stops-workspace";
    root.innerHTML = `
        <header class="bus-stops-hero glass-panel"><div><p>FLEET ROUTE DIRECTORY</p><h1>Stops by bus</h1><span>Open any bus to see its route stops in the exact travel order.</span></div><button type="button" data-action="refresh">Refresh</button></header>
        <section class="bus-stops-stats"><div class="glass-panel"><span>Total buses</span><strong data-stat="buses">0</strong></div><div class="glass-panel"><span>Buses with routes</span><strong data-stat="assigned">0</strong></div><div class="glass-panel"><span>Routes with stops</span><strong data-stat="routes">0</strong></div><div class="glass-panel"><span>Ordered stop entries</span><strong data-stat="stops">0</strong></div></section>
        <section class="bus-stops-toolbar glass-panel"><label class="bus-stops-search"><span>Search</span><input type="search" placeholder="Bus, route, stop name or stop code" aria-label="Search buses and stops"></label><label><span>Show</span><select aria-label="Filter buses"><option value="all">All buses</option><option value="assigned">Buses with routes</option><option value="empty">Buses without routes</option></select></label></section>
        <p class="bus-stops-status" role="status">Loading buses and ordered stops…</p><div class="bus-stop-list" aria-live="polite"></div><nav class="bus-stops-pagination" aria-label="Bus pages"></nav>
        <section class="unassigned-route-section" hidden><header><p>ROUTES AWAITING ASSIGNMENT</p><h2>Not attached to a bus</h2><span>These stops are ready, but the route still needs a bus in Assignments.</span></header><div class="unassigned-route-list"></div></section>`;
    const state = { data: { buses: [], unassigned_routes: [], statistics: {} }, page: 1, query: "", filter: "all", request: 0 };
    const status = message => { root.querySelector(".bus-stops-status").textContent = message; };

    function matches(bus) {
        const routes = bus.routes || [];
        if (state.filter === "assigned" && routes.length === 0) return false;
        if (state.filter === "empty" && routes.length > 0) return false;
        if (!state.query) return true;
        return [bus.bus_number, bus.registration_number, bus.status, ...routes.flatMap(route => [route.route_code, route.route_name, ...routeStops(route).flatMap(stop => [stop.stop_code, stop.stop_name])])].filter(Boolean).join(" ").toLowerCase().includes(state.query);
    }
    function draw() {
        const buses = (state.data.buses || []).filter(matches);
        const totalPages = Math.max(1, Math.ceil(buses.length / PAGE_SIZE));
        state.page = Math.min(state.page, totalPages);
        const start = (state.page - 1) * PAGE_SIZE;
        root.querySelector(".bus-stop-list").innerHTML = buses.length ? buses.slice(start, start + PAGE_SIZE).map(busMarkup).join("") : '<div class="bus-stops-empty glass-panel"><strong>No buses match this view</strong><span>Clear the search or choose another filter.</span></div>';
        root.querySelector(".bus-stops-pagination").innerHTML = totalPages > 1 ? `<button type="button" data-page="${state.page - 1}"${state.page === 1 ? " disabled" : ""}>Previous</button><span>Page ${state.page} of ${totalPages}</span><button type="button" data-page="${state.page + 1}"${state.page === totalPages ? " disabled" : ""}>Next</button>` : "";
        const unassigned = state.data.unassigned_routes || [];
        const section = root.querySelector(".unassigned-route-section");
        section.hidden = !unassigned.length || state.filter !== "all" || Boolean(state.query);
        root.querySelector(".unassigned-route-list").innerHTML = unassigned.map(route => routeMarkup(route, null, true)).join("");
    }
    async function load() {
        const request = ++state.request; status("Loading buses and ordered stops…");
        try {
            const data = await StopsAPI.getBusRouteStops();
            if (request !== state.request || !root.isConnected) return;
            state.data = data; const stats = data.statistics || {};
            root.querySelector('[data-stat="buses"]').textContent = stats.total_buses ?? 0; root.querySelector('[data-stat="assigned"]').textContent = stats.assigned_buses ?? 0;
            root.querySelector('[data-stat="routes"]').textContent = stats.routes_with_stops ?? 0; root.querySelector('[data-stat="stops"]').textContent = stats.ordered_stop_entries ?? 0;
            status("Every bus is shown with its assigned route stops in order."); draw();
        } catch (error) {
            if (request !== state.request || !root.isConnected) return;
            status(error.message); root.querySelector(".bus-stop-list").innerHTML = `<div class="bus-stops-empty is-error glass-panel"><strong>Stops unavailable</strong><span>${esc(error.message)}</span><button type="button" data-action="refresh">Try again</button></div>`;
        }
    }
    root.addEventListener("input", event => { if (event.target.matches('input[type="search"]')) { state.query = event.target.value.trim().toLowerCase(); state.page = 1; draw(); } });
    root.addEventListener("change", event => { if (event.target.matches("select[aria-label='Filter buses']")) { state.filter = event.target.value; state.page = 1; draw(); } });
    root.addEventListener("click", event => {
        const button = event.target.closest("button"); if (!button) return;
        if (button.dataset.page) { state.page = Number(button.dataset.page); draw(); root.querySelector(".bus-stops-toolbar").scrollIntoView({ behavior: "smooth", block: "start" }); return; }
        if (button.dataset.action === "refresh") { load(); return; }
        const routeStopId = Number(button.dataset.routeStopId); if (!routeStopId) return;
        const context = findStopContext(state.data, routeStopId); if (!context) { Modal.error({ title: "Stop unavailable", subtitle: "Refresh the page and try again." }); return; }
        if (button.dataset.action === "view") viewStop(context, load); if (button.dataset.action === "edit") editStop(context, load); if (button.dataset.action === "remove") removeStop(context, load);
    });
    load();
    return root;
}
