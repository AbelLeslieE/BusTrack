import { request } from "/static/common/api.js";
import { Modal } from "/static/common/modal.js";
import { createDropdown } from "/static/common/dropdown.js";
import { escapeHtml } from "/static/common/security.js";

const state = { tokens: [], devices: [], buses: [], statuses: [], translator: null, loading: true };
let page;

function formatDate(value) {
    return value ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "Never";
}

function revealProviderTokenOnce(result, title, subtitle) {
    const providerToken = String(result?.token || "");
    if (!providerToken) {
        Modal.error({ title: "Token generated but unavailable", subtitle: "Create a new token and copy it immediately. Existing token values cannot be retrieved." });
        return;
    }

    Modal.open({
        eyebrow: "CREDENTIALS",
        title,
        subtitle,
        size: "lg",
        closeOnOverlay: false,
        content: `<div class="tech-token-reveal"><p>This is the only time BusTrack will show this value. Copy it now and give it to the GPS provider through an approved secure channel.</p><label class="modal-label" for="tech-one-time-provider-token">Permanent GPS token</label><div class="tech-token-reveal-row"><input class="modal-input" id="tech-one-time-provider-token" value="${escapeHtml(providerToken)}" readonly autocomplete="off" spellcheck="false" aria-label="One-time permanent GPS token"><button class="tech-button secondary" id="tech-copy-provider-token" type="button">Copy token</button></div></div>`,
        actions: [{ text: "I've stored it", style: "primary", close: true }],
        onOpen: () => {
            const input = document.querySelector("#tech-one-time-provider-token");
            const copyButton = document.querySelector("#tech-copy-provider-token");
            copyButton?.addEventListener("click", async () => {
                input?.focus();
                input?.select();
                let copied = false;
                try {
                    if (navigator.clipboard?.writeText) {
                        await navigator.clipboard.writeText(providerToken);
                        copied = true;
                    }
                } catch { /* A manual selection/copy fallback is available below. */ }
                if (!copied) copied = Boolean(document.execCommand?.("copy"));
                copyButton.textContent = copied ? "Copied" : "Select and copy";
            });
        },
    });
}

function renderDashboard() {
    const tokenRows = state.tokens.length ? state.tokens.map(token => `
        <tr><td>${escapeHtml(token.label)}</td><td>${token.bus_id ? `Bus #${token.bus_id}` : "Fleet-wide"}</td><td><span class="tech-status ${token.is_active ? "live" : "offline"}">${token.is_active ? "Active" : "Disabled"}</span></td><td>${formatDate(token.last_used_at)}</td><td class="tech-token-actions"><button class="tech-button danger-outline" data-rotate-token="${token.id}">Rotate</button><button class="tech-button delete-outline" data-delete-token="${token.id}">Delete</button></td></tr>`).join("") : `<tr><td colspan="5" class="tech-empty">No provider tokens exist yet.</td></tr>`;
    const deviceRows = state.devices.length ? state.devices.map(device => `
        <tr><td>${escapeHtml(device.bus_number || `Bus #${device.bus_id}`)}</td><td><code>${escapeHtml(device.external_device_id)}</code></td><td>${escapeHtml(device.display_name || "—")}</td><td><span class="tech-status ${device.is_active ? "live" : "offline"}">${device.is_active ? "Mapped" : "Disabled"}</span></td><td><button class="tech-button secondary" data-edit-device="${device.id}">Edit ID</button></td></tr>`).join("") : `<tr><td colspan="5" class="tech-empty">No device IDs have been mapped.</td></tr>`;
    const statusCards = state.statuses.length ? state.statuses.slice(0, 6).map(item => `
        <article class="tech-device-card"><div><p>${escapeHtml(item.bus_number)}</p><strong>${item.speed_kmh == null ? "—" : `${Math.round(item.speed_kmh)} km/h`}</strong></div><span class="tech-status ${item.is_fresh ? "live" : "offline"}">${item.ignition ? "Ignition on" : "Ignition off"}</span><small>${escapeHtml(item.external_device_id)} · ${item.age_seconds}s ago</small></article>`).join("") : `<p class="tech-empty">Waiting for the GPS provider’s first position.</p>`;
    const translationSummary = state.translator ? Object.entries(state.translator.field_paths).map(([key, value]) => `<div><span>${escapeHtml(key.replaceAll("_", " "))}</span><code>${escapeHtml(Array.isArray(value) ? value.join(", ") : value)}</code></div>`).join("") : "";
    page.innerHTML = `
        <section class="tech-page">
            <header class="tech-hero glass-card"><div><p class="tech-eyebrow">TECHNICIAN WORKSPACE</p><h1>GPS Integration Control</h1><p>Securely translate provider data, protect live tracking, and keep vehicle mappings correct.</p></div><button class="tech-button primary" id="tech-refresh">↻ Refresh status</button></header>
            <section class="tech-stat-grid"><article class="tech-stat glass-card"><span>Provider tokens</span><strong>${state.tokens.filter(item => item.is_active).length}</strong><small>active credentials</small></article><article class="tech-stat glass-card"><span>Mapped buses</span><strong>${state.devices.filter(item => item.is_active).length}</strong><small>external device IDs</small></article><article class="tech-stat glass-card"><span>Live devices</span><strong>${state.statuses.filter(item => item.is_fresh).length}</strong><small>fresh positions</small></article></section>
            <section class="tech-grid">
                <article class="tech-panel glass-card tech-wide"><div class="tech-panel-heading"><div><p class="tech-eyebrow">CREDENTIALS</p><h2>Provider tokens</h2><p>Values are shown once immediately after creation or rotation, then remain hidden. Rotate immediately if a credential may be compromised.</p></div><button class="tech-button primary" id="create-token">Create token</button></div><div class="tech-table-wrap"><table><thead><tr><th>Label</th><th>Scope</th><th>Status</th><th>Last used</th><th></th></tr></thead><tbody>${tokenRows}</tbody></table></div></article>
                <article class="tech-panel glass-card tech-wide"><div class="tech-panel-heading"><div><p class="tech-eyebrow">DEVICE TRANSLATION</p><h2>External bus IDs</h2><p>Update the GPS-company identifier without changing BusTrack’s internal bus number.</p></div><button class="tech-button primary" id="add-device">Map device</button></div><div class="tech-table-wrap"><table><thead><tr><th>Bus</th><th>Provider device ID</th><th>Display name</th><th>Status</th><th></th></tr></thead><tbody>${deviceRows}</tbody></table></div></article>
                <article class="tech-panel glass-card tech-wide"><div class="tech-panel-heading"><div><p class="tech-eyebrow">FORMAT ADAPTER</p><h2>Provider field layout</h2><p>When the GPS company changes its JSON field names, update these paths here. The translation still runs securely on the server.</p></div><button class="tech-button secondary" id="edit-translator">Edit field paths</button></div><div class="tech-translation">${translationSummary}</div></article>
                <article class="tech-panel glass-card tech-wide"><div class="tech-panel-heading"><div><p class="tech-eyebrow">LIVE SIGNAL</p><h2>Latest vehicle GPS</h2></div><span class="tech-muted">20s while on · 2m while off</span></div><div class="tech-device-grid">${statusCards}</div></article>
            </section>
        </section>`;
    bindEvents();
}

async function refresh() {
    state.loading = true;
    try {
        const [tokens, devices, buses, statuses, translator] = await Promise.all([
            request("/integrations/gps/tokens"), request("/integrations/gps/devices"), request("/integrations/gps/buses"), request("/integrations/gps/status"), request("/integrations/gps/translator"),
        ]);
        Object.assign(state, { tokens, devices, buses, statuses, translator });
    } catch (error) {
        Modal.error({ title: "Unable to load integration tools", subtitle: error.message });
    } finally { state.loading = false; renderDashboard(); }
}

function rotateToken(id) {
    const token = state.tokens.find(item => item.id === id);
    Modal.confirm({ eyebrow: "SECURITY ACTION", title: "Rotate provider token?", subtitle: "The existing token will stop working immediately.", content: `<p>Rotate <strong>${escapeHtml(token?.label || "this token")}</strong>? This blocks a compromised credential. The new value will be shown once so you can copy it.</p>`, confirmText: "Rotate token", style: "danger", onConfirm: async () => {
        try { const result = await request(`/integrations/gps/tokens/${id}/rotate`, { method: "POST" }); Modal.close(); await refresh(); revealProviderTokenOnce(result, "Copy replacement token", "The previous provider token has been blocked."); }
        catch (error) { Modal.error({ title: "Token rotation failed", subtitle: error.message }); }
    }});
}

function deleteToken(id) {
    const token = state.tokens.find(item => item.id === id);
    Modal.confirm({ eyebrow: "PERMANENT DELETE", title: "Delete provider token?", subtitle: "The GPS company will no longer be able to send data with this token.", content: `<p>Delete <strong>${escapeHtml(token?.label || "this token")}</strong>? This cannot be undone.</p>`, confirmText: "Delete token", style: "danger", onConfirm: async () => {
        try { await request(`/integrations/gps/tokens/${id}`, { method: "DELETE" }); Modal.close(); await refresh(); Modal.success({ title: "Token deleted", subtitle: "This credential can no longer submit GPS positions." }); }
        catch (error) { Modal.error({ title: "Unable to delete token", subtitle: error.message }); }
    }});
}

function createToken() {
    let busDropdown;
    Modal.form({ eyebrow: "CREDENTIALS", title: "Create provider token", subtitle: "The token value will be shown once after creation.", content: `<div class="modal-group"><label class="modal-label" for="tech-token-label">Label</label><input class="modal-input" id="tech-token-label" maxlength="100" placeholder="GPS provider primary" required></div><div class="modal-group"><label class="modal-label">Scope</label><div id="tech-token-bus-container"></div></div>`, submitText: "Generate token", onOpen: () => {
        busDropdown = createDropdown({ id: "tech-token-bus", placeholder: "Fleet-wide token", items: state.buses.map(bus => ({ value: bus.id, label: `${bus.bus_number} · ${bus.registration_number}` })) });
        document.querySelector("#tech-token-bus-container")?.appendChild(busDropdown);
    }, onClose: () => busDropdown?.close(), onSubmit: async () => {
        const label = document.querySelector("#tech-token-label").value.trim(); const busValue = busDropdown?.getValue();
        if (label.length < 2) { Modal.error({ title: "Label required", subtitle: "Enter at least two characters." }); return; }
        try { const result = await request("/integrations/gps/tokens", { method: "POST", body: JSON.stringify({ label, bus_id: busValue ? Number(busValue) : null }) }); Modal.close(); await refresh(); revealProviderTokenOnce(result, "Copy provider token", "Store this value before closing this window."); }
        catch (error) { Modal.error({ title: "Unable to create token", subtitle: error.message }); }
    }});
}

function editDevice(id = null) {
    const device = state.devices.find(item => item.id === id);
    let busDropdown;
    const selectedBus = state.buses.find(bus => bus.id === device?.bus_id);
    Modal.form({ eyebrow: "DEVICE TRANSLATION", title: device ? "Update external bus ID" : "Map provider device", subtitle: "This changes only the external GPS-company identifier.", content: `<div class="modal-group"><label class="modal-label">Bus</label>${device ? `<p class="tech-static-field">${escapeHtml(selectedBus ? `${selectedBus.bus_number} · ${selectedBus.registration_number}` : `Bus #${device.bus_id}`)}</p>` : `<div id="tech-device-bus-container"></div>`}</div><div class="modal-group"><label class="modal-label" for="tech-device-id">Provider device ID</label><input class="modal-input" id="tech-device-id" maxlength="128" value="${escapeHtml(device?.external_device_id || "")}" placeholder="e.g. 862567072404952"></div><div class="modal-group"><label class="modal-label" for="tech-device-name">Display name</label><input class="modal-input" id="tech-device-name" maxlength="100" value="${escapeHtml(device?.display_name || "")}" placeholder="Optional"></div>`, submitText: device ? "Save ID" : "Map device", onOpen: () => {
        if (device) return;
        busDropdown = createDropdown({ id: "tech-device-bus", placeholder: "Select a saved bus", items: state.buses.map(bus => ({ value: bus.id, label: `${bus.bus_number} · ${bus.registration_number}` })) });
        document.querySelector("#tech-device-bus-container")?.appendChild(busDropdown);
    }, onClose: () => busDropdown?.close(), onSubmit: async () => {
        const external_device_id = document.querySelector("#tech-device-id").value.trim(); const display_name = document.querySelector("#tech-device-name").value.trim() || null;
        if (!external_device_id) { Modal.error({ title: "Device ID required", subtitle: "Enter the GPS-company device identifier." }); return; }
        const busId = busDropdown?.getValue();
        if (!device && !busId) { Modal.error({ title: "Bus required", subtitle: "Select one of the buses saved in BusTrack." }); return; }
        try { await request(device ? `/integrations/gps/devices/${id}` : "/integrations/gps/devices", { method: device ? "PUT" : "POST", body: JSON.stringify(device ? { external_device_id, display_name, is_active: device.is_active } : { bus_id: Number(busId), external_device_id, display_name }) }); Modal.close(); await refresh(); Modal.success({ title: "Device mapping saved", subtitle: "Incoming positions will now use the updated external ID." }); }
        catch (error) { Modal.error({ title: "Unable to save mapping", subtitle: error.message }); }
    }});
}

function editTranslator() {
    const configuration = JSON.stringify(state.translator?.field_paths || {}, null, 2);
    Modal.form({ eyebrow: "FORMAT ADAPTER", title: "Edit provider field paths", subtitle: "Use dot paths, for example attributes.ignition. Keep every listed field.", content: `<div class="modal-group modal-group-full"><label class="modal-label" for="tech-field-paths">Field-path JSON</label><textarea class="modal-textarea" id="tech-field-paths" rows="18"></textarea></div>`, submitText: "Apply translation", onOpen: () => { document.querySelector("#tech-field-paths").value = configuration; }, onSubmit: async () => {
        let field_paths; try { field_paths = JSON.parse(document.querySelector("#tech-field-paths").value); } catch { Modal.error({ title: "Invalid JSON", subtitle: "Correct the field-path JSON and try again." }); return; }
        try { await request("/integrations/gps/translator", { method: "PUT", body: JSON.stringify({ field_paths }) }); Modal.close(); await refresh(); Modal.success({ title: "Translation updated", subtitle: "New provider payloads will use the saved field paths." }); }
        catch (error) { Modal.error({ title: "Translation was not saved", subtitle: error.message }); }
    }});
}

function bindEvents() {
    page.querySelector("#tech-refresh")?.addEventListener("click", refresh);
    page.querySelector("#create-token")?.addEventListener("click", createToken);
    page.querySelector("#add-device")?.addEventListener("click", () => editDevice());
    page.querySelector("#edit-translator")?.addEventListener("click", editTranslator);
    page.querySelectorAll("[data-rotate-token]").forEach(button => button.addEventListener("click", () => rotateToken(Number(button.dataset.rotateToken))));
    page.querySelectorAll("[data-delete-token]").forEach(button => button.addEventListener("click", () => deleteToken(Number(button.dataset.deleteToken))));
    page.querySelectorAll("[data-edit-device]").forEach(button => button.addEventListener("click", () => editDevice(Number(button.dataset.editDevice))));
}

export function render() {
    page = document.createElement("div");
    page.className = "technician-module";
    page.innerHTML = `<div class="tech-loading glass-card">Loading GPS integration controls…</div>`;
    queueMicrotask(refresh);
    return page;
}

export function destroy() { page = null; }
