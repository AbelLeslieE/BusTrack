/* ==========================================================================
   BUSTRACK
   USER FORM
========================================================================== */

import { createDropdown } from "/static/common/dropdown.js";

/* ==========================================================================
   CREATE FORM
========================================================================== */

/* ==========================================================================
   CREATE FORM
========================================================================== */

export async function createUserForm(user = {}) {

    const wrapper = document.createElement("div");

    wrapper.className = "user-form";

    wrapper.innerHTML = `

        ${renderAccountInformation(user)}

        ${renderContactInformation(user)}

        ${renderSystemInformation(user)}

        ${renderDriverInformation(user)}

        ${renderStudentInformation(user)}

    `;

    await initializeDropdowns(wrapper, user);

    return wrapper;

}

/* ==========================================================================
   ACCOUNT INFORMATION
========================================================================== */

function renderAccountInformation(user) {

    return `

        <section class="modal-section">

            <h3 class="modal-section-title">

                Account Information

            </h3>

            <div class="modal-grid">

                ${createInput({

                    id: "full_name",

                    label: "Full Name",

                    value: user.full_name || "",

                    placeholder: "John Doe",

                    required: true

                })}

                ${createInput({

                    id: "username",

                    label: "Username",

                    value: user.username || "",

                    placeholder: "john.doe",

                    required: true

                })}

                ${createInput({

                    id: "password",

                    label: "Password",

                    type: "password",

                    placeholder: "Enter password",

                    required: true

                })}

                ${createInput({

                    id: "confirm_password",

                    label: "Confirm Password",

                    type: "password",

                    placeholder: "Confirm password",

                    required: true

                })}

            </div>

        </section>

    `;

}

/* ==========================================================================
   CONTACT INFORMATION
========================================================================== */

function renderContactInformation(user) {

    return `

        <section class="modal-section">

            <h3 class="modal-section-title">

                Contact Information

            </h3>

            <div class="modal-grid">

                ${createInput({

                    id: "email",

                    label: "Email",

                    type: "email",

                    value: user.email || "",

                    placeholder: "john@example.com"

                })}

                ${createInput({

                    id: "phone",

                    label: "Phone Number",

                    value: user.phone || "",

                    placeholder: "+91 9876543210"

                })}

            </div>

        </section>

    `;

}

/* ==========================================================================
   SYSTEM INFORMATION
========================================================================== */

function renderSystemInformation(user) {

    return `

        <section class="modal-section">

            <h3 class="modal-section-title">

                System Information

            </h3>

            <div class="modal-grid">

                <div class="modal-group">

                    <label class="modal-label">

                        Role

                        <span class="modal-required">*</span>

                    </label>

                    <div id="role_container"></div>

                </div>

                <div class="modal-group">

                    <label class="modal-label">

                        Status

                    </label>

                    <div id="status_container"></div>

                </div>

            </div>

        </section>

    `;

}
function renderDriverInformation(user) {

    return `

        <section
            id="driver_information_section"
            class="modal-section"
            style="display:none;"
        >

            <h3 class="modal-section-title">

                Driver Information

            </h3>

            <div class="modal-grid">

                ${createInput({
                    id: "driver_code",
                    label: "Driver Code",
                    value: user.driver_code || "",
                    placeholder: "DRV001",
                    required: true
                })}

                ${createInput({
                    id: "license_number",
                    label: "License Number",
                    value: user.license_number || "",
                    placeholder: "KL072024123456",
                    required: true
                })}

                ${createInput({
                    id: "license_expiry",
                    label: "License Expiry",
                    type: "date",
                    value: user.license_expiry || "",
                    required: true
                })}

                ${createTextarea({
                    id: "address",
                    label: "Address",
                    value: user.address || "",
                    placeholder: "Driver Address"
                })}

                <div class="modal-group">

                    <label class="modal-label">

                        Assigned Bus

                    </label>

                    <div id="driver_bus_container"></div>

                </div>

            </div>

        </section>

    `;

}
/* ==========================================================================
   STUDENT INFORMATION
========================================================================== */

/* ==========================================================================
   STUDENT INFORMATION
========================================================================== */

function renderStudentInformation(user) {

    return `

        <section
            id="student_information_section"
            class="modal-section"
            style="display:none;"
        >

            <h3 class="modal-section-title">

                Student Information

            </h3>

            <div class="modal-grid">

                ${createInput({

                    id: "student_code",

                    label: "Student Code",

                    value: user.student_code || "",

                    placeholder: "STU001",

                    required: true

                })}

                <div class="modal-group">

                    <label class="modal-label">

                        Assigned Bus

                    </label>

                    <div id="student_bus_container"></div>

                </div>

                <div class="modal-group">

                    <label class="modal-label">

                        Boarding Stop

                    </label>

                    <div id="student_stop_container"></div>

                </div>

            </div>

        </section>

    `;

}
/* ==========================================================================
   FORM COMPONENTS
========================================================================== */

function createInput({

    id,
    label,
    type = "text",
    value = "",
    placeholder = "",
    required = false

}) {

    return `

        <div class="modal-group">

            <label
                class="modal-label"
                for="${id}"
            >

                ${label}

                ${required
                    ? '<span class="modal-required">*</span>'
                    : ""
                }

            </label>

            <input

                id="${id}"

                class="modal-input"

                type="${type}"

                value="${value}"

                placeholder="${placeholder}"

            >

        </div>

    `;

}

/* ==========================================================================
   TEXTAREA COMPONENT
========================================================================== */

function createTextarea({

    id,
    label,
    value = "",
    placeholder = ""

}) {

    return `

        <div class="modal-group modal-group-full">

            <label
                class="modal-label"
                for="${id}"
            >

                ${label}

            </label>

            <textarea

                id="${id}"

                class="modal-textarea"

                rows="4"

                placeholder="${placeholder}"

            >${value}</textarea>

        </div>

    `;

}

/* ==========================================================================
   INITIALIZE DROPDOWNS
========================================================================== */
/* ==========================================================================
   INITIALIZE DROPDOWNS
========================================================================== */

async function initializeDropdowns(wrapper, user) {

    /* ----------------------------------------------------------
       Load buses and routes.

       The bus determines the route.
       The route determines the valid boarding stops.
    ---------------------------------------------------------- */

    let buses = [];
    let routes = [];

    try {

        const [
            busResponse,
            routeResponse
        ] = await Promise.all([

            fetch("/api/buses/"),

            fetch("/api/routes")

        ]);


        if (!busResponse.ok) {

            throw new Error(
                "Failed to load buses."
            );

        }


        if (!routeResponse.ok) {

            throw new Error(
                "Failed to load routes."
            );

        }


        buses =
            await busResponse.json();

        routes =
            await routeResponse.json();

    }
    catch (error) {

        console.error(
            "BusTrack: Failed to load transport data.",
            error
        );

        buses = [];

        routes = [];

    }


    /* ==========================================================
       ROLE DROPDOWN
    ========================================================== */

    const roleDropdown =
        createDropdown({

            id: "role",

            value:
                user.role ||
                "Administrator",

            placeholder:
                "Select Role",

            items: [

                {
                    value: "Administrator",

                    label: "Administrator"
                },

                {
                    value: "Driver",

                    label: "Driver"
                },

                {
                    value: "Student",

                    label: "Student"
                },

                {
                    value: "Transport Manager",

                    label:
                        "Transport Manager (Coming Soon)"
                },

                {
                    value: "Dispatcher",

                    label:
                        "Dispatcher (Coming Soon)"
                },

                {
                    value: "Technician",

                    label:
                        "Technician (Coming Soon)"
                }

            ]

        });


    wrapper
        .querySelector("#role_container")
        .appendChild(
            roleDropdown
        );


    /* ==========================================================
       STATUS DROPDOWN
    ========================================================== */

    const statusDropdown =
        createDropdown({

            id: "status",

            value:
                user.status ||
                "Active",

            placeholder:
                "Select Status",

            items: [

                "Active",

                "Inactive",

                "Locked"

            ]

        });


    wrapper
        .querySelector("#status_container")
        .appendChild(
            statusDropdown
        );


    /* ==========================================================
       DRIVER ASSIGNED BUS
    ========================================================== */

    const driverBusDropdown =
        createDropdown({

            id: "bus_id",

            value:
                user.role === "Driver"
                    ? user.bus_id ?? ""
                    : "",

            placeholder:
                "Select Bus",

            items:
                buses.map(
                    bus => ({

                        value:
                            bus.id,

                        label:
                            `${bus.bus_number} • ${bus.status}`

                    })
                )

        });


    wrapper
        .querySelector("#driver_bus_container")
        ?.appendChild(
            driverBusDropdown
        );


    /* ==========================================================
       STUDENT ASSIGNED BUS
    ========================================================== */

    const studentBusDropdown =
        createDropdown({

            id: "student_bus_id",

            value:
                user.role === "Student"
                    ? user.bus_id ?? ""
                    : "",

            placeholder:
                "Select Bus",

            items:
                buses.map(
                    bus => ({

                        value:
                            bus.id,

                        label:
                            `${bus.bus_number} • ${bus.status}`

                    })
                )

        });


    wrapper
        .querySelector("#student_bus_container")
        ?.appendChild(
            studentBusDropdown
        );


    /* ==========================================================
       STUDENT BOARDING STOP
       
       Initially empty.
       It will be populated after a bus is selected.
    ========================================================== */

    const studentStopDropdown =
        createDropdown({

            id: "student_stop_id",

            value: "",

            placeholder:
                "Select Boarding Stop",

            items: []

        });


    wrapper
        .querySelector("#student_stop_container")
        ?.appendChild(
            studentStopDropdown
        );


    /* ==========================================================
       LOAD STUDENT BOARDING STOPS
    ========================================================== */

    async function loadStudentStops(
        busId,
        selectedStopId = null
    ) {

        /* ------------------------------------------------------
           Clear existing stops.
        ------------------------------------------------------ */

        studentStopDropdown.setItems([]);


        if (!busId) {

            studentStopDropdown.clear();

            return;

        }


        /* ------------------------------------------------------
           Find the route assigned to this bus.
           
           Route.bus_id is the authoritative relationship.
        ------------------------------------------------------ */

        const route =
            routes.find(
                item =>
                    Number(item.bus_id) ===
                    Number(busId)
            );


        if (!route) {

            studentStopDropdown.clear();

            console.warn(
                "BusTrack: Selected bus has no assigned route."
            );

            return;

        }


        /* ------------------------------------------------------
           Load stops belonging to that route.
        ------------------------------------------------------ */

        try {

            const response =
                await fetch(
                    `/api/route-stops/${route.id}`
                );


            if (!response.ok) {

                throw new Error(
                    "Failed to load boarding stops."
                );

            }


            const routeStops =
                await response.json();


            /* --------------------------------------------------
               Convert route stops into dropdown items.
            -------------------------------------------------- */

            studentStopDropdown.setItems(

                routeStops.map(
                    routeStop => ({

                        value:
                            routeStop.stop_id,

                        label:
                            `${routeStop.stop_name} • ${routeStop.stop_code}`

                    })
                )

            );


            /* --------------------------------------------------
               Restore existing assignment when editing.
            -------------------------------------------------- */

            if (
                selectedStopId !== null &&
                selectedStopId !== undefined
            ) {

                studentStopDropdown.setValue(
                    Number(selectedStopId)
                );

            }

        }
        catch (error) {

            console.error(
                "BusTrack: Failed to load student boarding stops.",
                error
            );

            studentStopDropdown.clear();

        }

    }


    /* ==========================================================
       STUDENT BUS CHANGE
    ========================================================== */

    studentBusDropdown.addEventListener(
        "change",
        async () => {

            const selectedBusId =
                studentBusDropdown.getValue();


            /* --------------------------------------------------
               Changing the bus invalidates the previous stop.
            -------------------------------------------------- */

            studentStopDropdown.clear();


            await loadStudentStops(
                selectedBusId
            );

        }
    );


    /* ==========================================================
       ROLE-BASED SECTION VISIBILITY
    ========================================================== */

    const driverSection =
        wrapper.querySelector(
            "#driver_information_section"
        );


    const studentSection =
        wrapper.querySelector(
            "#student_information_section"
        );


    function toggleRoleInformationSections() {

        const role =
            roleDropdown.getValue();


        /* ------------------------------------------------------
           Driver section
        ------------------------------------------------------ */

        if (driverSection) {

            driverSection.style.display =
                role === "Driver"
                    ? ""
                    : "none";

        }


        /* ------------------------------------------------------
           Student section
        ------------------------------------------------------ */

        if (studentSection) {

            studentSection.style.display =
                role === "Student"
                    ? ""
                    : "none";

        }

    }


    roleDropdown.addEventListener(
        "change",
        toggleRoleInformationSections
    );


    /* ==========================================================
       INITIAL ROLE VISIBILITY
    ========================================================== */

    toggleRoleInformationSections();


    /* ==========================================================
       RESTORE EXISTING STUDENT ASSIGNMENT
       
       This is used when editing a Student.
    ========================================================== */

    if (
        user.role === "Student" &&
        user.bus_id
    ) {

        await loadStudentStops(

            user.bus_id,

            user.stop_id ?? null

        );

    }

}
/* ==========================================================================
   FORM DATA
========================================================================== */

/**
 * Collect all values from the form.
 */

/* ==========================================================================
   FORM DATA
========================================================================== */

/**
 * Collect all values from the form.
 */

export function getUserFormData() {

    const passwordInput =
        document.querySelector("#password");


    const confirmPasswordInput =
        document.querySelector("#confirm_password");


    const password =
        passwordInput &&
        !passwordInput.disabled

            ? passwordInput.value.trim()

            : "";


    const confirmPassword =
        confirmPasswordInput &&
        !confirmPasswordInput.disabled

            ? confirmPasswordInput.value.trim()

            : "";


    /* ----------------------------------------------------------
       Password Validation
    ---------------------------------------------------------- */

    if (
        passwordInput &&
        !passwordInput.disabled
    ) {

        if (
            password !==
            confirmPassword
        ) {

            throw new Error(
                "Passwords do not match."
            );

        }

    }


    /* ----------------------------------------------------------
       Role
    ---------------------------------------------------------- */

    const role =
        document
            .querySelector("#role")
            .getValue();


    /* ----------------------------------------------------------
       Status
    ---------------------------------------------------------- */

    const status =
        document
            .querySelector("#status")
            .getValue();


    console.log(
        "ROLE VALUE:",
        role
    );


    console.log(
        "STATUS VALUE:",
        status
    );


    /* ----------------------------------------------------------
       Driver Bus
    ---------------------------------------------------------- */

    const driverBusDropdown =
        document.querySelector(
            "#bus_id"
        );


    /* ----------------------------------------------------------
       Student Bus
    ---------------------------------------------------------- */

    const studentBusDropdown =
        document.querySelector(
            "#student_bus_id"
        );


    /* ----------------------------------------------------------
       Student Boarding Stop
    ---------------------------------------------------------- */

    const studentStopDropdown =
        document.querySelector(
            "#student_stop_id"
        );


    /* ----------------------------------------------------------
       Build final form object
    ---------------------------------------------------------- */

    const formData = {

        full_name:
            document
                .querySelector("#full_name")
                .value
                .trim(),


        username:
            document
                .querySelector("#username")
                .value
                .trim(),


        password,


        email:
            document
                .querySelector("#email")
                .value
                .trim(),


        phone:
            document
                .querySelector("#phone")
                .value
                .trim(),


        role,


        status,


        /* ======================================================
           DRIVER FIELDS
        ====================================================== */

        driver_code:
            role === "Driver"

                ? document
                    .querySelector("#driver_code")
                    ?.value
                    .trim() || null

                : null,


        license_number:
            role === "Driver"

                ? document
                    .querySelector("#license_number")
                    ?.value
                    .trim() || null

                : null,


        license_expiry:
            role === "Driver"

                ? document
                    .querySelector("#license_expiry")
                    ?.value || null

                : null,


        address:
            role === "Driver"

                ? document
                    .querySelector("#address")
                    ?.value
                    .trim() || null

                : null,


        /* ======================================================
           BUS ASSIGNMENT
        ====================================================== */

        bus_id:

            role === "Driver"

                ? driverBusDropdown
                    ?.getValue() || null

                : role === "Student"

                    ? studentBusDropdown
                        ?.getValue() || null

                    : null,


        /* ======================================================
           STUDENT FIELDS
        ====================================================== */

        student_code:

            role === "Student"

                ? document
                    .querySelector("#student_code")
                    ?.value
                    .trim() || null

                : null,


        stop_id:

            role === "Student"

                ? studentStopDropdown
                    ?.getValue() || null

                : null

    };


    /* ----------------------------------------------------------
       DEBUG
    ---------------------------------------------------------- */

    console.log(
        "FINAL USER FORM DATA:",
        formData
    );


    return formData;

}
/* ==========================================================================
   VALIDATION
========================================================================== */

/**
 * Validate required fields.
 */

export function validateUserForm() {

    const data = getUserFormData();

    if (!data.full_name) {

        throw new Error(

            "Full Name is required."

        );

    }

    if (!data.username) {

        throw new Error(

            "Username is required."

        );

    }

    const passwordInput = document.querySelector("#password");

    if (

        passwordInput &&

        !passwordInput.disabled &&

        !data.password

    ) {

        throw new Error(

            "Password is required."

        );

    }

    if (!data.role) {

        throw new Error(

            "Please select a role."

        );

    }


    /* ----------------------------------------------------------
       Student Validation
    ---------------------------------------------------------- */

    if (
        data.role === "Student" &&
        !data.student_code
    ) {

        throw new Error(

            "Student Code is required."

        );

    }


    /* ----------------------------------------------------------
       Driver Validation
    ---------------------------------------------------------- */

    if (data.role === "Driver") {

        if (!data.driver_code) {

            throw new Error(
                "Driver Code is required."
            );

        }

        if (!data.license_number) {

            throw new Error(
                "License Number is required."
            );

        }

        if (!data.license_expiry) {

            throw new Error(
                "License Expiry is required."
            );

        }

    }


    return data;

}

/* ==========================================================================
   RESET FORM
========================================================================== */

/**
 * Reset all form fields.
 */
/* ==========================================================================
   RESET FORM
========================================================================== */
/* ==========================================================================
   RESET FORM
========================================================================== */

/**
 * Reset all form fields.
 */

export function resetUserForm() {

    /* ----------------------------------------------------------
       Account fields
    ---------------------------------------------------------- */

    const fullName =
        document.querySelector("#full_name");

    const username =
        document.querySelector("#username");

    const password =
        document.querySelector("#password");

    const confirmPassword =
        document.querySelector("#confirm_password");

    const email =
        document.querySelector("#email");

    const phone =
        document.querySelector("#phone");


    if (fullName) {
        fullName.value = "";
    }

    if (username) {
        username.value = "";
    }

    if (password) {
        password.value = "";
    }

    if (confirmPassword) {
        confirmPassword.value = "";
    }

    if (email) {
        email.value = "";
    }

    if (phone) {
        phone.value = "";
    }


    /* ----------------------------------------------------------
       Driver fields
    ---------------------------------------------------------- */

    const driverCode =
        document.querySelector("#driver_code");

    const licenseNumber =
        document.querySelector("#license_number");

    const licenseExpiry =
        document.querySelector("#license_expiry");

    const address =
        document.querySelector("#address");


    if (driverCode) {
        driverCode.value = "";
    }

    if (licenseNumber) {
        licenseNumber.value = "";
    }

    if (licenseExpiry) {
        licenseExpiry.value = "";
    }

    if (address) {
        address.value = "";
    }


    /* ----------------------------------------------------------
       Student fields
    ---------------------------------------------------------- */

    const studentCode =
        document.querySelector("#student_code");


    if (studentCode) {
        studentCode.value = "";
    }


    /* ----------------------------------------------------------
       Role
    ---------------------------------------------------------- */

    const role =
        document.querySelector("#role");

    if (role) {
        role.clear();
    }


    /* ----------------------------------------------------------
       Status
    ---------------------------------------------------------- */

    const status =
        document.querySelector("#status");

    if (status) {
        status.setValue("Active");
    }


    /* ----------------------------------------------------------
       Driver information section
    ---------------------------------------------------------- */

    const driverSection =
        document.querySelector(
            "#driver_information_section"
        );

    if (driverSection) {
        driverSection.style.display = "none";
    }


    /* ----------------------------------------------------------
       Student information section
    ---------------------------------------------------------- */

    const studentSection =
        document.querySelector(
            "#student_information_section"
        );

    if (studentSection) {
        studentSection.style.display = "none";
    }

}