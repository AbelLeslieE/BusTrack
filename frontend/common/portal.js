import { escapeHtml } from "/static/common/security.js";

export function formatDateTime(value, fallback = "Not available") {
    if (!value) return fallback;
    const date = new Date(value);
    return Number.isNaN(date.getTime())
        ? fallback
        : date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

export function formatTime(value, fallback = "Not scheduled") {
    if (!value) return fallback;
    const normalized = String(value).slice(0, 5);
    const date = new Date(`2000-01-01T${normalized}:00`);
    return Number.isNaN(date.getTime())
        ? escapeHtml(normalized)
        : date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function emptyState(title, message) {
    return `<div class="portal-empty"><i class="fa-solid fa-circle-info" aria-hidden="true"></i><div><h3>${escapeHtml(title)}</h3><p>${escapeHtml(message)}</p></div></div>`;
}

export function errorState(error) {
    return emptyState("Unable to load this page", error?.message || "Please try again.");
}

export function value(data, fallback = "—") {
    return escapeHtml(data === null || data === undefined || data === "" ? fallback : String(data));
}
