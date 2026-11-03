const form = document.querySelector("#google-signup-form");
const loading = document.querySelector("#signup-loading");
const message = document.querySelector("#signup-message");
const identity = document.querySelector("#verified-identity");
const emailLabel = document.querySelector("#verified-email");
const usernameInput = document.querySelector("#signup-username");
const routeSelect = document.querySelector("#signup-route");
const passwordInput = document.querySelector("#signup-password");
const passwordConfirm = document.querySelector("#signup-password-confirm");
const togglePassword = document.querySelector("#toggle-signup-password");

function suggestedUsername(email) {
  const localPart = String(email || "").split("@", 1)[0].toLowerCase();
  const cleaned = localPart.replace(/[^a-z0-9_.-]/g, "").slice(0, 64);
  return cleaned.length >= 3 ? cleaned : `student.${cleaned}`.slice(0, 64);
}

function validationIssue(detail) {
  const field = Array.isArray(detail?.loc) ? detail.loc.at(-1) : null;
  const type = String(detail?.type || "");
  const rawMessage = String(detail?.msg || "").replace(/^Value error,\s*/i, "");

  if (field === "username") {
    if (type.includes("too_short")) return { field, message: "Username must be at least 3 characters." };
    if (type.includes("too_long")) return { field, message: "Username must be 64 characters or fewer." };
    return { field, message: "Username can only use letters, numbers, dots, dashes, and underscores. Spaces are not allowed." };
  }
  if (field === "password") {
    if (type.includes("too_short")) return { field, message: "Password must be at least 12 characters." };
    if (type.includes("too_long")) return { field, message: "Password must be 72 characters or fewer." };
    return { field, message: rawMessage || "Please choose a stronger password." };
  }
  if (field === "route_id") {
    return { field, message: "Please choose your bus route before creating the account." };
  }
  return { field, message: rawMessage || "Please check the information you entered." };
}

function responseIssue(data, fallback) {
  if (typeof data?.detail === "string") return { field: null, message: data.detail };
  if (Array.isArray(data?.detail) && data.detail.length) return validationIssue(data.detail[0]);
  return { field: null, message: fallback };
}

function showError(text, input) {
  form?.querySelectorAll("[aria-invalid='true']").forEach((element) => element.removeAttribute("aria-invalid"));
  message.textContent = text;
  if (input) {
    input.setAttribute("aria-invalid", "true");
    input.focus();
  }
}

function validateForm() {
  const username = usernameInput.value.trim();
  if (username.length < 3) return { input: usernameInput, message: "Username must be at least 3 characters." };
  if (username.length > 64) return { input: usernameInput, message: "Username must be 64 characters or fewer." };
  if (!/^[A-Za-z0-9_.-]+$/.test(username)) {
    return { input: usernameInput, message: "Username can only use letters, numbers, dots, dashes, and underscores. Spaces are not allowed." };
  }
  if (!routeSelect.value) return { input: routeSelect, message: "Please choose your bus route before creating the account." };
  if (passwordInput.value.length < 12) return { input: passwordInput, message: "Password must be at least 12 characters." };
  if (passwordInput.value.length > 72) return { input: passwordInput, message: "Password must be 72 characters or fewer." };
  if (!/[a-z]/.test(passwordInput.value)) return { input: passwordInput, message: "Password needs at least one lowercase letter." };
  if (!/[A-Z]/.test(passwordInput.value)) return { input: passwordInput, message: "Password needs at least one uppercase letter." };
  if (!/[0-9]/.test(passwordInput.value)) return { input: passwordInput, message: "Password needs at least one number." };
  if (!/[^A-Za-z0-9]/.test(passwordInput.value)) return { input: passwordInput, message: "Password needs at least one symbol, such as !, @, or #." };
  if (passwordInput.value !== passwordConfirm.value) return { input: passwordConfirm, message: "The two passwords do not match." };
  return null;
}

function routeLabel(route) {
  const routeName = [route.route_code, route.route_name].filter(Boolean).join(" · ");
  const bus = [route.bus_number, route.registration_number].filter(Boolean).join(" · ");
  return `${routeName} — ${bus}`;
}

async function loadVerifiedIdentity() {
  try {
    const response = await fetch("/api/auth/google/pending", { credentials: "same-origin" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.email) {
      throw new Error(responseIssue(data, "Your Google verification has expired.").message);
    }
    emailLabel.textContent = data.email;
    usernameInput.value = suggestedUsername(data.email);
    const routes = Array.isArray(data.routes) ? data.routes : [];
    routeSelect.replaceChildren(new Option("Select your route and bus", ""));
    routes.forEach((route) => {
      routeSelect.add(new Option(routeLabel(route), String(route.id)));
    });
    if (!routes.length) {
      throw new Error("No active routes with an assigned bus are available. Contact the transport administrator.");
    }
    identity.hidden = false;
    form.hidden = false;
    loading.hidden = true;
    usernameInput.focus();
  } catch (error) {
    loading.textContent = error.message || "Unable to load the verified account.";
    loading.classList.add("login-message");
  }
}

togglePassword?.addEventListener("click", () => {
  const shouldShow = passwordInput.type === "password";
  passwordInput.type = shouldShow ? "text" : "password";
  passwordConfirm.type = shouldShow ? "text" : "password";
  togglePassword.textContent = shouldShow ? "Hide" : "Show";
});

form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const invalid = validateForm();
  if (invalid) {
    showError(invalid.message, invalid.input);
    return;
  }

  const submitButton = form.querySelector("button[type='submit']");
  submitButton.disabled = true;
  message.textContent = "Creating your account…";
  try {
    const response = await fetch("/api/auth/google/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({
        username: usernameInput.value.trim(),
        password: passwordInput.value,
        route_id: Number(routeSelect.value),
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const issue = responseIssue(data, "Unable to create the account. Please try again.");
      const error = new Error(issue.message);
      error.field = issue.field;
      throw error;
    }
    message.textContent = "Account created. Taking you to sign in…";
    form.querySelectorAll("input, button").forEach((element) => { element.disabled = true; });
    window.setTimeout(() => {
      const params = new URLSearchParams({ signup: "complete", username: data.username || usernameInput.value.trim() });
      window.location.assign(`/?${params}`);
    }, 1200);
  } catch (error) {
    const fieldInputs = { username: usernameInput, password: passwordInput, route_id: routeSelect };
    showError(error.message || "Unable to create the account. Please try again.", fieldInputs[error.field]);
    submitButton.disabled = false;
  }
});

void loadVerifiedIdentity();
