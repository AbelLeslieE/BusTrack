import { request } from "/static/common/api.js";
import { Modal } from "/static/common/modal.js";
import { escapeHtml } from "/static/common/security.js";

const state = {
    health: null,
    positions: [],
    selectedBusId: "",
    loading: true,
    refreshing: false,
    changingDirectionBusId: null,
    resettingBusId: null,
    refreshRequestId: 0,
    lastRefreshError: "",
};

let page = null;
let refreshTimer = null;

function formatDate(value) {
    if (!value) return "Never";
    const date = new Date(value);
    return Number.isNaN(date.getTime())
        ? "Invalid timestamp"
        : new Intl.DateTimeFormat(undefined, {
            dateStyle: "medium",
            timeStyle: "medium",
        }).format(date);
}

function formatAge(seconds) {
    if (seconds === null || seconds === undefined) return "Unknown";
    const value = Math.max(0, Number(seconds) || 0);
    if (value < 60) return `${Math.round(value)} sec`;
    if (value < 3600) return `${Math.floor(value / 60)} min ${Math.round(value % 60)} sec`;
    return `${Math.floor(value / 3600)} hr ${Math.floor((value % 3600) / 60)} min`;
}

function statusLabel(value) {
    return {
        healthy: "Healthy",
        delayed: "Provider delayed",
        clock_error: "Invalid device time",
        offline: "No recent contact",
        error: "Provider error",
        no_data: "No data",
    }[value] || "Unknown";
}

function ignitionLabel(value) {
    if (value === true) return "ON · 20-second heartbeat";
    if (value === false) return "OFF · 2-minute heartbeat";
    return "Not reported";
}

function coordinate(value) {
    return Number.isFinite(Number(value)) ? Number(value).toFixed(6) : "—";
}

function selectedHealthRows() {
    const rows = state.health?.buses || [];
    return state.selectedBusId
        ? rows.filter(item => String(item.bus_id) === state.selectedBusId)
        : rows;
}

function summaryCard(label, value, detail, tone = "") {
    return `<article class="tech-stat provider-stat ${tone}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value))}</strong><small>${escapeHtml(detail)}</small></article>`;
}

function updateGapDetail(item) {
    if (item.device_update_gap_seconds === null || item.device_update_gap_seconds === undefined) {
        return "Waiting for two distinct accepted GPS fixes";
    }
    const timing = Number(item.device_update_delay_seconds) > 0
        ? `${formatAge(item.device_update_delay_seconds)} later than expected`
        : "Within the expected heartbeat interval";
    return `Previous: ${formatDate(item.previous_device_time)} · ${timing}`;
}

function healthCard(item) {
    const coordinates = item.latitude === null || item.longitude === null
        ? "No coordinate received"
        : `${coordinate(item.latitude)}, ${coordinate(item.longitude)}`;
    const trip = item.active_trip_id
        ? `Trip #${item.active_trip_id} · ${item.route_direction || "direction pending"}`
        : "No active GPS route session";
    const nextDirection = item.route_direction === "reverse" ? "forward" : "reverse";
    const directionControl = item.active_trip_id
        ? `<div class="provider-direction-control"><span>Manual route control</span><button class="tech-button secondary provider-direction-button" type="button" data-provider-direction-bus="${item.bus_id}" data-provider-next-direction="${nextDirection}" ${state.changingDirectionBusId === item.bus_id || state.resettingBusId === item.bus_id ? "disabled" : ""}>${state.changingDirectionBusId === item.bus_id ? "Changing…" : nextDirection === "reverse" ? "↔ Change to return" : "↔ Change to outbound"}</button><button class="tech-button secondary" type="button" data-provider-reset-bus="${item.bus_id}" ${state.resettingBusId === item.bus_id || state.changingDirectionBusId === item.bus_id ? "disabled" : ""}>${state.resettingBusId === item.bus_id ? "Resetting…" : "Reset to first stop"}</button></div>`
        : "";
    return `<article class="provider-bus-card ${escapeHtml(item.health_status)}">
        <header><div><p>${escapeHtml(item.bus_number)}</p><strong>${escapeHtml(item.registration_number || "No registration")}</strong></div><span class="provider-health-pill ${escapeHtml(item.health_status)}">${escapeHtml(statusLabel(item.health_status))}</span></header>
        <dl>
            <div><dt>Latest provider contact</dt><dd>${escapeHtml(formatDate(item.last_provider_success_at))}<small>${escapeHtml(formatAge(item.provider_contact_age_seconds))} ago · valid or quarantined response</small></dd></div>
            <div><dt>Accepted by BusTrack</dt><dd>${escapeHtml(formatDate(item.latest_accepted_received_at))}<small>Receipt time for the accepted fix below</small></dd></div>
            <div><dt>Latest accepted GPS time</dt><dd>${escapeHtml(formatDate(item.latest_device_time))}<small>${escapeHtml(formatAge(item.device_data_age_seconds))} old</small></dd></div>
            <div><dt>Delivery delay</dt><dd>${escapeHtml(formatAge(item.latest_delivery_delay_seconds))}<small>BusTrack receipt time minus this device time</small></dd></div>
            <div><dt>GPS update gap</dt><dd>${escapeHtml(formatAge(item.device_update_gap_seconds))}<small>${escapeHtml(updateGapDetail(item))}</small></dd></div>
            <div><dt>Ignition / expected</dt><dd>${escapeHtml(ignitionLabel(item.ignition))}</dd></div>
            <div><dt>Latest coordinates</dt><dd><code>${escapeHtml(coordinates)}</code></dd></div>
            <div><dt>Tracking session</dt><dd>${escapeHtml(trip)}</dd></div>
        </dl>
        ${directionControl}
        ${item.reset_waiting_for_start ? `<p class="tech-muted">${escapeHtml(item.reset_message)}</p>` : ""}
        ${item.timestamp_warning ? `<p class="provider-error-copy">${escapeHtml(item.timestamp_warning)} The packet was quarantined and did not update live tracking.</p>` : ""}
        ${item.last_provider_error ? `<p class="provider-error-copy">${escapeHtml(item.last_provider_error)}</p>` : ""}
    </article>`;
}

function positionRow(item) {
    return `<tr>
        <td><strong>${escapeHtml(item.bus_number)}</strong><small>${escapeHtml(item.registration_number || "—")}</small></td>
        <td>${escapeHtml(formatDate(item.received_at))}</td>
        <td>${escapeHtml(formatDate(item.fix_time))}<small>${item.quarantined ? `Clock ahead: ${escapeHtml(formatAge(item.device_clock_ahead_seconds))}` : `Delivery lag: ${escapeHtml(formatAge(item.delivery_delay_seconds))}`}</small></td>
        <td><code>${escapeHtml(coordinate(item.latitude))}</code><small><code>${escapeHtml(coordinate(item.longitude))}</code></small></td>
        <td>${escapeHtml(item.speed_kmh === null ? "—" : `${Number(item.speed_kmh).toFixed(1)} km/h`)}<small>${escapeHtml(ignitionLabel(item.ignition))}</small></td>
        <td><span class="provider-applied ${item.applied_to_current_state ? "yes" : "no"}">${item.quarantined ? "QUARANTINED" : item.applied_to_current_state ? "CURRENT" : "HISTORY"}</span><small>${escapeHtml(item.quarantine_reason || item.protocol || "Unknown protocol")}</small></td>
        <td><button class="tech-button secondary provider-raw-button" type="button" data-provider-position="${item.id}">Raw data</button></td>
    </tr>`;
}

function renderPage() {
    if (!page) return;
    if (state.loading && !state.health) {
        page.innerHTML = `<div class="tech-loading">Loading provider health…</div>`;
        return;
    }

    const allRows = state.health?.buses || [];
    const visibleRows = selectedHealthRows();
    const counts = state.health?.counts || {};
    const busOptions = allRows.map(item => `<option value="${item.bus_id}" ${String(item.bus_id) === state.selectedBusId ? "selected" : ""}>${escapeHtml(`${item.bus_number} · ${item.registration_number || "No registration"}`)}</option>`).join("");
    const healthCards = visibleRows.length
        ? visibleRows.map(healthCard).join("")
        : `<p class="tech-empty">No buses match this filter.</p>`;
    const positionRows = state.positions.length
        ? state.positions.map(positionRow).join("")
        : `<tr><td colspan="7" class="tech-empty">No provider coordinates are retained for this bus yet.</td></tr>`;

    page.innerHTML = `<section class="tech-page provider-health-page">
        <header class="tech-hero provider-health-hero"><div><p class="tech-eyebrow">GPS PROVIDER OBSERVABILITY</p><h1>Provider Health</h1><p>See every retained provider response, its device timestamp, when BusTrack received it, and whether it advanced live tracking.</p></div><button class="tech-button primary" id="provider-pull-now" type="button" ${state.refreshing ? "disabled" : ""}>${state.refreshing ? "Fetching…" : "↻ Fetch provider now"}</button></header>
        ${state.lastRefreshError ? `<p class="provider-page-error">${escapeHtml(state.lastRefreshError)}</p>` : ""}
        <section class="tech-stat-grid provider-stat-grid">
            ${summaryCard("Healthy", counts.healthy || 0, "fresh provider coordinates", "healthy")}
            ${summaryCard("Delayed", counts.delayed || 0, "provider answered with old data", "delayed")}
            ${summaryCard("Offline", counts.offline || 0, "provider contact overdue", "offline")}
            ${summaryCard("Errors", (counts.error || 0) + (counts.clock_error || 0), "provider or device clock problem", "error")}
            ${summaryCard("No data", counts.no_data || 0, "waiting for first coordinate")}
        </section>
        <section class="tech-panel provider-filter-panel"><div><label for="provider-bus-filter">Filter by exact bus</label><select id="provider-bus-filter"><option value="">All buses</option>${busOptions}</select></div><p>Auto-refreshes every ${escapeHtml(String(state.health?.poll_interval_seconds || 20))} seconds. Raw history is retained for ${escapeHtml(formatAge((state.health?.history_retention_minutes || 0) * 60))}.</p></section>
        <section class="provider-health-grid">${healthCards}</section>
        <section class="tech-panel"><div class="tech-panel-heading"><div><p class="tech-eyebrow">COORDINATE FEED</p><h2>${state.selectedBusId ? "Selected bus provider data" : "All provider data"}</h2><p>Rows are ordered by BusTrack receipt time. “Current” is the newest device timestamp used by the tracker; replays remain visible as history but cannot move the route backward.</p></div><span class="tech-muted">Newest 100 retained responses</span></div><div class="tech-table-wrap"><table class="provider-position-table"><thead><tr><th>Bus</th><th>Received by BusTrack</th><th>Device timestamp</th><th>Coordinates</th><th>Movement</th><th>Tracker use</th><th></th></tr></thead><tbody>${positionRows}</tbody></table></div></section>
    </section>`;
    bindEvents();
}

function bindEvents() {
    page?.querySelectorAll("[data-provider-reset-bus]").forEach(button => {
        button.addEventListener("click", () => void openResetDialog(Number(button.dataset.providerResetBus)));
    });
    page?.querySelector("#provider-bus-filter")?.addEventListener("change", event => {
        state.selectedBusId = event.target.value;
        void refreshData();
    });
    page?.querySelector("#provider-pull-now")?.addEventListener("click", () => void pullProviderNow());
    page?.querySelectorAll("[data-provider-position]").forEach(button => {
        button.addEventListener("click", () => showRawPosition(Number(button.dataset.providerPosition)));
    });
    page?.querySelectorAll("[data-provider-direction-bus]").forEach(button => {
        button.addEventListener("click", () => confirmDirectionChange(
            Number(button.dataset.providerDirectionBus),
            button.dataset.providerNextDirection,
        ));
    });
}

async function openResetDialog(busId) {
    if (state.resettingBusId !== null || state.changingDirectionBusId !== null) return;
    state.resettingBusId = busId;
    renderPage();
    try {
        const options = await request(`/integrations/gps/provider-health/buses/${busId}/reset-options`, { cache: "no-store" });
        if (!page) return;
        const requestId = crypto.randomUUID();
        let submitting = false;
        let direction = "forward";
        Modal.form({
            eyebrow: "LIVE TRIP CONTROL",
            title: `Reset ${options.bus_number} to first stop`,
            subtitle: options.route_name,
            size: "sm",
            submitText: "Reset to first stop",
            content: `<label for="provider-reset-direction">Journey direction</label>
                <select id="provider-reset-direction"><option value="forward">Outbound</option><option value="reverse">Return</option></select>
                <p>Starting stop: <strong id="provider-reset-start">${escapeHtml(options.starts.forward.name)}</strong></p>
                <p>Clears current stop progress and waits for a fresh GPS arrival at this stop. The real bus location and journey history stay available.</p>
                <p id="provider-reset-error" role="alert"></p>`,
            onOpen: () => document.getElementById("provider-reset-direction")?.addEventListener("change", event => {
                direction = event.target.value;
                document.getElementById("provider-reset-start").textContent = options.starts[direction].name;
            }),
            onSubmit: async () => {
                if (submitting) return;
                submitting = true;
                const select = document.getElementById("provider-reset-direction");
                if (select) select.disabled = true;
                try {
                    const result = await request(`/integrations/gps/provider-health/buses/${busId}/reset`, {
                        method: "POST",
                        body: JSON.stringify({direction, trip_id: options.trip_id,
                            expected_reset_version: options.reset_version, request_id: requestId}),
                    });
                    Modal.close();
                    await refreshData({ force: true });
                    Modal.success({ title: "Route reset", subtitle: result.message });
                } catch (error) {
                    const message = document.getElementById("provider-reset-error");
                    if (message) message.textContent = error.message;
                    // Retrying this dialog reuses the same request ID.
                } finally {
                    submitting = false;
                    if (select) select.disabled = false;
                }
            },
        });
    } catch (error) {
        Modal.error({ title: "Unable to reset route", subtitle: error.message });
    } finally {
        state.resettingBusId = null;
        renderPage();
    }
}

function confirmDirectionChange(busId, direction) {
    const bus = (state.health?.buses || []).find(item => item.bus_id === busId);
    if (!bus || (direction !== "forward" && direction !== "reverse")) return;
    const directionLabel = direction === "reverse" ? "return" : "outbound";
    Modal.confirm({
        eyebrow: "LIVE TRIP CONTROL",
        title: `Change ${bus.bus_number} to ${directionLabel}?`,
        subtitle: "This changes the active trip only; it does not rewrite the saved route.",
        content: `<p>The student map and railway tracker will use the <strong>${escapeHtml(directionLabel)}</strong> stop order. The next GPS heartbeat continues progression from the bus's current live stop.</p>`,
        confirmText: `Use ${directionLabel} route`,
        style: "primary",
        onConfirm: async () => {
            state.changingDirectionBusId = busId;
            renderPage();
            try {
                const result = await request(`/integrations/gps/provider-health/buses/${busId}/direction`, {
                    method: "POST",
                    body: JSON.stringify({ direction }),
                });
                Modal.close();
                await refreshData();
                Modal.success({ title: "Route direction changed", subtitle: result.message });
            } catch (error) {
                Modal.error({ title: "Unable to change route direction", subtitle: error.message });
            } finally {
                state.changingDirectionBusId = null;
                renderPage();
            }
        },
    });
}

function showRawPosition(id) {
    const item = state.positions.find(position => position.id === id);
    if (!item) return;
    const payload = JSON.stringify(item.provider_payload, null, 2) || "Raw payload was not valid JSON.";
    Modal.open({
        eyebrow: "PROVIDER RESPONSE",
        title: `${item.bus_number} · ${coordinate(item.latitude)}, ${coordinate(item.longitude)}`,
        subtitle: `Device: ${formatDate(item.fix_time)} · Received: ${formatDate(item.received_at)}`,
        size: "lg",
        content: `<pre class="provider-raw-json">${escapeHtml(payload)}</pre>`,
        actions: [{ text: "Close", style: "secondary", close: true }],
    });
}

async function refreshData({ preserveError = false, force = false } = {}) {
    if (state.refreshing && !force) return;
    const requestId = ++state.refreshRequestId;
    state.refreshing = true;
    if (!preserveError) state.lastRefreshError = "";
    try {
        const suffix = state.selectedBusId ? `?bus_id=${encodeURIComponent(state.selectedBusId)}&limit=100` : "?limit=100";
        const [health, feed] = await Promise.all([
            request("/integrations/gps/provider-health"),
            request(`/integrations/gps/provider-health/positions${suffix}`),
        ]);
        if (requestId !== state.refreshRequestId) return;
        state.health = health;
        state.positions = feed.positions;
    } catch (error) {
        if (requestId === state.refreshRequestId) state.lastRefreshError = `Unable to refresh provider health: ${error.message}`;
    } finally {
        if (requestId !== state.refreshRequestId) return;
        state.loading = false;
        state.refreshing = false;
        renderPage();
    }
}

async function pullProviderNow() {
    if (state.refreshing) return;
    state.refreshing = true;
    state.lastRefreshError = "";
    renderPage();
    let providerNotice = "";
    try {
        const suffix = state.selectedBusId ? `?bus_id=${encodeURIComponent(state.selectedBusId)}` : "";
        const result = await request(`/integrations/gps/airotrack/refresh${suffix}`, { method: "POST" });
        if (result.errors?.length) {
            providerNotice = `${result.errors.length} provider request${result.errors.length === 1 ? "" : "s"} failed. Details are shown on the affected bus.`;
        }
    } catch (error) {
        providerNotice = `Provider fetch failed: ${error.message}`;
    } finally {
        state.refreshing = false;
        state.lastRefreshError = providerNotice;
        await refreshData({ preserveError: true });
    }
}

export function render() {
    page = document.createElement("div");
    page.className = "technician-module provider-health-module";
    page.cleanup = destroy;
    renderPage();
    queueMicrotask(() => void refreshData());
    refreshTimer = window.setInterval(() => void refreshData(), 20000);
    return page;
}

export function destroy() {
    if (refreshTimer !== null) window.clearInterval(refreshTimer);
    refreshTimer = null;
    page = null;
}
