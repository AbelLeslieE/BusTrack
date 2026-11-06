import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync, existsSync} from 'node:fs';

const source=readFileSync(new URL('../frontend/modules/js/routeStudio.js',import.meta.url),'utf8')
    .replace(/^import .*;\r?\n/gm,'').replace('export function render()', 'function render()');
const settle=async()=>{for(let i=0;i<15;i++) await new Promise(setImmediate);};

function fixture({denied=false}={}){
    const values=new Map(), intervals=new Map(), nodes=new Map(), frames=[];
    let gpsCallback, watched=0, cleared=0, offline=false, tick=0, next=0, clock=Date.now(), externalFetches=0;
    class TestDate extends Date {
        constructor(...args){super(...(args.length ? args : [clock]));}
        static now(){return clock;}
    }
    const positions=[],paths=[],traces=[];
    const element=()=>({innerHTML:'',textContent:'',value:'Test journey',disabled:false,listeners:{},dataset:{},
        addEventListener(k,fn){this.listeners[k]=fn;},
        querySelector(k){if(!nodes.has(k)) nodes.set(k,element());return nodes.get(k);}});
    const root=element();
    const context=vm.createContext({console,JSON,Date:TestDate,Promise,Number,Array,Error,Math,AbortController,structuredClone,
        esc:v=>String(v),createStudioMap:async()=>({setPath:p=>paths.push(structuredClone(p)),setStops(){},setPosition:p=>positions.push(p),tracePosition:p=>traces.push(structuredClone(p)),follow(){},remove(){}}),crypto:{randomUUID:()=> '11111111-1111-4111-8111-111111111111'},
        setTimeout,clearTimeout,setInterval:fn=>{intervals.set(++next,fn);return next;},clearInterval:id=>intervals.delete(id),
        localStorage:{getItem:()=>JSON.stringify({id:7,role:'Tracer'})},
        document:{hidden:false,createElement:()=>root,addEventListener(){},removeEventListener(){}},
        window:{isSecureContext:true},requestAnimationFrame:fn=>frames.push(fn),confirm:()=>true,
        navigator:{locks:{request:async(_name,_options,fn)=>fn({})},geolocation:{
            getCurrentPosition:(ok,fail)=>denied?fail({code:1}):ok({timestamp:Date.now(),coords:{latitude:10,longitude:76,accuracy:5}}),
            watchPosition:fn=>{gpsCallback=fn;watched++;return 42;},clearWatch:()=>cleared++}},
        indexedDB:{open(){const r={};setImmediate(()=>{r.result={close(){},transaction(){
            const tx={objectStore:()=>({get(key){const q={result:structuredClone(values.get(key))};setImmediate(()=>tx.oncomplete());return q;},
                put(value,key){const q={result:key};values.set(key,structuredClone(value));setImmediate(()=>tx.oncomplete());return q;}})};return tx;}};r.onsuccess();});return r;}},
        L:{map:()=>({setView(){return this;},on(){},remove(){},removeLayer(){},fitBounds(){}}),
            tileLayer:()=>({addTo(){}}),polyline:()=>({addTo(){return this;},getBounds(){return {};}})},
        fetch:async(url,options)=>{
            if(url.startsWith('http')) {externalFetches++;throw new Error('Unexpected browser-side routing request');}
            if(url.endsWith('/points')){if(offline)throw new Error('Network unavailable');return {ok:true,json:async()=>({acknowledged:JSON.parse(options.body).points.map(p=>p.sequence)})};}
            if(url.endsWith('/recordings'))return {ok:true,json:async()=>({id:'11111111-1111-4111-8111-111111111111',name:'Test journey',status:'RECORDING',geometry:[],stops:[]})};
            return {ok:true,json:async()=>({recordings:[],assignment:{bus_id:1,bus_number:'BUS-1'},buses:[],tracers:[]})};
        }
    });
    vm.runInContext(source+'\n globalThis.page=render();',context);
    return {values,intervals,root,frames,context,positions,paths,traces,get watched(){return watched;},get cleared(){return cleared;},get externalFetches(){return externalFetches;},
        offline(value){offline=value;},async init(){await frames.shift()();await settle();},
        async click(action){const button={dataset:{action},disabled:false};root.listeners.click({target:{closest:()=>button}});await settle();},
        async fix({latitude=10,longitude=76,accuracy=5,speed=0,seconds=4}={}){
            clock+=seconds*1000;
            gpsCallback({timestamp:clock,coords:{latitude,longitude,accuracy,speed,heading:null}});
            await settle();
        },
        async sync(){for(const fn of intervals.values())fn();await settle();}};
}

test('Route Studio has its required lazy-loaded stylesheet',()=>{
    assert.ok(existsSync(new URL('../frontend/modules/css/routeStudio.css',import.meta.url)));
});
test('admin road editor keeps OSRM server-side and exposes precise map controls',()=>{
    const mapSource=readFileSync(new URL('../frontend/common/studioMap.js',import.meta.url),'utf8');
    assert.match(source,/data-action="build-road"/);
    assert.match(source,/data-action="edit-route"/);
    assert.match(source,/data-action="restore-trace"/);
    assert.match(source,/\/road-route/);
    assert.match(source,/guide_points/);
    assert.match(mapSource,/setGuides\(next, canEdit\)/);
    assert.match(mapSource,/onMoveGuide/);
    assert.doesNotMatch(source,/router\.project-osrm\.org/);
});
test('opening and closing Tracer never starts GPS or upload timers',async()=>{
    const f=fixture();await f.init();assert.equal(f.watched,0);assert.equal(f.intervals.size,0);f.root.cleanup();assert.equal(f.cleared,0);
});
test('GPS is persisted before upload and offline pending samples survive',async()=>{
    const f=fixture();await f.init();await f.click('start');assert.equal(f.watched,1);
    await f.fix();assert.equal(f.values.get(7).pending.length,1);
    f.offline(true);await f.sync();assert.equal(f.values.get(7).pending.length,1);
    f.root.cleanup();assert.equal(f.cleared,1);assert.equal(f.intervals.size,0);assert.equal(f.values.get(7).pending.length,1);
});
test('only acknowledged samples are removed after successful upload',async()=>{
    const f=fixture();await f.init();await f.click('start');await f.fix();await f.sync();
    assert.equal(f.values.get(7).pending.length,0);assert.equal(f.values.get(7).sequence,1);f.root.cleanup();
});
test('denied location never creates a recording or starts GPS watching',async()=>{
    const f=fixture({denied:true});await f.init();await f.click('start');
    assert.equal(f.watched,0);assert.equal(f.values.size,0);
    assert.match(f.root.querySelector('.studio-permission-state').textContent,/Location denied/);f.root.cleanup();
});
test('enabling location previews position without starting recording',async()=>{
    const f=fixture();await f.init();await f.click('permission');
    assert.equal(f.watched,0);assert.equal(f.values.size,0);assert.equal(f.positions.length,1);f.root.cleanup();
});
test('accepted GPS fixes update the visible path and recording metrics',async()=>{
    const f=fixture();await f.init();await f.click('start');await f.fix();
    assert.deepEqual(JSON.parse(JSON.stringify(f.paths.at(-1))),[[76,10]]);
    assert.equal(f.root.querySelector('.studio-samples').textContent,'1');
    assert.equal(f.root.querySelector('.studio-record-badge').dataset.live,'true');
    assert.equal(f.values.get(7).pending.length,1);f.root.cleanup();
});
test('stationary drift holds the line until successive fixes confirm travel',async()=>{
    const f=fixture();await f.init();await f.click('start');
    await f.fix();
    await f.fix({latitude:10.0001});
    await f.fix({latitude:10.0002});
    assert.deepEqual(JSON.parse(JSON.stringify(f.paths.at(-1))),[[76,10]]);
    await f.fix({latitude:10.0004});
    assert.deepEqual(JSON.parse(JSON.stringify(f.traces)),[[76,10.0001],[76,10.0004]]);
    assert.equal(f.values.get(7).pending.length,4);
    assert.equal(f.externalFetches,0);
    f.root.cleanup();
});
test('impossible coordinate spikes are rejected and the trail resumes from the last good fix',async()=>{
    const f=fixture();await f.init();await f.click('start');
    await f.fix({latitude:10,speed:8,seconds:1});
    await f.fix({latitude:10.0001,speed:8,seconds:1});
    await f.fix({latitude:11,speed:8,seconds:1});
    await f.fix({latitude:15,speed:8,seconds:1});
    await f.fix({latitude:10.0002,speed:8,seconds:1});
    assert.deepEqual(JSON.parse(JSON.stringify(f.traces)),[[76,10.0001],[76,10.0002]]);
    assert.equal(f.values.get(7).pending.length,3);
    assert.match(f.root.querySelector('.studio-status').textContent,/accuracy/);
    f.root.cleanup();
});
