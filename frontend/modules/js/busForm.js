/* ==========================================================================
   BUSTRACK
   BUS FORM
========================================================================== */
import { createDropdown } from "/static/common/dropdown.js";

import { getDrivers } from "./driversApi.js";

import { getRoutes } from "./routesApi.js";
/* ==========================================================================
   CREATE FORM
========================================================================== */

export async function createBusForm(bus = {}) {

    const wrapper = document.createElement("div");

    wrapper.className = "bus-form";

    wrapper.innerHTML = `

        ${renderBusInformation(bus)}

        ${renderAssignment(bus)}

        ${renderTracking(bus)}

        ${renderStatus(bus)}

    `;
    await initializeDropdowns(wrapper, bus);

    return wrapper;

}

/* ==========================================================================
   BUS INFORMATION
========================================================================== */

/* ==========================================================================
   BUS INFORMATION
========================================================================== */

function renderBusInformation(bus){

    return `

        <section class="modal-section">

            <h3 class="modal-section-title">
                Bus Information
            </h3>

            <div class="modal-grid">

                ${createInput({
                    id:"bus_number",
                    label:"Bus Number",
                    value:bus.bus_number || "",
                    placeholder:"BUS-001",
                    required:true
                })}

                ${createInput({
                    id:"registration_number",
                    label:"Registration Number",
                    value:bus.registration_number || "",
                    placeholder:"KL-01-AB-1234",
                    required:true
                })}

                ${createInput({
                    id:"manufacturer",
                    label:"Manufacturer",
                    value:bus.manufacturer || "",
                    placeholder:"Ashok Leyland",
                    required:true
                })}

                ${createInput({
                    id:"model",
                    label:"Model",
                    value:bus.model || "",
                    placeholder:"Lynx Smart",
                    required:true
                })}

                ${createInput({
                    id:"year",
                    label:"Year",
                    type:"number",
                    value:bus.year || "",
                    placeholder:"2024",
                    required:true
                })}

                <div class="modal-group">

                    <label class="modal-label">

                        Fuel Type

                        <span class="modal-required">*</span>

                    </label>

                    <div id="fuel_type_container"></div>

                </div>
                

                ${createInput({
                    id:"capacity",
                    label:"Capacity",
                    type:"number",
                    value:bus.capacity || "",
                    placeholder:"50",
                    required:true
                })}

            </div>

        </section>

    `;

}

/* ==========================================================================
   ASSIGNMENT
========================================================================== */

function renderAssignment(bus){

    return `

        <section class="modal-section">

            <h3 class="modal-section-title">

                Assignment

            </h3>

            <div class="modal-grid">

                <div class="modal-group">

                    <label class="modal-label">

                        Driver

                    </label>

                    <div id="driver_container"></div>

                </div>

                <div class="modal-group">

                    <label class="modal-label">

                        Route

                    </label>

                    <div id="route_container"></div>

                </div>

            </div>

        </section>

    `;

}

/* ==========================================================================
   TRACKING
========================================================================== */

function renderTracking(bus){

    return `

        <section class="modal-section">

            <h3 class="modal-section-title">
                Tracking
            </h3>

            <div class="modal-grid">

                ${createInput({
                    id:"device_id",
                    label:"GPS Device ID",
                    value:bus.device_id || "",
                    placeholder:"GPS-1001"
                })}

            </div>

        </section>

    `;

}

/* ==========================================================================
   STATUS
========================================================================== */

function renderStatus(bus){

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
   INITIALIZE CUSTOM DROPDOWNS
========================================================================== */

async function initializeDropdowns(wrapper, bus){
    const drivers = await getDrivers();

    const routes = await getRoutes();

    wrapper.querySelector("#fuel_type_container")
        .appendChild(
            createDropdown({
                id:"fuel_type",
                value:bus.fuel_type || "",
                placeholder:"Select Fuel Type",
                items:[
                    "Diesel",
                    "Petrol",
                    "Electric",
                    "CNG"
                ]
            })
        );

    wrapper.querySelector("#status_container")
        .appendChild(
            createDropdown({
                id:"status",
                value:bus.status || "Active",
                items:[
                    "Active",
                    "Maintenance",
                    "Inactive"
                ]
            })
        );
    wrapper.querySelector("#driver_container")
    .appendChild(
        createDropdown({

            id: "driver_id",

            value: bus.driver_id || "",

            placeholder: "Select Driver",

            items: drivers.map(driver => ({

                value: driver.id,

                label: driver.full_name

            }))

        })
);

wrapper.querySelector("#route_container")
.appendChild(
    createDropdown({

        id: "route",

        value: bus.route || "",

        placeholder: "Select Route",

        items: routes.map(route => ({

            value: route.route_name,

            label: `${route.route_code} • ${route.route_name}`

        }))

    })
);
}