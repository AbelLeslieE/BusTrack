import { createDropdown } from "/static/common/dropdown.js";

const API_URL = "/api/assignments";

const state = { data: null };

function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, character => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
    }[character]));
}

function assignmentCard(route) {
    const schedule = route.departure_time || route.arrival_time
        ? `${route.departure_time || "—"} – ${route.arrival_time || "—"}`
        : "No schedule set";
    return `
        <article class="assignment-card" data-route-id="${route.id}">
            <div class="assignment-card__heading">
                <div>
                    <p class="assignment-card__code">${escapeHtml(route.route_code)}</p>
                    <h3>${escapeHtml(route.route_name)}</h3>
                    <small>${escapeHtml(schedule)}</small>
                </div>
                <span class="assignment-status ${route.status === "Active" ? "is-active" : ""}">${escapeHtml(route.status)}</span>
            </div>
            <div class="assignment-fields">
                <label>Bus
                    <div class="assignment-dropdown" data-field="bus_id"></div>
                </label>
                <label>Driver
                    <div class="assignment-dropdown" data-field="driver_id"></div>
                </label>
            </div>
            <div class="assignment-card__footer">
                <span>${route.bus_number ? `Bus: ${escapeHtml(route.bus_number)}` : "Bus not assigned"}</span>
                <button class="assignment-save" type="button">Save assignment</button>
            </div>
        </article>`;
}

function addAssignmentDropdowns(view) {
    view.querySelectorAll("[data-route-id]").forEach(card => {
        const route = state.data.routes.find(item => item.id === Number(card.dataset.routeId));
        if (!route) return;

        const busDropdown = createDropdown({
            placeholder: "No bus assigned",
            value: route.bus_id ?? "",
            items: [
                { value: "", label: "No bus assigned" },
                ...state.data.buses.map(bus => ({
                    value: bus.id,
                    label: `${bus.bus_number} • ${bus.status}`,
                })),
            ],
        });
        const driverDropdown = createDropdown({
            placeholder: "No driver assigned",
            value: route.driver_id ?? "",
            items: [
                { value: "", label: "No driver assigned" },
                ...state.data.drivers.map(driver => ({
                    value: driver.id,
                    label: `${driver.label} • ${driver.status}`,
                })),
            ],
        });

        card.querySelector('[data-field="bus_id"]').appendChild(busDropdown);
        card.querySelector('[data-field="driver_id"]').appendChild(driverDropdown);
    });
}

function renderContent(view) {
    const routes = state.data.routes;
    const assigned = routes.filter(route => route.bus_id || route.driver_id).length;
    view.innerHTML = `
        <section class="assignments-page">
            <header class="assignments-hero glass-card">
                <div>
                    <p class="assignments-eyebrow">Transport management</p>
                    <h1>Assignments</h1>
                    <p>Connect each route to its bus and driver here. Bus and Route details stay separate, so there is only one place to manage operations.</p>
                </div>
                <div class="assignments-summary">
                    <strong>${assigned}/${routes.length}</strong><span>routes configured</span>
                </div>
            </header>
            <section class="assignment-guidance glass-card">
                <span>1. Pick a route</span><i>→</i><span>2. Select its bus</span><i>→</i><span>3. Select its driver</span><i>→</i><span>4. Save</span>
            </section>
            <section class="assignments-list" aria-label="Route assignments">
                ${routes.length ? routes.map(assignmentCard).join("") : `<div class="assignment-empty glass-card"><h2>No routes yet</h2><p>Create a route first, then return here to assign its bus and driver.</p></div>`}
            </section>
        </section>`;

    addAssignmentDropdowns(view);

    view.querySelectorAll(".assignment-save").forEach(button => {
        button.addEventListener("click", async () => {
            const card = button.closest("[data-route-id]");
            const body = {
                bus_id: Number(card.querySelector('[data-field="bus_id"] .dropdown').getValue()) || null,
                driver_id: Number(card.querySelector('[data-field="driver_id"] .dropdown').getValue()) || null,
            };
            button.disabled = true;
            button.textContent = "Saving…";
            try {
                const response = await fetch(`${API_URL}/routes/${card.dataset.routeId}`, {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(body),
                });
                const data = await response.json().catch(() => ({}));
                if (!response.ok) throw new Error(data.detail || "Could not save the assignment.");
                await loadAssignments(view);
            } catch (error) {
                button.disabled = false;
                button.textContent = "Save assignment";
                window.alert(error.message);
            }
        });
    });
}

async function loadAssignments(view) {
    view.innerHTML = `<div class="assignment-loading">Loading assignments…</div>`;
    try {
        const response = await fetch(API_URL);
        if (!response.ok) throw new Error("Could not load assignments.");
        state.data = await response.json();
        renderContent(view);
    } catch (error) {
        view.innerHTML = `<section class="assignment-empty glass-card"><h2>Assignments unavailable</h2><p>${escapeHtml(error.message)}</p></section>`;
    }
}

export function render() {
    const view = document.createElement("div");
    loadAssignments(view);
    return view;
}

