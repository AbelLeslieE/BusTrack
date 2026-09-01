import { request } from "/static/common/api.js";
import { clearSession, replaceSession } from "/static/common/auth.js";
import { escapeHtml } from "/static/common/security.js";

const state = { view: null, account: null, loading: false };

function initials(name = "") {
    return String(name).split(" ").filter(Boolean).slice(0, 2)
        .map((word) => word[0]).join("").toUpperCase() || "A";
}

function setMessage(message = "", tone = "") {
    const target = state.view?.querySelector("#settingsMessage");
    if (!target) return;
    target.textContent = message;
    target.className = `settings-message${tone ? ` is-${tone}` : ""}`;
}

function updateTopbar(account) {
    const topbar = document.querySelector(".topbar");
    topbar?.querySelector(".profile-copy strong")?.replaceChildren(account.full_name || account.username);
    topbar?.querySelector(".profile-copy small")?.replaceChildren("Admin");
    topbar?.querySelector(".avatar")?.replaceChildren(initials(account.full_name || account.username));
}

async function downloadBackup() {
    const button = state.view?.querySelector("#downloadBackup");
    if (!button) return;
    button.disabled = true;
    button.textContent = "Preparing backup…";
    setMessage();
    try {
        const response = await fetch("/api/settings/backup/download");
        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.detail || "Unable to create the database backup.");
        }
        const archive = await response.blob();
        const filename = response.headers.get("content-disposition")
            ?.match(/filename="?([^";]+)"?/i)?.[1] || "BusTrack-backup.zip";
        const link = document.createElement("a");
        const objectUrl = URL.createObjectURL(archive);
        link.href = objectUrl;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
        setMessage("Backup downloaded. Keep the ZIP file in a secure location.", "success");
    } catch (error) {
        setMessage(error.message || "Unable to create the database backup.", "error");
    } finally {
        if (button.isConnected) {
            button.disabled = false;
            button.textContent = "Download backup";
        }
    }
}

function chooseBackupForRestore() {
    state.view?.querySelector("#restoreBackupFile")?.click();
}

async function restoreBackup(event) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".zip")) {
        setMessage("Choose a BusTrack backup ZIP file.", "error");
        return;
    }
    const confirmation = window.prompt(
        "This permanently replaces the current BusTrack data with the selected backup. Type RESTORE to continue.",
    );
    if (confirmation !== "RESTORE") {
        setMessage("Recovery cancelled. No data was changed.");
        return;
    }

    const button = state.view?.querySelector("#restoreBackup");
    if (!button) return;
    button.disabled = true;
    button.textContent = "Restoring…";
    setMessage("Validating and restoring the backup. The application will briefly be unavailable…");
    try {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("confirmation", confirmation);
        const response = await fetch("/api/settings/backup/restore", { method: "POST", body: formData });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.detail || "Unable to restore the database backup.");
        clearSession();
        window.alert("Backup restored successfully. Please sign in again.");
        window.location.assign("/");
    } catch (error) {
        setMessage(error.message || "Unable to restore the database backup.", "error");
        if (button.isConnected) {
            button.disabled = false;
            button.textContent = "Restore from backup";
        }
    }
}

function accountMarkup(account) {
    const name = account.full_name || account.username;
    return `
        <section class="settings-hero glass-card">
            <div class="settings-identity">
                <span class="settings-avatar" aria-hidden="true">${escapeHtml(initials(name))}</span>
                <div>
                    <p class="settings-eyebrow">Administrator account</p>
                    <h1>Settings</h1>
                    <p>Keep your admin identity and account security up to date.</p>
                </div>
            </div>
            <button id="refreshSettings" type="button" class="settings-refresh">Refresh details</button>
        </section>

        <p id="settingsMessage" class="settings-message" role="status" aria-live="polite"></p>

        <section class="settings-grid">
            <article class="settings-card settings-profile-card glass-card">
                <div class="settings-card-heading">
                    <div><p class="settings-eyebrow">Profile</p><h2>Account details</h2></div>
                    <span class="settings-role">Admin</span>
                </div>
                <form id="settingsProfileForm" class="settings-form" novalidate>
                    <label>Full name<input id="settingsFullName" name="full_name" required minlength="2" maxlength="100" value="${escapeHtml(account.full_name || "")}" autocomplete="name"></label>
                    <label>Username<input id="settingsUsername" name="username" required minlength="3" maxlength="64" pattern="[A-Za-z0-9_.-]+" value="${escapeHtml(account.username || "")}" autocomplete="username"></label>
                    <label>Email address<input id="settingsEmail" name="email" type="email" maxlength="100" value="${escapeHtml(account.email || "")}" autocomplete="email" placeholder="name@college.edu"></label>
                    <label>Phone number<input id="settingsPhone" name="phone" maxlength="20" value="${escapeHtml(account.phone || "")}" autocomplete="tel" placeholder="+91 00000 00000"></label>
                    <div class="settings-form-actions"><button type="submit" class="settings-primary">Save profile</button></div>
                </form>
            </article>

            <aside class="settings-card settings-summary-card glass-card">
                <p class="settings-eyebrow">Account status</p>
                <h2>${escapeHtml(name)}</h2>
                <dl class="settings-summary-list">
                    <div><dt>Role</dt><dd>Admin</dd></div>
                    <div><dt>Account status</dt><dd><span class="settings-status">${escapeHtml(account.status || "Active")}</span></dd></div>
                    <div><dt>Last sign-in</dt><dd>${escapeHtml(account.last_login ? new Date(account.last_login).toLocaleString() : "No sign-in recorded")}</dd></div>
                </dl>
                <p class="settings-summary-help">Admin settings only affect your own account. User, driver, route, and fleet records remain unchanged.</p>
            </aside>

            <article class="settings-card settings-security-card glass-card">
                <div class="settings-card-heading"><div><p class="settings-eyebrow">Security</p><h2>Change or reset password</h2></div><span class="settings-lock" aria-hidden="true">⌁</span></div>
                <p class="settings-help">Confirm your current password, then choose a new password with at least 12 characters, uppercase and lowercase letters, a number, and a symbol. Saving signs out any older sessions for this account.</p>
                <form id="settingsPasswordForm" class="settings-form" novalidate>
                    <label>Current password<input id="settingsCurrentPassword" name="current_password" type="password" required maxlength="72" autocomplete="current-password"></label>
                    <label>New password<input id="settingsNewPassword" name="new_password" type="password" required minlength="12" maxlength="72" autocomplete="new-password"></label>
                    <label>Confirm new password<input id="settingsConfirmPassword" type="password" required minlength="12" maxlength="72" autocomplete="new-password"></label>
                    <div class="settings-form-actions"><button type="submit" class="settings-primary settings-security-action">Update password</button><button id="clearPasswordForm" type="button" class="settings-secondary">Clear</button></div>
                </form>
            </article>

            <article class="settings-card settings-backup-card glass-card">
                <div class="settings-card-heading">
                    <div><p class="settings-eyebrow">Data protection</p><h2>Data backup &amp; recovery</h2></div>
                    <span class="settings-backup-icon" aria-hidden="true">↺</span>
                </div>
                <p class="settings-help settings-backup-description">Create a compressed backup of your BusTrack data, including fleet, routes, stops, users, assignments, and tracking settings. If data is ever lost or corrupted, restore a previously downloaded backup to return each module to its saved state.</p>
                <div class="settings-backup-flow" aria-label="Backup and recovery process">
                    <div><span>1</span><strong>Download backup</strong><small>Save a complete backup file somewhere secure.</small></div>
                    <div><span>2</span><strong>Restore from backup</strong><small>Upload that file to recover the saved data.</small></div>
                </div>
                <div class="settings-backup-actions">
                    <button id="downloadBackup" type="button" class="settings-primary">Download backup</button>
                    <button id="restoreBackup" type="button" class="settings-secondary settings-restore-action">Restore from backup</button>
                    <input id="restoreBackupFile" type="file" accept=".zip,application/zip" hidden>
                </div>
                <p class="settings-backup-pending"><span aria-hidden="true">●</span> Restoring replaces the current data with the selected backup and then signs you out. Keep backup ZIP files secure.</p>
            </article>
        </section>`;
}

function renderAccount(account) {
    state.account = account;
    state.view.innerHTML = accountMarkup(account);
    state.view.querySelector("#refreshSettings")?.addEventListener("click", loadAccount);
    state.view.querySelector("#settingsProfileForm")?.addEventListener("submit", saveProfile);
    state.view.querySelector("#settingsPasswordForm")?.addEventListener("submit", changePassword);
    state.view.querySelector("#downloadBackup")?.addEventListener("click", downloadBackup);
    state.view.querySelector("#restoreBackup")?.addEventListener("click", chooseBackupForRestore);
    state.view.querySelector("#restoreBackupFile")?.addEventListener("change", restoreBackup);
    state.view.querySelector("#clearPasswordForm")?.addEventListener("click", () => {
        state.view.querySelector("#settingsPasswordForm")?.reset();
        setMessage();
    });
}

async function loadAccount() {
    if (state.loading) return;
    state.loading = true;
    const refresh = state.view?.querySelector("#refreshSettings");
    if (refresh) { refresh.disabled = true; refresh.textContent = "Refreshing…"; }
    try {
        renderAccount(await request("/settings/account"));
        setMessage("Account details are up to date.", "success");
    } catch (error) {
        setMessage(error.message || "Unable to load account settings.", "error");
    } finally {
        state.loading = false;
        if (refresh?.isConnected) { refresh.disabled = false; refresh.textContent = "Refresh details"; }
    }
}

async function saveProfile(event) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const button = form.querySelector("button[type='submit']");
    button.disabled = true;
    button.textContent = "Saving…";
    setMessage();
    try {
        const session = await request("/settings/account", {
            method: "PUT",
            body: JSON.stringify({
                full_name: form.full_name.value.trim(),
                username: form.username.value.trim(),
                email: form.email.value.trim() || null,
                phone: form.phone.value.trim() || null,
            }),
        });
        replaceSession(session);
        renderAccount(session.user);
        updateTopbar(session.user);
        setMessage("Profile saved and your session was refreshed.", "success");
    } catch (error) {
        setMessage(error.message || "Unable to save your profile.", "error");
    } finally {
        if (button.isConnected) { button.disabled = false; button.textContent = "Save profile"; }
    }
}

async function changePassword(event) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const newPassword = form.new_password.value;
    if (newPassword !== form.querySelector("#settingsConfirmPassword").value) {
        setMessage("The new-password confirmation does not match.", "error");
        return;
    }
    const button = form.querySelector("button[type='submit']");
    button.disabled = true;
    button.textContent = "Updating…";
    setMessage();
    try {
        const session = await request("/settings/account/password", {
            method: "PUT",
            body: JSON.stringify({ current_password: form.current_password.value, new_password: newPassword }),
        });
        replaceSession(session);
        form.reset();
        setMessage("Password updated. Older sessions for this account have been signed out.", "success");
    } catch (error) {
        setMessage(error.message || "Unable to update your password.", "error");
    } finally {
        button.disabled = false;
        button.textContent = "Update password";
    }
}

export function render() {
    const view = document.createElement("div");
    view.className = "settings-page";
    view.innerHTML = `<section class="settings-loading glass-card">Loading your account settings…</section>`;
    state.view = view;
    loadAccount();
    return view;
}
