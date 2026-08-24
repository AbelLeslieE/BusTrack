import { request } from "/static/common/api.js";
import { errorState } from "/static/common/portal.js";

const BUS_PASS_ENDPOINT = "/students/me/bus-pass";

function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function display(value, fallback = "Not recorded") {
    return value ? escapeHtml(value) : fallback;
}

function formatDate(value) {
    if (!value) return "Not recorded";
    const date = new Date(`${value}T00:00:00`);
    return Number.isNaN(date.getTime())
        ? escapeHtml(value)
        : new Intl.DateTimeFormat(undefined, {
            day: "2-digit",
            month: "short",
            year: "numeric"
        }).format(date);
}

function statusClass(status) {
    return String(status || "pending").toLowerCase().replace(/[^a-z]/g, "");
}

function renderEmptyAssignment() {
    return `
        <section class="portal-card bus-pass-empty">
            <i class="fa-regular fa-id-card" aria-hidden="true"></i>
            <div>
                <h2>No bus pass has been assigned to your account.</h2>
                <p>Your transport office can issue a pass after your bus assignment is confirmed.</p>
            </div>
        </section>`;
}

function renderPass(data) {
    const pass = data.bus_pass;
    const student = data.student || {};
    const transport = data.transport || {};
    const bus = transport.bus;
    const route = transport.route;
    const stop = transport.boarding_stop;
    const status = pass.effective_status || pass.status || "Pending";
    const statusName = escapeHtml(status.toUpperCase());
    const expiryAlert = data.alerts?.[0]
        ? `<p class="bus-pass-expiry-alert"><i class="fa-solid fa-bell" aria-hidden="true"></i>${escapeHtml(data.alerts[0].message)}</p>`
        : "";
    const assignmentNotice = !bus
        ? '<p class="bus-pass-assignment-notice">Bus assignment pending.</p>'
        : "";

    return `
        <header class="portal-header">
            <p class="portal-eyebrow">STUDENT PORTAL</p>
            <h1>Bus Pass</h1>
            <p>Your verified transport pass and current assignment.</p>
        </header>

        <section class="bus-pass-layout" aria-label="Digital bus pass">
            <article class="digital-bus-pass status-${statusClass(status)}">
                <div class="bus-pass-card-top">
                    <div>
                        <p>COLLEGE BUS PASS</p>
                        <strong>BusTrack</strong>
                    </div>
                    <span class="bus-pass-chip" aria-hidden="true"></span>
                </div>

                <div class="bus-pass-person">
                    <span class="bus-pass-avatar" aria-hidden="true">${escapeHtml((student.name || "S").trim().charAt(0).toUpperCase())}</span>
                    <div>
                        <h2>${display(student.name, "Student")}</h2>
                        <p>${display(student.student_code, "Student ID not recorded")}</p>
                    </div>
                </div>

                <dl class="bus-pass-card-details">
                    <div><dt>Bus</dt><dd>${display(bus?.bus_number, "Assignment pending")}</dd></div>
                    <div><dt>Route</dt><dd>${display(route?.route_name || route?.route_code, "Assignment pending")}</dd></div>
                    <div><dt>Boarding stop</dt><dd>${display(stop?.stop_name, "Not assigned")}</dd></div>
                    <div><dt>Pass ID</dt><dd>${display(pass.pass_number)}</dd></div>
                </dl>

                <div class="bus-pass-validity">
                    <div><span>VALID UNTIL</span><strong>${formatDate(pass.valid_until)}</strong></div>
                    <span class="bus-pass-status">${statusName}</span>
                </div>
            </article>

            <aside class="portal-card bus-pass-details">
                <div class="portal-title-row">
                    <div>
                        <p class="portal-eyebrow">PASS STATUS</p>
                        <h2>${statusName}</h2>
                        <p>${pass.is_valid ? "This pass is currently valid for the assigned bus." : "This pass is not currently valid for travel."}</p>
                        ${expiryAlert}
                    </div>
                    <span class="portal-badge">${pass.is_valid ? "VALID" : "CHECK STATUS"}</span>
                </div>
                <dl class="portal-details">
                    <div><dt>Pass number</dt><dd>${display(pass.pass_number)}</dd></div>
                    <div><dt>Academic year</dt><dd>${display(pass.academic_year)}</dd></div>
                    <div><dt>Pass duration</dt><dd>${display(pass.validity_period)}</dd></div>
                    <div><dt>Valid from</dt><dd>${formatDate(pass.valid_from)}</dd></div>
                    <div><dt>Valid until</dt><dd>${formatDate(pass.valid_until)}</dd></div>
                    <div><dt>Vehicle registration</dt><dd>${display(bus?.registration_number, "Not assigned")}</dd></div>
                    <div><dt>Boarding stop</dt><dd>${display(stop?.stop_name, "Not assigned")}</dd></div>
                </dl>
                ${assignmentNotice}
            </aside>
        </section>`;
}

export function render() {
    const page = document.createElement("section");
    page.className = "portal-page bus-pass-page";
    page.innerHTML = '<div class="portal-loading">Loading your bus pass…</div>';

    const load = async () => {
        try {
            const data = await request(BUS_PASS_ENDPOINT);
            page.innerHTML = data.bus_pass ? renderPass(data) : `
                <header class="portal-header">
                    <p class="portal-eyebrow">STUDENT PORTAL</p>
                    <h1>Bus Pass</h1>
                    <p>Your verified transport pass and current assignment.</p>
                </header>
                ${renderEmptyAssignment()}`;
        } catch (error) {
            page.innerHTML = `<section class="portal-card">${errorState(error)}</section>`;
        }
    };

    void load();
    return page;
}
