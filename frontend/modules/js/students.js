import { Modal } from "/static/common/modal.js";
import { createDropdown } from "/static/common/dropdown.js";

const API = "/api/students";

function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, character => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
    }[character]));
}

function assignmentLabel(student) {
    if (!student.route) return "Unassigned";
    const bus = student.bus?.bus_number || "No bus assigned";
    return `${student.route.route_code} · ${student.route.route_name} · ${bus}`;
}

function downloadCsv(filename, rows) {
    const cell = value => {
        let text = String(value ?? "");
        // Spreadsheet applications can evaluate cells beginning with these characters.
        if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
        return `"${text.replaceAll('"', '""')}"`;
    };
    const blob = new Blob(["\uFEFF", rows.map(row => row.map(cell).join(",")).join("\r\n"), "\r\n"], {
        type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function downloadTemplate() {
    downloadCsv("bustrack-student-template.csv", [
        ["full_name", "email"],
        ["Example Student", "student@example.edu"],
    ]);
}

async function importLogins(file, reload) {
    const body = new FormData();
    body.append("file", file);
    const result = await request(`${API}/import-logins`, { method: "POST", body });
    if (result.created_count) {
        const today = new Date().toISOString().slice(0, 10);
        downloadCsv(`bustrack-student-logins-${today}.csv`, [
            ["full_name", "email", "student_code", "temporary_password"],
            ...result.credentials.map(entry => [
                entry.full_name, entry.email, entry.student_code, entry.temporary_password,
            ]),
        ]);
    }
    result.credentials = [];
    Modal.close();
    await reload();
    Modal.success({
        eyebrow: "STUDENT LOGINS",
        title: result.created_count ? "Student logins created" : "No new logins needed",
        subtitle: `${result.created_count} created · ${result.existing_count} already had accounts. ${result.created_count ? "The credentials CSV was downloaded once. Give each student only their own row." : "Existing passwords were left unchanged."}`,
    });
}

function confirmImport(file, reload) {
    if (!file) return;
    let submitting = false;
    Modal.confirm({
        eyebrow: "STUDENT LOGINS",
        title: "Create student logins?",
        subtitle: file.name,
        confirmText: "Create and download",
        style: "primary",
        content: `<p>Upload a UTF-8 CSV with <strong>full_name</strong> and <strong>email</strong> columns (up to 500 students). New accounts use their email to sign in and must change the initial password on first login. Existing student accounts are skipped without changing their passwords.</p><p>The download contains initial passwords and is available only after this import. Store it securely and share each row privately.</p>`,
        onConfirm: async () => {
            if (submitting) return;
            submitting = true;
            try {
                await importLogins(file, reload);
            } catch (error) {
                submitting = false;
                throw error;
            }
        },
    });
}

function renderRows(students) {
    if (!students.length) {
        return `<tr><td colspan="7" class="students-empty">No student accounts have been created yet.</td></tr>`;
    }

    return students.map(student => `
        <tr>
            <td><strong>${escapeHtml(student.student_code)}</strong></td>
            <td><strong>${escapeHtml(student.full_name)}</strong><small>${escapeHtml(student.username || "—")}</small></td>
            <td>${escapeHtml(student.email || "—")}</td>
            <td>${student.route ? `${escapeHtml(student.route.route_code)} · ${escapeHtml(student.route.route_name)}` : "<span class=\"students-unassigned\">Unassigned</span>"}</td>
            <td>${escapeHtml(student.bus?.bus_number || "—")}</td>
            <td>${escapeHtml(student.stop?.stop_name || "—")}</td>
            <td>
                <div class="students-actions">
                    <button type="button" class="table-action-btn student-view" data-id="${student.id}" title="View student">👁</button>
                    <button type="button" class="table-action-btn student-assign" data-id="${student.id}" title="Edit route assignment">✎</button>
                    <button type="button" class="table-action-btn student-reset" data-id="${student.id}" aria-label="Reset login for ${escapeHtml(student.full_name)}" title="${student.status === "Active" ? "Issue a new temporary password" : "Activate this account in Users first"}" ${student.status === "Active" ? "" : "disabled"}>Reset login</button>
                </div>
            </td>
        </tr>`).join("");
}

function renderPage(students) {
    const assigned = students.filter(student => student.route).length;
    const root = document.createElement("section");
    root.className = "students-page";
    root.innerHTML = `
        <header class="students-hero glass-card">
            <div>
                <p class="students-eyebrow">Student management</p>
                <h1>Students</h1>
                <p>See every student account and manage the route and boarding-stop assignment in one dedicated place.</p>
            </div>
            <div class="students-summary"><strong>${assigned}/${students.length}</strong><span>students assigned</span></div>
        </header>
        <section class="students-table-card glass-card">
            <div class="students-table-heading"><div><h2>Student directory</h2><p>Student transport assignments are managed here. Upload a CSV to create student logins in bulk.</p></div><div class="students-toolbar"><button type="button" class="students-refresh students-template">Download CSV template</button><button type="button" class="students-refresh students-import">Upload student logins</button><button type="button" class="students-refresh students-reload">↻ Refresh</button><input class="students-import-file" type="file" accept=".csv,text/csv" hidden aria-label="Student login CSV"></div></div>
            <div class="students-table-wrap"><table class="students-table"><thead><tr><th>Code</th><th>Student</th><th>Email</th><th>Route</th><th>Bus</th><th>Boarding stop</th><th>Actions</th></tr></thead><tbody>${renderRows(students)}</tbody></table></div>
        </section>`;
    return root;
}

async function request(path, options = {}) {
    const response = await fetch(path, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || "Request failed.");
    return data;
}

async function openAssignmentModal(student, reload) {
    const [routes, form] = await Promise.all([
        request("/api/routes"),
        Promise.resolve(document.createElement("div")),
    ]);

    form.className = "student-assignment-form";
    form.innerHTML = `
        <p class="assignment-help">Select the student's route. Its bus is supplied automatically from the central Assignments workspace.</p>
        <div class="modal-group"><label class="modal-label">Assigned Route</label><div class="student-route-dropdown"></div></div>
        <div class="modal-group"><label class="modal-label">Boarding Stop</label><div class="student-stop-dropdown"></div></div>`;

    const routeDropdown = createDropdown({
        id: "student-management-route",
        placeholder: "No route assigned",
        value: student.route?.id ?? "",
        items: [
            { value: "", label: "No route assigned" },
            ...routes.map(route => ({
                value: route.id,
                label: `${route.route_code} · ${route.route_name}${route.bus_number ? ` · ${route.bus_number}` : " · No bus"}`,
            })),
        ],
    });
    const stopDropdown = createDropdown({
        id: "student-management-stop",
        placeholder: "No boarding stop",
        value: student.stop?.id ?? "",
        items: [{ value: "", label: "No boarding stop" }],
    });
    form.querySelector(".student-route-dropdown").appendChild(routeDropdown);
    form.querySelector(".student-stop-dropdown").appendChild(stopDropdown);

    async function loadStops(routeId, selectedStopId = "") {
        stopDropdown.setItems([{ value: "", label: "No boarding stop" }]);
        stopDropdown.clear();
        if (!routeId) return;
        const stops = await request(`/api/route-stops/${routeId}`);
        stopDropdown.setItems([
            { value: "", label: "No boarding stop" },
            ...stops.map(stop => ({
                value: stop.stop_id,
                label: `${stop.stop_name} · ${stop.stop_code}`,
            })),
        ]);
        stopDropdown.setValue(selectedStopId || "");
    }

    routeDropdown.addEventListener("change", event => loadStops(event.detail));
    if (student.route?.id) await loadStops(student.route.id, student.stop?.id);

    Modal.form({
        eyebrow: "STUDENT MANAGEMENT",
        title: `Assign ${student.full_name}`,
        subtitle: "Route and boarding stop",
        content: form,
        submitText: "Save assignment",
        onSubmit: async () => {
            await request(`${API}/${student.id}/assignment`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    route_id: Number(routeDropdown.getValue()) || null,
                    stop_id: Number(stopDropdown.getValue()) || null,
                }),
            });
            Modal.close();
            await reload();
            Modal.success({ eyebrow: "STUDENT MANAGEMENT", title: "Assignment updated", subtitle: "The student portal will use the new route and bus." });
        },
    });
}

function openViewModal(student) {
    Modal.alert({
        eyebrow: "STUDENT MANAGEMENT",
        title: student.full_name,
        subtitle: student.student_code,
        content: `<div class="detail-list"><p><strong>Email:</strong> ${escapeHtml(student.email || "—")}</p><p><strong>Phone:</strong> ${escapeHtml(student.phone || "—")}</p><p><strong>Route / bus:</strong> ${escapeHtml(assignmentLabel(student))}</p><p><strong>Boarding stop:</strong> ${escapeHtml(student.stop?.stop_name || "—")}</p><p><strong>Status:</strong> ${escapeHtml(student.status)}</p></div>`,
    });
}

function openResetLoginModal(student) {
    let submitting = false;
    Modal.confirm({
        eyebrow: "STUDENT LOGIN",
        title: `Reset login for ${student.full_name}?`,
        subtitle: student.student_code,
        confirmText: "Reset and download",
        content: `<p>This replaces the student's current password and signs out their active sessions. Download the new temporary password and give it only to this student. They must change it at their next sign-in.</p>`,
        onConfirm: async () => {
            if (submitting) return;
            submitting = true;
            try {
                const result = await request(`${API}/${student.id}/reset-login`, { method: "POST" });
                downloadCsv(`bustrack-login-${result.student_code}.csv`, [
                    ["full_name", "login", "student_code", "temporary_password"],
                    [result.full_name, result.login, result.student_code, result.temporary_password],
                ]);
                result.temporary_password = "";
                Modal.close();
                Modal.success({
                    eyebrow: "STUDENT LOGIN",
                    title: "New login ready",
                    subtitle: "The replacement credential CSV was downloaded. Share it privately with the student.",
                });
            } catch (error) {
                submitting = false;
                throw error;
            }
        },
    });
}

export function render() {
    const view = document.createElement("div");

    const load = async () => {
        view.innerHTML = `<section class="students-loading">Loading student directory…</section>`;
        try {
            const students = await request(`${API}/directory`);
            const page = renderPage(students);
            page.querySelector(".students-reload").addEventListener("click", load);
            page.querySelector(".students-template").addEventListener("click", downloadTemplate);
            const fileInput = page.querySelector(".students-import-file");
            page.querySelector(".students-import").addEventListener("click", () => fileInput.click());
            fileInput.addEventListener("change", () => {
                const file = fileInput.files?.[0];
                fileInput.value = "";
                confirmImport(file, load);
            });
            page.querySelectorAll(".student-view").forEach(button => button.addEventListener("click", () => {
                openViewModal(students.find(student => student.id === Number(button.dataset.id)));
            }));
            page.querySelectorAll(".student-assign").forEach(button => button.addEventListener("click", () => {
                openAssignmentModal(students.find(student => student.id === Number(button.dataset.id)), load)
                    .catch(error => Modal.error({ title: "Unable to Open Assignment", subtitle: error.message }));
            }));
            page.querySelectorAll(".student-reset").forEach(button => button.addEventListener("click", () => {
                openResetLoginModal(students.find(student => student.id === Number(button.dataset.id)));
            }));
            view.replaceChildren(page);
        } catch (error) {
            view.innerHTML = `<section class="students-loading"><h2>Students unavailable</h2><p>${escapeHtml(error.message)}</p></section>`;
        }
    };

    load();
    return view;
}
