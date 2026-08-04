/* ==========================================================
   BUSTRACK
   ROUTE STOPS API
========================================================== */

const BASE_URL = "/api/route-stops";

/* ==========================================================
   GET ROUTE STOPS
========================================================== */

export async function getRouteStops(routeId) {

    const response = await fetch(`${BASE_URL}/${routeId}`);

    if (!response.ok) {

        throw new Error("Failed to load route stops.");

    }

    return await response.json();

}

/* ==========================================================
   ADD STOP TO ROUTE
========================================================== */

export async function addRouteStop(routeId, stopData) {

    const response = await fetch(`${BASE_URL}/${routeId}`, {

        method: "POST",

        headers: {

            "Content-Type": "application/json"

        },

        body: JSON.stringify(stopData)

    });

    if (!response.ok) {

        const error = await response.json();

        throw new Error(error.detail || "Failed to add stop.");

    }

    return await response.json();

}

/* ==========================================================
   UPDATE ROUTE STOP
========================================================== */

export async function updateRouteStop(routeStopId, stopData) {

    const response = await fetch(`${BASE_URL}/${routeStopId}`, {

        method: "PUT",

        headers: {

            "Content-Type": "application/json"

        },

        body: JSON.stringify(stopData)

    });

    if (!response.ok) {

        const error = await response.json();

        throw new Error(error.detail || "Failed to update stop.");

    }

    return await response.json();

}
/* ==========================================================
   CLEAR ALL ROUTE STOPS
========================================================== */

export async function clearRouteStops(routeId) {

    const response = await fetch(

        `${BASE_URL}/route/${routeId}`,

        {

            method: "DELETE"

        }

    );

    if (!response.ok) {

        const error = await response.json();

        throw new Error(
            error.detail || "Failed to clear route stops."
        );

    }

    return await response.json();

}
/* ==========================================================
   DELETE ROUTE STOP
========================================================== */

export async function deleteRouteStop(routeStopId) {

    const response = await fetch(`${BASE_URL}/${routeStopId}`, {

        method: "DELETE"

    });

    if (!response.ok) {

        const error = await response.json();

        throw new Error(error.detail || "Failed to delete stop.");

    }

    return await response.json();

}

/* ==========================================================
   REFRESH ROUTE STOPS
========================================================== */

export async function refreshRouteStops(routeId) {

    return await getRouteStops(routeId);

}