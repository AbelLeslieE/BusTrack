/* ==========================================================
   BUSTRACK
   API CLIENT
========================================================== */

const API_BASE = "/api";

/* ==========================================================
   REQUEST
========================================================== */

export async function request(path, options = {}) {

    const response = await fetch(

        API_BASE + path,

        {
            headers: {

                "Content-Type": "application/json",

                ...(options.headers || {})

            },

            ...options

        }

    );

    const data = await response.json().catch(() => null);

    if (!response.ok) {

        throw new Error(

            data?.detail ||

            "Request failed."

        );

    }

    return data;

}

/* ==========================================================
   BUS API
========================================================== */

export const BusAPI = {

    getAll() {

        return request("/buses/");

    },

    get(id) {

        return request(`/buses/${id}`);

    },

    create(data) {

        return request("/buses/", {

            method: "POST",

            body: JSON.stringify(data)

        });

    },

    update(id, data) {

        return request(`/buses/${id}`, {

            method: "PUT",

            body: JSON.stringify(data)

        });

    },

    remove(id) {

        return request(`/buses/${id}`, {

            method: "DELETE"

        });

    }

};