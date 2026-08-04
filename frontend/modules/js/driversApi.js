/* ==========================================================
   BUSTRACK
   DRIVERS API
========================================================== */

const BASE_URL = "/api/drivers";

/* ==========================================================
   GET ALL DRIVERS
========================================================== */

export async function getDrivers() {

    const response = await fetch(BASE_URL);

    if (!response.ok) {

        throw new Error("Failed to load drivers.");

    }

    return await response.json();

}