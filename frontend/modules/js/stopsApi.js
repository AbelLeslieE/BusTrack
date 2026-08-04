/* ==========================================================================
   BUSTRACK
   STOPS API
========================================================================== */

const BASE_URL = "/api/stops";

/* ==========================================================================
   GET ALL STOPS
========================================================================== */

export async function getStops() {

    const response = await fetch(BASE_URL);

    if (!response.ok) {

        throw new Error("Failed to load stops.");

    }

    return await response.json();

}



/* ==========================================================================
   GET SINGLE STOP
========================================================================== */

export async function getStop(stopId) {

    const response = await fetch(`${BASE_URL}/${stopId}`);

    if (!response.ok) {

        throw new Error("Failed to load stop.");

    }

    return await response.json();

}

/* ==========================================================================
   REFRESH STOPS
========================================================================== */

export async function refreshStops() {

    return await getStops();

}
/* ==========================================================
   IMPORT STOPS
========================================================== */

/* ==========================================================
   IMPORT STOPS
========================================================== */

export async function importStops(file){

    const formData = new FormData();

    formData.append("file", file);

    const response = await fetch("/api/stops/import",{

        method:"POST",

        body:formData

    });

    const result = await response.json();

    if(!response.ok){

        throw new Error(

            result.detail ||

            "Failed to import stops."

        );

    }

    return result;

}
/* ==========================================================================
   CREATE STOP
========================================================================== */

export async function createStop(stop){

    const response = await fetch(BASE_URL,{

        method:"POST",

        headers:{

            "Content-Type":"application/json"

        },

        body:JSON.stringify(stop)

    });

    const result = await response.json();

    if(!response.ok){

        throw new Error(

            result.detail ||

            "Failed to create stop."

        );

    }

    return result;

}

/* ==========================================================================
   UPDATE STOP
========================================================================== */

export async function updateStop(id, stop){

    const response = await fetch(`${BASE_URL}/${id}`,{

        method:"PUT",

        headers:{

            "Content-Type":"application/json"

        },

        body:JSON.stringify(stop)

    });

    const result = await response.json();

    if(!response.ok){

        throw new Error(

            result.detail ||

            "Failed to update stop."

        );

    }

    return result;

}

/* ==========================================================================
   DELETE STOP
========================================================================== */

export async function deleteStop(id){

    const response = await fetch(`${BASE_URL}/${id}`,{

        method:"DELETE"

    });

    const result = await response.json();

    if(!response.ok){

        throw new Error(

            result.detail ||

            "Failed to delete stop."

        );

    }

    return result;

}
/* ==========================================================================
   EXPORT STOPS
========================================================================== */

export function exportStops() {

    const link = document.createElement("a");

    link.href = "/api/stops/export";

    link.download = "Stops.xlsx";

    document.body.appendChild(link);

    link.click();

    document.body.removeChild(link);

}