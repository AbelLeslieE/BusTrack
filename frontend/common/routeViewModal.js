/* ==========================================================================
   BUS TRACK
   ROUTE VIEW MODAL
========================================================================== */
console.log(
    "BusTrack: NEW routeViewModal.js LOADED"
);
import { Modal } from "./modal.js";


/* ==========================================================================
   ROUTE VIEW MAP STATE
========================================================================== */

let routeViewMap = null;

let routeViewLayer = null;

let routeViewMarkers = [];

let routeViewStops = [];


/* ==========================================================================
   OPEN VIEW MODAL
========================================================================== */

export function openRouteViewModal(route){

    /*
     * The route object is expected to already contain the
     * complete Master Stop information.
     *
     * Each stop should contain:
     *
     * id
     * sequence
     * stop_name
     * latitude
     * longitude
     * radius
     */

    routeViewStops =
        Array.isArray(route?.stops)
            ? route.stops
            : [];


    /* ==========================================================
       VALIDATE ROUTE
    ========================================================== */

    if(!route){

        console.error(
            "BusTrack: Cannot open Route View without route data."
        );

        return;

    }


    /* ==========================================================
       STOP LIST
    ========================================================== */

    const stopList =
        routeViewStops.length

            ? routeViewStops
                .map(

                    (stop,index)=>`

                        <button
                            type="button"
                            class="route-view-stop"
                            data-stop-index="${index}"
                        >

                            <div
                                class="route-view-stop-number"
                            >

                                ${index + 1}

                            </div>


                            <div
                                class="route-view-stop-content"
                            >

                                <strong>

                                    ${escapeRouteText(
                                        stop.stop_name
                                    )}

                                </strong>


                                <span>

                                    ${
                                        stop.stop_code
                                            ? escapeRouteText(
                                                stop.stop_code
                                            )
                                            : "Master Stop"
                                    }

                                </span>

                            </div>


                            <div
                                class="route-view-stop-coordinates"
                            >

                                ${
                                    Number.isFinite(
                                        Number(stop.latitude)
                                    ) &&
                                    Number.isFinite(
                                        Number(stop.longitude)
                                    )

                                        ? `${Number(
                                            stop.latitude
                                        ).toFixed(6)},
                                        ${Number(
                                            stop.longitude
                                        ).toFixed(6)}`

                                        : "Coordinates unavailable"

                                }

                            </div>


                            <i
                                class="fa-solid fa-chevron-right"
                                aria-hidden="true"
                            ></i>

                        </button>

                    `

                )
                .join("")

            : `

                <div class="route-view-empty">

                    <i
                        class="fa-solid fa-location-dot"
                    ></i>

                    <strong>

                        No stops available

                    </strong>

                    <span>

                        This route does not have any configured stops.

                    </span>

                </div>

            `;


    /* ==========================================================
       OPEN MODAL
    ========================================================== */

    Modal.open({

        size:
            "lg",

        eyebrow:
            "Transport Management",

        title:
            "Route Details",

        subtitle:
            "View the saved route, road network and stop sequence.",


        /* ======================================================
           CONTENT
        ======================================================= */

        content: `

            <div class="route-view">


                <!-- ==================================================
                     ROUTE INFORMATION
                =================================================== -->

                <section class="route-view-section">

                    <div class="route-view-section-header">

                        <div>

                            <span
                                class="route-view-eyebrow"
                            >

                                ROUTE

                            </span>


                            <h3>

                                ${escapeRouteText(
                                    route.route_name
                                )}

                            </h3>

                        </div>


                        <span
                            class="route-view-status"
                        >

                            ${escapeRouteText(
                                route.status ||
                                "Active"
                            )}

                        </span>

                    </div>


                    <div class="route-view-grid">


                        <div
                            class="route-view-item"
                        >

                            <label>

                                Route Code

                            </label>

                            <span>

                                ${escapeRouteText(
                                    route.route_code ||
                                    "—"
                                )}

                            </span>

                        </div>


                        <div
                            class="route-view-item"
                        >

                            <label>

                                Route Name

                            </label>

                            <span>

                                ${escapeRouteText(
                                    route.route_name ||
                                    "—"
                                )}

                            </span>

                        </div>


                        <div
                            class="route-view-item"
                        >

                            <label>

                                Assigned Bus

                            </label>

                            <span>

                                ${
                                    escapeRouteText(
                                        route.bus?.bus_number ??
                                        route.bus_number ??
                                        "Not Assigned"
                                    )
                                }

                            </span>

                        </div>


                        <div
                            class="route-view-item"
                        >

                            <label>

                                Driver

                            </label>

                            <span>

                                ${
                                    escapeRouteText(
                                        route.driver?.user?.full_name ??
                                        route.driver_name ??
                                        "Not Assigned"
                                    )
                                }

                            </span>

                        </div>


                        <div
                            class="route-view-item"
                        >

                            <label>

                                Total Stops

                            </label>

                            <span>

                                ${routeViewStops.length}

                            </span>

                        </div>


                        <div
                            class="route-view-item"
                        >

                            <label>

                                Route Status

                            </label>

                            <span>

                                ${escapeRouteText(
                                    route.status ||
                                    "Active"
                                )}

                            </span>

                        </div>

                    </div>

                </section>


                <!-- ==================================================
                     ROUTE MAP
                =================================================== -->

                <section class="route-view-section">

                    <div
                        class="route-view-section-header"
                    >

                        <div>

                            <span
                                class="route-view-eyebrow"
                            >

                                ROUTE PREVIEW

                            </span>


                            <h3>

                                Road Route

                            </h3>

                        </div>


                        <div
                            id="route-view-map-status"
                            class="route-view-map-status"
                        >

                            <i
                                class="fa-solid fa-route"
                                aria-hidden="true"
                            ></i>

                            Waiting for route

                        </div>

                    </div>


                    <div
                        id="route-view-map"
                        class="route-view-map"
                    ></div>

                </section>


                <!-- ==================================================
                     STOP SEQUENCE
                =================================================== -->

                <section class="route-view-section">

                    <div
                        class="route-view-section-header"
                    >

                        <div>

                            <span
                                class="route-view-eyebrow"
                            >

                                ROUTE ORDER

                            </span>


                            <h3>

                                Stop Sequence

                            </h3>

                        </div>


                        <span
                            class="route-view-stop-count"
                        >

                            ${routeViewStops.length}

                            ${
                                routeViewStops.length === 1
                                    ? "Stop"
                                    : "Stops"
                            }

                        </span>

                    </div>


                    <div
                        id="route-view-stop-list"
                        class="route-view-stop-list"
                    >

                        ${stopList}

                    </div>

                </section>


            </div>

        `,


        /* ======================================================
           FOOTER
        ======================================================= */

        actions: [

            {

                text:
                    "Close",

                style:
                    "secondary",

                close:
                    true

            }

        ],


        /* ======================================================
           AFTER MODAL OPENS
        ======================================================= */

        onOpen: ()=>{

            /*
             * The Modal system inserts the content into the
             * DOM before calling onOpen.
             *
             * Therefore the map container now exists.
             */

            initializeRouteView();

            bindRouteViewStopEvents();

        },


        /* ======================================================
           MODAL CLOSE
        ======================================================= */

        onClose: ()=>{

            destroyRouteViewMap();

        }

    });

}


/* ==========================================================================
   INITIALIZE ROUTE VIEW
========================================================================== */

function initializeRouteView(){

    const mapContainer =
        document.getElementById(
            "route-view-map"
        );


    /* ==========================================================
       MAP CONTAINER CHECK
    ========================================================== */

    if(!mapContainer){

        console.error(

            "BusTrack: Route View map container was not found."

        );

        return;

    }


    /* ==========================================================
       LEAFLET CHECK
    ========================================================== */

    if(!window.L){

        console.error(

            "BusTrack: Leaflet is not loaded."

        );


        updateRouteViewMapStatus(

            "Map engine is unavailable."

        );


        return;

    }


    /* ==========================================================
       CREATE MAP
    ========================================================== */

    routeViewMap =
        window.L.map(

            mapContainer,

            {

                zoomControl:
                    true,

                attributionControl:
                    true

            }

        );


    /* ==========================================================
       DEFAULT VIEW
    ========================================================== */

    routeViewMap.setView(

        [10.45,76.25],

        9

    );


    /* ==========================================================
       OPENSTREETMAP
    ========================================================== */

    window.L.tileLayer(

        "https://tile.openstreetmap.org/{z}/{x}/{y}.png",

        {

            maxZoom:
                19,

            minZoom:
                2,

            attribution:
                "&copy; OpenStreetMap contributors"

        }

    ).addTo(
        routeViewMap
    );


    /* ==========================================================
       FORCE MAP SIZE
    ========================================================== */

    requestAnimationFrame(()=>{

        if(routeViewMap){

            routeViewMap.invalidateSize();

        }

    });


    setTimeout(()=>{

        if(routeViewMap){

            routeViewMap.invalidateSize();

        }

    },300);


    /* ==========================================================
       RENDER STOP MARKERS
    ========================================================== */

    renderRouteViewMarkers();


    /* ==========================================================
       GENERATE ROAD ROUTE
    ========================================================== */

    generateRouteViewRoadRoute();

}


/* ==========================================================================
   RENDER STOP MARKERS
========================================================================== */

function renderRouteViewMarkers(){

    if(!routeViewMap){

        return;

    }


    /* ==========================================================
       REMOVE OLD MARKERS
    ========================================================== */

    routeViewMarkers.forEach(

        marker=>{

            routeViewMap.removeLayer(
                marker
            );

        }

    );


    routeViewMarkers = [];


    /* ==========================================================
       CREATE MARKERS
    ========================================================== */

    routeViewStops.forEach(

        (stop,index)=>{

            const latitude =
                Number(
                    stop.latitude
                );


            const longitude =
                Number(
                    stop.longitude
                );


            /* ==================================================
               COORDINATE VALIDATION
            =================================================== */

            if(

                !Number.isFinite(
                    latitude
                ) ||

                !Number.isFinite(
                    longitude
                )

            ){

                console.warn(

                    "BusTrack: Cannot place Route View marker.",

                    stop

                );

                return;

            }


            /* ==================================================
               CREATE MARKER
            =================================================== */

            const marker =
                window.L.marker(

                    [

                        latitude,

                        longitude

                    ]

                ).addTo(
                    routeViewMap
                );


            /* ==================================================
               POPUP
            =================================================== */

            marker.bindPopup(`

                <div
                    class="route-view-popup"
                >

                    <div
                        class="route-view-popup-number"
                    >

                        ${index + 1}

                    </div>


                    <div>

                        <strong>

                            ${escapeRouteText(
                                stop.stop_name
                            )}

                        </strong>


                        <small>

                            ${latitude.toFixed(6)},
                            ${longitude.toFixed(6)}

                        </small>

                    </div>

                </div>

            `);


            /* ==================================================
               MARKER CLICK
            =================================================== */

            marker.on(

                "click",

                ()=>{

                    highlightRouteViewStop(
                        index
                    );

                }

            );


            routeViewMarkers.push(
                marker
            );

        }

    );


    /* ==========================================================
       FIT SINGLE STOP
    ========================================================== */

    if(routeViewStops.length === 1){

        const stop =
            routeViewStops[0];


        const latitude =
            Number(
                stop.latitude
            );


        const longitude =
            Number(
                stop.longitude
            );


        if(

            Number.isFinite(latitude) &&
            Number.isFinite(longitude)

        ){

            routeViewMap.setView(

                [

                    latitude,

                    longitude

                ],

                16

            );

        }

    }

}


/* ==========================================================================
   GENERATE ROAD ROUTE
========================================================================== */

async function generateRouteViewRoadRoute(){

    if(
        !routeViewMap ||
        routeViewStops.length < 2
    ){

        if(routeViewStops.length === 1){

            updateRouteViewMapStatus(
                "1 stop on route"
            );

        }

        else{

            updateRouteViewMapStatus(
                "No stops configured"
            );

        }


        return;

    }


    /* ==========================================================
       VALIDATE COORDINATES
    ========================================================== */

    const coordinates = [];


    for(

        let index = 0;

        index < routeViewStops.length;

        index++

    ){

        const stop =
            routeViewStops[index];


        const latitude =
            Number(
                stop.latitude
            );


        const longitude =
            Number(
                stop.longitude
            );


        if(

            !Number.isFinite(
                latitude
            ) ||

            !Number.isFinite(
                longitude
            ) ||

            latitude < -90 ||

            latitude > 90 ||

            longitude < -180 ||

            longitude > 180

        ){

            updateRouteViewMapStatus(

                `${stop.stop_name} has invalid coordinates.`

            );


            return;

        }


        coordinates.push(

            `${longitude},${latitude}`

        );

    }


    /* ==========================================================
       BUILD OSRM REQUEST
    ========================================================== */

    const coordinateString =
        coordinates.join(";");


    const url =

        "https://router.project-osrm.org/route/v1/driving/" +

        coordinateString +

        "?overview=full&geometries=geojson&steps=false";


    try{

        updateRouteViewMapStatus(

            "Calculating road route..."

        );


        const response =
            await fetch(url);


        if(!response.ok){

            throw new Error(

                `Routing service returned HTTP ${response.status}.`

            );

        }


        const data =
            await response.json();


        if(

            data.code !== "Ok" ||

            !Array.isArray(
                data.routes
            ) ||

            data.routes.length === 0

        ){

            throw new Error(

                "No road route could be calculated."

            );

        }


        /* ======================================================
           DRAW ROAD
        ======================================================= */

        drawRouteViewRoad(

            data.routes[0].geometry

        );


        updateRouteViewMapStatus(

            "Road route ready"

        );

    }

    catch(error){

        console.error(

            "BusTrack: Route View routing failed.",

            error

        );


        updateRouteViewMapStatus(

            error.message ||

            "Unable to calculate road route."

        );

    }

}


/* ==========================================================================
   DRAW ROAD ROUTE
========================================================================== */

function drawRouteViewRoad(
    geometry
){

    if(

        !routeViewMap ||
        !geometry

    ){

        return;

    }


    /* ==========================================================
       REMOVE OLD ROUTE
    ========================================================== */

    if(routeViewLayer){

        routeViewMap.removeLayer(
            routeViewLayer
        );

        routeViewLayer =
            null;

    }


    /* ==========================================================
       DRAW GEOJSON
    ========================================================== */

    routeViewLayer =
        window.L.geoJSON(

            geometry,

            {

                style:{

                    color:
                        "#4FD1FF",

                    weight:
                        6,

                    opacity:
                        .9,

                    lineCap:
                        "round",

                    lineJoin:
                        "round"

                }

            }

        ).addTo(
            routeViewMap
        );


    /* ==========================================================
       FIT MAP TO ROUTE
    ========================================================== */

    const bounds =
        routeViewLayer.getBounds();


    if(bounds.isValid()){

        routeViewMap.fitBounds(

            bounds,

            {

                padding:
                    [50,50],

                maxZoom:
                    17

            }

        );

    }


    /* ==========================================================
       BRING MARKERS ABOVE ROUTE
    ========================================================== */

    routeViewMarkers.forEach(

        marker=>{

            marker.setZIndexOffset(
                1000
            );

        }

    );

}


/* ==========================================================================
   STOP LIST EVENTS
========================================================================== */

function bindRouteViewStopEvents(){

    const list =
        document.getElementById(
            "route-view-stop-list"
        );


    if(!list){

        return;

    }


    list
        .querySelectorAll(
            "[data-stop-index]"
        )
        .forEach(

            button=>{

                button.addEventListener(

                    "click",

                    ()=>{

                        const index =
                            Number(
                                button.dataset.stopIndex
                            );


                        focusRouteViewStop(
                            index
                        );

                    }

                );

            }

        );

}


/* ==========================================================================
   FOCUS STOP
========================================================================== */

function focusRouteViewStop(index){

    const stop =
        routeViewStops[index];


    const marker =
        routeViewMarkers[index];


    if(!stop){

        return;

    }


    const latitude =
        Number(
            stop.latitude
        );


    const longitude =
        Number(
            stop.longitude
        );


    if(

        !Number.isFinite(latitude) ||
        !Number.isFinite(longitude)

    ){

        return;

    }


    /* ==========================================================
       MOVE MAP TO STOP
    ========================================================== */

    if(routeViewMap){

        routeViewMap.flyTo(

            [

                latitude,

                longitude

            ],

            16,

            {

                duration:
                    .8

            }

        );

    }


    /* ==========================================================
       OPEN MARKER POPUP
    ========================================================== */

    if(marker){

        marker.openPopup();

    }


    /* ==========================================================
       HIGHLIGHT LIST ITEM
    ========================================================== */

    highlightRouteViewStop(
        index
    );

}


/* ==========================================================================
   HIGHLIGHT STOP
========================================================================== */

function highlightRouteViewStop(index){

    const list =
        document.getElementById(
            "route-view-stop-list"
        );


    if(!list){

        return;

    }


    list
        .querySelectorAll(
            ".route-view-stop"
        )
        .forEach(

            item=>{

                item.classList.remove(
                    "is-selected"
                );

            }

        );


    const selected =
        list.querySelector(

            `[data-stop-index="${index}"]`

        );


    if(selected){

        selected.classList.add(
            "is-selected"
        );


        selected.scrollIntoView({

            behavior:
                "smooth",

            block:
                "nearest"

        });

    }

}


/* ==========================================================================
   MAP STATUS
========================================================================== */

function updateRouteViewMapStatus(
    message
){

    const status =
        document.getElementById(
            "route-view-map-status"
        );


    if(!status){

        return;

    }


    status.innerHTML = `

        <i
            class="fa-solid fa-route"
            aria-hidden="true"
        ></i>

        ${escapeRouteText(
            message
        )}

    `;

}


/* ==========================================================================
   DESTROY ROUTE VIEW MAP
========================================================================== */

function destroyRouteViewMap(){

    if(routeViewMap){

        try{

            routeViewMap.remove();

        }

        catch(error){

            console.warn(

                "BusTrack: Failed to destroy Route View map.",

                error

            );

        }

    }


    routeViewMap =
        null;


    routeViewLayer =
        null;


    routeViewMarkers =
        [];


    routeViewStops =
        [];

}


/* ==========================================================================
   ESCAPE TEXT
========================================================================== */

function escapeRouteText(value){

    return String(
        value ?? ""
    )

        .replaceAll(
            "&",
            "&amp;"
        )

        .replaceAll(
            "<",
            "&lt;"
        )

        .replaceAll(
            ">",
            "&gt;"
        )

        .replaceAll(
            '"',
            "&quot;"
        )

        .replaceAll(
            "'",
            "&#039;"
        );

}