/** Stop-by-stop fleet progress from the same live feed as the admin map. */
import { escapeHtml } from "/static/common/security.js";

const busOrder = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
const assignedRoutes = new Map();
let routesLoadedAt = 0;
let routesRequest = null;
let lastTrips = [];
let lastBuses = [];
let routeLoadVersion = 0;

async function loadWaitingBusRoutes() {
    if (routesRequest || Date.now() - routesLoadedAt < 300_000 || typeof fetch !== "function") return;
    const version = routeLoadVersion;
    routesRequest = (async () => {
        const response = await fetch("/api/routes", { credentials: "same-origin" });
        if (!response.ok) throw new Error("Assigned routes unavailable");
        const routes = await response.json();
        if (!Array.isArray(routes)) throw new Error("Invalid assigned routes");
        const assigned = routes.filter(route => route.bus_id != null);
        const loaded = await Promise.all(assigned.map(async route => {
            const stopsResponse = await fetch(`/api/route-stops/${encodeURIComponent(route.id)}`, {
                credentials: "same-origin",
            });
            if (!stopsResponse.ok) return { route, stops: [] };
            const stops = await stopsResponse.json();
            return { route, stops: Array.isArray(stops) ? stops.map((stop, index) => ({
                ...stop, sequence: index + 1, tracking_status: "pending",
            })) : [] };
        }));
        if (version !== routeLoadVersion) return;
        assignedRoutes.clear();
        for (const { route, stops } of loaded) {
            assignedRoutes.set(String(route.bus_id), { ...route, stops });
        }
        routesLoadedAt = Date.now();
        renderFleetTrackUpdates(lastTrips, lastBuses);
    })().catch(() => {
        if (version === routeLoadVersion) routesLoadedAt = Date.now() - 240_000;
    }).finally(() => {
        if (version === routeLoadVersion) routesRequest = null;
    });
}

function displayTime(value) {
    if (!value) return "No location update yet";
    const time = new Date(value);
    return Number.isFinite(time.getTime()) ? time.toLocaleString() : "No location update yet";
}

function displayAge(seconds) {
    if (seconds == null || !Number.isFinite(Number(seconds))) return "Age unknown";
    const age = Math.max(0, Math.round(Number(seconds)));
    if (age < 60) return `${age}s ago`;
    if (age < 3600) return `${Math.floor(age / 60)}m ago`;
    return `${Math.floor(age / 3600)}h ${Math.floor((age % 3600) / 60)}m ago`;
}

function trackingSource(trip) {
    if (!trip) return { time: null, label: "No GPS report", freshness: null };
    if (trip.location_source === "vehicle_gps" || !trip.is_active_trip) {
        return {
            time: trip.provider_gps?.effective_time || trip.last_location_update,
            label: trip.provider_gps?.protocol ? `${trip.provider_gps.protocol} GPS` : "Vehicle GPS",
            freshness: trip.provider_gps || trip.gps_freshness,
        };
    }
    return {
        time: trip.last_location_update,
        label: "Driver phone",
        freshness: trip.gps_freshness,
    };
}

function fleetRows(trips, buses) {
    const rows = new Map();
    for (const bus of buses) rows.set(String(bus.id), { bus, trip: null });
    for (const trip of trips) {
        if (trip.bus_id == null) continue;
        const key = String(trip.bus_id);
        const row = rows.get(key) || { bus: null, trip: null };
        if (!row.trip || (trip.is_active_trip && !row.trip.is_active_trip)) row.trip = trip;
        rows.set(key, row);
    }
    return [...rows.entries()].sort((a, b) => {
        const label = row => row[1].bus?.bus_number || row[1].trip?.bus_number || `BUS-${row[0]}`;
        return busOrder.compare(label(a), label(b));
    });
}

const stopLabels = {
    completed: "Passed",
    skipped: "Skipped",
    reached: "Reached",
    approaching: "Approaching",
    terminal_completed: "Trip completed",
    pending: "Upcoming",
};

function renderTimeline(stops) {
    if (!Array.isArray(stops) || !stops.length) {
        return '<p class="track-route-empty">Route stops are not configured or available.</p>';
    }
    return `<ol class="fleet-route-timeline" aria-label="Live route stop progress" tabindex="0">${stops.map(stop => {
        const status = Object.hasOwn(stopLabels, stop.tracking_status) ? stop.tracking_status : "pending";
        return `<li class="fleet-route-stop ${status}">
            <span class="fleet-route-marker" aria-hidden="true">${status === "completed" || status === "terminal_completed" ? "✓" : status === "skipped" ? "↷" : status === "reached" || status === "approaching" ? "●" : "○"}</span>
            <div class="fleet-route-stop-copy"><small>STOP ${escapeHtml(stop.sequence)}</small>
                <strong>${escapeHtml(stop.stop_name || "Unnamed stop")}</strong>
                ${stop.stop_code ? `<span>${escapeHtml(stop.stop_code)}</span>` : ""}</div>
            <span class="fleet-route-stop-status">${stopLabels[status]}</span>
        </li>`;
    }).join("")}</ol>`;
}

function renderBus(id, bus, trip) {
    const source = trackingSource(trip);
    const assignment = assignedRoutes.get(id);
    const stops = trip?.route_stops || assignment?.stops;
    const current = Array.isArray(stops)
        ? stops.find(stop => ["reached", "approaching", "terminal_completed"].includes(stop.tracking_status))
        : null;
    const next = Array.isArray(stops) && current
        ? stops.find(stop => Number(stop.sequence) === Number(current.sequence) + 1)
        : null;
    const active = trip?.is_active_trip === true;
    const status = trip?.reset_waiting_for_start ? "Waiting for route restart"
        : current ? stopLabels[current.tracking_status]
        : active ? "Waiting for first route stop"
        : "Route not running";
    const route = trip?.route_name || trip?.route_code || assignment?.route_name || bus?.route || "No route assigned";
    const direction = active ? (trip.route_direction === "reverse" ? "Return journey" : "Outbound journey") : "No active trip";
    const freshness = !source.time ? "No GPS report"
        : source.freshness?.is_fresh === true ? `GPS fresh · ${displayAge(source.freshness.age_seconds)}`
        : `GPS delayed · ${displayAge(source.freshness?.age_seconds)}`;
    const eta = active && next && trip?.next_stop_eta_minutes != null
        && Number.isFinite(Number(trip.next_stop_eta_minutes))
        ? ` · Next stop ETA ${Math.max(0, Math.round(Number(trip.next_stop_eta_minutes)))} min`
        : "";
    return `<article class="track-update-card ${active ? "running" : "waiting"}" data-bus-id="${escapeHtml(id)}">
        <div class="track-update-heading"><div><strong>${escapeHtml(bus?.bus_number || trip?.bus_number || `BUS-${id}`)}</strong>
            <span>${escapeHtml(bus?.registration_number || trip?.registration_number || "Registration not set")}</span></div>
            <span class="track-update-status">${escapeHtml(status)}</span></div>
        <div class="track-route-heading"><div><small>ROUTE PROGRESS · ${escapeHtml(direction)}</small>
            <h3>${escapeHtml(route)}</h3></div></div>
        <p class="track-route-live">${escapeHtml(current ? `${stopLabels[current.tracking_status]} ${current.stop_name}` : "No stop reached yet")}${escapeHtml(eta)}</p>
        ${renderTimeline(stops)}
        <p class="track-route-telemetry">${escapeHtml(freshness)} · ${escapeHtml(source.label)} · Updated ${escapeHtml(displayTime(source.time))}</p>
    </article>`;
}

export function renderFleetTrackUpdates(trips = [], buses = []) {
    const panel = document.getElementById("fleetTrackUpdates");
    if (!panel) return;
    const scrollPositions = new Map();
    for (const card of panel.querySelectorAll?.(".track-update-card") || []) {
        scrollPositions.set(card.dataset.busId, card.querySelector(".fleet-route-timeline")?.scrollTop || 0);
    }
    lastTrips = Array.isArray(trips) ? trips : [];
    lastBuses = Array.isArray(buses) ? buses : [];
    const rows = fleetRows(lastTrips, lastBuses);
    const running = rows.filter(([, row]) => row.trip?.is_active_trip).length;
    const progressing = rows.filter(([, row]) => row.trip?.route_stops?.some(
        stop => ["reached", "approaching", "terminal_completed"].includes(stop.tracking_status)
    )).length;
    panel.innerHTML = `<div class="track-monitor-heading"><div><p class="tracking-title">LIVE ROUTE PROGRESS</p>
        <h2>Every bus, stop by stop</h2><p>Route progress comes from the live GPS trip state. Each bus updates here as its route stops advance.</p></div></div>
        <p class="track-monitor-checked">Live feed checked ${escapeHtml(new Date().toLocaleTimeString())}</p>
        <div class="track-monitor-summary" aria-label="Fleet route progress summary">
            <span><strong>${rows.length}</strong> registered buses</span>
            <span><strong>${running}</strong> routes running</span>
            <span><strong>${progressing}</strong> showing stop progress</span>
        </div>
        <div class="track-update-grid">${rows.map(([id, { bus, trip }]) => renderBus(id, bus, trip)).join("")
            || '<p class="empty-state">No buses are registered yet.</p>'}</div>`;
    for (const card of panel.querySelectorAll?.(".track-update-card") || []) {
        const timeline = card.querySelector(".fleet-route-timeline");
        if (timeline) timeline.scrollTop = scrollPositions.get(card.dataset.busId) || 0;
    }
    if (rows.some(([, row]) => !row.trip)) void loadWaitingBusRoutes();
}

export function reportFleetTrackFeedError(message) {
    const panel = document.getElementById("fleetTrackUpdates");
    if (!panel) return;
    const notice = panel.querySelector(".track-monitor-checked");
    if (notice) {
        notice.textContent = message;
        notice.classList.add("error");
    } else {
        panel.innerHTML = `<p class="track-monitor-checked error">${escapeHtml(message)}</p>`;
    }
}

export function resetFleetTrackUpdates() {
    routeLoadVersion += 1;
    assignedRoutes.clear();
    routesLoadedAt = 0;
    routesRequest = null;
    lastTrips = [];
    lastBuses = [];
}
