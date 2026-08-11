/* ==========================================================================
   BUSTRACK
   GLOBAL MODAL SYSTEM
   PART 1
   Modal Manager
========================================================================== */


/* ==========================================================================
   MODAL STATE
========================================================================== */

const modalState = {

    overlay: null,

    modal: null,

    body: null,

    title: null,

    subtitle: null,

    eyebrow: null,

    footer: null,

    initialized: false,

    previousFocus: null,

    closeOnOverlay: true,

    closeOnEscape: true,

    onOpen: null,

    onClose: null

};
/* ==========================================================================
   LUCIDE ICONS
========================================================================== */

/**
 * Initialize Lucide icons inside a specific modal container.
 *
 * The modal content is dynamically created, so icons must be
 * initialized after the HTML has been inserted into the DOM.
 */
function initializeLucideIcons(container){

    if(!window.lucide){

        console.warn(
            "BusTrack: Lucide library is not available."
        );

        return;

    }

    window.lucide.createIcons({

        root: container

    });

}
/* ==========================================================================
   EVENT BINDINGS
========================================================================== */

/* ==========================================================================
   EVENTS
========================================================================== */

function bindEvents(){

    /* -----------------------------
       Close Button
    ------------------------------ */

    modalState.overlay
        .querySelector(".modal-close")
        .addEventListener("click", close);

    /* -----------------------------
       Overlay Click
    ------------------------------ */

    modalState.overlay.addEventListener("click", (event)=>{

        if(
            event.target === modalState.overlay &&
            modalState.closeOnOverlay
        ){
            close();
        }

    });

    /* -----------------------------
       ESC Key
    ------------------------------ */

    document.addEventListener("keydown",(event)=>{

        if(
            event.key==="Escape" &&
            modalState.overlay.classList.contains("is-open") &&
            modalState.closeOnEscape
        ){
            close();
        }

    });

}
/* ==========================================================================
   MODAL HTML
========================================================================== */

function createModalHTML(){

    return `

        <div class="modal-overlay">

            <div class="modal modal-md">

                <header class="modal-header">

                    <div class="modal-header-left">

                        <p class="modal-eyebrow"></p>

                        <h2 class="modal-title"></h2>

                        <p class="modal-subtitle"></p>

                    </div>

                    <button
                        class="modal-close"
                        type="button"
                        aria-label="Close Modal"
                        title="Close Modal">

                        <i
                            data-lucide="x"
                            aria-hidden="true">
                        </i>

                    </button>

                </header>

                <div class="modal-divider"></div>

                <section class="modal-body">

                </section>

                <div class="modal-divider"></div>

                <footer class="modal-footer">

                    <div class="modal-actions">

                    </div>

                </footer>

            </div>

        </div>

    `;

}
/* ==========================================================================
   INITIALIZE
========================================================================== */

function initialize(){

    if(modalState.initialized){

        return;

    }

    document.body.insertAdjacentHTML(

        "beforeend",

        createModalHTML()

    );

    modalState.overlay =

        document.querySelector(".modal-overlay");

    modalState.modal =

        modalState.overlay.querySelector(".modal");

    modalState.body =

        modalState.overlay.querySelector(".modal-body");

    modalState.title =

        modalState.overlay.querySelector(".modal-title");

    modalState.subtitle =

        modalState.overlay.querySelector(".modal-subtitle");

    modalState.eyebrow =

        modalState.overlay.querySelector(".modal-eyebrow");

    modalState.footer =

        modalState.overlay.querySelector(".modal-actions");

    modalState.initialized = true;


    /* ==========================================================
    INITIALIZE MODAL ICONS
    ========================================================== */

    initializeLucideIcons(
        modalState.overlay
    );


    bindEvents();

}
/* ==========================================================================
   OPEN
========================================================================== */

/* ==========================================================================
   OPEN
========================================================================== */

function open(options = {}){

    initialize();

    /* -----------------------------
    Save Current Focus
    ------------------------------ */

    modalState.previousFocus = document.activeElement;

    const{

        eyebrow="",

        title="",

        subtitle="",

        size="md",

        content="",

        actions=[],

        closeOnOverlay=true,

        closeOnEscape=true,

        onOpen=null,

        onClose=null

    }=options;

    /* -----------------------------
       Reset Size
    ------------------------------ */

    modalState.modal.className = "modal";

    modalState.modal.classList.add(`modal-${size}`);

    /* -----------------------------
       Header
    ------------------------------ */

    modalState.eyebrow.textContent = eyebrow;

    modalState.title.textContent = title;

    modalState.subtitle.textContent = subtitle;

    /* -----------------------------
    Save Modal Options
    ------------------------------ */

    modalState.closeOnOverlay = closeOnOverlay;

    modalState.closeOnEscape = closeOnEscape;

    modalState.onOpen = onOpen;

    modalState.onClose = onClose;

 

    /* -----------------------------
    Body
    ------------------------------ */

    modalState.body.innerHTML = "";

    if(content instanceof HTMLElement){

        modalState.body.appendChild(content);

    }

    else{

        modalState.body.innerHTML = content;

    }
    /* ==========================================================
    INITIALIZE CONTENT ICONS
    ========================================================== */

    initializeLucideIcons(
        modalState.body
    );
    /* -----------------------------
    Footer
    ------------------------------ */

    renderActions(actions);

    /* -----------------------------
       Open
    ------------------------------ */

    modalState.overlay.classList.add("is-open");
    requestAnimationFrame(()=>{

        const firstField=

            modalState.body.querySelector(

                "input,select,textarea,button"

            );

        firstField?.focus();

    });

    if(modalState.onOpen){

        modalState.onOpen();

    }

    document.body.style.overflow = "hidden";

}
/* ==========================================================================
   FOOTER BUTTONS
========================================================================== */

function renderActions(actions = []){

    modalState.footer.innerHTML = "";

    actions.forEach(action => {

        const button = document.createElement("button");

        button.className =

            `modal-btn modal-btn-${action.style || "primary"}`;

        button.innerHTML = action.loading

        ? `<span class="modal-btn-spinner"></span>`

        : action.text || "Button";

        if(action.disabled){

            button.disabled = true;

        }

        button.addEventListener("click", () => {

            if(action.onClick){

                action.onClick();

            }

            if(action.close){

                close();

            }

        });

        modalState.footer.appendChild(button);

    });

}

/* ==========================================================================
   CLOSE
========================================================================== */

function close(){

    modalState.overlay.classList.remove("is-open");

    document.body.style.overflow="";

    modalState.body.innerHTML="";

    modalState.footer.innerHTML="";

    if(modalState.onClose){

        modalState.onClose();

    }

    if(modalState.previousFocus){

        modalState.previousFocus.focus();

    }

}
/* ==========================================================================
   ALERT
========================================================================== */

function alert(options = {}){

    open({

        eyebrow: options.eyebrow || "Notification",

        title: options.title || "Alert",

        subtitle: options.subtitle || "",

        size: options.size || "sm",

        content: options.content || "",

        actions: [

            {

                text: "OK",

                style: "primary",

                close: true

            }

        ]

    });

}


/* ==========================================================================
   SUCCESS
========================================================================== */

function success(options = {}){

    open({

        eyebrow: "Success",

        title: options.title || "Completed",

        subtitle: options.subtitle || "",

        size: "sm",

        content: options.content || "",

        actions: [

            {

                text: "Done",

                style: "primary",

                close: true

            }

        ]

    });

}


/* ==========================================================================
   WARNING
========================================================================== */

function warning(options = {}){

    open({

        eyebrow: "Warning",

        title: options.title || "Warning",

        subtitle: options.subtitle || "",

        size: "sm",

        content: options.content || "",

        actions: [

            {

                text: "Continue",

                style: "primary",

                close: true

            }

        ]

    });

}


/* ==========================================================================
   ERROR
========================================================================== */

function error(options = {}){

    open({

        eyebrow: "Error",

        title: options.title || "Something went wrong",

        subtitle: options.subtitle || "",

        size: "sm",

        content: options.content || "",

        actions: [

            {

                text: "Close",

                style: "danger",

                close: true

            }

        ]

    });

}
/* ==========================================================================
   CONFIRM
========================================================================== */

function confirm(options = {}){

    open({

        eyebrow: options.eyebrow || "Confirmation",

        title: options.title || "Confirm",

        subtitle: options.subtitle || "",

        size: options.size || "sm",

        content: options.content || "",

        closeOnOverlay: false,

        actions:[

            {

                text:"Cancel",

                style:"secondary",

                close:true

            },

            {

                text:options.confirmText || "Confirm",

                style:options.style || "danger",

                onClick:options.onConfirm

            }

        ]

    });

}
/* ==========================================================================
   FORM
========================================================================== */

/* ==========================================================================
   FORM
========================================================================== */

function form(options = {}){

    open({

        eyebrow: options.eyebrow || "",

        title: options.title || "Form",

        subtitle: options.subtitle || "",

        size: options.size || "lg",

        content: options.content || "",

        closeOnOverlay: false,

        closeOnEscape: options.closeOnEscape ?? true,

        onOpen: options.onOpen,

        onClose: options.onClose,

        actions:[

            {

                text:"Cancel",

                style:"secondary",

                close:true

            },

            {

                text:options.submitText || "Save",

                style:"primary",

                onClick:options.onSubmit

            }

        ]

    });

}
/* ==========================================================================
   PUBLIC API
========================================================================== */

export const Modal = {

    open,

    close,

    alert,

    success,

    warning,

    error,

    confirm,

    form

};