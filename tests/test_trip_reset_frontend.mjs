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

test('admin map removes old marker when a reset trip has no coordinates', () => {
    const removed = [];
    const cancelled = [];
    const context = portal('adminTrackingService', {
        cancelAnimationFrame: id => cancelled.push(id),
    });
    const oldMarker = {id: 1};
    const activeMarker = {id: 2};
    context.markerLayer = {removeLayer: marker => removed.push(marker)};
    context.oldMarker = oldMarker;
    context.activeMarker = activeMarker;
    vm.runInContext(`
        fleetMarkerLayer = markerLayer;
        markers.set(1, oldMarker);
        markers.set(2, activeMarker);
        markerAnimations.set('1', 10);
        roadMotions.set('1', {frame: 20});
        previousBusPositions.set('1', {latitude: 10, longitude: 76});
        selectedBusId = 1;
        followSelectedBus = true;
        pruneFleetMarkers([
            {bus_id: 1, latitude: null, longitude: null},
            {bus_id: 2, latitude: 10.1, longitude: 76.1}
        ]);
    `, context);
    assert.deepEqual(removed, [oldMarker]);
    assert.deepEqual(cancelled, [10, 20]);
    assert.equal(vm.runInContext('markers.has(1)', context), false);
    assert.equal(vm.runInContext('markers.has(2)', context), true);
    assert.equal(vm.runInContext('selectedBusId', context), null);
});

test('student map removes old marker when reset clears GPS coordinates', () => {
    const removed = [];
    const cancelled = [];
    const context = portal('studentTracking', {
        cancelAnimationFrame: id => cancelled.push(id),
    });
    context.testMap = {removeLayer: marker => removed.push(marker)};
    context.testMarker = {id: 'old-bus'};
    vm.runInContext(`
        state.map = testMap;
        state.busMarker = testMarker;
        state.busTargetLocation = {latitude: 10, longitude: 76};
        state.busMotion.frame = 30;
        state.liveTrip = {id: 7, latitude: null, longitude: null};
        updateBusPosition();
    `, context);
    assert.deepEqual(removed, [context.testMarker]);
    assert.deepEqual(cancelled, [30]);
    assert.equal(vm.runInContext('state.busMarker', context), null);
    assert.equal(vm.runInContext('state.busTargetLocation', context), null);
});

test('driver map removes old marker when fleet reset has no new vehicle fix', () => {
    const removed = [];
    const cancelled = [];
    const elements = {};
    const context = portal('trackingService', {
        document: {getElementById: id => elements[id] ??= {classList: {toggle() {}}, textContent: ''}},
        window: {clearTimeout() {}},
        cancelAnimationFrame: id => cancelled.push(id),
    });
    context.testMap = {removeLayer: marker => removed.push(marker)};
    context.testMarker = {id: 'old-driver-bus'};
    vm.runInContext(`
        map = testMap;
        marker = testMarker;
        markerMotion.frame = 40;
        markerTargetLocation = {latitude: 10, longitude: 76};
        currentTripId = null;
        currentResetVersion = 0;
        tracking = false;
        updateDirectionControls = () => {};
        showRunningTripStatus = () => {};
        applyTrackingSource({active_trip_id: 7, reset_version: 1,
            fleet_reset_waiting: true,
            reset_waiting_for_start: true, tracking_source: 'vehicle_gps_offline',
            vehicle: null, route_direction: 'forward'});
    `, context);
    assert.deepEqual(removed, [context.testMarker]);
    assert.deepEqual(cancelled, [40]);
    assert.equal(vm.runInContext('marker', context), null);
    assert.equal(elements.latitude.textContent, '—');
});

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

test('student reset clears cached route ETA, retains real map target and rejects older reset versions', async () => {
    let modalClosed = 0;
    const context = portal('studentTracking', {
        window: {clearTimeout() {}}, Modal: {close: () => {modalClosed++;}},
    });
    vm.runInContext(`
        updateETAInterface = () => {};
        calculateRouteProgress = () => ({nextStop: {id: 2, latitude: 10.01, longitude: 76}});
        state.liveTrip = {id: 7, latitude: 10, longitude: 76, speed: 30, reset_version: 0};
        state.trackingData = {trip: state.liveTrip};
        state.roadRoute = [[10, 76], [10.01, 76]];
        state.roadRouteLoaded = true;
        state.busTargetLocation = {latitude: 10, longitude: 76};
        state.terminalNoticeTimer = 123;
    `, context);
    await vm.runInContext('calculateNextStopETA()', context);
    assert.ok(vm.runInContext('state.etaMinutes', context) > 0);
    vm.runInContext(`fetchAuthenticated = async () => ({trip: {
        id: 7, latitude: 10, longitude: 76, speed: 30, reset_version: 1,
        route_direction: 'forward', reset_waiting_for_start: true
    }, stops: []});`, context);
    await vm.runInContext('loadStudentTracking()', context);
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
    assert.equal(elements['#student-next-stop-eta'].textContent, 'Waiting for route stop');
    assert.equal(elements['#student-next-stop-distance'].textContent, '');
    const message = vm.runInContext('renderTrackingMessage()', context);
    assert.match(message, /waiting for a fresh GPS fix at a route stop/);
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
            reset_waiting_for_start: true, reset_message: 'Route reset — waiting for a fresh GPS fix at a route stop.',
            tracking_source: 'vehicle_gps_offline', reason: 'GPS is delayed'});
    `, context);
    assert.match(elements.tripStatus.textContent, /waiting for a fresh GPS fix at a route stop/);
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
