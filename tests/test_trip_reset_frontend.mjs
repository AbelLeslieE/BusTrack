// Exercise the real portal functions with controlled network/DOM boundaries.
// Run: node --test tests/test_trip_reset_frontend.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

function portal(name, globals = {}) {
    const source = fs.readFileSync(new URL(`../frontend/modules/js/${name}.js`, import.meta.url), 'utf8')
        .replace(/^import .*;\r?$/gm, '').replace(/^export /gm, '');
    const context = vm.createContext({console: {log() {}, warn() {}, error() {}}, ...globals});
    vm.runInContext(source, context);
    return context;
}

test('reset dialog previews both starts, submits once and retains its retry identity', async () => {
    let form, selectionHandler, release;
    const requests = [];
    const elements = {
        'provider-reset-direction': {addEventListener: (_, handler) => {selectionHandler = handler;}},
        'provider-reset-start': {textContent: ''},
        'provider-reset-error': {textContent: ''},
    };
    const context = portal('providerHealth', {
        document: {getElementById: id => elements[id]},
        crypto: {randomUUID: () => 'test-request-id'}, escapeHtml: value => String(value),
        Modal: {form: options => {form = options; options.onOpen();}, close() {}, success() {}, error: error => {throw Error(error.subtitle);}},
        request: async (path, options) => {
            requests.push({path, options});
            if (path.endsWith('reset-options')) return {
                bus_number: 'BUS-008', trip_id: 7, reset_version: 2, route_name: 'Route',
                starts: {forward: {name: 'First stop'}, reverse: {name: 'Last stop'}},
            };
            return new Promise(resolve => {release = () => resolve({message: 'Reset saved'});});
        },
    });
    vm.runInContext('page = {}; renderPage = () => {}; refreshData = async () => {};', context);
    await vm.runInContext('openResetDialog(8)', context);
    assert.match(form.content, /First stop/);
    selectionHandler({target: {value: 'reverse'}});
    assert.equal(elements['provider-reset-start'].textContent, 'Last stop');
    const first = form.onSubmit();
    await form.onSubmit();
    assert.equal(requests.filter(item => item.path.endsWith('/reset')).length, 1);
    const body = JSON.parse(requests[1].options.body);
    assert.deepEqual(body, {direction: 'reverse', trip_id: 7, expected_reset_version: 2, request_id: 'test-request-id'});
    release(); await first;
    const retry = form.onSubmit();
    assert.equal(JSON.parse(requests[2].options.body).request_id, body.request_id);
    release(); await retry;
});

test('student reset discards pending old ETA, retains real map target and rejects older reset versions', async () => {
    let release;
    let modalClosed = 0;
    const context = portal('studentTracking', {
        fetch: () => new Promise(resolve => {release = () => resolve({ok: true, json: async () => ({code: 'Ok', routes: [{distance: 500}]})});}),
        window: {clearTimeout() {}}, Modal: {close: () => {modalClosed++;}},
    });
    vm.runInContext(`
        updateETAInterface = () => {};
        calculateRouteProgress = () => ({nextStop: {id: 2, latitude: 10.01, longitude: 76}});
        state.liveTrip = {id: 7, latitude: 10, longitude: 76, speed: 30, reset_version: 0};
        state.trackingData = {trip: state.liveTrip};
        state.busTargetLocation = {latitude: 10, longitude: 76};
        state.terminalNoticeTimer = 123;
    `, context);
    const pendingETA = vm.runInContext('calculateNextStopETA()', context);
    vm.runInContext(`fetchAuthenticated = async () => ({trip: {
        id: 7, latitude: 10, longitude: 76, speed: 30, reset_version: 1,
        route_direction: 'forward', reset_waiting_for_start: true
    }, stops: []});`, context);
    await vm.runInContext('loadStudentTracking()', context);
    release(); await pendingETA;
    assert.equal(vm.runInContext('state.etaMinutes', context), null);
    assert.equal(vm.runInContext('state.etaLoading', context), false);
    assert.equal(vm.runInContext('state.busTargetLocation.latitude', context), 10);
    assert.equal(modalClosed, 1);
    vm.runInContext('fetchAuthenticated = async () => ({trip: {id: 7, reset_version: 0}});', context);
    assert.equal(await vm.runInContext('loadStudentTracking()', context), null);
    assert.equal(vm.runInContext('state.liveTrip.reset_version', context), 1);
});

test('student waiting reset suppresses ETA and keeps stale-location notice visible', async () => {
    const elements = {'#student-next-stop-eta': {}, '#student-next-stop-distance': {textContent: 'old distance'}};
    const context = portal('studentTracking', {
        document: {querySelector: id => elements[id]},
        fetch: () => {throw Error('ETA must not be requested while waiting');},
    });
    vm.runInContext(`state.liveTrip = {reset_waiting_for_start: true};
        getTelemetry = () => ({is_fresh: false});`, context);
    await vm.runInContext('calculateNextStopETA()', context);
    assert.equal(elements['#student-next-stop-eta'].textContent, 'Waiting for first stop');
    assert.equal(elements['#student-next-stop-distance'].textContent, '');
    const message = vm.runInContext('renderTrackingMessage()', context);
    assert.match(message, /waiting to reach the first stop/);
    assert.match(message, /GPS is delayed/);
});

test('driver reset updates waiting state without announcing a terminal arrival', () => {
    const elements = {};
    const context = portal('trackingService', {
        document: {getElementById: id => elements[id] ??= {classList: {toggle() {}}, textContent: ''}},
        window: {clearTimeout() {}},
    });
    vm.runInContext(`
        tracking = true; currentTripId = 7; terminalMessageTimer = 123;
        stopMobileLocationTracking = () => {};
        updateDirectionControls = direction => {currentRouteDirection = direction;};
        showTerminalArrival = () => {throw Error('A reset is not a terminal arrival');};
        applyTrackingSource({active_trip_id: 7, route_direction: 'reverse', reset_version: 1,
            reset_waiting_for_start: true, reset_message: 'Route reset — waiting to reach the first stop.',
            tracking_source: 'vehicle_gps_offline', reason: 'GPS is delayed'});
    `, context);
    assert.match(elements.tripStatus.textContent, /waiting to reach the first stop/);
    assert.match(elements.trackingSourceReason.textContent, /GPS is delayed/);
    vm.runInContext(`applyTrackingSource({active_trip_id: 7, route_direction: 'forward', reset_version: 0});`, context);
    assert.equal(vm.runInContext('currentRouteDirection', context), 'reverse');
    assert.equal(vm.runInContext('terminalMessageTimer', context), null);
});

test('phone update carries the actual fix timestamp and captured reset version', async () => {
    let body;
    const context = portal('trackingService', {
        localStorage: {getItem: () => 'test-token'},
        fetch: async (_, options) => {body = JSON.parse(options.body); return {ok: true, json: async () => ({})};},
    });
    vm.runInContext(`activeTrackingSource = 'mobile'; currentTripId = 7; currentResetVersion = 3;`, context);
    await vm.runInContext('sendLocation(10, 76, 2, 5, 1788768000000)', context);
    assert.equal(body.reset_version, 3);
    assert.equal(body.recorded_at, new Date(1788768000000).toISOString());
    assert.equal(body.latitude, 10);
});
