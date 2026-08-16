/* ==========================================================================
   BUSTRACK
   ROUTE IMPORT MODULE
   ==========================================================================
   Handles:
   • Excel Preview
   • Excel Import
   • Route Preview
   • Success Dialog
   • Automatic Refresh
========================================================================== */
console.log("ROUTE IMPORT JS LOADED");
import { Modal } from "/static/common/modal.js";
import { escapeHtml } from "/static/common/security.js";

/* ==========================================================================
   API
========================================================================== */

const API = {

    PREVIEW : "/api/routes/preview",

    IMPORT : "/api/routes/import"

};

/* ==========================================================================
   MODULE STATE
========================================================================== */

const state = {

    selectedFile : null,

    previewData : null,

    previewLoaded : false,

    onSuccess : null

};

/* ==========================================================================
   PUBLIC
========================================================================== */

export function showRouteImportModal(onSuccess = null){

    state.selectedFile = null;

    state.previewData = null;

    state.previewLoaded = false;

    state.onSuccess = onSuccess;

    Modal.form({

        eyebrow : "TRANSPORT MANAGEMENT",

        title : "Import Routes",

        subtitle :
            "Import transport routes directly from the official Excel sheet.",

        size : "lg",

        submitText : "Import",

        content : renderBody(),

        onOpen(){

            console.log("========== ON OPEN ==========");

            bindEvents();

        },

        onSubmit : importExcel

    });

}

/* ==========================================================================
   BODY
========================================================================== */

function renderBody(){

    return `

        <div class="route-import-wrapper">

            <section class="import-upload-card">

                <div class="upload-icon">

                    📄

                </div>

                <div class="upload-content">

                    <h3>

                        Transport Excel

                    </h3>

                    <p>

                        Select the official transport department Excel file.

                    </p>

                    <input

                        id="route-import-file"

                        type="file"

                        accept=".xlsx,.xls"

                        hidden

                    >

                    <button

                        id="choose-file-btn"

                        class="primary-btn"

                        type="button"

                    >

                        Choose Excel File

                    </button>

                    <div

                        id="selected-file"

                        class="selected-file"

                    >

                        No file selected

                    </div>

                </div>

            </section>

            <section

                id="preview-area"

                class="preview-area"

            >

                <div class="preview-placeholder">

                    Select an Excel file to preview.

                </div>

            </section>

        </div>

    `;

}
/* ==========================================================================
   EVENTS
========================================================================== */

function bindEvents(){

    console.log("========== BIND EVENTS ==========");

    const modal = document.querySelector(".modal");

    console.log("Modal :", modal);

    const fileInput = modal.querySelector("#route-import-file");

    console.log("Input :", fileInput);

    const chooseButton = modal.querySelector("#choose-file-btn");

    console.log("Button :", chooseButton);

    if(!chooseButton){

        console.error("Button not found");

        return;

    }

    if(!fileInput){

        console.error("Input not found");

        return;

    }

    chooseButton.onclick = () => {

        console.log("Choose button pressed");

        fileInput.click();

    };

    fileInput.onchange = previewExcel;

    console.log("Events attached");

}
/* ==========================================================================
   PREVIEW EXCEL
========================================================================== */

async function previewExcel(event){

    const file = event.target.files[0];

    if(!file){

        return;

    }

    state.selectedFile = file;

    state.previewLoaded = false;

    document.querySelector(

        "#selected-file"

    ).textContent = file.name;

    const preview = document.querySelector(

        "#preview-area"

    );

    preview.innerHTML = `

        <div class="preview-loading">

            Reading Excel...

        </div>

    `;

    const formData = new FormData();

    formData.append(

        "file",

        file

    );

    try{

        const response = await fetch(

            API.PREVIEW,

            {

                method:"POST",

                body:formData

            }

        );

        const result = await response.json();

        if(!response.ok){

            throw new Error(

                result.detail ||

                "Preview failed."

            );

        }

        state.previewData = result;

        state.previewLoaded = true;

        renderPreview(result);

    }

    catch(error){

        console.error(error);

        preview.innerHTML = `

            <div class="preview-error">

                ${escapeHtml(error.message)}

            </div>

        `;

    }

}

/* ==========================================================================
   RENDER PREVIEW
========================================================================== */

function renderPreview(result){

    const preview = document.querySelector(

        "#preview-area"

    );

    if(

        !result.routes ||

        !result.routes.length

    ){

        preview.innerHTML = `

            <div class="preview-empty">

                No routes found.

            </div>

        `;

        return;

    }

    preview.innerHTML = `

        <div class="preview-summary">

            <div class="summary-card">

                <span>

                    Routes

                </span>

                <h2>

                    ${result.routes.length}

                </h2>

            </div>

            <div class="summary-card">

                <span>

                    Stops

                </span>

                <h2>

                    ${result.routes.reduce(

                        (total, route) =>

                            total + Number(route.total_stops || 0),

                        0

                    )}

                </h2>

            </div>

        </div>

        <div class="preview-grid">

            ${result.routes.map(

                renderRouteCard

            ).join("")}

        </div>

    `;

}

/* ==========================================================================
   ROUTE CARD
========================================================================== */

function renderRouteCard(route){

    return `

        <article class="preview-card">

            <div class="preview-card-header">

                <div class="preview-route-icon">

                    🚌

                </div>

                <div>

                    <h3>

                        ${escapeHtml(route.route_name)}

                    </h3>

                    <p>

                        Ready to Import

                    </p>

                </div>

            </div>

            <div class="preview-details">

                <div>

                    <span>

                        Bus

                    </span>

                    <strong>

                        ${escapeHtml(route.bus_number || "Not Assigned")}

                    </strong>

                </div>

                <div>

                    <span>

                        Driver

                    </span>

                    <strong>

                        ${escapeHtml(route.driver_name || "Not Assigned")}

                    </strong>

                </div>

                <div>

                    <span>

                        Stops

                    </span>

                    <strong>

                        ${escapeHtml(route.total_stops)}

                    </strong>

                </div>

            </div>

        </article>

    `;

}
/* ==========================================================================
   IMPORT EXCEL
========================================================================== */

async function importExcel(){

    if(!state.previewLoaded){

        Modal.warning({

            title:"Preview Required",

            subtitle:"Please preview the Excel before importing."

        });

        return false;

    }

    try{

        const formData = new FormData();

        formData.append(

            "file",

            state.selectedFile

        );

        const response = await fetch(

            API.IMPORT,

            {

                method:"POST",

                body:formData

            }

        );

        const result = await response.json();

        if(!response.ok){

            throw new Error(

                result.detail ||

                "Unable to import Excel."

            );

        }

        Modal.success({

            title:"Import Successful",

            subtitle:"Routes have been imported successfully.",

            content:`

                <div class="import-summary">

                    <div class="summary-card">

                        <span>

                            Routes Created

                        </span>

                        <h2>

                            ${result.routes_created}

                        </h2>

                    </div>

                    <div class="summary-card">

                        <span>

                            Stops Created

                        </span>

                        <h2>

                            ${result.stops_created}

                        </h2>

                    </div>

                </div>

            `

        });

        if(typeof state.onSuccess==="function"){

            await state.onSuccess();

        }

        return true;

    }

    catch(error){

        console.error(error);

        Modal.error({

            title:"Import Failed",

            subtitle:error.message

        });

        return false;

    }

}
