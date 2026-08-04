/* ==========================================================
   BUSTRACK
   ROUTES API
========================================================== */

const BASE_URL = "/api/routes";

/* ==========================================================
   GET ALL ROUTES
========================================================== */

export async function getRoutes() {

    const response = await fetch(BASE_URL);

    if (!response.ok) {

        throw new Error("Failed to load routes.");

    }

    return await response.json();

}

/* ==========================================================
   GET ROUTE
========================================================== */

export async function getRoute(routeId) {

    const response = await fetch(`${BASE_URL}/${routeId}`);

    if (!response.ok) {

        throw new Error("Failed to load route.");

    }

    return await response.json();

}

/* ==========================================================
   REFRESH ROUTES
========================================================== */

export async function refreshRoutes() {

    return await getRoutes();

}
/* ==========================================================
   CREATE ROUTE
========================================================== */

export async function createRoute(routeData) {

    const response = await fetch(BASE_URL, {

        method: "POST",

        headers: {

            "Content-Type": "application/json"

        },

        body: JSON.stringify(routeData)

    });

    if (!response.ok) {

        const error = await response.json();

        throw new Error(error.detail || "Failed to create route.");

    }

    return await response.json();

}

/* ==========================================================
   UPDATE ROUTE
========================================================== */

export async function updateRoute(routeId, routeData) {

    const response = await fetch(`${BASE_URL}/${routeId}`, {

        method: "PUT",

        headers: {

            "Content-Type": "application/json"

        },

        body: JSON.stringify(routeData)

    });

    if (!response.ok) {

        const error = await response.json();

        throw new Error(error.detail || "Failed to update route.");

    }

    return await response.json();

}

/* ==========================================================
   DELETE ROUTE
========================================================== */

export async function deleteRoute(routeId) {

    const response = await fetch(`${BASE_URL}/${routeId}`, {

        method: "DELETE"

    });

    if (!response.ok) {

        const error = await response.json();

        throw new Error(error.detail || "Failed to delete route.");

    }

    return await response.json();

}

/* ==========================================================
   GET ALL BUSES
========================================================== */

export async function getBuses() {

    const response = await fetch("/api/buses");

    if (!response.ok) {

        throw new Error("Failed to load buses.");

    }

    return await response.json();

}

/* ==========================================================
   GET ALL DRIVERS
========================================================== */

export async function getDrivers() {

    const response = await fetch("/api/drivers");

    if (!response.ok) {

        throw new Error("Failed to load drivers.");

    }

    return await response.json();

}