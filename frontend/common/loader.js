/**
 * Shared loading-state view for asynchronous SPA module changes.
 * TODO: Add accessible progress updates for longer running data operations.
 */

export function createLoader(label = "Loading workspace") {
  const loader = document.createElement("div");
  loader.className = "page-loader";
  loader.setAttribute("role", "status");
  const logo = document.createElement("img");
  logo.className = "page-loader__logo";
  logo.src = "/static/assets/images/logo.png?v=20261015logo2";
  logo.alt = "";
  logo.setAttribute("aria-hidden", "true");
  const orbit = document.createElement("span");
  orbit.className = "loader-orbit";
  orbit.setAttribute("aria-hidden", "true");
  const message = document.createElement("span");
  message.textContent = label;
  loader.append(logo, orbit, message);
  return loader;
}
