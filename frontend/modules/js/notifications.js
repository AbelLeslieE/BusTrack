import { escapeHtml } from "/static/common/security.js";

const API_URL = "/api/notifications";
const state = { items: [], filter: "all", view: null, loading: false };
let actionMessageTimer = null;

function showActionMessage(message, tone = "success") {
    const target = state.view?.querySelector("#notificationActionMessage");
    if (!target) return;

    if (actionMessageTimer) window.clearTimeout(actionMessageTimer);
    target.textContent = message;
    target.className = `notifications-action-message is-${tone}`;
    actionMessageTimer = window.setTimeout(() => {
        if (!target.isConnected) return;
        target.textContent = "";
        target.className = "notifications-action-message";
    }, 4500);
}

function formatDate(value) {
    if (!value) return "Unknown time";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "Unknown time" : date.toLocaleString([], { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function statusClass(value) {
    return String(value || "").toLowerCase();
}

function renderItems() {
    const list = state.view.querySelector("#notificationList");
    const visible = state.filter === "all" ? state.items : state.items.filter(item => item.status === state.filter);
    if (!visible.length) {
        list.innerHTML = `<div class="notifications-empty"><h3>No ${state.filter === "all" ? "operational" : state.filter.toLowerCase()} notifications</h3><p>Driver feedback will appear here as soon as it is reported.</p></div>`;
        return;
    }
    list.innerHTML = visible.map(item => `
        <article class="notification-card notification-${statusClass(item.status)} notification-severity-card-${statusClass(item.severity)}" data-notification-id="${item.id}">
            <div class="notification-card__top">
                <div>
                    <span class="notification-severity notification-severity-${statusClass(item.severity)}">${escapeHtml(item.severity)}</span>
                    <h3>${escapeHtml(item.title)}</h3>
                </div>
                <span class="notification-status notification-status-${statusClass(item.status)}">${escapeHtml(item.status)}</span>
            </div>
            <p class="notification-message">${escapeHtml(item.message || "No additional details provided.")}</p>
            <div class="notification-meta">
                <span><strong>Driver:</strong> ${escapeHtml(item.driver_name || item.driver_code || "Unknown")}</span>
                <span><strong>Bus:</strong> ${escapeHtml(item.bus_number || "Unassigned")}</span>
                <span><strong>Route:</strong> ${escapeHtml(item.route_name || item.route_code || "Unassigned")}</span>
                <time datetime="${escapeHtml(item.created_at || "")}">${escapeHtml(formatDate(item.created_at))}</time>
            </div>
            <div class="notification-actions">
                ${item.status === "Open" ? `<button type="button" data-notification-action="Acknowledged">Acknowledge</button>` : ""}
                ${item.status !== "Resolved" ? `<button type="button" class="notification-resolve" data-notification-action="Resolved">Mark resolved</button>` : ""}
                ${item.status !== "Open" ? `<button type="button" class="notification-reopen" data-notification-action="Open">Reopen</button>` : ""}
            </div>
        </article>`).join("");

    list.querySelectorAll("[data-notification-action]").forEach(button => {
        button.addEventListener("click", () => updateStatus(button));
    });
}

function renderStats(data = {}) {
    state.view.querySelector("#notificationTotal").textContent = state.items.length;
    state.view.querySelector("#notificationOpen").textContent = state.items.filter(item => item.status === "Open").length;
    state.view.querySelector("#notificationCritical").textContent = state.items.filter(item => item.severity === "Critical" && item.status !== "Resolved").length;
    state.view.querySelector("#notificationLastRefresh").textContent = `Updated ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
    if (data.open_count !== undefined) state.view.querySelector("#notificationOpen").textContent = data.open_count;
}

async function loadNotifications() {
    if (state.loading) return;
    state.loading = true;
    const refreshButton = state.view.querySelector("#refreshNotifications");
    refreshButton.disabled = true;
    refreshButton.textContent = "Refreshing…";
    try {
        const response = await fetch(`${API_URL}?limit=200`);
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.detail || "Unable to load notifications.");
        state.items = Array.isArray(data.notifications) ? data.notifications : [];
        renderStats(data);
        renderItems();
    } catch (error) {
        state.view.querySelector("#notificationList").innerHTML = `<div class="notifications-empty"><h3>Notifications unavailable</h3><p>${escapeHtml(error.message)}</p><button type="button" class="notification-retry">Try again</button></div>`;
        state.view.querySelector(".notification-retry")?.addEventListener("click", loadNotifications);
    } finally {
        state.loading = false;
        refreshButton.disabled = false;
        refreshButton.textContent = "Refresh";
    }
}

async function updateStatus(button) {
    const card = button.closest("[data-notification-id]");
    const notificationId = card?.dataset.notificationId;
    if (!notificationId) return;
    button.disabled = true;
    try {
        const response = await fetch(`${API_URL}/${notificationId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: button.dataset.notificationAction }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.detail || "Unable to update notification.");
        const index = state.items.findIndex(item => String(item.id) === String(notificationId));
        if (index >= 0) state.items[index] = data;
        renderStats();
        renderItems();
        showActionMessage(`Alert marked ${String(data.status || "updated").toLowerCase()}.`);
    } catch (error) {
        button.disabled = false;
        showActionMessage(error.message || "Unable to update this alert.", "error");
    }
}

export function render() {
    const view = document.createElement("div");
    view.className = "notifications-page";
    state.view = view;
    view.innerHTML = `
        <section class="notifications-hero glass-card">
            <div>
                <p class="notifications-eyebrow">Operations center</p>
                <h1>Notifications</h1>
                <p>Review live feedback from drivers, acknowledge incidents, and keep every operational response traceable.</p>
            </div>
            <div class="notifications-hero-action"><button id="refreshNotifications" type="button" class="notifications-refresh">Refresh</button><span id="notificationActionMessage" class="notifications-action-message" role="status" aria-live="polite"></span><span id="notificationLastRefresh">Waiting for data</span></div>
        </section>
        <section class="notifications-summary" aria-label="Notification summary">
            <article class="notification-stat glass-card"><span class="notification-stat__icon notification-stat-blue">◉</span><div><small>Total feedback</small><strong id="notificationTotal">0</strong></div></article>
            <article class="notification-stat glass-card"><span class="notification-stat__icon notification-stat-amber">!</span><div><small>Open</small><strong id="notificationOpen">0</strong></div></article>
            <article class="notification-stat glass-card"><span class="notification-stat__icon notification-stat-red">⚠</span><div><small>Critical</small><strong id="notificationCritical">0</strong></div></article>
        </section>
        <section class="notifications-list-card glass-card">
            <div class="notifications-list-heading"><div><p class="notifications-eyebrow">Driver feedback</p><h2>Operational alerts</h2></div><div class="notification-filters" role="group" aria-label="Filter notifications"><button type="button" class="is-active" data-notification-filter="all">All</button><button type="button" data-notification-filter="Open">Open</button><button type="button" data-notification-filter="Acknowledged">Acknowledged</button><button type="button" data-notification-filter="Resolved">Resolved</button></div></div>
            <div id="notificationList" class="notifications-list"><div class="notifications-loading">Loading notifications…</div></div>
        </section>`;
    view.querySelector("#refreshNotifications").addEventListener("click", loadNotifications);
    view.querySelectorAll("[data-notification-filter]").forEach(button => {
        button.addEventListener("click", () => {
            state.filter = button.dataset.notificationFilter;
            view.querySelectorAll("[data-notification-filter]").forEach(item => item.classList.toggle("is-active", item === button));
            renderItems();
        });
    });
    loadNotifications();
    const refreshTimer = window.setInterval(loadNotifications, 15000);
    view.cleanup = () => window.clearInterval(refreshTimer);
    return view;
}
