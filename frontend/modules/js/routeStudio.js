import { escapeHtml as esc } from '/static/common/security.js';
import { createStudioMap } from '/static/common/studioMap.js?v=20261106trail1';

async function api(path, data, method = 'POST') {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
        const response = await fetch('/api/route-studio' + path, {method:data === undefined ? 'GET' : method,
            credentials:'same-origin', headers:{'Content-Type':'application/json'},
            body:data === undefined ? undefined : JSON.stringify(data), signal:controller.signal});
        const result = await response.json();
        if (!response.ok) { const error = new Error(typeof result.detail === 'string' ? result.detail : 'Request failed validation.'); error.status=response.status; throw error; }
        return result;
    } finally { clearTimeout(timeout); }
}
const profile = JSON.parse(localStorage.getItem('bus_tracker_profile') || '{}');
const tracer = String(profile.role || '').toLowerCase() === 'tracer';
const admin = String(profile.role || '').toLowerCase() === 'admin';

function openStore() {
    return new Promise((resolve, reject) => {
        const r = indexedDB.open('bustrack-tracer', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('sessions');
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
    });
}
async function storage(value, write = false) {
    const db = await openStore();
    try {
        return await new Promise((resolve, reject) => {
            const t = db.transaction('sessions', write ? 'readwrite' : 'readonly');
            const r = write ? t.objectStore('sessions').put(value, profile.id) : t.objectStore('sessions').get(profile.id);
            t.oncomplete = () => resolve(r.result);
            t.onerror = () => reject(t.error);
            t.onabort = () => reject(t.error || new Error('Local storage failed'));
        });
    } finally { db.close(); }
}

export function render() {
    const root = document.createElement('section');
    root.className = `portal-page studio-page${admin ? ' studio-admin-page' : ''}`;
    root.innerHTML = admin ? `
      <header class="studio-header"><div><p class="studio-eyebrow">BUSTRACK / RECORDED ROUTES</p><h1>Maintain route</h1><p>Choose a recording, review its path, and place named stops directly on the map.</p></div></header>
      <section class="studio-admin-picker"><label>Recorded path<select class="studio-history" aria-label="Recorded path"><option value="">Choose a recorded path</option></select></label><button data-action="refresh">Refresh list</button></section>
      <p role="status" class="studio-status">Loading recorded paths…</p>
      <section class="studio-map-card studio-admin-map"><div class="studio-map-toolbar"><span>Recorded route <small>Select a path to zoom to its recording</small></span><div class="studio-map-actions"><input class="studio-new-stop-name" aria-label="New stop name" placeholder="Name this stop"><button data-action="add-stop">Add stop on map</button><button data-action="fit">Show whole path</button></div></div><p class="studio-map-status" role="status">Choose a recorded path above.</p><div class="studio-map" aria-label="Recorded bus route map"></div></section>
      <div class="studio-editor"></div>` : `
      <header class="studio-header"><div><p class="studio-eyebrow">BUSTRACK / ${tracer ? 'TRACER PORTAL' : admin ? 'ROUTE APPROVAL' : 'TECHNICIAN PORTAL'}</p><h1>${tracer ? 'Every turn, captured.' : admin ? 'Maintain route' : 'Routes · Traced paths'}</h1><p>${tracer ? 'Watch your journey take shape as you travel.' : admin ? 'Review technician-prepared paths and choose the route maintained for this bus.' : 'Review recorded paths, refine stops, and prepare routes for approval.'}</p></div><span class="studio-record-badge">● Recording off</span></header>
      ${tracer ? `<section class="studio-permission"><div><h2>Your location, your control</h2><p>Allow precise location to trace your assigned bus. Samples are saved on this phone and synchronized to BusTrack. Keep this page visible and your phone unlocked.</p></div><button data-action="permission">Enable location</button><span class="studio-permission-state">Permission not requested</span></section>` : ''}
      <div class="studio-metrics"><div><span>Assigned bus</span><strong class="studio-bus-label">—</strong></div><div><span>GPS accuracy</span><strong class="studio-accuracy">Waiting</strong></div><div><span>Samples captured</span><strong class="studio-samples">0</strong></div><div><span>Pending upload</span><strong class="studio-pending">0</strong></div><div><span>Last GPS fix</span><strong class="studio-last-fix">—</strong></div></div>
      <p role="status" class="studio-status">Loading…</p><div class="studio-controls studio-management"></div>
      <div class="studio-controls"><input class="studio-name" aria-label="Path name" placeholder="Path name"><select class="studio-history" aria-label="Saved recordings"><option value="">Choose a recording</option></select><button data-action="refresh">Refresh</button></div>
      <div class="studio-controls studio-record"></div><section class="studio-map-card"><div class="studio-map-toolbar"><span>Live journey <small>MapLibre · OpenFreeMap</small></span><button data-action="follow">Follow my location</button><button data-action="fit">Show whole path</button></div><p class="studio-map-status" role="status">Loading vector map…</p><div class="studio-map" aria-label="Live bus recording map"></div></section>
      <div class="studio-editor"></div>`;
    const status = message => { if (!closed) { root.querySelector('.studio-status').textContent = message; metrics(); } };
    let closed = false, map, selected = null, local = null, watch = null, timer = null, syncing = false, busy = false;
    let chain = Promise.resolve(), lastSample = 0, retries = 0, nextRetry = 0, overview, undo = [], redo = [], releaseLock = null, masterStops = [];
    let placingStop = false, rawGeometry = [];
    let routeFixes = [], pendingRouteFix = null;
    const name = () => root.querySelector('.studio-name')?.value.trim() || selected?.name || 'Bus trace';
    let lastFix = null, lastAcceptedPoint = null, locationPermission = 'prompt';
    const distanceMetres = (a,b) => {
        const rad=value=>value*Math.PI/180, dLat=rad(b.latitude-a.latitude), dLon=rad(b.longitude-a.longitude);
        const x=Math.sin(dLat/2)**2+Math.cos(rad(a.latitude))*Math.cos(rad(b.latitude))*Math.sin(dLon/2)**2;
        const bounded=Math.max(0,Math.min(1,x));
        return 6371000*2*Math.atan2(Math.sqrt(bounded),Math.sqrt(1-bounded));
    };
    function addMovementFix(point) {
        // Only credible GPS movement advances the visible tail. OSRM remains the
        // final road-matching stage after the recording has been completed.
        const added=[];
        if(!Number.isFinite(point.accuracy) || point.accuracy < 0 || point.accuracy > 35) return added;
        if(!routeFixes.length) {
            routeFixes.push(point);rawGeometry.push([point.longitude,point.latitude]);added.push(point);return added;
        }
        const anchor=routeFixes.at(-1);
        const distance=distanceMetres(anchor,point);
        const uncertainty=anchor.accuracy+point.accuracy;
        const moving=Number.isFinite(point.speed) && point.speed >= 1.2;
        const movementFloor=moving ? Math.max(2.5,Math.min(8,.3*uncertainty)) : Math.max(10,.8*uncertainty);
        if(distance <= movementFloor) {if(!moving)pendingRouteFix=null;return added;}
        const elapsed=(Date.parse(point.recorded_at)-Date.parse(anchor.recorded_at))/1000;
        if(!Number.isFinite(elapsed) || elapsed <= 0 || distance/elapsed > 45 || (Number.isFinite(point.speed) && point.speed > 55)) {
            pendingRouteFix=null;return added;
        }
        if(moving) {
            routeFixes.push(point);rawGeometry.push([point.longitude,point.latitude]);added.push(point);pendingRouteFix=null;return added;
        }
        if(pendingRouteFix) {
            const required=Math.max(12,.8*(pendingRouteFix.accuracy+point.accuracy));
            if(distance-distanceMetres(anchor,pendingRouteFix) >= required && distanceMetres(pendingRouteFix,point) >= required) {
                routeFixes.push(pendingRouteFix,point);
                rawGeometry.push([pendingRouteFix.longitude,pendingRouteFix.latitude],[point.longitude,point.latitude]);
                added.push(pendingRouteFix,point);pendingRouteFix=null;return added;
            }
        } else pendingRouteFix=point;
        return added;
    }
    function metrics() {
        const badge=root.querySelector('.studio-record-badge');
        if(!badge) return;
        badge.textContent = watch === null ? '● Recording off' : '● Recording live';
        badge.dataset.live = watch === null ? 'false' : 'true';
        root.querySelector('.studio-samples').textContent = String(local?.sequence || 0);
        root.querySelector('.studio-pending').textContent = String(local?.pending?.length || 0);
        if(lastFix) {
            const accuracy = Math.round(lastFix.coords.accuracy);
            root.querySelector('.studio-accuracy').textContent = accuracy > 100 ? `Weak · ± ${accuracy} m` : `± ${accuracy} m`;
            root.querySelector('.studio-accuracy').dataset.quality = accuracy > 100 ? 'weak' : 'good';
            root.querySelector('.studio-last-fix').textContent = new Date(lastFix.timestamp).toLocaleTimeString();
        }
    }
    async function requestLocation() {
        if(!window.isSecureContext || !navigator.geolocation) throw new Error('Location requires HTTPS and a browser with location support.');
        const label=root.querySelector('.studio-permission-state');
        if(label) label.textContent='Waiting for browser permission and GPS…';
        try {
            const fix=await new Promise((ok,fail)=>navigator.geolocation.getCurrentPosition(ok,fail,{enableHighAccuracy:true,timeout:15000,maximumAge:0}));
            if(closed) throw new Error('Recording page was closed.');
            locationPermission='granted';lastFix=fix;
            if(label) label.textContent='Location allowed · ready to record';
            if(fix.coords.latitude != null) map?.setPosition([fix.coords.longitude,fix.coords.latitude],fix.coords.accuracy);
            metrics();return fix;
        } catch(error) {
            locationPermission=error.code===1 ? 'denied' : 'unavailable';
            const message=error.code===1 ? 'Location denied. Open this site’s browser permissions, allow Location, then try again.' : 'No GPS fix yet. Check location services and try again outdoors.';
            if(label) label.textContent=message;
            throw new Error(message);
        }
    }
    const stopWatch = () => { if (watch !== null) navigator.geolocation.clearWatch(watch); watch = null; releaseLock?.(); releaseLock = null; };
    const queue = fn => { chain = chain.then(fn).catch(error => { stopWatch(); status(error.message); }); return chain; };
    const remember = () => { undo.push(JSON.stringify(selected)); if (undo.length > 50) undo.shift(); redo = []; };
    function draw(fit = false) {
        if (!map) return;
        const coords = selected?.geometry || [];
        map.setPath(coords,{fit});
        map.setStops(selected?.stops || [], !tracer && selected?.status === 'DRAFT');
    }
    function editor() {
        const el = root.querySelector('.studio-editor');
        if (!selected || tracer) { el.innerHTML = ''; return; }
        if (admin) {
            const editable=selected.status === 'DRAFT';
            el.innerHTML = `<div class="studio-admin-editor-heading"><div><p class="studio-eyebrow">ROUTE STOPS</p><h2>${esc(selected.name)}</h2><span>${selected.stops.length} named stop${selected.stops.length === 1 ? '' : 's'}</span></div><div class="studio-controls">${editable ? '<button data-action="undo">Undo</button><button data-action="save">Save stops</button><button data-action="traced">Use this route</button>' : '<button data-action="copy">Edit stops</button>'}<button data-action="manual">Use manual route</button></div></div><p class="studio-admin-help">${editable ? 'Enter a stop name above, choose Add stop on map, then click its position. Drag a numbered marker to move it.' : 'This route is published. Choose Edit stops to create an editable version.'}</p><ol class="studio-stops studio-admin-stops">${selected.stops.length ? selected.stops.map((s,i) => `<li><b>${i+1}</b><input data-stop="${i}" value="${esc(s.name)}" aria-label="Stop ${i+1} name"><button data-remove="${i}">Remove</button></li>`).join('') : '<li class="studio-empty-stops">No stops added yet. Add the first one from the map.</li>'}</ol>`;
            return;
        }
        el.innerHTML = `<h2>${esc(selected.status)} · revision ${selected.revision}</h2><p>The blue line is the filtered GPS trail, road-matched by OSRM when the recording is finished. Review any GPS gaps before selecting it. Click the map to add a stop; drag stop markers to move them.</p>
          <div class="studio-controls"><button data-action="undo">Undo</button><button data-action="redo">Redo</button><button data-action="save">Save draft</button><button data-action="copy">New draft version</button><button data-action="reload">Cancel edits</button>${String(profile.role || '').toLowerCase() === 'admin' ? '<button data-action="traced">Approve and select traced route</button><button data-action="manual">Use original manual route</button>' : ''}</div>
          <div class="studio-controls"><select class="studio-master-stop" aria-label="Existing stop">${masterStops.map((s,i) => `<option value="${i}">${esc(s.name)}</option>`).join('')}</select><button data-action="existing-stop">Add existing stop</button></div><ol class="studio-stops">${selected.stops.map((s,i) => `<li><input data-stop="${i}" value="${esc(s.name)}" aria-label="Stop name"><span>${s.latitude.toFixed(5)}, ${s.longitude.toFixed(5)}</span><button data-up="${i}">↑</button><button data-down="${i}">↓</button><button data-remove="${i}">Remove</button></li>`).join('')}</ol>
          <details><summary>Edit trace coordinates (longitude, latitude)</summary><p>Corrections are unverified GPS geometry. Do not bridge missing sections without evidence.</p><textarea class="studio-geometry" aria-label="Trace coordinates" rows="8" style="width:100%">${esc(JSON.stringify(selected.geometry))}</textarea><button data-action="geometry">Apply coordinate edits</button></details>`;
    }
    async function refresh() {
        overview = await api('');
        if (closed) return;
        const recordings=admin ? overview.recordings.filter(s => ['DRAFT','PUBLISHED'].includes(s.status)) : overview.recordings;
        root.querySelector('.studio-history').innerHTML = '<option value="">Choose a recorded path</option>' + recordings.map(s => `<option value="${s.id}">${esc(s.name)} · ${esc(s.status)}</option>`).join('');
        if (tracer) {
            root.querySelector('.studio-bus-label').textContent=overview.assignment?.bus_number || 'Not assigned';
            root.querySelector('.studio-record').innerHTML = ['Start','Recover','Pause','Resume','Finish','Discard'].map(a => `<button data-action="${a.toLowerCase()}">${a}</button>`).join('');
            status(`Recording ${watch === null ? 'OFF' : 'ON'} · ${overview.assignment ? 'Assigned bus: ' + overview.assignment.bus_number : 'Waiting for technician assignment'} · ${local?.pending?.length || 0} pending samples. Keep this page open and the phone unlocked.`);
        } else if (admin) {
            status(recordings.length ? 'Choose a recorded path to view it on the map.' : 'No completed recorded paths are ready for review.');
        } else {
            root.querySelector('.studio-management').innerHTML = `<select class="studio-tracer" aria-label="Tracer">${overview.tracers.map(u => `<option value="${u.id}">${esc(u.name)}</option>`).join('')}</select><select class="studio-bus" aria-label="Bus">${overview.buses.map(b => `<option value="${b.id}">${esc(b.name)}</option>`).join('')}</select><button data-action="assign">Assign bus to tracer</button>`;
            status('Choose a saved path to edit. Only an administrator can select it for service.');
        }
    }
    async function load(id) {
        if(watch !== null) throw new Error('Pause recording before viewing another path.');
        selected = await api('/recordings/' + id);
        if (closed) return;
        const nameInput=root.querySelector('.studio-name');if(nameInput)nameInput.value = selected.name;
        undo = []; redo = []; draw(true); editor();
    }
    async function flush(force = false) {
        if (!local?.pending?.length || syncing || (!force && Date.now() < nextRetry)) return;
        syncing = true;
        try {
            const batch = local.pending.slice(0, 200);
            const result = await api(`/recordings/${local.id}/points`, {points:batch});
            await queue(async () => { local.pending = local.pending.filter(p => !result.acknowledged.includes(p.sequence)); await storage(local, true); });
            retries = 0; nextRetry = 0;
            status(`${watch === null ? 'Recording OFF' : 'Recording ON'} · ${local.sequence} captured · ${local.pending.length} pending`);
        } catch (e) {
            if ([401,403,404].includes(e.status)) { stopWatch(); clearInterval(timer); timer=null; }
            nextRetry = Date.now() + Math.min(60000, 1000 * 2 ** Math.min(++retries, 6));
            status(`Samples saved on this phone; sync retry pending: ${e.message}`);
            if (force) throw e;
        } finally { syncing = false; }
    }
    async function restorePath() {
        const saved=await api(`/recordings/${local.id}`);
        const points=new Map((saved.points || []).map(p=>[p.sequence,p]));
        local.pending.forEach(p=>points.set(p.sequence,p));
        const ordered=[...points.values()].sort((a,b)=>a.sequence-b.sequence);
        routeFixes=[];pendingRouteFix=null;rawGeometry=[];
        ordered.forEach(addMovementFix);
        selected.geometry=[...rawGeometry];
        lastAcceptedPoint=ordered.at(-1) || null;
        draw(true);
        if(rawGeometry.length) map?.setPosition(rawGeometry.at(-1),routeFixes.at(-1).accuracy);
    }
    async function capture() {
        if (!window.isSecureContext || !navigator.geolocation) throw new Error('Phone recording requires HTTPS and location access.');
        if (watch !== null) return;
        if (!navigator.locks) throw new Error('Use a browser with Web Locks support for safe recording (current Chrome or Edge).');
        await new Promise((resolve, reject) => {
            navigator.locks.request(`bustrack-tracer-${profile.id}`, {ifAvailable:true}, async lock => {
                if (!lock) { reject(new Error('Another tab is recording. Close or pause it before recovering here.')); return; }
                await new Promise(release => { releaseLock = release; resolve(); });
            }).catch(reject);
        });
        if (closed || document.hidden) { stopWatch(); throw new Error('Keep the recording page visible.'); }
        lastSample = 0;
        watch = navigator.geolocation.watchPosition(position => {
            if (closed || watch === null || Date.now() - lastSample < 750) return;
            lastSample = Date.now();
            queue(async () => {
                if (local.sequence >= 20000) throw new Error('Recording reached 20,000 samples. Finish this path before starting another.');
                const c = position.coords;
                lastFix=position;
                if (![c.latitude,c.longitude,c.accuracy].every(Number.isFinite) || c.accuracy > 75) {
                    status(`Waiting for a better GPS fix · current accuracy ±${Math.round(c.accuracy || 0)}m · point not recorded`);
                    return;
                }
                const point = {sequence: local.sequence + 1, latitude:c.latitude, longitude:c.longitude, accuracy:c.accuracy,
                    speed:c.speed !== null && c.speed >= 0 ? c.speed : null, heading:c.heading, recorded_at:new Date(position.timestamp).toISOString()};
                if(lastAcceptedPoint) {
                    const elapsed=Math.max(1,(new Date(point.recorded_at)-new Date(lastAcceptedPoint.recorded_at))/1000);
                    const distance=distanceMetres(lastAcceptedPoint,point);
                    const impossibleSpeed=distance/elapsed > 45;
                    const impossibleReportedSpeed=Number.isFinite(point.speed) && point.speed > 55;
                    if((distance > Math.max(60,3*(lastAcceptedPoint.accuracy+c.accuracy)) && impossibleSpeed) || impossibleReportedSpeed) {
                        status(`Impossible GPS jump rejected · ${Math.round(distance)}m in ${Math.round(elapsed)}s · route unchanged`);
                        return;
                    }
                }
                local.sequence = point.sequence; local.pending.push(point);
                await storage(local, true);
                lastAcceptedPoint=point;
                if (selected?.id === local.id) {
                    const mapStatus=root.querySelector('.studio-map-status');
                    const added=addMovementFix(point);
                    if(added.length) {
                        selected.geometry=[...rawGeometry];
                        if(rawGeometry.length===added.length) {
                            map?.setPath(rawGeometry);
                            map?.setPosition(rawGeometry[0],added[0].accuracy);
                        } else {
                            for(const accepted of added) {
                                const previous=routeFixes[routeFixes.indexOf(accepted)-1];
                                const elapsed=previous ? Date.parse(accepted.recorded_at)-Date.parse(previous.recorded_at) : 700;
                                map?.tracePosition([accepted.longitude,accepted.latitude],accepted.accuracy,{duration:Math.max(250,Math.min(1100,elapsed))});
                            }
                        }
                        if(rawGeometry.length > 1 && mapStatus) mapStatus.textContent='Live GPS trail · blue line grows behind the moving phone';
                    } else if(mapStatus) {
                        mapStatus.textContent=c.accuracy > 35
                            ? 'GPS fix saved · waiting for better accuracy before extending the route'
                            : 'GPS fix saved · route held until movement is confirmed';
                    }
                }
                status(`Recording ON · accuracy ${Math.round(c.accuracy)}m · ${local.pending.length} pending samples${c.accuracy > 35 ? ' · waiting for precise GPS to extend route' : ''}`);
            });
        }, error => { stopWatch(); if(error.code===1) root.querySelector('.studio-permission-state').textContent='Location permission revoked. Allow Location in browser site settings.'; status(`Recording interrupted: ${error.message}. Saved samples are recoverable.`); }, {enableHighAccuracy:true, maximumAge:0, timeout:15000});
        if (!timer) timer = setInterval(() => { void flush(); }, 12000);
        status('Recording ON · waiting for phone GPS');
    }
    async function act(action) {
        if(action === 'permission') { await requestLocation(); status('Location enabled. Press Start to begin recording your assigned bus.'); return; }
        if(action === 'follow') { map?.follow(); return; }
        if(action === 'fit') { draw(true); return; }
        if(action === 'add-stop') {
            if (!selected) throw new Error('Choose a recorded path first.');
            if (selected.status !== 'DRAFT') throw new Error('Choose Edit stops before changing a published route.');
            const label=root.querySelector('.studio-new-stop-name')?.value.trim();
            if(!label) throw new Error('Enter a stop name first.');
            placingStop=true;root.querySelector('.studio-map-status').textContent=`Click the map where “${label}” should be placed.`;return;
        }
        if (action === 'refresh') return refresh();
        if (action === 'assign') { await api('/assignment', {user_id:Number(root.querySelector('.studio-tracer').value), bus_id:Number(root.querySelector('.studio-bus').value)}, 'PUT'); return refresh(); }
        if (action === 'start') {
            if (local && !local.finished) throw new Error('Recover or finish your existing recording first.');
            if (!window.isSecureContext) throw new Error('Use HTTPS on the phone for location capture.');
            if(!overview?.assignment) throw new Error('A technician must assign your bus before recording.');
            await requestLocation();
            lastAcceptedPoint=null;
            rawGeometry=[];routeFixes=[];pendingRouteFix=null;
            local = {id:crypto.randomUUID(), sequence:0, pending:[], finished:false, name:name() || 'Bus trace'};
            await storage(local, true);
            selected = await api('/recordings', {request_id:local.id, name:local.name});
            await capture(); return;
        }
        if (action === 'recover') {
            await requestLocation();
            local = await storage();
            if (!local || local.finished) throw new Error('No unfinished recording is stored on this phone.');
            selected = await api('/recordings', {request_id:local.id, name:local.name});
            if (!['RECORDING','PAUSED'].includes(selected.status)) {
                local.finished=true; await storage(local,true); draw(); editor();
                status('Recording was already finalized on the server. You can start a new recording.'); return;
            }
            if (selected.status === 'PAUSED') selected = await api(`/recordings/${local.id}/action`, {action:'resume'});
            await restorePath();
            await capture(); return;
        }
        if (['pause','resume','finish','discard'].includes(action)) {
            if(action === 'resume') await requestLocation();
            if (!local || local.finished) throw new Error('Start or recover your recording first.');
            if (action === 'discard' && !confirm('Discard only this recording? Raw samples will remain stored for review.')) return;
            stopWatch(); clearInterval(timer); timer=null; await chain;
            if (syncing) throw new Error('Sync is running; please retry this action in a moment.');
            if (action === 'finish') while (local.pending.length) await flush(true);
            selected = await api(`/recordings/${local.id}/action`, {action, final_sequence:local.sequence});
            if (action === 'resume') { await restorePath(); await capture(); }
            else { clearInterval(timer); timer = null; }
            if (['finish','discard'].includes(action)) { local.finished = true; await storage(local,true); }
            draw(); editor(); status(selected.status + ' · saved independently of live tracking'); return;
        }
        if (!selected) throw new Error('Choose a saved path first.');
        if (action === 'reload') return load(selected.id);
        if (action === 'existing-stop') { if (selected.status !== 'DRAFT') throw new Error('Create a new draft to change published stops.'); const stop=masterStops[Number(root.querySelector('.studio-master-stop').value)]; if (!stop) throw new Error('No existing stop selected.'); remember(); selected.stops.push({...stop}); }
        if (action === 'copy') { selected = await api(`/recordings/${selected.id}/copy`, {}); const nameInput=root.querySelector('.studio-name');if(nameInput)nameInput.value = selected.name; }
        if (action === 'undo' && undo.length) { redo.push(JSON.stringify(selected)); selected = JSON.parse(undo.pop()); }
        if (action === 'redo' && redo.length) { undo.push(JSON.stringify(selected)); selected = JSON.parse(redo.pop()); }
        if (action === 'geometry') { const value = JSON.parse(root.querySelector('.studio-geometry').value); if (!Array.isArray(value) || value.length < 2 || value.some(p => !Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite) || Math.abs(p[0]) > 180 || Math.abs(p[1]) > 90)) throw new Error('Enter valid longitude/latitude pairs.'); remember(); selected.geometry = value; }
        if (action === 'save') selected = await api(`/recordings/${selected.id}/draft`, {revision:selected.revision,name:name(),geometry:selected.geometry,stops:selected.stops}, 'PUT');
        if (['manual','traced'].includes(action)) {
            if (!confirm(`Select the ${action} route for this bus? This changes its route assignment and affected passenger route assignments.`)) return;
            selected = await api(`/recordings/${selected.id}/select`, {mode:action,revision:selected.revision});
        }
        draw(); editor(); status('Saved path: ' + selected.status);
    }
    root.addEventListener('click', event => {
        const button = event.target.closest('button'); if (!button) return;
        if (button.dataset.action) { if(busy)return;busy=true;button.disabled = true; act(button.dataset.action).catch(e => status(e.message)).finally(() => {busy=false;button.disabled = false;}); return; }
        if (!selected || selected.status !== 'DRAFT') return;
        remember();
        if (button.dataset.remove !== undefined) selected.stops.splice(Number(button.dataset.remove),1);
        for (const [key, delta] of [['up',-1],['down',1]]) if (button.dataset[key] !== undefined) { const i=Number(button.dataset[key]), j=i+delta; if (j>=0 && j<selected.stops.length) [selected.stops[i],selected.stops[j]]=[selected.stops[j],selected.stops[i]]; }
        draw(); editor();
    });
    root.addEventListener('change', event => {
        if (event.target.matches('.studio-history') && event.target.value) load(event.target.value).catch(e => status(e.message));
        if (event.target.dataset.stop !== undefined && selected?.status === 'DRAFT') { remember(); selected.stops[Number(event.target.dataset.stop)].name=event.target.value; draw(); }
    });
    const visibility = () => { if (document.hidden && watch !== null) { stopWatch(); status('Recording interrupted while page was hidden. Use Recover when ready.'); } };
    document.addEventListener('visibilitychange', visibility);
    root.cleanup = () => { closed=true; stopWatch(); clearInterval(timer); document.removeEventListener('visibilitychange',visibility); map?.remove(); };
    requestAnimationFrame(async () => {
        if (closed) return;
        const mapStatus=message=>{if(!closed)root.querySelector('.studio-map-status').textContent=message;};
        createStudioMap(root.querySelector('.studio-map'), {
            onError:mapStatus,
            onStop:p=>{if(tracer || selected?.status !== 'DRAFT')return;let label;if(admin){if(!placingStop)return;label=root.querySelector('.studio-new-stop-name')?.value.trim();placingStop=false;}else{label=prompt('Stop name')?.trim();}if(!label)return;remember();selected.stops.push({name:label,latitude:p.lat,longitude:p.lng,radius:50});const input=root.querySelector('.studio-new-stop-name');if(input)input.value='';draw();editor();root.querySelector('.studio-map-status').textContent='Stop added. Drag its numbered marker to fine-tune the position.';},
            onMoveStop:(i,p)=>{remember();selected.stops[i].latitude=p.lat;selected.stops[i].longitude=p.lng;editor();}
        }).then(result=>{if(closed){result.remove();return;}map=result;draw(true);if(lastFix)map.setPosition([lastFix.coords.longitude,lastFix.coords.latitude],lastFix.coords.accuracy);mapStatus(admin ? 'Choose a recorded path above.' : 'Blue line: filtered live GPS trail · blue marker: latest trusted phone position');}).catch(e=>mapStatus(e.message));
        try { if (tracer) local=await storage(); else if(!admin) masterStops=await api('/stops'); await refresh(); } catch(e) { status(e.message); }
    });
    return root;
}
