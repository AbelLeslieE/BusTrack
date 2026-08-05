/* ==========================================================================
   BUSTRACK
   USERS API
========================================================================== */

import { request } from "/static/common/api.js";

/* ==========================================================================
   GET ALL USERS
========================================================================== */

export async function getUsers() {

    return await request(

        "/users"

    );

}

/* ==========================================================================
   GET USER
========================================================================== */

export async function getUser(userId) {

    return await request(

        `/users/${userId}`

    );

}

/* ==========================================================================
   CREATE USER
========================================================================== */

export async function createUser(userData) {

    return await request(

        "/users",

        {

            method: "POST",

            body: JSON.stringify(userData)

        }

    );

}

/* ==========================================================================
   UPDATE USER
========================================================================== */

export async function updateUser(userId, userData) {

    return await request(

        `/users/${userId}`,

        {

            method: "PUT",

            body: JSON.stringify(userData)

        }

    );

}

/* ==========================================================================
   DELETE USER
========================================================================== */

export async function deleteUser(userId) {

    return await request(

        `/users/${userId}`,

        {

            method: "DELETE"

        }

    );

}