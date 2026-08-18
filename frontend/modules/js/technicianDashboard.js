import { request } from "/static/common/api.js";
import { Modal } from "/static/common/modal.js";
import { createDropdown } from "/static/common/dropdown.js";
import { escapeHtml } from "/static/common/security.js";

const state = {
    tokens: [], allTokens: [], devices: [], buses: [], statuses: [], translator: null,
    auditEvents: [], auditTotal: 0, auditHasMore: false, auditOffset: 0,
    requestLogs: [], requestTotal: 0, requestHasMore: false, requestOffset: 0,
    requestPage: 1, requestPageSize: 25,
    tokenFilters: { search: "", state: "" },
    requestFilters: { search: "", method: "", statusClass: "", tokenId: "" },
    loading: true,
};
let page;
let filterDropdowns = [];

function closeFilterDropdowns() {
    filterDropdowns.forEach(dropdown => dropdown.close?.());
    filterDropdowns = [];
}

function mountFilterDropdowns() {
    const mount = (containerId, config) => {
        const container = page?.querySelector(`#${containerId}-container`);
        if (!container) return;

        const dropdown = createDropdown({ id: containerId, ...config });
        dropdown.classList.add("tech-filter-dropdown");
        container.appendChild(dropdown);
        filterDropdowns.push(dropdown);
    };

    mount("tech-token-state", {
        placeholder: "All states",
        value: state.tokenFilters.state,
        items: [
            { value: "", label: "All states" },
            { value: "active", label: "Active" },
            { value: "inactive", label: "Inactive" },
        ],
    });

    mount("tech-request-method", {
        placeholder: "All methods",
        value: state.requestFilters.method,
        items: ["", "GET", "POST", "PUT", "PATCH", "DELETE"].map(value => ({
            value,
            label: value || "All methods",
        })),
    });

    mount("tech-request-status", {
        placeholder: "All results",
        value: state.requestFilters.statusClass,
        items: ["", "2xx", "4xx", "5xx"].map(value => ({
            value,
            label: value || "All results",
        })),
    });

    mount("tech-request-token", {
        placeholder: "All tokens / users",
        value: state.requestFilters.tokenId,
        items: [
            { value: "", label: "All tokens / users" },
            ...state.allTokens.map(token => ({ value: token.id, label: token.label })),
        ],
    });
}

function formatDate(value) {
    return value ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "Never";
}

function auditLabel(action) {
    return String(action || "activity").replaceAll("_", " ").replace(/\b\w/g, letter => letter.toUpperCase());
}

function auditActor(event) {
    const user = event.actor_username || "Unknown account";
    return event.actor_role ? `${user} · ${event.actor_role}` : user;
}

function auditDetails(event) {
    if (!event.details || typeof event.details !== "object") return "—";
    return Object.entries(event.details).map(([key, value]) => `${key.replaceAll("_", " ")}: ${Array.isArray(value) || typeof value === "object" ? JSON.stringify(value) : String(value)}`).join(" · ");
}

function queryString(values) {
    const params = new URLSearchParams();
    Object.entries(values).forEach(([key, value]) => {
        if (value !== null && value !== undefined && String(value).trim() !== "") params.set(key, String(value).trim());
    });
    const query = params.toString();
    return query ? `?${query}` : "";
}

function requestStatusLabel(entry) {
    return `${entry.status_code} · ${entry.duration_ms} ms`;
}

function requestPageCount() {
    return Math.max(1, Math.ceil(state.requestTotal / state.requestPageSize));
}

function requestPagination() {
    const pageCount = requestPageCount();
    if (state.requestTotal <= state.requestPageSize) return "";

    return `<nav class="tech-pagination" aria-label="API request pages">
        <button class="tech-button secondary" type="button" data-request-page="previous" ${state.requestPage <= 1 ? "disabled" : ""}>Previous</button>
        <span>Page ${state.requestPage} of ${pageCount}</span>
        <button class="tech-button secondary" type="button" data-request-page="next" ${state.requestPage >= pageCount ? "disabled" : ""}>Next</button>
    </nav>`;
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
    closeFilterDropdowns();
    const tokenRows = state.tokens.length ? state.tokens.map(token => `
        <tr><td>${escapeHtml(token.label)}</td><td>${token.bus_id ? `Bus #${token.bus_id}` : "Fleet-wide"}</td><td><span class="tech-status ${token.is_active ? "live" : "offline"}">${token.is_active ? "Active" : "Disabled"}</span></td><td>${formatDate(token.last_used_at)}</td><td class="tech-token-actions"><button class="tech-button secondary" data-view-token="${token.id}">Details</button><button class="tech-button danger-outline" data-rotate-token="${token.id}">Rotate</button><button class="tech-button delete-outline" data-delete-token="${token.id}">Delete</button></td></tr>`).join("") : `<tr><td colspan="5" class="tech-empty">No provider tokens exist yet.</td></tr>`;
    const deviceRows = state.devices.length ? state.devices.map(device => `
        <tr><td>${escapeHtml(device.bus_number || `Bus #${device.bus_id}`)}</td><td><code>${escapeHtml(device.external_device_id)}</code></td><td>${escapeHtml(device.display_name || "—")}</td><td><span class="tech-status ${device.is_active ? "live" : "offline"}">${device.is_active ? "Mapped" : "Disabled"}</span></td><td><button class="tech-button secondary" data-edit-device="${device.id}">Edit ID</button></td></tr>`).join("") : `<tr><td colspan="5" class="tech-empty">No device IDs have been mapped.</td></tr>`;
    const statusCards = state.statuses.length ? state.statuses.slice(0, 6).map(item => `
        <article class="tech-device-card"><div><p>${escapeHtml(item.bus_number)}</p><strong>${item.speed_kmh == null ? "—" : `${Math.round(item.speed_kmh)} km/h`}</strong></div><span class="tech-status ${item.is_fresh ? "live" : "offline"}">${item.ignition ? "Ignition on" : "Ignition off"}</span><small>${escapeHtml(item.external_device_id)} · ${item.age_seconds}s ago</small></article>`).join("") : `<p class="tech-empty">Waiting for the GPS provider’s first position.</p>`;
    const translationSummary = state.translator ? Object.entries(state.translator.field_paths).map(([key, value]) => `<div><span>${escapeHtml(key.replaceAll("_", " "))}</span><code>${escapeHtml(Array.isArray(value) ? value.join(", ") : value)}</code></div>`).join("") : "";
    const auditRows = state.auditEvents.length ? state.auditEvents.map(event => `
        <tr><td>${formatDate(event.created_at)}</td><td><strong>${escapeHtml(auditLabel(event.action))}</strong><small>${escapeHtml(event.subject_label || event.subject_type || "BusTrack")}</small></td><td>${escapeHtml(auditActor(event))}</td><td>${escapeHtml(event.client_ip || "—")}</td><td>${escapeHtml(auditDetails(event))}</td></tr>`).join("") : `<tr><td colspan="5" class="tech-empty">No audit events have been recorded since this feature was enabled.</td></tr>`;
    const requestRows = state.requestLogs.length ? state.requestLogs.map(entry => `
        <tr><td>${formatDate(entry.created_at)}</td><td><code>${escapeHtml(entry.method)}</code><small>${escapeHtml(entry.path)}</small></td><td><span class="tech-request-status status-${Math.floor(Number(entry.status_code) / 100)}">${escapeHtml(requestStatusLabel(entry))}</span></td><td>${escapeHtml(entry.actor_username || entry.integration_token_label || "Unauthenticated")}${entry.actor_role ? `<small>${escapeHtml(entry.actor_role)}</small>` : ""}</td><td>${escapeHtml(entry.integration_token_label || "—")}</td><td>${escapeHtml(entry.client_ip || "—")}</td></tr>`).join("") : `<tr><td colspan="6" class="tech-empty">No matching API requests have been recorded yet.</td></tr>`;
    page.innerHTML = `
        <section class="tech-page">
            <header class="tech-hero glass-card"><div><p class="tech-eyebrow">TECHNICIAN WORKSPACE</p><h1>GPS Integration Control</h1><p>Securely translate provider data, protect live tracking, and keep vehicle mappings correct.</p></div><button class="tech-button primary" id="tech-refresh">↻ Refresh status</button></header>
            <section class="tech-stat-grid"><article class="tech-stat glass-card"><span>Provider tokens</span><strong>${state.tokens.filter(item => item.is_active).length}</strong><small>active credentials</small></article><article class="tech-stat glass-card"><span>Mapped buses</span><strong>${state.devices.filter(item => item.is_active).length}</strong><small>external device IDs</small></article><article class="tech-stat glass-card"><span>Live devices</span><strong>${state.statuses.filter(item => item.is_fresh).length}</strong><small>fresh positions</small></article></section>
            <section class="tech-grid">
                <article class="tech-panel glass-card tech-wide"><div class="tech-panel-heading"><div><p class="tech-eyebrow">CREDENTIALS</p><h2>Provider tokens</h2><p>View safe token metadata and lifecycle history here. Values are shown only once immediately after creation or rotation, then remain hidden.</p></div><button class="tech-button primary" id="create-token">Create token</button></div><div class="tech-filter-bar"><input class="tech-filter-input" id="tech-token-search" value="${escapeHtml(state.tokenFilters.search)}" maxlength="100" placeholder="Search token label"><div id="tech-token-state-container" class="tech-dropdown-container"></div><button class="tech-button secondary" id="tech-apply-token-filters">Apply</button><button class="tech-filter-clear" id="tech-clear-token-filters" type="button">Clear</button></div><div class="tech-table-wrap"><table><thead><tr><th>Label</th><th>Scope</th><th>Status</th><th>Last used</th><th></th></tr></thead><tbody>${tokenRows}</tbody></table></div></article>
                <article class="tech-panel glass-card tech-wide"><div class="tech-panel-heading"><div><p class="tech-eyebrow">DEVICE TRANSLATION</p><h2>External bus IDs</h2><p>Update the GPS-company identifier without changing BusTrack’s internal bus number.</p></div><button class="tech-button primary" id="add-device">Map device</button></div><div class="tech-table-wrap"><table><thead><tr><th>Bus</th><th>Provider device ID</th><th>Display name</th><th>Status</th><th></th></tr></thead><tbody>${deviceRows}</tbody></table></div></article>
                <article class="tech-panel glass-card tech-wide"><div class="tech-panel-heading"><div><p class="tech-eyebrow">FORMAT ADAPTER</p><h2>Provider field layout</h2><p>When the GPS company changes its JSON field names, update these paths here. The translation still runs securely on the server.</p></div><button class="tech-button secondary" id="edit-translator">Edit field paths</button></div><div class="tech-translation">${translationSummary}</div></article>
                <article class="tech-panel glass-card tech-wide"><div class="tech-panel-heading"><div><p class="tech-eyebrow">LIVE SIGNAL</p><h2>Latest vehicle GPS</h2></div><span class="tech-muted">20s while on · 2m while off</span></div><div class="tech-device-grid">${statusCards}</div></article>
                <article class="tech-panel glass-card tech-wide"><div class="tech-panel-heading"><div><p class="tech-eyebrow">SECURITY AUDIT</p><h2>Portal and integration history</h2><p>Records portal entry, sign-out, failed sign-in attempts, and GPS token or translation changes. Token values and passwords are never logged.</p></div><span class="tech-muted">${state.auditTotal} recorded event${state.auditTotal === 1 ? "" : "s"}</span></div><div class="tech-table-wrap"><table class="tech-audit-table"><thead><tr><th>When</th><th>Activity</th><th>User / role</th><th>IP</th><th>Details</th></tr></thead><tbody>${auditRows}</tbody></table></div>${state.auditHasMore ? `<div class="tech-audit-more"><button class="tech-button secondary" id="tech-load-more-audit">Load older events</button></div>` : ""}</article>
                <article class="tech-panel glass-card tech-wide"><div class="tech-panel-heading"><div><p class="tech-eyebrow">API REQUEST MONITOR</p><h2>Request queue and history</h2><p>Search completed API requests by route, user, service token, method, or result. Request bodies and token values are never stored.</p></div><span class="tech-muted">${state.requestTotal} matching request${state.requestTotal === 1 ? "" : "s"}</span></div><div class="tech-filter-bar tech-request-filters"><input class="tech-filter-input" id="tech-request-search" value="${escapeHtml(state.requestFilters.search)}" maxlength="100" placeholder="Search route, user or token"><div id="tech-request-method-container" class="tech-dropdown-container"></div><div id="tech-request-status-container" class="tech-dropdown-container"></div><div id="tech-request-token-container" class="tech-dropdown-container tech-token-filter-dropdown"></div><button class="tech-button secondary" id="tech-apply-request-filters">Apply</button><button class="tech-filter-clear" id="tech-clear-request-filters" type="button">Clear</button></div><div class="tech-table-wrap"><table class="tech-request-table"><thead><tr><th>When</th><th>Request</th><th>Result</th><th>Caller</th><th>GPS token</th><th>IP</th></tr></thead><tbody>${requestRows}</tbody></table></div>${requestPagination()}</article>
            </section>
        </section>`;
    mountFilterDropdowns();
    bindEvents();
}

async function refresh() {
    state.loading = true;
    try {
        const tokenFilters = queryString({ search: state.tokenFilters.search, state: state.tokenFilters.state });
        const requestFilters = queryString({
            search: state.requestFilters.search,
            method: state.requestFilters.method,
            status_class: state.requestFilters.statusClass,
            token_id: state.requestFilters.tokenId,
            limit: state.requestPageSize,
            offset: (state.requestPage - 1) * state.requestPageSize,
        });
        const [tokens, allTokens, devices, buses, statuses, translator, audit, requestLog] = await Promise.all([
            request(`/integrations/gps/tokens${tokenFilters}`), request("/integrations/gps/tokens"), request("/integrations/gps/devices"), request("/integrations/gps/buses"), request("/integrations/gps/status"), request("/integrations/gps/translator"), request("/integrations/gps/audit?limit=100&offset=0"), request(`/integrations/gps/requests${requestFilters}`),
        ]);
        Object.assign(state, {
            tokens, allTokens, devices, buses, statuses, translator,
            auditEvents: audit.events, auditTotal: audit.total, auditHasMore: audit.has_more, auditOffset: audit.events.length,
            requestLogs: requestLog.requests, requestTotal: requestLog.total, requestHasMore: requestLog.has_more, requestOffset: requestLog.offset,
        });
    } catch (error) {
        Modal.error({ title: "Unable to load integration tools", subtitle: error.message });
    } finally { state.loading = false; renderDashboard(); }
}

async function loadMoreAudit() {
    try {
        const audit = await request(`/integrations/gps/audit?limit=100&offset=${state.auditOffset}`);
        Object.assign(state, { auditEvents: [...state.auditEvents, ...audit.events], auditTotal: audit.total, auditHasMore: audit.has_more, auditOffset: state.auditOffset + audit.events.length });
        renderDashboard();
    } catch (error) {
        Modal.error({ title: "Unable to load older audit events", subtitle: error.message });
    }
}

function changeRequestPage(direction) {
    const pageCount = requestPageCount();
    const nextPage = direction === "next"
        ? Math.min(pageCount, state.requestPage + 1)
        : Math.max(1, state.requestPage - 1);

    if (nextPage === state.requestPage) return;
    state.requestPage = nextPage;
    refresh();
}

function applyTokenFilters() {
    state.tokenFilters = {
        search: page.querySelector("#tech-token-search")?.value.trim() || "",
        state: page.querySelector("#tech-token-state")?.getValue?.() || "",
    };
    refresh();
}

function clearTokenFilters() {
    state.tokenFilters = { search: "", state: "" };
    refresh();
}

function applyRequestFilters() {
    state.requestFilters = {
        search: page.querySelector("#tech-request-search")?.value.trim() || "",
        method: page.querySelector("#tech-request-method")?.getValue?.() || "",
        statusClass: page.querySelector("#tech-request-status")?.getValue?.() || "",
        tokenId: page.querySelector("#tech-request-token")?.getValue?.() || "",
    };
    state.requestPage = 1;
    refresh();
}

function clearRequestFilters() {
    state.requestFilters = { search: "", method: "", statusClass: "", tokenId: "" };
    state.requestPage = 1;
    refresh();
}

async function showTokenHistory(id) {
    try {
        const result = await request(`/integrations/gps/tokens/${id}/history`);
        const token = result.token;
        const events = result.events.length ? result.events.map(event => `<li><strong>${escapeHtml(auditLabel(event.action))}</strong><span>${escapeHtml(auditActor(event))} · ${formatDate(event.created_at)}</span><small>${escapeHtml(auditDetails(event))}</small></li>`).join("") : "<li>No lifecycle events were recorded for this token yet.</li>";
        Modal.open({
            eyebrow: "TOKEN AUDIT",
            title: token.label,
            subtitle: "Credential metadata and lifecycle history. The token value is permanently hidden.",
            size: "lg",
            content: `<div class="tech-token-history"><dl><div><dt>Scope</dt><dd>${token.bus_id ? `Bus #${token.bus_id}` : "Fleet-wide"}</dd></div><div><dt>Status</dt><dd>${token.is_active ? "Active" : "Disabled"}</dd></div><div><dt>Created</dt><dd>${formatDate(token.created_at)}</dd></div><div><dt>Last used</dt><dd>${formatDate(token.last_used_at)}</dd></div></dl><p class="tech-token-history-note">Token value: never retrievable after its one-time display.</p><h3>Lifecycle history</h3><ol>${events}</ol></div>`,
            actions: [{ text: "Close", style: "secondary", close: true }],
        });
    } catch (error) {
        Modal.error({ title: "Unable to load token details", subtitle: error.message });
    }
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
    page.querySelector("#tech-load-more-audit")?.addEventListener("click", loadMoreAudit);
    page.querySelectorAll("[data-request-page]").forEach(button => button.addEventListener("click", () => changeRequestPage(button.dataset.requestPage)));
    page.querySelector("#tech-apply-token-filters")?.addEventListener("click", applyTokenFilters);
    page.querySelector("#tech-clear-token-filters")?.addEventListener("click", clearTokenFilters);
    page.querySelector("#tech-apply-request-filters")?.addEventListener("click", applyRequestFilters);
    page.querySelector("#tech-clear-request-filters")?.addEventListener("click", clearRequestFilters);
    page.querySelectorAll("[data-view-token]").forEach(button => button.addEventListener("click", () => showTokenHistory(Number(button.dataset.viewToken))));
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

export function destroy() { closeFilterDropdowns(); page = null; }
