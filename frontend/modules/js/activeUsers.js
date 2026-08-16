import { request } from "/static/common/api.js";
import { Modal } from "/static/common/modal.js";
import { escapeHtml } from "/static/common/security.js";

const state = { view: null, sessions: [], suspendedUsers: [], query: "", loading: false, timer: null, currentUserId: null };

function formatDate(value) {
    if (!value) return "Not recorded";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "Not recorded" : date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function deviceLabel(userAgent) {
    const agent = String(userAgent || "Unknown device");
    if (/android/i.test(agent)) return "Android browser";
    if (/iphone|ipad|ios/i.test(agent)) return "Apple mobile browser";
    if (/windows/i.test(agent)) return "Windows browser";
    if (/macintosh|mac os/i.test(agent)) return "Mac browser";
    if (/linux/i.test(agent)) return "Linux browser";
    return agent.length > 72 ? `${agent.slice(0, 69)}…` : agent;
}

function setMessage(message = "", tone = "") {
    const target = state.view?.querySelector("#activeUsersMessage");
    if (!target) return;
    target.textContent = message;
    target.className = `active-users-message${tone ? ` is-${tone}` : ""}`;
}

function filteredSessions() {
    const query = state.query.trim().toLowerCase();
    if (!query) return state.sessions;
    return state.sessions.filter((session) => [session.full_name, session.username, session.email, session.phone, session.role, session.client_ip, session.user_agent]
        .some((value) => String(value || "").toLowerCase().includes(query)));
}

function sessionCard(session) {
    const isCurrentUser = Number(session.user_id) === Number(state.currentUserId);
    return `
        <article class="active-session-card" data-session-id="${escapeHtml(session.session_id)}">
            <div class="active-session-heading">
                <div><span class="active-dot" aria-hidden="true"></span><span class="active-live-label">Active now</span></div>
                <span class="active-role">${escapeHtml(session.role)}</span>
            </div>
            <h3>${escapeHtml(session.full_name)}</h3>
            <p class="active-username">@${escapeHtml(session.username)}</p>
            <dl class="active-detail-grid">
                <div><dt>Email</dt><dd>${escapeHtml(session.email || "Not provided")}</dd></div>
                <div><dt>Phone</dt><dd>${escapeHtml(session.phone || "Not provided")}</dd></div>
                <div><dt>Device</dt><dd>${escapeHtml(deviceLabel(session.user_agent))}</dd></div>
                <div><dt>IP address</dt><dd>${escapeHtml(session.client_ip || "Unavailable")}</dd></div>
                <div><dt>Signed in</dt><dd>${escapeHtml(formatDate(session.created_at))}</dd></div>
                <div><dt>Last active</dt><dd>${escapeHtml(formatDate(session.last_seen_at))}</dd></div>
            </dl>
            <div class="active-session-actions">${isCurrentUser
                ? `<span class="active-current-session">Your current Admin account</span>`
                : `<button type="button" class="active-secondary" data-active-action="kick-session" data-session-id="${escapeHtml(session.session_id)}">Kick this device</button><button type="button" class="active-warning" data-active-action="kick-user" data-user-id="${session.user_id}">Kick all devices</button><button type="button" class="active-danger" data-active-action="ban-user" data-user-id="${session.user_id}">Ban user</button>`}
            </div>
        </article>`;
}

function suspendedCard(user) {
    return `<article class="suspended-user-card"><div><span class="suspended-badge">Suspended</span><h3>${escapeHtml(user.full_name)}</h3><p>@${escapeHtml(user.username)} · ${escapeHtml(user.role)}</p><small>${escapeHtml(user.email || "No email")} · Last sign-in: ${escapeHtml(formatDate(user.last_login))}</small></div><button type="button" class="active-restore" data-active-action="restore-user" data-user-id="${user.user_id}">Restore access</button></article>`;
}

function renderList() {
    const list = state.view.querySelector("#activeSessionList");
    const sessions = filteredSessions();
    list.innerHTML = sessions.length
        ? sessions.map(sessionCard).join("")
        : `<div class="active-empty"><h3>No active users found</h3><p>Users appear here after signing in with the current session-aware login.</p></div>`;
    state.view.querySelector("#suspendedUsers").innerHTML = state.suspendedUsers.length
        ? state.suspendedUsers.map(suspendedCard).join("")
        : `<p class="active-no-suspended">No suspended accounts.</p>`;
    state.view.querySelectorAll("[data-active-action]").forEach((button) => button.addEventListener("click", () => confirmAction(button)));
}

function renderActiveUsers(data) {
    state.sessions = Array.isArray(data.sessions) ? data.sessions : [];
    state.suspendedUsers = Array.isArray(data.suspended_users) ? data.suspended_users : [];
    state.view.innerHTML = `
        <section class="active-users-hero glass-card"><div><p class="active-eyebrow">Session security</p><h1>Active Users</h1><p>Review signed-in devices, end access immediately, and suspend accounts when required.</p></div><button id="refreshActiveUsers" class="active-refresh" type="button">Refresh</button></section>
        <p id="activeUsersMessage" class="active-users-message" role="status" aria-live="polite"></p>
        <section class="active-user-stats" aria-label="Active user summary"><article class="active-stat glass-card"><span>◉</span><div><small>Active users</small><strong id="activeUserCount">${data.active_users || 0}</strong></div></article><article class="active-stat glass-card"><span>▣</span><div><small>Active devices</small><strong id="activeDeviceCount">${data.active_sessions || 0}</strong></div></article><article class="active-stat glass-card"><span>⊘</span><div><small>Suspended accounts</small><strong id="suspendedCount">${state.suspendedUsers.length}</strong></div></article></section>
        <section class="active-users-panel glass-card"><div class="active-panel-heading"><div><p class="active-eyebrow">Live devices</p><h2>Currently signed in</h2><p>Activity is refreshed automatically every 15 seconds.</p></div><label class="active-search">⌕<input id="activeUserSearch" type="search" placeholder="Search name, device, email or IP"></label></div><div id="activeSessionList" class="active-session-list"></div></section>
        <section class="active-suspended-panel glass-card"><div><p class="active-eyebrow">Access control</p><h2>Suspended accounts</h2></div><div id="suspendedUsers" class="suspended-user-list"></div></section>`;
    state.view.querySelector("#refreshActiveUsers").addEventListener("click", loadActiveUsers);
    state.view.querySelector("#activeUserSearch").addEventListener("input", (event) => { state.query = event.target.value; renderList(); });
    renderList();
}

async function loadActiveUsers() {
    if (state.loading) return;
    state.loading = true;
    const refresh = state.view?.querySelector("#refreshActiveUsers");
    if (refresh) { refresh.disabled = true; refresh.textContent = "Refreshing…"; }
    try {
        renderActiveUsers(await request("/active-users"));
    } catch (error) {
        const message = error.message || "Unable to load active users.";
        if (state.view?.querySelector("#activeUsersMessage")) {
            setMessage(message, "error");
        } else if (state.view) {
            state.view.innerHTML = `<section class="active-empty glass-card"><h3>Active users unavailable</h3><p>${escapeHtml(message)}</p><button id="retryActiveUsers" class="active-refresh" type="button">Try again</button></section>`;
            state.view.querySelector("#retryActiveUsers")?.addEventListener("click", loadActiveUsers);
        }
    } finally {
        state.loading = false;
        if (refresh?.isConnected) { refresh.disabled = false; refresh.textContent = "Refresh"; }
    }
}

function confirmAction(button) {
    const action = button.dataset.activeAction;
    const userId = button.dataset.userId;
    const sessionId = button.dataset.sessionId;
    const labels = {
        "kick-session": ["Kick this device?", "This browser will be signed out immediately.", "Kick device", "danger"],
        "kick-user": ["Kick user from all devices?", "Every active session for this user will end immediately.", "Kick all", "danger"],
        "ban-user": ["Suspend this user?", "The account will be locked and every active session will end immediately.", "Suspend user", "danger"],
        "restore-user": ["Restore this user?", "The account will become active again. The user must sign in again.", "Restore access", "primary"],
    };
    const [title, subtitle, confirmText, style] = labels[action] || [];
    Modal.confirm({
        eyebrow: "ACTIVE USER CONTROL",
        title,
        subtitle,
        confirmText,
        style,
        onConfirm: () => { Modal.close(); void performAction(action, userId, sessionId); },
    });
}

async function performAction(action, userId, sessionId) {
    const routes = {
        "kick-session": `/active-users/sessions/${encodeURIComponent(sessionId)}/kick`,
        "kick-user": `/active-users/${encodeURIComponent(userId)}/kick`,
        "ban-user": `/active-users/${encodeURIComponent(userId)}/ban`,
        "restore-user": `/active-users/${encodeURIComponent(userId)}/restore`,
    };
    setMessage();
    try {
        const result = await request(routes[action], { method: "POST" });
        await loadActiveUsers();
        setMessage(result.message || "Access control updated.", "success");
    } catch (error) {
        setMessage(error.message || "Unable to update access.", "error");
    }
}

export function render() {
    const view = document.createElement("div");
    view.className = "active-users-page";
    view.innerHTML = `<section class="active-users-loading glass-card">Loading active sessions…</section>`;
    state.view = view;
    try {
        state.currentUserId = JSON.parse(localStorage.getItem("bus_tracker_profile") || "{}").id || null;
    } catch {
        state.currentUserId = null;
    }
    loadActiveUsers();
    state.timer = window.setInterval(loadActiveUsers, 15_000);
    view.cleanup = () => { if (state.timer) window.clearInterval(state.timer); state.timer = null; };
    return view;
}
