/* MapLibre is loaded only when Route Studio is opened. No GPS listeners here. */
let libraryPromise;
export function loadStudioMapLibrary() {
    if (window.maplibregl) return Promise.resolve(window.maplibregl);
    if (libraryPromise) return libraryPromise;
    libraryPromise = new Promise((resolve, reject) => {
        const css = document.createElement('link');
        css.rel = 'stylesheet'; css.href = 'https://unpkg.com/maplibre-gl@5.6.1/dist/maplibre-gl.css';
        const script = document.createElement('script');
        script.src = 'https://unpkg.com/maplibre-gl@5.6.1/dist/maplibre-gl.js';
        const timeout = setTimeout(() => fail(), 20000);
        function fail() { clearTimeout(timeout); script.remove(); css.remove(); libraryPromise=null; reject(new Error('Map could not load. Check your connection and reload this page.')); }
        script.onerror = fail;
        script.onload = () => { clearTimeout(timeout); if (!window.maplibregl) return fail(); resolve(window.maplibregl); };
        document.head.append(css, script);
    });
    return libraryPromise;
}

const feature = geometry => ({type:'Feature', properties:{}, geometry});
const empty = () => ({type:'FeatureCollection', features:[]});
function accuracyRing(point, metres) {
    const lat=point[1]*Math.PI/180, radius=Math.min(metres,10000), coords=[];
    for(let i=0;i<=64;i++) { const angle=i/64*Math.PI*2; coords.push([point[0]+Math.cos(angle)*radius/(111320*Math.max(.01,Math.cos(lat))),point[1]+Math.sin(angle)*radius/111320]); }
    return feature({type:'Polygon',coordinates:[coords]});
}

export async function createStudioMap(container, {onStop, onMoveStop, onError}) {
    const gl=await loadStudioMapLibrary();
    const map=new gl.Map({container,style:'https://tiles.openfreemap.org/styles/liberty',center:[76,10],zoom:9,attributionControl:true});
    map.addControl(new gl.NavigationControl(),'top-right');
    map.addControl(new gl.ScaleControl({unit:'metric'}),'bottom-left');
    let ready=false, destroyed=false, path=[], stops=[], editable=false, position=null, accuracy=0, following=true, marker=null, stopMarkers=[];
    map.on('dragstart',()=>{following=false;});
    map.on('error',()=>{if(!destroyed) onError('Map tiles are unavailable. GPS recording and local storage can continue.');});
    map.on('click',event=>onStop({lat:event.lngLat.lat,lng:event.lngLat.lng}));
    function drawPath() {
        if (!ready) return;
        map.getSource('studio-trace').setData(path.length>1 ? feature({type:'LineString',coordinates:path}) : empty());
        map.getSource('studio-accuracy').setData(position ? accuracyRing(position,accuracy) : empty());
    }
    map.on('load',()=>{
        if(destroyed) return;
        map.addSource('studio-trace',{type:'geojson',data:empty()});
        map.addSource('studio-accuracy',{type:'geojson',data:empty()});
        map.addLayer({id:'studio-accuracy-fill',type:'fill',source:'studio-accuracy',paint:{'fill-color':'#0ea5e9','fill-opacity':.12}});
        map.addLayer({id:'studio-trace-outline',type:'line',source:'studio-trace',layout:{'line-join':'round','line-cap':'round'},paint:{'line-color':'#fff','line-width':8}});
        map.addLayer({id:'studio-trace-line',type:'line',source:'studio-trace',layout:{'line-join':'round','line-cap':'round'},paint:{'line-color':'#0284c7','line-width':4}});
        ready=true;drawPath();
    });
    return {
        setPath(coords, {fit=false}={}) {
            path=coords;drawPath();
            if(fit && coords.length) {
                const bounds=coords.reduce((b,p)=>b.extend(p),new gl.LngLatBounds(coords[0],coords[0]));
                map.fitBounds(bounds,{padding:55,maxZoom:16,duration:500});
            }
        },
        setStops(next, canEdit) {
            if(JSON.stringify(stops)===JSON.stringify(next) && editable===canEdit) return;
            stops=structuredClone(next);editable=canEdit;
            stopMarkers.forEach(m=>m.remove());stopMarkers=[];
            next.forEach((stop,index)=>{
                const el=document.createElement('div');el.className='studio-stop-pin';el.textContent=String(index+1);el.title=stop.name;
                const m=new gl.Marker({element:el,draggable:canEdit}).setLngLat([stop.longitude,stop.latitude]).setPopup(new gl.Popup().setText(stop.name)).addTo(map);
                m.on('dragend',()=>{const p=m.getLngLat();onMoveStop(index,{lat:p.lat,lng:p.lng});});stopMarkers.push(m);
            });
        },
        setPosition(point, metres) {
            position=point;accuracy=metres;drawPath();
            if(!marker) { const el=document.createElement('div');el.className='studio-live-pin';el.setAttribute('aria-label','Latest phone GPS position');marker=new gl.Marker({element:el}).setLngLat(point).addTo(map); }
            marker.setLngLat(point);
            if(following) map.easeTo({center:point,zoom:Math.max(map.getZoom(),15),duration:800});
        },
        follow(){following=true;if(position)map.easeTo({center:position,zoom:16,duration:500});},
        remove(){destroyed=true;marker?.remove();stopMarkers.forEach(m=>m.remove());map.remove();}
    };
}
