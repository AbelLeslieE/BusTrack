import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function setup(start = async () => {}) {
    const nodes = new Map();
    const node = name => {
        if (!nodes.has(name)) nodes.set(name, {hidden:false, handlers:{}, textContent:'',
            addEventListener(event, fn) { this.handlers[event] = fn; }, replaceChildren() { this.innerHTML=''; }});
        return nodes.get(name);
    };
    const page = {isConnected:false, querySelector:node};
    const document = {hidden:false, createElement:()=>page, handlers:{},
        addEventListener(event,fn) {this.handlers[event]=fn;}, removeEventListener(event) {delete this.handlers[event];}};
    const instances=[];
    class Scanner {
        constructor(video, callback, options) {
            assert.equal(page.isConnected,true,'Camera must stay inside the mounted page');
            this.callback=callback; this.options=options; this.stops=0; instances.push(this);
        }
        start() { return start(); }
        stop() { this.stops++; }
        destroy() {this.destroyed=true;}
    }
    const context=vm.createContext({document,window:{isSecureContext:true},navigator:{mediaDevices:{getUserMedia(){}}},
        QrScanner:Scanner,request:async()=>({valid:false,status:'INVALID',message:'Test result'}),escapeHtml:String,
        AbortController,setTimeout,clearTimeout,Date});
    vm.runInContext(fs.readFileSync(new URL('../frontend/common/passScannerSession.js',import.meta.url),'utf8').replace('export function','function'),context);
    vm.runInContext(fs.readFileSync(new URL('../frontend/modules/js/verifyBusPass.js',import.meta.url),'utf8').replace(/^import .*;\r?$/gm,'').replace('export function','function'),context);
    context.render();
    return {page,node,document,instances};
}
const settle = () => new Promise(resolve=>setImmediate(resolve));

test('camera initializes only after mount and stays visible until a scan',async()=>{
    const ui=setup();
    assert.equal(ui.instances.length,0);
    ui.page.isConnected=true;
    ui.node('.scanner-start').handlers.click(); await settle();
    assert.equal(ui.instances.length,1);
    assert.equal(ui.instances[0].options.highlightScanRegion,true);
    assert.equal(ui.node('.scanner-placeholder').hidden,true);
    assert.equal(ui.node('.scanner-stop').hidden,false);
    ui.instances[0].callback({data:'test-signed-qr'}); await settle();
    assert.equal(ui.node('.scanner-placeholder').hidden,false);
    assert.equal(ui.node('.scanner-next').hidden,false);
    ui.node('.scanner-next').handlers.click(); await settle();
    assert.equal(ui.instances.length,1);
    assert.equal(ui.node('.scanner-placeholder').hidden,true);
    ui.page.cleanup(); assert.equal(ui.instances[0].destroyed,true);
});

test('permission failure leaves a visible retry and no live indicator',async()=>{
    const ui=setup(async()=>{throw Error('Permission denied');}); ui.page.isConnected=true;
    ui.node('.scanner-start').handlers.click(); await settle();
    assert.equal(ui.node('.scanner-start').hidden,false);
    assert.equal(ui.node('.scanner-live').hidden,true);
    assert.match(ui.node('.scanner-message').textContent,/Permission denied/);
    ui.page.cleanup();
});

test('double taps do not start two cameras and hiding pauses a pending start',async()=>{
    let finish;
    const ui=setup(()=>new Promise(resolve=>{finish=resolve;})); ui.page.isConnected=true;
    ui.node('.scanner-start').handlers.click(); ui.node('.scanner-start').handlers.click();
    assert.equal(ui.instances.length,1);
    ui.document.hidden=true; ui.document.handlers.visibilitychange(); finish(); await settle();
    assert.equal(ui.node('.scanner-live').hidden,true);
    assert.equal(ui.node('.scanner-start').hidden,false);
    assert.ok(ui.instances[0].stops>0);
    ui.page.cleanup();
});
