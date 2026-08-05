/* ==========================================================================
   BUSTRACK
   USER FORM
========================================================================== */

import { createDropdown } from "/static/common/dropdown.js";

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

async function initializeDropdowns(wrapper, user) {

    /* ----------------------------------------------------------
       Role Dropdown
    ---------------------------------------------------------- */

    wrapper

        .querySelector("#role_container")

        .appendChild(

            createDropdown({

                id: "role",

                value: user.role || "Administrator",

                placeholder: "Select Role",

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
                        label: "Transport Manager (Coming Soon)"
                    },

                    {
                        value: "Dispatcher",
                        label: "Dispatcher (Coming Soon)"
                    },

                    {
                        value: "Technician",
                        label: "Technician (Coming Soon)"
                    }

                ]

            })

        );

    /* ----------------------------------------------------------
       Status Dropdown
    ---------------------------------------------------------- */

    wrapper

        .querySelector("#status_container")

        .appendChild(

            createDropdown({

                id: "status",

                value: user.status || "Active",

                placeholder: "Select Status",

                items: [

                    "Active",

                    "Inactive",

                    "Locked"

                ]

            })

        );
        wrapper
            .querySelector("#driver_bus_container")
            ?.appendChild(

                createDropdown({

                    id: "bus_id",

                    placeholder: "Select Bus",

                    items: []

                })

            );
        /* ----------------------------------------------------------
        Driver Section Visibility
        ---------------------------------------------------------- */

        const roleDropdown = wrapper.querySelector("#role");

        const driverSection = wrapper.querySelector(
            "#driver_information_section"
        );

        function toggleDriverSection() {

            if (!driverSection) return;

            driverSection.style.display =
                roleDropdown.getValue() === "Driver"
                    ? ""
                    : "none";

        }

        roleDropdown.addEventListener(
            "change",
            toggleDriverSection
        );

        toggleDriverSection();

}
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
        passwordInput && !passwordInput.disabled
            ? passwordInput.value.trim()
            : "";

    const confirmPassword =
        confirmPasswordInput && !confirmPasswordInput.disabled
            ? confirmPasswordInput.value.trim()
            : "";

    /* ----------------------------------------------------------
       Password Validation
    ---------------------------------------------------------- */

    if (!passwordInput?.disabled) {

        if (password !== confirmPassword) {

            throw new Error(

                "Passwords do not match."

            );

        }

    }
    console.log(
        "ROLE VALUE:",
        document.querySelector("#role").getValue()
    );

    console.log(
        "STATUS VALUE:",
        document.querySelector("#status").getValue()
    );
    const role = document.querySelector("#role").getValue();

    return {

        full_name:
            document.querySelector("#full_name").value.trim(),

        username:
            document.querySelector("#username").value.trim(),

        password,

        email:
            document.querySelector("#email").value.trim(),

        phone:
            document.querySelector("#phone").value.trim(),

        role,

        status:
            document.querySelector("#status").getValue(),

        // --------------------------------------------------
        // Driver fields
        // --------------------------------------------------

        driver_code:
            role === "Driver"
                ? document.querySelector("#driver_code")?.value.trim() || null
                : null,

        license_number:
            role === "Driver"
                ? document.querySelector("#license_number")?.value.trim() || null
                : null,

        license_expiry:
            role === "Driver"
                ? document.querySelector("#license_expiry")?.value || null
                : null,

        address:
            role === "Driver"
                ? document.querySelector("#address")?.value.trim() || null
                : null,

        bus_id:
            role === "Driver"
                ? document.querySelector("#bus_id")?.getValue() || null
                : null

    };

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

    return data;

}

/* ==========================================================================
   RESET FORM
========================================================================== */

/**
 * Reset all form fields.
 */

export function resetUserForm() {

    document.querySelector("#full_name").value = "";

    document.querySelector("#username").value = "";

    document.querySelector("#password").value = "";

    document.querySelector("#confirm_password").value = "";

    document.querySelector("#email").value = "";

    document.querySelector("#phone").value = "";

    document
        .querySelector("#role")
        .clear();

    document
        .querySelector("#status")
        .setValue("Active");

}   