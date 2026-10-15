/** Read-only fleet update monitor fed by the existing admin live stream. */
import { escapeHtml } from "/static/common/security.js";

const observed = new Map();
const busOrder = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function validTime(value) {
    if (!value) return null;
    const time = new Date(value).getTime();
    return Number.isFinite(time) ? time : null;
}

function displayTime(value) {
    const time = validTime(value);
    return time === null ? "No track update yet" : new Date(time).toLocaleString();
}

function displayAge(seconds) {
    if (seconds == null || !Number.isFinite(Number(seconds))) return "Age unknown";
    const age = Math.max(0, Math.round(Number(seconds)));
    if (age < 60) return `${age}s ago`;
    if (age < 3600) return `${Math.floor(age / 60)}m ago`;
    return `${Math.floor(age / 3600)}h ${Math.floor((age % 3600) / 60)}m ago`;
}

function trackedSource(trip) {
    const provider = trip?.provider_gps;
    if (provider) {
        return {
            time: provider.effective_time,
            received: provider.received_at,
            source: provider.protocol ? `${provider.protocol} GPS` : "Vehicle GPS",
            freshness: provider,
        };
    }
    return {
        time: trip?.last_location_update,
        received: null,
        source: trip?.location_source === "mobile" ? "Driver phone" : "Live tracking",
        freshness: trip?.gps_freshness,
    };
}

function fleetRows(trips, buses) {
    const rows = new Map();
    for (const bus of buses) {
        rows.set(String(bus.id), { bus, trip: null });
    }
    for (const trip of trips) {
        if (trip.bus_id == null) continue;
        const key = String(trip.bus_id);
        const row = rows.get(key) || { bus: null, trip: null };
        if (!row.trip || (validTime(trackedSource(trip).time) || 0) >
            (validTime(trackedSource(row.trip).time) || 0)) {
            row.trip = trip;
        }
        rows.set(key, row);
    }
    return [...rows.entries()].sort((a, b) => {
        const label = row => row[1].bus?.bus_number || row[1].trip?.bus_number || `BUS-${row[0]}`;
        return busOrder.compare(label(a), label(b));
    });
}

export function renderFleetTrackUpdates(trips = [], buses = []) {
    const panel = document.getElementById("fleetTrackUpdates");
    if (!panel) return;

    const rows = fleetRows(Array.isArray(trips) ? trips : [], Array.isArray(buses) ? buses : []);
    const currentIds = new Set(rows.map(([id]) => id));
    for (const id of observed.keys()) {
        if (!currentIds.has(id)) observed.delete(id);
    }
    let fresh = 0;
    let stale = 0;
    let waiting = 0;
    let advanced = 0;

    const cards = rows.map(([id, { bus, trip }]) => {
        const source = trackedSource(trip);
        const time = validTime(source.time);
        const previous = observed.get(id);
        const record = previous || { latest: null, changes: 0, lastSeenChange: null };
        if (time === null) {
            record.latest = null;
            record.changes = 0;
            record.lastSeenChange = null;
        }
        if (previous && time !== null && (record.latest === null || time > record.latest)) {
            record.changes += 1;
            record.lastSeenChange = new Date().toISOString();
        }
        if (time !== null && (record.latest === null || time > record.latest)) {
            record.latest = time;
        }
        observed.set(id, record);

        const state = record.latest === null ? "waiting" : source.freshness?.is_fresh === true
            ? "fresh" : "stale";
        if (state === "fresh") fresh += 1;
        else if (state === "stale") stale += 1;
        else waiting += 1;
        if (record.changes > 0) advanced += 1;

        const name = bus?.bus_number || trip?.bus_number || `BUS-${id}`;
        const registration = bus?.registration_number || trip?.registration_number || "Registration not set";
        const route = trip?.route_name || trip?.route_code || "No active route";
        const stateLabel = state === "fresh" ? "GPS fresh" : state === "stale" ? "GPS stale" : "Waiting for GPS";
        const age = state === "waiting" ? "No accepted fix"
            : displayAge(time !== null && time >= record.latest
                ? source.freshness?.age_seconds
                : (Date.now() - record.latest) / 1000);

        return `<article class="track-update-card ${state}" data-bus-id="${escapeHtml(id)}">
            <div class="track-update-heading"><div><strong>${escapeHtml(name)}</strong><span>${escapeHtml(registration)}</span></div>
                <span class="track-update-status">${stateLabel}</span></div>
            <p class="track-update-route">${escapeHtml(route)}</p>
            <dl class="track-update-details">
                <div><dt>Latest track update</dt><dd>${escapeHtml(displayTime(record.latest))}</dd></div>
                <div><dt>GPS freshness</dt><dd>${escapeHtml(age)}</dd></div>
                <div><dt>Track source</dt><dd>${escapeHtml(state === "waiting" ? "No report" : source.source)}</dd></div>
                <div><dt>Provider contact</dt><dd>${escapeHtml(source.received ? displayTime(source.received) : "Not available")}</dd></div>
                <div><dt>New updates seen here</dt><dd>${record.changes}</dd></div>
                <div><dt>Last change seen here</dt><dd>${escapeHtml(record.lastSeenChange ? displayTime(record.lastSeenChange) : "Waiting for next update")}</dd></div>
            </dl>
        </article>`;
    });

    panel.innerHTML = `<div class="track-monitor-heading"><div><p class="tracking-title">LIVE TRACK UPDATE CHECK</p>
        <h2>Every bus, one update view</h2><p>New updates count when an accepted tracking time advances while this page is open. Provider contact alone does not count as a new track fix.</p></div></div>
        <p class="track-monitor-checked">Live feed checked ${escapeHtml(new Date().toLocaleTimeString())}</p>
        <div class="track-monitor-summary" aria-label="Fleet tracking update summary">
            <span><strong>${rows.length}</strong> registered</span><span><strong>${fresh}</strong> fresh</span>
            <span><strong>${stale}</strong> stale</span><span><strong>${waiting}</strong> waiting</span>
            <span><strong>${advanced}</strong> advanced here</span>
        </div>
        <div class="track-update-grid">${cards.join("") || '<p class="empty-state">No buses are registered yet.</p>'}</div>`;
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
    observed.clear();
}
