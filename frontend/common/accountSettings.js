import { request } from "/static/common/api.js";
import { replaceSession } from "/static/common/auth.js";
import { errorState, value } from "/static/common/portal.js";

export function renderAccountSettings(portalName) {
    const page = document.createElement("section");
    page.className = "portal-page account-settings-page";
    page.innerHTML = `<header class="portal-header"><p class="portal-eyebrow">${value(portalName)}</p><h1>Account settings</h1><p>Manage the contact details and password for your own account.</p></header><div class="portal-loading">Loading account settings…</div>`;

    const load = async () => {
        try {
            const account = await request("/settings/account");
            page.innerHTML = `<header class="portal-header"><p class="portal-eyebrow">${value(portalName)}</p><h1>Account settings</h1><p>Changes apply only to your signed-in account.</p></header>
                <div class="portal-two-column">
                    <form class="portal-card portal-form" id="accountProfileForm">
                        <h2>Profile</h2>
                        <label>Full name<input name="full_name" required minlength="2" value="${value(account.full_name, "")}"></label>
                        <label>Username<input name="username" required value="${value(account.username, "")}"></label>
                        <label>Email<input name="email" type="email" value="${value(account.email, "")}"></label>
                        <label>Phone<input name="phone" value="${value(account.phone, "")}"></label>
                        <button class="portal-primary" type="submit">Save profile</button><p class="portal-form-message" aria-live="polite"></p>
                    </form>
                    <form class="portal-card portal-form" id="accountPasswordForm">
                        <h2>Change password</h2>
                        <label>Current password<input name="current_password" type="password" required autocomplete="current-password"></label>
                        <label>New password<input name="new_password" type="password" required minlength="12" autocomplete="new-password"></label>
                        <p class="portal-hint">Use 12+ characters including uppercase, lowercase, a number, and a symbol.</p>
                        <button class="portal-primary" type="submit">Update password</button><p class="portal-form-message" aria-live="polite"></p>
                    </form>
                </div>`;
            const bind = (form, path) => form.addEventListener("submit", async event => {
                event.preventDefault();
                const button = form.querySelector("button");
                const message = form.querySelector(".portal-form-message");
                button.disabled = true;
                message.textContent = "Saving…";
                try {
                    const body = Object.fromEntries(new FormData(form));
                    if (path === "/settings/account") {
                        for (const key of ["email", "phone"]) body[key] = body[key].trim() || null;
                    }
                    const session = await request(path, { method: "PUT", body: JSON.stringify(body) });
                    replaceSession(session);
                    message.textContent = path.endsWith("password") ? "Password updated." : "Profile saved.";
                    if (path.endsWith("password")) form.reset();
                } catch (error) { message.textContent = error.message; }
                finally { button.disabled = false; }
            });
            bind(page.querySelector("#accountProfileForm"), "/settings/account");
            bind(page.querySelector("#accountPasswordForm"), "/settings/account/password");
        } catch (error) { page.innerHTML = `<div class="portal-card">${errorState(error)}</div>`; }
    };
    void load();
    return page;
}
