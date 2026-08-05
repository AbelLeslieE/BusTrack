/**
 * Browser JWT session handling and login-form behavior.
 * TODO: Move tokens to secure HTTP-only cookies when a production frontend origin is configured.
 */

const TOKEN_KEY = "bus_tracker_access_token";
const PROFILE_KEY = "bus_tracker_profile";

export function getAccessToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(PROFILE_KEY);
}

export async function requireAuthenticatedSession() {
  const token = getAccessToken();
  if (!token) {
    window.location.replace("/");
    return null;
  }
  const response = await fetch("/api/auth/me", { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) {
    clearSession();
    window.location.replace("/");
    return null;
  }
  const profile = await response.json();
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
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
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.access_token) {
      throw new Error(data.detail || "Unable to sign in.");
    }
    localStorage.setItem(TOKEN_KEY, data.access_token);
    localStorage.setItem(PROFILE_KEY, JSON.stringify(data.user));

    // ------------------------------------------------
    // Redirect based on role
    // ------------------------------------------------

    switch (data.user.role) {

        case "Administrator":

            window.location.assign("/dashboard");
            break;

        case "Driver":
            window.location.assign("/dashboard#driverDashboard");
            break;

        default:

            window.location.assign("/dashboard");
            break;
    }
  } catch (error) {
    clearSession();
    message.textContent = error.message || "Unable to reach the server.";
  } finally {
    submitButton.disabled = false;
  }
});
