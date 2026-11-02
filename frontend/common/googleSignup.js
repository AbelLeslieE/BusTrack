const form = document.querySelector("#google-signup-form");
const loading = document.querySelector("#signup-loading");
const message = document.querySelector("#signup-message");
const identity = document.querySelector("#verified-identity");
const emailLabel = document.querySelector("#verified-email");
const usernameInput = document.querySelector("#signup-username");
const passwordInput = document.querySelector("#signup-password");
const passwordConfirm = document.querySelector("#signup-password-confirm");
const togglePassword = document.querySelector("#toggle-signup-password");

function suggestedUsername(email) {
  const localPart = String(email || "").split("@", 1)[0].toLowerCase();
  const cleaned = localPart.replace(/[^a-z0-9_.-]/g, "").slice(0, 64);
  return cleaned.length >= 3 ? cleaned : `student.${cleaned}`.slice(0, 64);
}

function responseError(data, fallback) {
  if (typeof data?.detail === "string") return data.detail;
  if (Array.isArray(data?.detail) && typeof data.detail[0]?.msg === "string") {
    return data.detail[0].msg.replace(/^Value error,\s*/i, "");
  }
  return fallback;
}

async function loadVerifiedIdentity() {
  try {
    const response = await fetch("/api/auth/google/pending", { credentials: "same-origin" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.email) {
      throw new Error(responseError(data, "Your Google verification has expired."));
    }
    emailLabel.textContent = data.email;
    usernameInput.value = suggestedUsername(data.email);
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
  if (passwordInput.value !== passwordConfirm.value) {
    message.textContent = "The passwords do not match.";
    passwordConfirm.focus();
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
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(responseError(data, "Unable to create the account."));
    message.textContent = "Account created. Taking you to sign in…";
    form.querySelectorAll("input, button").forEach((element) => { element.disabled = true; });
    window.setTimeout(() => {
      const params = new URLSearchParams({ signup: "complete", username: data.username || usernameInput.value.trim() });
      window.location.assign(`/?${params}`);
    }, 1200);
  } catch (error) {
    message.textContent = error.message || "Unable to create the account.";
    submitButton.disabled = false;
  }
});

void loadVerifiedIdentity();
