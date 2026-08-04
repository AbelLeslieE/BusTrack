/* ==========================================================================
   BUSTRACK
   DRIVER FORM
========================================================================== */

import { createDropdown } from "/static/common/dropdown.js";

/* ==========================================================================
   CREATE FORM
========================================================================== */
export function createDriverForm(driver = {}) {

    const wrapper = document.createElement("div");

    wrapper.className = "driver-form";

    wrapper.innerHTML = `

        ${renderDriverInformation(driver)}

        ${renderAssignment(driver)}

        ${renderStatus(driver)}

    `;

    initializeDropdowns(wrapper, driver);

    return wrapper;

}

/* ==========================================================================
   DRIVER INFORMATION
========================================================================== */

function renderDriverInformation(driver){

    return `

        <section class="modal-section">

            <h3 class="modal-section-title">

                Driver Information

            </h3>

            <div class="modal-grid">

                ${createInput({
                    id:"driver_code",
                    label:"Driver Code",
                    value:driver.driver_code || "",
                    placeholder:"DRV001",
                    required:true
                })}

                ${createInput({
                    id:"full_name",
                    label:"Full Name",
                    value:driver.full_name || "",
                    placeholder:"John Mathew",
                    required:true
                })}

                ${createInput({
                    id:"phone",
                    label:"Phone Number",
                    value:driver.phone || "",
                    placeholder:"+91 9876543210",
                    required:true
                })}

                ${createInput({
                    id:"email",
                    label:"Email",
                    type:"email",
                    value:driver.email || "",
                    placeholder:"john@email.com"
                })}

                ${createInput({
                    id:"license_number",
                    label:"License Number",
                    value:driver.license_number || "",
                    placeholder:"KL072024123456",
                    required:true
                })}

                ${createInput({
                    id:"license_expiry",
                    label:"License Expiry",
                    type:"date",
                    value:driver.license_expiry || "",
                    required:true
                })}

                ${createTextarea({
                    id:"address",
                    label:"Address",
                    value:driver.address || "",
                    placeholder:"Driver Address"
                })}

            </div>

        </section>

    `;

}


/* ==========================================================================
   ASSIGNMENT
========================================================================== */

function renderAssignment(driver){

    return `

        <section class="modal-section">

            <h3 class="modal-section-title">

                Assignment

            </h3>

            <div class="modal-grid">

                <div class="modal-group">

                    <label class="modal-label">

                        Assigned Bus

                    </label>

                    <div id="bus_container"></div>

                </div>

            </div>

        </section>

    `;

}


/* ==========================================================================
   STATUS
========================================================================== */

function renderStatus(driver){

    return `

        <section class="modal-section">

            <h3 class="modal-section-title">

                Status

            </h3>

            <div class="modal-grid">

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

}){

    return `

        <div class="modal-group">

            <label class="modal-label" for="${id}">

                ${label}

                ${required ? '<span class="modal-required">*</span>' : ""}

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

function createTextarea({

    id,
    label,
    value = "",
    placeholder = ""

}){

    return `

        <div class="modal-group modal-group-full">

            <label class="modal-label" for="${id}">

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


function initializeDropdowns(wrapper, driver){

    /* ==========================================================
       Assigned Bus
    ========================================================== */

    wrapper.querySelector("#bus_container")
        .appendChild(
            createDropdown({
                id: "bus_id",
                value: driver.bus_id || "",
                placeholder: "Select Bus",
                items: []
            })
        );

    /* ==========================================================
       Status
    ========================================================== */

    wrapper.querySelector("#status_container")
        .appendChild(
            createDropdown({
                id: "status",
                value: driver.status || "Available",
                items: [
                    "Available",
                    "On Duty",
                    "Off Duty",
                    "On Trip"
                ]
            })
        );

}

/* ==========================================================================
   READ FORM
========================================================================== */

/* ==========================================================================
   READ DRIVER FORM
========================================================================== */

export function getDriverFormData() {

    return {

        driver_code:
            document.querySelector("#driver_code").value.trim(),

        full_name:
            document.querySelector("#full_name").value.trim(),

        phone:
            document.querySelector("#phone").value.trim(),

        email:
            document.querySelector("#email").value.trim() || null,

        license_number:
            document.querySelector("#license_number").value.trim(),

        license_expiry:
            document.querySelector("#license_expiry").value,

        address:
            document.querySelector("#address").value.trim() || null,

        bus_id:
            document.querySelector("#bus_id").getValue() || null,

        status:
            document.querySelector("#status").getValue()

    };

}