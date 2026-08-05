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

        let message = "Request failed.";

        if (typeof data?.detail === "string") {

            message = data.detail;

        }

        else if (Array.isArray(data?.detail) && data.detail.length > 0) {

            const error = data.detail[0];

            if (error.loc?.includes("password")) {

                message = "Password must contain at least 8 characters.";

            }

            else if (error.loc?.includes("username")) {

                message = "Please enter a valid username.";

            }

            else if (error.loc?.includes("email")) {

                message = "Please enter a valid email address.";

            }

            else {

                message = error.msg;

            }

        }

        throw new Error(message);

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
/* ==========================================================
   USER API
========================================================== */

export const UserAPI = {

    getAll() {

        return request("/users");

    },

    get(id) {

        return request(`/users/${id}`);

    },

    create(data) {

        return request("/users", {

            method: "POST",

            body: JSON.stringify(data)

        });

    },

    update(id, data) {

        return request(`/users/${id}`, {

            method: "PUT",

            body: JSON.stringify(data)

        });

    },

    remove(id) {

        return request(`/users/${id}`, {

            method: "DELETE"

        });

    }

};