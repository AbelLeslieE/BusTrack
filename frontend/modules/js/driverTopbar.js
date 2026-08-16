/**
 * Driver Topbar
 *
 * Uses the shared topbar.css.
 */

import { escapeHtml } from "/static/common/security.js";

export function createDriverTopbar(toggleSidebar) {

    const profile =
        JSON.parse(
            localStorage.getItem("bus_tracker_profile") || "{}"
        );

    const topbar = document.createElement("header");

    topbar.className = "topbar";

    topbar.innerHTML = `

        <div class="topbar-title">

            <button
                class="icon-button mobile-menu"
                type="button"
                aria-label="Toggle navigation">

                <i class="fa-solid fa-bars"></i>

            </button>

            <div>

                <p class="section-kicker">

                    DRIVER PORTAL

                </p>

                <h1 id="page-title">

                    Dashboard

                </h1>

            </div>

        </div>

        <div class="search-box">

            <i data-lucide="search"></i>

            <input
                type="text"
                placeholder="Search..."
            >

        </div>

        <div class="topbar-actions">

            <button
                class="icon-button notification-button"
                type="button">

                <i data-lucide="bell"></i>

                <span></span>

            </button>

            <button
                class="profile-button"
                type="button">

                <div class="avatar">

                    ${getInitials(profile.full_name)}

                </div>

                <div class="profile-copy">

                    <strong>

                        ${escapeHtml(profile.full_name || "Driver")}

                    </strong>

                    <small>

                        Driver

                    </small>

                </div>

            </button>

        </div>

    `;

    if (window.lucide) {

        lucide.createIcons();

    }
    const menuButton = topbar.querySelector(".mobile-menu");

    menuButton?.addEventListener("click", () => {

        console.log("Driver hamburger clicked");

        toggleSidebar();

    });
    return topbar;

}

export function setDriverTopbarTitle(topbar, title) {

    const heading =
        topbar.querySelector("#page-title");

    if (heading) {

        heading.textContent = title;

    }

}

function getInitials(name = "") {

    return name
        .split(" ")
        .filter(Boolean)
        .slice(0, 2)
        .map(word => word[0])
        .join("")
        .toUpperCase();

}
