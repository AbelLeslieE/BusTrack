import { request } from "/static/common/api.js";
import { escapeHtml } from "/static/common/security.js";

let view;

const dateLabel = () => new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric", month: "long" }).format(new Date());
const time = value => value ? String(value).slice(0, 5) : "—";
const updateTime = value => value ? new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(value)) : "No GPS update";

function renderDashboard(data) {
  const metrics = data.metrics;
  const liveTrips = data.live_trips.length ? data.live_trips.map(trip => `<li><span class="alert-dot blue"></span><div><strong>${escapeHtml(trip.bus_number)}</strong><small>${trip.speed_kmh == null ? "Awaiting GPS" : `${Math.round(trip.speed_kmh)} km/h`} · ${escapeHtml(updateTime(trip.last_location_update))}</small></div></li>`).join("") : `<li class="dashboard-empty">No trips are running right now.</li>`;
  const alerts = data.alerts.length ? data.alerts.map(alert => `<li><span class="alert-dot ${alert.severity === "Critical" ? "pink" : "amber"}"></span><div><strong>${escapeHtml(alert.title)}</strong><small>${escapeHtml(alert.message || alert.status)}</small></div><time>${escapeHtml(alert.status)}</time></li>`).join("") : `<li class="dashboard-empty">No unresolved operational alerts.</li>`;
  const departures = data.departures.length ? data.departures.map(route => `<div class="schedule-row"><b>${escapeHtml(time(route.departure_time))}</b><span class="route-badge">${escapeHtml(route.route_code)}</span><span>${escapeHtml(route.route_name)}</span><small>${escapeHtml(route.bus_number || "No bus")} · ${escapeHtml(route.driver_name || "No driver")}</small></div>`).join("") : `<p class="dashboard-empty">No active routes are scheduled.</p>`;
  view.innerHTML = `<section class="dashboard-view"><section class="welcome-banner glass-panel"><div><p class="eyebrow">${escapeHtml(dateLabel())}</p><h2>Fleet overview</h2><p>Live operations from your BusTrack database.</p></div><div class="route-chip"><span class="pulse"></span>${metrics.active_trips} active trip${metrics.active_trips === 1 ? "" : "s"}</div></section><section class="metric-grid" aria-label="Fleet summary"><article class="metric-card glass-panel"><span class="metric-icon blue">▣</span><div><p>Total buses</p><strong>${metrics.total_buses}</strong><small>${metrics.maintenance_buses} in maintenance</small></div></article><article class="metric-card glass-panel"><span class="metric-icon green">◎</span><div><p>On route</p><strong>${metrics.active_trips}</strong><small>Currently running trips</small></div></article><article class="metric-card glass-panel"><span class="metric-icon amber">◉</span><div><p>Assigned students</p><strong>${metrics.assigned_students}</strong><small>Students with a bus assignment</small></div></article><article class="metric-card glass-panel"><span class="metric-icon violet">◒</span><div><p>Available drivers</p><strong>${metrics.active_drivers}</strong><small>${metrics.unassigned_drivers} not assigned to a bus</small></div></article></section><section class="dashboard-grid"><article class="tracking-card glass-panel"><div class="card-heading"><div><p class="eyebrow">Live movement</p><h3>Fleet activity</h3></div><a href="#live_tracking">Open live map →</a></div><ul class="alert-list">${liveTrips}</ul></article><article class="alerts-card glass-panel"><div class="card-heading"><div><p class="eyebrow">Attention needed</p><h3>Operations alerts</h3></div><a href="#notifications">View all →</a></div><ul class="alert-list">${alerts}</ul></article></section><section class="bottom-grid"><article class="glass-panel schedule-card"><div class="card-heading"><div><p class="eyebrow">Next departures</p><h3>Active routes</h3></div><a href="#routes">Manage routes →</a></div>${departures}</article><article class="glass-panel quick-card"><p class="eyebrow">Quick actions</p><h3>Manage your fleet</h3><a href="#buses">Add bus <span>+</span></a><a href="#drivers">Register driver <span>+</span></a><a href="#notifications">Review alerts <span>→</span></a></article></section></section>`;
}

async function loadDashboard() {
  try { renderDashboard(await request("/admin/dashboard")); }
  catch (error) { view.innerHTML = `<section class="dashboard-view"><section class="welcome-banner glass-panel"><p class="eyebrow">Fleet overview</p><h2>Dashboard unavailable</h2><p>${escapeHtml(error.message)}</p></section></section>`; }
}

export function render() {
  view = document.createElement("section");
  view.className = "dashboard-view";
  view.innerHTML = `<section class="welcome-banner glass-panel"><p>Loading fleet data…</p></section>`;
  queueMicrotask(loadDashboard);
  return view;
}
