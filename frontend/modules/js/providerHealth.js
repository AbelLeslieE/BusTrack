import { request } from "/static/common/api.js";
import { Modal } from "/static/common/modal.js";
import { escapeHtml } from "/static/common/security.js";

const state = {
    health: null,
    positions: [],
    selectedBusId: "",
    loading: true,
    refreshing: false,
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

function healthCard(item) {
    const coordinates = item.latitude === null || item.longitude === null
        ? "No coordinate received"
        : `${coordinate(item.latitude)}, ${coordinate(item.longitude)}`;
    const trip = item.active_trip_id
        ? `Trip #${item.active_trip_id} · ${item.route_direction || "direction pending"}`
        : "No active GPS route session";
    return `<article class="provider-bus-card ${escapeHtml(item.health_status)}">
        <header><div><p>${escapeHtml(item.bus_number)}</p><strong>${escapeHtml(item.registration_number || "No registration")}</strong></div><span class="provider-health-pill ${escapeHtml(item.health_status)}">${escapeHtml(statusLabel(item.health_status))}</span></header>
        <dl>
            <div><dt>Provider contacted</dt><dd>${escapeHtml(formatDate(item.last_provider_success_at))}<small>${escapeHtml(formatAge(item.provider_contact_age_seconds))} ago</small></dd></div>
            <div><dt>Device coordinate time</dt><dd>${escapeHtml(formatDate(item.latest_device_time))}<small>${escapeHtml(formatAge(item.device_data_age_seconds))} old</small></dd></div>
            <div><dt>Delay when received</dt><dd>${escapeHtml(formatAge(item.latest_delivery_delay_seconds))}</dd></div>
            <div><dt>Ignition / expected</dt><dd>${escapeHtml(ignitionLabel(item.ignition))}</dd></div>
            <div><dt>Latest coordinates</dt><dd><code>${escapeHtml(coordinates)}</code></dd></div>
            <div><dt>Tracking session</dt><dd>${escapeHtml(trip)}</dd></div>
        </dl>
        ${item.last_provider_error ? `<p class="provider-error-copy">${escapeHtml(item.last_provider_error)}</p>` : ""}
    </article>`;
}

function positionRow(item) {
    return `<tr>
        <td><strong>${escapeHtml(item.bus_number)}</strong><small>${escapeHtml(item.registration_number || "—")}</small></td>
        <td>${escapeHtml(formatDate(item.received_at))}</td>
        <td>${escapeHtml(formatDate(item.fix_time))}<small>Delivery lag: ${escapeHtml(formatAge(item.delivery_delay_seconds))}</small></td>
        <td><code>${escapeHtml(coordinate(item.latitude))}</code><small><code>${escapeHtml(coordinate(item.longitude))}</code></small></td>
        <td>${escapeHtml(item.speed_kmh === null ? "—" : `${Number(item.speed_kmh).toFixed(1)} km/h`)}<small>${escapeHtml(ignitionLabel(item.ignition))}</small></td>
        <td><span class="provider-applied ${item.applied_to_current_state ? "yes" : "no"}">${item.applied_to_current_state ? "CURRENT" : "HISTORY"}</span><small>${escapeHtml(item.protocol || "Unknown protocol")}</small></td>
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
            ${summaryCard("Errors", counts.error || 0, "latest poll failed", "error")}
            ${summaryCard("No data", counts.no_data || 0, "waiting for first coordinate")}
        </section>
        <section class="tech-panel provider-filter-panel"><div><label for="provider-bus-filter">Filter by exact bus</label><select id="provider-bus-filter"><option value="">All buses</option>${busOptions}</select></div><p>Auto-refreshes every ${escapeHtml(String(state.health?.poll_interval_seconds || 20))} seconds. Raw history is retained for ${escapeHtml(formatAge((state.health?.history_retention_minutes || 0) * 60))}.</p></section>
        <section class="provider-health-grid">${healthCards}</section>
        <section class="tech-panel"><div class="tech-panel-heading"><div><p class="tech-eyebrow">COORDINATE FEED</p><h2>${state.selectedBusId ? "Selected bus provider data" : "All provider data"}</h2><p>Rows are ordered by BusTrack receipt time. “Current” is the newest device timestamp used by the tracker; replays remain visible as history but cannot move the route backward.</p></div><span class="tech-muted">Newest 100 retained responses</span></div><div class="tech-table-wrap"><table class="provider-position-table"><thead><tr><th>Bus</th><th>Received by BusTrack</th><th>Device timestamp</th><th>Coordinates</th><th>Movement</th><th>Tracker use</th><th></th></tr></thead><tbody>${positionRows}</tbody></table></div></section>
    </section>`;
    bindEvents();
}

function bindEvents() {
    page?.querySelector("#provider-bus-filter")?.addEventListener("change", event => {
        state.selectedBusId = event.target.value;
        void refreshData();
    });
    page?.querySelector("#provider-pull-now")?.addEventListener("click", () => void pullProviderNow());
    page?.querySelectorAll("[data-provider-position]").forEach(button => {
        button.addEventListener("click", () => showRawPosition(Number(button.dataset.providerPosition)));
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

async function refreshData({ preserveError = false } = {}) {
    if (state.refreshing) return;
    state.refreshing = true;
    if (!preserveError) state.lastRefreshError = "";
    try {
        const suffix = state.selectedBusId ? `?bus_id=${encodeURIComponent(state.selectedBusId)}&limit=100` : "?limit=100";
        const [health, feed] = await Promise.all([
            request("/integrations/gps/provider-health"),
            request(`/integrations/gps/provider-health/positions${suffix}`),
        ]);
        state.health = health;
        state.positions = feed.positions;
    } catch (error) {
        state.lastRefreshError = `Unable to refresh provider health: ${error.message}`;
    } finally {
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
