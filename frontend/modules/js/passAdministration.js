import { Modal } from "/static/common/modal.js";
import { request } from "/static/common/api.js";
import { escapeHtml } from "/static/common/security.js";

export async function editPassIdentity(studentId) {
    try {
        const identity = await request(`/bus-passes/identities/${studentId}`);
        const content = document.createElement("div");
        content.innerHTML = `<p>Enroll the official college identity. Students cannot edit these fields through their profile.</p>
            <div class="modal-group"><label class="modal-label" for="official-pass-name">Official name</label><input id="official-pass-name" maxlength="100" required value="${escapeHtml(identity.official_name)}"></div>
            <div class="modal-group"><label class="modal-label" for="official-pass-department">Department / course</label><input id="official-pass-department" maxlength="120" required value="${escapeHtml(identity.department)}"></div>
            <div class="modal-group"><label class="modal-label" for="official-pass-file">Official photograph (JPEG, PNG or WebP, under 500 KB)</label><input id="official-pass-file" type="file" accept="image/jpeg,image/png,image/webp"></div>
            <img class="pass-enrollment-photo" ${identity.photo ? `src="${escapeHtml(identity.photo)}"` : "hidden"} alt="Official photo preview">`;
        let photo;
        let reading;
        const fileInput = content.querySelector("#official-pass-file");
        const preview = content.querySelector("img");
        fileInput.addEventListener("change", () => {
            photo = undefined;
            const file = fileInput.files[0];
            if (!file) return;
            reading = new Promise((resolve, reject) => {
                if (file.size > 500000) { reject(new Error("Choose a photograph under 500 KB.")); return; }
                const reader = new FileReader();
                reader.onload = () => { photo = String(reader.result).split(",")[1]; preview.src = reader.result; preview.hidden = false; resolve(); };
                reader.onerror = () => reject(new Error("Could not read the photograph."));
                reader.readAsDataURL(file);
            });
            // Validation is displayed by the modal on submit, without unhandled rejections.
            reading.catch(() => {});
        });
        Modal.form({ title: "Official bus pass identity", eyebrow: "ADMIN ENROLLMENT", content, submitText: "Save official identity",
            onSubmit: async () => {
                await reading;
                await request(`/bus-passes/identities/${studentId}`, { method: "PUT", body: JSON.stringify({
                    official_name: content.querySelector("#official-pass-name").value,
                    department: content.querySelector("#official-pass-department").value,
                    photo_base64: photo || null
                }) });
                Modal.close();
            }
        });
    } catch (error) { Modal.error({ title: "Identity unavailable", message: error.message }); }
}

export function passHistory() {
    const panel = document.createElement("section");
    panel.className = "bus-passes-table-card glass-card pass-history";
    const states = ["VALID", "INVALID_SIGNATURE", "QR_EXPIRED", "PASS_EXPIRED", "REVOKED", "SUSPENDED", "WRONG_BUS", "WRONG_ROUTE", "UNKNOWN_PASS", "REPLAY_SUSPECTED", "NO_ACTIVE_TRIP", "UNAUTHORIZED_SCANNER", "ASSIGNMENT_CHANGED", "IDENTITY_REQUIRED"];
    panel.innerHTML = `<div class="bus-passes-table-heading"><div><h2>Verification history</h2><p>Server decisions, including suspicious attempts. No raw QR credentials are retained.</p></div></div>
        <form class="pass-history-filters"><label>Result <select name="result"><option value="">All results</option>${states.map(s => `<option>${s}</option>`).join("")}</select></label>
        <label>Student ID <input name="student_id" type="number" min="1" placeholder="Database ID"></label>
        <label>Bus ID <input name="bus_id" type="number" min="1" placeholder="Database ID"></label>
        <label><input name="suspicious" type="checkbox"> Suspicious only</label><button type="submit">Refresh history</button></form>
        <div class="bus-passes-table-wrap"><table class="bus-passes-table"><thead><tr><th>Student</th><th>Bus / route</th><th>Driver / trip</th><th>Time</th><th>Result / reason</th></tr></thead><tbody></tbody></table></div>
        <p class="history-error" role="status"></p><button class="history-more" type="button" hidden>Load older results</button>`;
    let before = null;
    let busy = false;
    const form = panel.querySelector("form");
    const tbody = panel.querySelector("tbody");
    const more = panel.querySelector(".history-more");
    const load = async (append = false) => {
        if (busy) return;
        busy = true;
        more.disabled = true;
        panel.querySelector(".history-error").textContent = "";
        try {
            const params = new URLSearchParams();
            for (const [key, value] of new FormData(form)) if (value) params.set(key, value === "on" ? "true" : value);
            if (append && before) params.set("before", before);
            const data = await request(`/bus-passes/verifications?${params}`, { cache: "no-store" });
            if (!append) tbody.replaceChildren();
            data.records.forEach(r => {
                const row = document.createElement("tr");
                row.innerHTML = `<td>${escapeHtml(r.student || "Unknown")}<small>${escapeHtml(r.studentId || "")}</small></td>
                    <td>${escapeHtml(r.bus || "—")}<small>${escapeHtml(r.route || "—")}</small></td>
                    <td>${escapeHtml(r.driver)}<small>Trip ${escapeHtml(r.tripId || "—")}</small></td>
                    <td>${escapeHtml(new Date(r.scannedAt.endsWith("Z") || /[+-]\d\d:\d\d$/.test(r.scannedAt) ? r.scannedAt : r.scannedAt + "Z").toLocaleString())}</td>
                    <td><strong>${escapeHtml(r.result)}</strong><small>${escapeHtml(r.reason)}</small></td>`;
                tbody.append(row);
            });
            if (!data.records.length && !append) tbody.innerHTML = '<tr><td colspan="5">No verification records match these filters.</td></tr>';
            before = data.nextBefore;
            more.hidden = !before;
        } catch (error) { panel.querySelector(".history-error").textContent = error.message; }
        finally { busy = false; more.disabled = false; }
    };
    form.addEventListener("submit", e => { e.preventDefault(); void load(); });
    more.addEventListener("click", () => void load(true));
    void load();
    return panel;
}
