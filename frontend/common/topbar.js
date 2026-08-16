/** Shared administrator dashboard topbar. */

import { escapeHtml } from "/static/common/security.js";
import { roleLabel } from "/static/common/roles.js";

export function createTopbar(onMenuToggle) {
  const profile = JSON.parse(localStorage.getItem("bus_tracker_profile") || "{}");
  const name = profile.full_name || profile.username || "Admin";
  const initials = name.split(" ").filter(Boolean).slice(0, 2).map((word) => word[0]).join("").toUpperCase() || "A";
  const topbar = document.createElement("header");
  topbar.className = "topbar glass-panel";
  topbar.innerHTML = `
    <div class="topbar-title">
      <button
          class="icon-button mobile-menu"
          type="button"
          aria-label="Toggle navigation">

          <i class="fa-solid fa-bars"></i>

      </button>
      <div><p class="section-kicker">Fleet command center</p><h1 id="page-title">Overview</h1></div>
    </div>
    <div class="topbar-actions">
      <label class="search-box"><span aria-hidden="true">⌕</span><input type="search" placeholder="Search fleet"></label>
      <button class="icon-button notification-button" type="button" aria-label="Notifications">♧<span></span></button>
      <button class="profile-button" type="button" aria-label="Open profile"><span class="avatar">${escapeHtml(initials)}</span><span class="profile-copy"><strong>${escapeHtml(name)}</strong><small>${roleLabel(profile.role)}</small></span><span aria-hidden="true">⌄</span></button>
    </div>`;
  topbar.querySelector(".mobile-menu")?.addEventListener("click", onMenuToggle);
  return topbar;
}

export function setTopbarTitle(topbar, title) {
  const heading = topbar.querySelector("#page-title");
  if (heading) heading.textContent = title;
}
