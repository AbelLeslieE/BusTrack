import { request } from "/static/common/api.js";
import { emptyState, errorState, value } from "/static/common/portal.js";

export function render() {
    const page = document.createElement("section");
    page.className = "portal-page";
    page.innerHTML = `<div class="portal-loading">Loading your profile…</div>`;
    void request("/students/me").then(student => {
        const user = student.user;
        const bus = student.assigned_bus;
        const stop = student.assigned_stop;
        page.innerHTML = `<header class="portal-header"><p class="portal-eyebrow">STUDENT PORTAL</p><h1>My profile</h1><p>Your account and transport assignment details.</p></header><section class="portal-card"><div class="portal-title-row"><div><h2>${value(user.full_name, "Student")}</h2><p>${value(student.student_code, "Student code not recorded")}</p></div></div><dl class="portal-details"><div><dt>Username</dt><dd>${value(user.username)}</dd></div><div><dt>Email</dt><dd>${value(user.email, "Not provided")}</dd></div><div><dt>Phone</dt><dd>${value(user.phone, "Not provided")}</dd></div><div><dt>Assigned bus</dt><dd>${value(bus?.bus_number, "Not assigned")}</dd></div><div><dt>Assigned route</dt><dd>${value(bus?.route?.route_name || bus?.route?.route_code, "Not assigned")}</dd></div><div><dt>Boarding stop</dt><dd>${value(stop?.stop_name, "Not assigned")}</dd></div></dl></section>${!bus ? emptyState("No transport assignment", "Your bus and stop details will appear after an administrator assigns them.") : ""}`;
    }).catch(error => { page.innerHTML = `<div class="portal-card">${errorState(error)}</div>`; });
    return page;
}
