import { Modal } from "/static/common/modal.js";
import { request } from "/static/common/api.js";
import { createDropdown } from "/static/common/dropdown.js";
import { confirmDeletion, showOperationFeedback } from "/static/common/operationFeedback.js";

const API = "/bus-passes";

function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, character => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
    }[character]));
}

function dateValue(value) {
    return value ? String(value).slice(0, 10) : "";
}

function formatDate(value) {
    if (!value) return "—";
    const date = new Date(`${dateValue(value)}T00:00:00`);
    return Number.isNaN(date.getTime()) ? escapeHtml(value) : new Intl.DateTimeFormat(undefined, {
        day: "2-digit", month: "short", year: "numeric"
    }).format(date);
}

function calendarDate(value) {
    return new Date(`${value}T00:00:00`);
}

function dateInputValue(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function plannedExpiry(startValue, period) {
    const start = calendarDate(startValue);
    if (Number.isNaN(start.getTime()) || period === "Custom Dates") return "";
    if (period === "One Day") return dateInputValue(start);
    const originalMonth = start.getMonth();
    start.setFullYear(start.getFullYear() + 1);
    // Match the server's leap-day rule: 29 Feb renews on 28 Feb.
    if (start.getMonth() !== originalMonth) start.setDate(0);
    return dateInputValue(start);
}

function badge(pass) {
    if (!pass) return '<span class="bus-passes-badge is-pending">Not issued</span>';
    const status = pass.effective_status || pass.status || "Pending";
    return `<span class="bus-passes-badge is-${status.toLowerCase()}">${escapeHtml(status)}</span>`;
}

function recordRow(record) {
    const pass = record.bus_pass;
    const assignment = record.transport;
    const action = pass
        ? `<div class="bus-passes-actions"><button type="button" class="bus-passes-action edit-pass" data-pass-id="${pass.id}">Manage</button><button type="button" class="bus-passes-action is-delete delete-pass" data-pass-id="${pass.id}">Delete</button></div>`
        : `<button type="button" class="bus-passes-action issue-pass" data-student-id="${record.student.id}" ${assignment.assigned ? "" : "disabled title=\"Assign a route and bus first\""}>Issue pass</button>`;
    return `<tr>
        <td><strong>${escapeHtml(record.student.name)}</strong><small>${escapeHtml(record.student.student_code)}</small></td>
        <td>${assignment.assigned ? `<strong>${escapeHtml(assignment.bus_number)}</strong><small>${escapeHtml(assignment.route_name)}</small>` : '<span class="bus-passes-unassigned">Bus assignment pending</span>'}</td>
        <td>${escapeHtml(assignment.boarding_stop || "—")}</td>
        <td>${pass ? `<strong>${escapeHtml(pass.pass_number)}</strong><small>${escapeHtml(pass.validity_period)}</small>` : "—"}</td>
        <td>${badge(pass)}${pass?.expiring_soon ? '<small class="bus-passes-expiry">Expires within 30 days</small>' : ""}</td>
        <td>${pass ? formatDate(pass.valid_until) : "—"}</td>
        <td>${action}</td>
    </tr>`;
}

function renderPage(data) {
    const root = document.createElement("section");
    root.className = "bus-passes-page";
    root.innerHTML = `
        <header class="bus-passes-hero glass-card">
            <div><p class="bus-passes-eyebrow">Transport administration</p><h1>Bus Passes</h1><p>Issue, renew, and suspend passes. The bus, route, and boarding stop always come from each student's central transport assignment.</p></div>
            <div class="bus-passes-summary"><strong>${data.issued}/${data.total}</strong><span>passes issued</span><small>${data.expiring_soon} expiring within 30 days</small></div>
        </header>
        <section class="bus-passes-guidance glass-card"><span>1. Assign bus and route</span><i>→</i><span>2. Assign student and stop</span><i>→</i><span>3. Issue pass for any validity</span><i>→</i><span>4. Renew or change dates</span></section>
        <section class="bus-passes-table-card glass-card">
            <div class="bus-passes-table-heading"><div><h2>Student bus passes</h2><p>Set one-day, yearly, two-semester, or custom expiry dates directly when issuing or renewing.</p></div><button type="button" class="bus-passes-refresh">↻ Refresh</button></div>
            <div class="bus-passes-table-wrap"><table class="bus-passes-table"><thead><tr><th>Student</th><th>Assigned transport</th><th>Boarding stop</th><th>Pass number</th><th>Status</th><th>Valid until</th><th>Action</th></tr></thead><tbody>${data.records.length ? data.records.map(recordRow).join("") : '<tr><td colspan="7" class="bus-passes-empty">No student accounts are available.</td></tr>'}</tbody></table></div>
        </section>`;
    attachEvents(root, data);
    return root;
}

function formMarkup(record, mode) {
    const pass = record.bus_pass;
    const today = new Date().toISOString().slice(0, 10);
    const initialStartDate = dateValue(pass?.valid_from) || today;
    const initialValidityPeriod = pass?.validity_period || "One Year";
    // A normal pass is always shown as one full year by default.  Only a
    // deliberately custom pass keeps its saved end date unchanged.
    const initialExpiryDate = initialValidityPeriod === "Custom Dates"
        ? (dateValue(pass?.valid_until) || initialStartDate)
        : (plannedExpiry(initialStartDate, initialValidityPeriod) || initialStartDate);
    return `<form class="bus-pass-form">
        <p class="bus-pass-form__assignment"><strong>${escapeHtml(record.student.name)}</strong><br>${escapeHtml(record.transport.bus_number || "Bus assignment pending")} · ${escapeHtml(record.transport.route_name || "No route")}</p>
        <div class="modal-group"><label class="modal-label" for="bus-pass-valid-from">${mode === "issue" ? "Pass start date" : "Renewal start date"}</label><input id="bus-pass-valid-from" type="date" value="${initialStartDate}" required></div>
        <div class="modal-group"><label class="modal-label">Validity plan</label><div class="bus-pass-period-dropdown"></div><small class="bus-pass-form__hint">One Day ends on the selected day. You may always edit the expiry date.</small></div>
        <div class="modal-group"><label class="modal-label" for="bus-pass-valid-until">Expiry date</label><input id="bus-pass-valid-until" type="date" value="${initialExpiryDate}" required></div>
        <div class="modal-group"><label class="modal-label" for="bus-pass-academic-year">Academic year / session</label><input id="bus-pass-academic-year" type="text" maxlength="30" value="${escapeHtml(pass?.academic_year || "")}" placeholder="2026–2027"></div>
        <div class="modal-group"><label class="modal-label">Pass status</label><div class="bus-pass-status-dropdown"></div></div>
    </form>`;
}

function openPassModal(record, mode, reload) {
    const form = document.createElement("div");
    form.innerHTML = formMarkup(record, mode);
    const pass = record.bus_pass;
    const periodDropdown = createDropdown({
        id: "bus-pass-period",
        placeholder: "Select validity",
        value: pass?.validity_period || "One Year",
        items: ["One Day", "One Year", "Two Semesters", "Custom Dates"],
    });
    const statusDropdown = createDropdown({
        id: "bus-pass-status",
        placeholder: "Select status",
        value: pass?.status || "Active",
        items: mode === "issue" ? ["Active", "Pending"] : ["Active", "Pending", "Suspended"],
    });
    form.querySelector(".bus-pass-period-dropdown").appendChild(periodDropdown);
    form.querySelector(".bus-pass-status-dropdown").appendChild(statusDropdown);

    const validFrom = form.querySelector("#bus-pass-valid-from");
    const validUntil = form.querySelector("#bus-pass-valid-until");
    const applyPlannedExpiry = () => {
        const expiry = plannedExpiry(validFrom.value, periodDropdown.getValue());
        if (expiry) validUntil.value = expiry;
    };
    periodDropdown.onChange(applyPlannedExpiry);
    validFrom.addEventListener("change", applyPlannedExpiry);
    validUntil.addEventListener("change", () => {
        const planned = plannedExpiry(validFrom.value, periodDropdown.getValue());
        if (planned && validUntil.value !== planned) periodDropdown.setValue("Custom Dates");
    });
    const submitText = mode === "issue" ? "Issue bus pass" : "Save pass changes";
    Modal.form({
        eyebrow: "BUS PASS MANAGEMENT",
        title: mode === "issue" ? `Issue pass for ${record.student.name}` : `Manage ${record.student.name}'s pass`,
        subtitle: mode === "issue" ? "The server creates the pass number; you control the validity dates." : "Renew, suspend, or change any pass date as needed.",
        content: form,
        submitText,
        onSubmit: async () => {
            const payload = {
                valid_from: validFrom.value,
                valid_until: validUntil.value,
                validity_period: periodDropdown.getValue(),
                academic_year: form.querySelector("#bus-pass-academic-year").value.trim() || null,
                status: statusDropdown.getValue(),
            };
            try {
                if (mode === "issue") {
                    await request(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ student_id: record.student.id, ...payload }) });
                } else {
                    await request(`${API}/${record.bus_pass.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
                }
                Modal.close();
                await reload();
                showOperationFeedback({
                    type: "success",
                    title: mode === "issue" ? "Bus pass issued" : "Bus pass updated",
                    message: mode === "issue" ? "The student can now view the issued pass." : "The pass changes have been saved."
                });
            } catch (error) {
                showOperationFeedback({
                    type: "error",
                    title: "Bus pass not saved",
                    message: error.message || "Please review the pass details and try again."
                });
                throw error;
            }
        },
    });
}

function attachEvents(root, data) {
    const reload = async () => {
        root.replaceWith(await loadPage());
    };
    root.querySelector(".bus-passes-refresh").addEventListener("click", () => void reload());
    root.querySelectorAll(".issue-pass").forEach(button => button.addEventListener("click", () => {
        const record = data.records.find(item => item.student.id === Number(button.dataset.studentId));
        if (record) openPassModal(record, "issue", reload);
    }));
    root.querySelectorAll(".edit-pass").forEach(button => button.addEventListener("click", () => {
        const record = data.records.find(item => item.bus_pass?.id === Number(button.dataset.passId));
        if (record) openPassModal(record, "manage", reload);
    }));
    root.querySelectorAll(".delete-pass").forEach(button => button.addEventListener("click", async () => {
        const record = data.records.find(item => item.bus_pass?.id === Number(button.dataset.passId));
        if (!record) return;
        const confirmed = await confirmDeletion({
            title: "Delete this bus pass?",
            message: `This removes ${record.student.name}'s pass but keeps their bus, route, and stop assignment unchanged.`,
            confirmText: "Delete pass"
        });
        if (!confirmed) return;
        try {
            await request(`${API}/${record.bus_pass.id}`, { method: "DELETE" });
            await reload();
            showOperationFeedback({
                type: "success",
                title: "Bus pass deleted",
                message: "The student's transport assignment was kept unchanged."
            });
        } catch (error) {
            showOperationFeedback({
                type: "error",
                title: "Bus pass not deleted",
                message: error.message || "Please try again."
            });
        }
    }));
}

async function loadPage() {
    const data = await request(API);
    return renderPage(data);
}

export function render() {
    const loading = document.createElement("section");
    loading.className = "bus-passes-loading";
    loading.textContent = "Loading bus passes…";
    void loadPage().then(page => loading.replaceWith(page)).catch(error => {
        loading.innerHTML = `<section class="bus-passes-error"><h2>Bus passes unavailable</h2><p>${escapeHtml(error.message)}</p></section>`;
    });
    return loading;
}
