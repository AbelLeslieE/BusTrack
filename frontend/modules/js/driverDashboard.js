/**
 * Driver Dashboard
 * Hero section only (Step 1)
 */

export function render() {

    const page = document.createElement("div");

    page.className = "driver-dashboard";

    page.innerHTML = `

        <!-- ==========================================
             HERO
        =========================================== -->

        <section class="driver-hero glass-panel">

            <div class="driver-hero-overlay"></div>

            <div class="driver-hero-content">

                <div class="driver-hero-header">

                    <p class="hero-date">

                        Tuesday, 29 July 2025

                    </p>

                    <h1>

                        Good Morning, Abel!

                    </h1>

                    <p class="hero-subtitle">

                        Have a safe trip and a great day ahead.

                    </p>

                </div>

                <div class="driver-status-grid">

                    <div class="status-card">

                        <span class="status-label">

                            Current Status

                        </span>

                        <strong class="status-green">

                            ● On Duty

                        </strong>

                    </div>

                    <div class="status-card">

                        <span class="status-label">

                            Current Bus

                        </span>

                        <strong>

                            BUS-014

                        </strong>

                    </div>

                    <div class="status-card">

                        <span class="status-label">

                            Current Route

                        </span>

                        <strong>

                            Route 5

                        </strong>

                    </div>

                    <div class="status-card">

                        <span class="status-label">

                            Next Departure

                        </span>

                        <strong>

                            08:00 AM

                        </strong>

                    </div>

                </div>

            </div>

        </section>

    `;

    return page;

}