/** Read-only administrator profile summary with a link to account settings. */

import { request } from "/static/common/api.js";
import { escapeHtml } from "/static/common/security.js";

let activeView = null;

function initials(name = "") {
    return String(name)
        .split(" ")
        .filter(Boolean)
        .slice(0, 2)
        .map((word) => word[0])
        .join("")
        .toUpperCase() || "A";
}

function display(value, fallback = "Not provided") {
    const text = String(value ?? "").trim();
    return escapeHtml(text || fallback);
}

function formatDateTime(value) {
    if (!value) return "No sign-in recorded";
    const date = new Date(value);
    return Number.isNaN(date.getTime())
        ? "No sign-in recorded"
        : date.toLocaleString();
}

function profileMarkup(account) {
    const name = account.full_name || account.username || "Administrator";
    return `
        <section class="profile-hero glass-card">
            <span class="profile-avatar" aria-hidden="true">${escapeHtml(initials(name))}</span>
            <div class="profile-heading">
                <p class="profile-eyebrow">Administrator profile</p>
                <h1>${escapeHtml(name)}</h1>
                <p>Review the identity attached to your current authenticated session.</p>
            </div>
            <a class="profile-settings-link" href="#settings">Edit in Settings</a>
        </section>
        <p id="profileMessage" class="profile-message" role="status" aria-live="polite"></p>
        <section class="profile-grid">
            <article class="profile-card glass-card">
                <div class="profile-card-heading">
                    <div><p class="profile-eyebrow">Account</p><h2>Contact details</h2></div>
                    <span class="profile-status">${display(account.status, "Unknown")}</span>
                </div>
                <dl class="profile-details">
                    <div><dt>Full name</dt><dd>${display(account.full_name)}</dd></div>
                    <div><dt>Username</dt><dd>${display(account.username)}</dd></div>
                    <div><dt>Email</dt><dd>${display(account.email)}</dd></div>
                    <div><dt>Phone</dt><dd>${display(account.phone)}</dd></div>
                </dl>
            </article>
            <aside class="profile-card profile-security glass-card">
                <p class="profile-eyebrow">Session identity</p>
                <h2>${display(account.role, "Admin")}</h2>
                <dl class="profile-details compact">
                    <div><dt>Account status</dt><dd>${display(account.status, "Unknown")}</dd></div>
                    <div><dt>Last sign-in</dt><dd>${escapeHtml(formatDateTime(account.last_login))}</dd></div>
                </dl>
                <button id="refreshProfile" class="profile-refresh" type="button">Refresh profile</button>
            </aside>
        </section>`;
}

async function loadProfile(view) {
    const message = view.querySelector("#profileMessage");
    try {
        const account = await request("/settings/account");
        if (activeView !== view || !view.isConnected) return;
        view.innerHTML = profileMarkup(account);
        view.querySelector("#refreshProfile")?.addEventListener("click", () => {
            const button = view.querySelector("#refreshProfile");
            if (button) {
                button.disabled = true;
                button.textContent = "Refreshing…";
            }
            loadProfile(view);
        });
    } catch (error) {
        if (activeView !== view || !view.isConnected) return;
        message.textContent = error.message || "Unable to load your profile.";
        message.classList.add("is-error");
    }
}

export function render() {
    const view = document.createElement("div");
    view.className = "profile-page";
    view.innerHTML = `
        <section class="profile-loading glass-card">Loading your profile…</section>
        <p id="profileMessage" class="profile-message" role="status" aria-live="polite"></p>`;
    activeView = view;
    view.cleanup = () => {
        if (activeView === view) activeView = null;
    };
    loadProfile(view);
    return view;
}
