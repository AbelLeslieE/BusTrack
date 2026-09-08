import { Modal } from "../../common/modal.js";
import { escapeHtml } from "../../common/security.js";

const dateLabel = value => value ? new Date(`${value}T12:00:00`).toLocaleDateString([], {day:"numeric", month:"short", year:"numeric"}) : "Not entered";
const statusLabels = {NOT_ADDED:"Not added", ADDED:"Added", VALID:"Valid", EXPIRING:"Expiring", EXPIRING_SOON:"Expiring soon", EXPIRED:"Expired"};

async function api(url, options) {
    const response = await fetch(url, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(typeof data.detail === "string" ? data.detail : "Unable to save document.");
    return data;
}

export function openBusDetails(bus, selectedDocument = null) {
    const root = document.createElement("div");
    root.className = "bus-documents";
    const endpoint = `/api/buses/${bus.id}/documents`;
    let documents = [], requestId = 0;
    root.innerHTML = `<div class="bus-document-tabs" role="tablist" aria-label="Bus details">
        <button type="button" role="tab" id="bus-overview-tab" aria-controls="bus-overview-panel">Overview</button>
        <button type="button" role="tab" id="bus-documents-tab" aria-controls="bus-documents-panel">Documents &amp; Compliance</button>
        </div><section id="bus-overview-panel" role="tabpanel" aria-labelledby="bus-overview-tab" class="detail-list">
        ${[["Registration",bus.registration_number],["Capacity",bus.capacity],["Vehicle",`${bus.manufacturer || ""} ${bus.model || ""} (${bus.year || "—"})`],["Fuel",bus.fuel_type],["Status",bus.status],["Route",bus.route],["Driver",bus.driver_name],["GPS Device",bus.device_id]].map(([label,value])=>`<p><strong>${label}:</strong> ${escapeHtml(value ?? "Not assigned")}</p>`).join("")}
        </section><section id="bus-documents-panel" role="tabpanel" aria-labelledby="bus-documents-tab" hidden>
        <p class="bus-document-note">All document details, dates and files are optional. Missing or expired documents do not affect bus tracking or trips.</p>
        <div class="bus-document-message" role="status"></div><div class="bus-document-content"></div></section>`;
    const content = root.querySelector(".bus-document-content");
    const message = root.querySelector(".bus-document-message");

    function reveal(target) {
        if (!target) return;
        const body = root.closest(".modal-body");
        if (body) body.scrollTop += target.getBoundingClientRect().top - body.getBoundingClientRect().top - 16;
    }

    function cards() {
        content.innerHTML = `<div class="bus-document-grid">${documents.map(doc => `<article class="bus-document-card" data-document="${doc.document_type}" tabindex="-1">
            <h3>${escapeHtml(doc.label)}</h3><span class="bus-document-status status-${doc.status}">${statusLabels[doc.status] || "Added"}</span>
            ${doc.status !== "NOT_ADDED" ? `<dl><dt>Document number</dt><dd>${escapeHtml(doc.document_number || "Not entered")}</dd><dt>Issue date</dt><dd>${dateLabel(doc.issue_date)}</dd><dt>Valid from</dt><dd>${dateLabel(doc.valid_from)}</dd><dt>${doc.status === "EXPIRED" ? "Expired on" : "Valid until"}</dt><dd>${dateLabel(doc.valid_until)}</dd><dt>Remarks</dt><dd>${escapeHtml(doc.remarks || "Not entered")}</dd></dl>` : `<p>No information added yet.</p>`}
            <div class="bus-document-actions">${doc.has_file ? `<button type="button" data-download="${doc.document_type}">Download file</button>` : ""}<button type="button" data-edit="${doc.document_type}">${doc.status === "NOT_ADDED" ? "Add" : "Update / Renew"}</button></div></article>`).join("")}</div>`;
    }

    async function load() {
        const id = ++requestId;
        content.textContent = "Loading documents…";
        try {
            const data = await api(endpoint);
            if (id !== requestId || !root.isConnected) return;
            documents = data.documents || [];
            cards();
            if (selectedDocument) {
                const target = [...content.querySelectorAll("[data-document]")].find(el=>el.dataset.document === selectedDocument);
                target?.focus({preventScroll:true});
                reveal(target);
                selectedDocument = null;
            }
        } catch (error) {
            if (id !== requestId || !root.isConnected) return;
            content.innerHTML = `<p>${escapeHtml(error.message)}</p><button type="button" data-retry>Try again</button>`;
        }
    }

    function tab(showDocuments) {
        root.querySelector("#bus-overview-panel").hidden = showDocuments;
        root.querySelector("#bus-documents-panel").hidden = !showDocuments;
        root.querySelectorAll('[role="tab"]').forEach((button,index)=>{
            const active = Boolean(index) === showDocuments;
            button.setAttribute("aria-selected",String(active));
            button.tabIndex = active ? 0 : -1;
        });
        if (showDocuments && !documents.length) load();
    }

    function edit(kind) {
        const doc = documents.find(item=>item.document_type === kind);
        if (!doc) return;
        message.textContent = "";
        content.innerHTML = `<form class="bus-document-form"><h3>${escapeHtml(doc.label)}</h3><p>Enter any details you have. Every field below is optional.</p><div class="bus-document-fields">
            <label>Document number<input name="document_number" maxlength="120" value="${escapeHtml(doc.document_number || "")}"></label>
            ${[["issue_date","Issue date"],["valid_from","Valid from"],["valid_until","Valid until"]].map(([key,label])=>`<label>${label}<input type="date" name="${key}" value="${escapeHtml(doc[key] || "")}"></label>`).join("")}
            <label class="wide">Remarks<textarea name="remarks" maxlength="4000" rows="3">${escapeHtml(doc.remarks || "")}</textarea></label>
            <label class="wide">Document file (PDF, JPG, JPEG or PNG; up to 5 MB)<input type="file" name="file" accept=".pdf,.jpg,.jpeg,.png"></label>
            ${doc.has_file ? `<p class="wide">Current file: ${escapeHtml(doc.file_name)}. Leave upload empty to keep it.</p><label class="wide bus-document-checkbox"><input type="checkbox" name="remove_file">Remove current file</label>` : ""}
            </div><div class="bus-document-actions"><button type="button" data-cancel>Back to documents</button><button type="submit">Save document</button></div><p class="bus-document-error" role="alert"></p></form>`;
        const form = content.querySelector("form");
        form.querySelector("input")?.focus({preventScroll:true});
        reveal(form);
        let saving = false;
        form.addEventListener("submit", async event => {
            event.preventDefault();
            if (saving) return;
            const fields = new FormData(form), file = fields.get("file");
            const errorTarget = form.querySelector('[role="alert"]');
            errorTarget.textContent = "";
            if (file?.size > 5 * 1024 * 1024) { errorTarget.textContent = "Choose a file up to 5 MB."; return; }
            const metadata = {expected_version:doc.version || 0, remove_file:fields.get("remove_file") === "on"};
            for (const key of ["document_number","issue_date","valid_from","valid_until","remarks"]) metadata[key] = fields.get(key)?.trim() || null;
            const body = new FormData();
            body.set("metadata", JSON.stringify(metadata));
            if (file?.name) body.set("file", file);
            saving = true;
            form.querySelectorAll("button").forEach(button=>button.disabled=true);
            try {
                const saved = await api(`${endpoint}/${kind}`, {method:"PUT",body});
                if (!form.isConnected) return;
                documents = documents.map(item=>item.document_type === kind ? saved : item);
                cards();
                message.textContent = "Document saved.";
                content.querySelector(`[data-edit="${kind}"]`)?.focus({preventScroll:true});
                reveal(content.querySelector(`[data-document="${kind}"]`));
            } catch (error) {
                errorTarget.textContent = error.message;
            } finally {
                saving = false;
                form.querySelectorAll("button").forEach(button=>button.disabled=false);
            }
        });
    }

    root.querySelectorAll('[role="tab"]').forEach((button,index)=>{
        button.addEventListener("click",()=>tab(Boolean(index)));
        button.addEventListener("keydown",event=>{
            if (!["ArrowLeft","ArrowRight","Home","End"].includes(event.key)) return;
            event.preventDefault();
            const next = event.key === "Home" ? 0 : event.key === "End" ? 1 : 1-index;
            tab(Boolean(next));
            root.querySelectorAll('[role="tab"]')[next].focus();
        });
    });
    root.addEventListener("click",async event=>{
        const button=event.target.closest("button");
        if (!button) return;
        if (button.hasAttribute("data-edit")) edit(button.dataset.edit);
        if (button.hasAttribute("data-cancel")) cards();
        if (button.hasAttribute("data-retry")) load();
        if (button.hasAttribute("data-download")) {
            button.disabled = true;
            try {
                const response = await fetch(`${endpoint}/${button.dataset.download}/file`);
                if (!response.ok) throw new Error("Unable to download this file. Please reopen the document.");
                const url = URL.createObjectURL(await response.blob());
                const link = document.createElement("a");
                link.href = url; link.download = documents.find(d=>d.document_type === button.dataset.download)?.file_name || "document";
                link.click();
                window.setTimeout(()=>URL.revokeObjectURL(url),1000);
            } catch(error) { message.textContent = error.message; }
            finally { button.disabled=false; }
        }
    });
    Modal.open({eyebrow:"Fleet management",title:bus.bus_number,subtitle:bus.registration_number,size:"lg",content:root,
        actions:[{text:"Close",style:"secondary",close:true}],onClose:()=>{requestId++;},onOpen:()=>{
            root.closest(".modal").scrollTop = 0;
            root.closest(".modal-body").scrollTop = 0;
            tab(Boolean(selectedDocument));
        }});
}
