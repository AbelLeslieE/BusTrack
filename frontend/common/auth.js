/** Browser session handling and login-form behavior. */

import { canonicalRole, ROLE_ADMIN, ROLE_DRIVER, ROLE_TECHNICIAN, ROLE_USER } from "/static/common/roles.js";
import { installHardRefreshShortcut } from "/static/common/cacheRefresh.js";

installHardRefreshShortcut();

// Kept only to remove/migrate sessions created by older frontend versions.
// New browser sessions authenticate exclusively with the HttpOnly cookie.
const LEGACY_TOKEN_KEY = "bus_tracker_access_token";
const PROFILE_KEY = "bus_tracker_profile";
const EXPIRY_KEY = "bus_tracker_session_expires_at";
let authenticatedFetchInstalled = false;
let sessionExpiryTimer = null;
let sessionMonitorTimer = null;
let sessionCheckInFlight = false;
let sessionVisibilityHandler = null;
let lastSessionCheckAt = 0;

// Normal API calls already redirect on an explicit 401.  This slower monitor
// exists only to notice a remotely revoked session while the user is idle.
const SESSION_MONITOR_INTERVAL_MS = 60 * 60 * 1000;
const SESSION_FOCUS_RECHECK_AGE_MS = 60 * 60 * 1000;

export function clearSession() {
  if (sessionExpiryTimer) window.clearTimeout(sessionExpiryTimer);
  sessionExpiryTimer = null;
  if (sessionMonitorTimer) window.clearInterval(sessionMonitorTimer);
  sessionMonitorTimer = null;
  if (sessionVisibilityHandler) {
    document.removeEventListener("visibilitychange", sessionVisibilityHandler);
    sessionVisibilityHandler = null;
  }
  sessionCheckInFlight = false;
  lastSessionCheckAt = 0;
  localStorage.removeItem(LEGACY_TOKEN_KEY);
  localStorage.removeItem(PROFILE_KEY);
  localStorage.removeItem(EXPIRY_KEY);
}

/** Store a rotated session returned after an account-security update. */
export function replaceSession(session) {
  if (!session?.access_token || !session?.user) {
    throw new Error("The server did not return a refreshed session.");
  }
  localStorage.removeItem(LEGACY_TOKEN_KEY);
  localStorage.setItem(PROFILE_KEY, JSON.stringify(session.user));
  if (session.expires_at) localStorage.setItem(EXPIRY_KEY, session.expires_at);
  scheduleSessionExpiry();
  startSessionMonitor();
}

/** Keep active devices visible to Admins and honour a remote kick promptly. */
export function startSessionMonitor() {
  if (sessionMonitorTimer) window.clearInterval(sessionMonitorTimer);
  if (sessionVisibilityHandler) {
    document.removeEventListener("visibilitychange", sessionVisibilityHandler);
  }
  // Login or portal bootstrap has just validated this session. Treat that as
  // the first check so an ordinary tab switch cannot trigger a duplicate GET.
  lastSessionCheckAt = Date.now();
  const verify = async () => {
    if (sessionCheckInFlight || document.hidden) return;
    sessionCheckInFlight = true;
    lastSessionCheckAt = Date.now();
    try {
      const response = await fetch("/api/auth/me", { credentials: "same-origin" });
      // A transient server failure must not be treated as a revoked session.
      // In particular, editing stops can coincide with a short database write
      // (GPS, audit logging, or another administrator action).  Only an
      // explicit authentication/authorization response means this browser
      // needs to return to the sign-in screen.
      if (response.status === 401 || response.status === 403) {
        clearSession();
        if (window.location.pathname !== "/") window.location.replace("/");
      }
    } catch {
      // A short network interruption must not sign a valid user out.
    } finally {
      sessionCheckInFlight = false;
    }
  };
  sessionMonitorTimer = window.setInterval(verify, SESSION_MONITOR_INTERVAL_MS);
  sessionVisibilityHandler = () => {
    if (
      document.visibilityState === "visible"
      && Date.now() - lastSessionCheckAt >= SESSION_FOCUS_RECHECK_AGE_MS
    ) {
      void verify();
    }
  };
  document.addEventListener("visibilitychange", sessionVisibilityHandler);
}

function tokenExpiry(token) {
  const storedExpiry = Date.parse(localStorage.getItem(EXPIRY_KEY) || "");
  if (Number.isFinite(storedExpiry)) return storedExpiry;
  try {
    let encodedPayload = String(token || "").split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    encodedPayload += "=".repeat((4 - (encodedPayload.length % 4)) % 4);
    const payload = JSON.parse(atob(encodedPayload));
    return Number(payload.exp) * 1000;
  } catch {
    return NaN;
  }
}

export function scheduleSessionExpiry(token = null) {
  if (sessionExpiryTimer) window.clearTimeout(sessionExpiryTimer);
  const expiresAt = tokenExpiry(token);
  if (!Number.isFinite(expiresAt)) return;
  const remaining = expiresAt - Date.now();
  const expire = () => {
    clearSession();
    if (window.location.pathname !== "/") window.location.replace("/");
  };
  if (remaining <= 0) {
    expire();
    return;
  }
  sessionExpiryTimer = window.setTimeout(expire, remaining + 250);
}

export async function logoutSession() {
  try {
    await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "same-origin",
    });
  } finally {
    clearSession();
    window.location.replace("/");
  }
}

/**
 * Ensure every same-origin API request includes the HttpOnly session cookie
 * and consistently handles an explicit authentication failure.
 */
export function installAuthenticatedFetch() {
  if (authenticatedFetchInstalled) return;
  authenticatedFetchInstalled = true;

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input, options = {}) => {
    const requestUrl = typeof input === "string" ? input : input?.url;
    const url = new URL(requestUrl || window.location.href, window.location.origin);
    const isApiRequest = url.origin === window.location.origin && url.pathname.startsWith("/api/");
    const isLoginRequest = url.pathname === "/api/auth/login";

    if (isApiRequest && !isLoginRequest) {
      options = { ...options, credentials: options.credentials || "same-origin" };
    }

    const response = await originalFetch(input, options);
    if (isApiRequest && !isLoginRequest && response.status === 401) {
      clearSession();
      if (window.location.pathname !== "/" && !window.location.pathname.endsWith("/login.html")) {
        window.location.replace("/");
      }
    }
    return response;
  };
}

export async function requireAuthenticatedSession() {
  // Existing releases set the cookie and the legacy token together. Verify
  // with the cookie so a stale readable token can never override a newer
  // valid session, then remove that legacy copy.
  const legacyToken = localStorage.getItem(LEGACY_TOKEN_KEY);
  const response = await fetch("/api/auth/me", { credentials: "same-origin" });
  if (!response.ok) {
    clearSession();
    window.location.replace("/");
    return null;
  }
  const profile = await response.json();
  localStorage.removeItem(LEGACY_TOKEN_KEY);
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  scheduleSessionExpiry(legacyToken);
  installAuthenticatedFetch();
  startSessionMonitor();
  return profile;
}

const passwordInput = document.querySelector("#password");
const toggleButton = document.querySelector("#toggle-password");
const form = document.querySelector("#login-form");
const message = document.querySelector("#login-message");

toggleButton?.addEventListener("click", () => {
  const showPassword = passwordInput.type === "password";
  passwordInput.type = showPassword ? "text" : "password";
  toggleButton.textContent = showPassword ? "Hide" : "Show";
  toggleButton.setAttribute("aria-label", showPassword ? "Hide password" : "Show password");
});

form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submitButton = form.querySelector("button[type='submit']");
  const formData = new URLSearchParams({
    username: document.querySelector("#username").value.trim(),
    password: passwordInput.value,
  });
  message.textContent = "Signing in…";
  submitButton.disabled = true;
  try {
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formData,
      credentials: "same-origin",
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.access_token) {
      throw new Error(data.detail || "Unable to sign in.");
    }
    replaceSession(data);

    // ------------------------------------------------
    // Normalize user role
    // ------------------------------------------------
    // The backend may return roles using different casing,
    // for example:
    //     admin
    //     Administrator
    //     ADMIN
    //
    // We normalize the value here so the frontend
    // handles all of them consistently.
    // ------------------------------------------------

    const normalizedRole = canonicalRole(data.user.role);


    // ------------------------------------------------
    // Redirect based on normalized role
    // ------------------------------------------------

    switch (normalizedRole) {

        case ROLE_ADMIN:

            window.location.assign(
                "/dashboard"
            );

            break;


        case ROLE_DRIVER:

            window.location.assign(
                "/dashboard#driverDashboard"
            );

            break;


        case ROLE_USER:

            window.location.assign(
                "/dashboard#studentTracking"
            );

            break;

        case ROLE_TECHNICIAN:

            window.location.assign(
                "/dashboard#technicianDashboard"
            );

            break;


        default:

            console.error(
                "BusTrack: Unknown user role:",
                data.user.role
            );

            message.textContent =
                `Unsupported account role: ${data.user.role}`;

            clearSession();

            break;
    }
  } catch (error) {
    clearSession();
    message.textContent = error.message || "Unable to reach the server.";
  } finally {
    submitButton.disabled = false;
  }
});
