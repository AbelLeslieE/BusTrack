/** Stop-by-stop fleet progress from the same live feed as the admin map. */
import { escapeHtml } from "/static/common/security.js";
import { request } from "/static/common/api.js";
import { Modal } from "/static/common/modal.js";

const busOrder = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
const assignedRoutes = new Map();
let routesLoadedAt = 0;
let routesRequest = null;
let lastTrips = [];
let lastBuses = [];
let routeLoadVersion = 0;
let resetDialogBusId = null;
let refreshFleet = null;
const boundPanels = new WeakSet();

export function setFleetTrackRefreshHandler(handler) {
    refreshFleet = handler;
}

function resetRequestId() {
    if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function openForwardReset(busId) {
    if (resetDialogBusId !== null) return;
    resetDialogBusId = busId;
    try {
        const options = await request(
            `/integrations/gps/provider-health/buses/${busId}/reset-options`,
            { cache: "no-store" },
        );
        const firstStop = options.starts?.forward?.name;
        if (!firstStop) throw new Error("This route has no first stop to reset to.");
        const requestId = resetRequestId();
        let submitting = false;
        Modal.form({
            eyebrow: "LIVE ROUTE CONTROL",
            title: `Reset ${options.bus_number} to first stop?`,
            subtitle: options.route_name,
            size: "sm",
            submitText: "Reset forward route",
            content: `<p>Direction: <strong>Forward (outbound)</strong></p>
                <p>Starting stop: <strong>${escapeHtml(firstStop)}</strong></p>
                <p>Only this bus's current stop progress will reset. Its real GPS position and journey history stay available. A fresh GPS fix at this or a later stop resumes progress.</p>
                <p id="fleet-route-reset-error" role="alert"></p>`,
            onClose: () => { resetDialogBusId = null; },
            onSubmit: async () => {
                if (submitting) return;
                submitting = true;
                try {
                    const result = await request(
                        `/integrations/gps/provider-health/buses/${busId}/reset`,
                        { method: "POST", body: JSON.stringify({
                            direction: "forward",
                            trip_id: options.trip_id,
                            expected_reset_version: options.reset_version,
                            request_id: requestId,
                        }) },
                    );
                    Modal.close();
                    await refreshFleet?.();
                    Modal.success({ title: "Route reset", subtitle: result.message });
                } catch (error) {
                    const message = document.getElementById("fleet-route-reset-error");
                    if (message) message.textContent = error.message;
                } finally {
                    submitting = false;
                }
            },
        });
    } catch (error) {
        resetDialogBusId = null;
        Modal.error({ title: "Unable to reset route", subtitle: error.message });
    }
}

function bindResetButtons(panel) {
    if (boundPanels.has(panel)) return;
    panel.addEventListener("click", event => {
        const button = event.target.closest?.("[data-reset-route-bus]");
        if (!button || button.disabled || !panel.contains(button)) return;
        void openForwardReset(Number(button.dataset.resetRouteBus));
    });
    boundPanels.add(panel);
}

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
    const status = trip?.reset_waiting_for_start ? "Waiting for fresh GPS"
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
    const canReset = active && trip?.trip_id != null && Array.isArray(stops) && stops.length > 0;
    return `<article class="track-update-card ${active ? "running" : "waiting"}" data-bus-id="${escapeHtml(id)}">
        <div class="track-update-heading"><div><strong>${escapeHtml(bus?.bus_number || trip?.bus_number || `BUS-${id}`)}</strong>
            <span>${escapeHtml(bus?.registration_number || trip?.registration_number || "Registration not set")}</span></div>
            <span class="track-update-status">${escapeHtml(status)}</span></div>
        <div class="track-route-heading"><div><small>ROUTE PROGRESS · ${escapeHtml(direction)}</small>
            <h3>${escapeHtml(route)}</h3></div></div>
        <p class="track-route-live">${escapeHtml(current ? `${stopLabels[current.tracking_status]} ${current.stop_name}` : "No stop reached yet")}${escapeHtml(eta)}</p>
        <button class="track-route-reset" type="button" data-reset-route-bus="${escapeHtml(id)}"
            ${canReset ? "" : 'disabled title="A running route with saved stops is required"'}>Reset to first stop</button>
        ${renderTimeline(stops)}
        <p class="track-route-telemetry">${escapeHtml(freshness)} · ${escapeHtml(source.label)} · Updated ${escapeHtml(displayTime(source.time))}</p>
    </article>`;
}

export function renderFleetTrackUpdates(trips = [], buses = []) {
    const panel = document.getElementById("fleetTrackUpdates");
    if (!panel) return;
    bindResetButtons(panel);
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
    refreshFleet = null;
}
