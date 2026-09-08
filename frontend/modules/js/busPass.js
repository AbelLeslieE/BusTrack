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
            <p>Present your live QR to the driver for secure verification.</p>
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
                    ${student.photo ? `<img class="bus-pass-official-photo" src="${escapeHtml(student.photo)}" alt="Official student photo">` : '<span class="bus-pass-avatar" aria-hidden="true">?</span>'}
                    <div>
                        <h2>${display(student.name, "Student")}</h2>
                        <p>${display(student.student_code, "Student ID not recorded")}</p>
                        <p>${display(student.department, "Department not enrolled")}</p>
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
                        <p>Status reported by the transport office. The driver must scan your QR and compare your official photo before boarding.</p>
                        ${expiryAlert}
                    </div>
                    <span class="portal-badge">${statusName}</span>
                </div>
                <div class="live-pass-qr" aria-live="polite"><p>Requesting a live QR…</p></div>
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

    let disposed = false;
    let busy = false;
    let timer;
    let controller;
    let expires = 0;
    let generation = 0;
    const clearQR = message => {
        expires = 0;
        const box = page.querySelector(".live-pass-qr");
        if (box) { box.replaceChildren(); const p = document.createElement("p"); p.textContent = message; box.append(p); }
    };
    const load = async () => {
        if (disposed || busy || document.hidden) return;
        busy = true;
        const current = ++generation;
        const started = performance.now();
        const requestController = new AbortController();
        controller = requestController;
        const timeout = setTimeout(() => requestController.abort(), 8000);
        clearQR("Refreshing secure QR…");
        try {
            const data = await request(BUS_PASS_ENDPOINT, { cache: "no-store", signal: requestController.signal });
            if (disposed || current !== generation) return;
            page.innerHTML = data.bus_pass ? renderPass(data) : `
                <header class="portal-header">
                    <p class="portal-eyebrow">STUDENT PORTAL</p>
                    <h1>Bus Pass</h1>
                    <p>Your verified transport pass and current assignment.</p>
                </header>
                ${renderEmptyAssignment()}`;
            if (data.bus_pass) {
                const token = await request(`${BUS_PASS_ENDPOINT}/live-token`, {
                    method: "POST", body: "{}", cache: "no-store", signal: requestController.signal
                });
                if (disposed || current !== generation) return;
                // This timer controls display only; server time authorizes scans.
                expires = performance.now() + Math.max(0, (token.expiresAt - token.serverTime) * 1000 - (performance.now() - started));
                const box = page.querySelector(".live-pass-qr");
                box.innerHTML = `<img src="${escapeHtml(token.qrImage)}" alt="Short-lived bus pass QR"><p class="qr-countdown"></p><small>Show this live screen. Screenshots expire quickly.</small>`;
            }
        } catch (error) {
            if (disposed || current !== generation) return;
            if (page.querySelector(".live-pass-qr")) clearQR(error.name === "AbortError" ? "Connection required. QR refresh timed out." : error.message);
            else page.innerHTML = `<section class="portal-card">${errorState(error)}</section>`;
        } finally {
            clearTimeout(timeout);
            if (current === generation) busy = false;
            if (!disposed && current === generation) timer = setTimeout(load, expires ? 19000 : 5000);
        }
    };
    const countdown = setInterval(() => {
        if (!expires) return;
        const seconds = Math.max(0, Math.ceil((expires - performance.now()) / 1000));
        const label = page.querySelector(".qr-countdown");
        if (label) label.textContent = `QR expires in ${seconds} seconds`;
        if (!seconds) clearQR("QR expired. Refreshing requires a connection.");
    }, 250);
    const visibility = () => {
        clearTimeout(timer);
        if (document.hidden) { generation++; controller?.abort(); clearQR("Reopen this page to refresh your QR."); }
        else { busy = false; void load(); }
    };
    document.addEventListener("visibilitychange", visibility);
    page.cleanup = () => {
        disposed = true; generation++; controller?.abort(); clearTimeout(timer); clearInterval(countdown);
        document.removeEventListener("visibilitychange", visibility);
        clearQR("");
    };
    void load();
    return page;
}
