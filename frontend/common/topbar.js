/**
 * Shared dashboard topbar.
 * TODO: Connect notification and profile controls to authenticated user data.
 */

export function createTopbar(onMenuToggle) {
  const topbar = document.createElement("header");
  topbar.className = "topbar glass-panel";
  topbar.innerHTML = `
    <div class="topbar-title">
      <button class="icon-button mobile-menu" type="button" aria-label="Toggle navigation">☰</button>
      <div><p class="section-kicker">Fleet command center</p><h1 id="page-title">Overview</h1></div>
    </div>
    <div class="topbar-actions">
      <label class="search-box"><span aria-hidden="true">⌕</span><input type="search" placeholder="Search fleet"></label>
      <button class="icon-button notification-button" type="button" aria-label="Notifications">♧<span></span></button>
      <button class="profile-button" type="button" aria-label="Open profile"><span class="avatar">AM</span><span class="profile-copy"><strong>Abel Leslie E</strong><small>Transport admin</small></span><span aria-hidden="true">⌄</span></button>
    </div>`;
  topbar.querySelector(".mobile-menu")?.addEventListener("click", onMenuToggle);
  return topbar;
}

export function setTopbarTitle(topbar, title) {
  const heading = topbar.querySelector("#page-title");
  if (heading) heading.textContent = title;
}
