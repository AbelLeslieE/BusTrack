/**
 * Shared loading-state view for asynchronous SPA module changes.
 * TODO: Add accessible progress updates for longer running data operations.
 */

export function createLoader(label = "Loading workspace") {
  const loader = document.createElement("div");
  loader.className = "page-loader";
  loader.setAttribute("role", "status");
  loader.innerHTML = `<span class="loader-orbit" aria-hidden="true"></span><span>${label}</span>`;
  return loader;
}
