import { escapeHtml } from "/static/common/security.js";

function formatDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "Unknown time" : date.toLocaleString([], { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function render() {
    const view = document.createElement("section");
    view.className = "notifications-page driver-notifications-page";
    view.innerHTML = `
        <section class="notifications-hero glass-card">
            <div><p class="notifications-eyebrow">Driver portal</p><h1>My Notifications</h1><p>Review the feedback you have sent to the transport team.</p></div>
            <button type="button" id="driverNotificationsRefresh" class="notifications-refresh">Refresh</button>
        </section>
        <section class="notifications-list-card glass-card"><div id="driverNotificationList" class="notifications-list"><div class="notifications-loading">Loading notifications…</div></div></section>`;

    const list = view.querySelector("#driverNotificationList");
    const load = async () => {
        const button = view.querySelector("#driverNotificationsRefresh");
        button.disabled = true;
        try {
            const response = await fetch("/api/notifications?limit=100");
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.detail || "Unable to load notifications.");
            if (!data.notifications?.length) {
                list.innerHTML = `<div class="notifications-empty"><h3>No feedback sent</h3><p>Use the safety feedback buttons in Live Tracking whenever management needs to know about an issue.</p></div>`;
                return;
            }
            list.innerHTML = data.notifications.map(item => `
                <article class="notification-card notification-${String(item.status).toLowerCase()} notification-severity-card-${String(item.severity).toLowerCase()}">
                    <div class="notification-card__top"><div><span class="notification-severity notification-severity-${String(item.severity).toLowerCase()}">${escapeHtml(item.severity)}</span><h3>${escapeHtml(item.title)}</h3></div><span class="notification-status notification-status-${String(item.status).toLowerCase()}">${escapeHtml(item.status)}</span></div>
                    <p class="notification-message">${escapeHtml(item.message || "No additional details provided.")}</p>
                    <div class="notification-meta"><span>Bus: ${escapeHtml(item.bus_number || "Unassigned")}</span><span>Route: ${escapeHtml(item.route_name || item.route_code || "Unassigned")}</span><time>${escapeHtml(formatDate(item.created_at))}</time></div>
                </article>`).join("");
        } catch (error) {
            list.innerHTML = `<div class="notifications-empty"><h3>Notifications unavailable</h3><p>${escapeHtml(error.message)}</p></div>`;
        } finally {
            button.disabled = false;
        }
    };
    view.querySelector("#driverNotificationsRefresh").addEventListener("click", load);
    load();
    return view;
}
