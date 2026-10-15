import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

function monitor(extra = {}) {
    const panel = {innerHTML: '', querySelector: () => null};
    const source = read('frontend/modules/js/adminTrackUpdates.js')
        .replace(/^import .*;\r?$/gm, '')
        .replace(/^export /gm, '');
    const context = vm.createContext({
        document: {getElementById: id => id === 'fleetTrackUpdates' ? panel : null},
        escapeHtml: value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;'),
        Date, Map, Intl, Number, String, Set, Object,
        ...extra,
    });
    vm.runInContext(source, context);
    context.render = (trips, buses) => vm.runInContext(
        'renderFleetTrackUpdates(testTrips, testBuses)',
        Object.assign(context, {testTrips: trips, testBuses: buses}),
    );
    return {context, panel};
}

test('admin route view shows every bus and live stop progress', () => {
    const {context, panel} = monitor();
    const buses = [
        {id: 1, bus_number: 'BUS-001', registration_number: 'KL001'},
        {id: 2, bus_number: 'BUS-002', registration_number: 'KL002'},
    ];
    const trip = {
        bus_id: 1, bus_number: 'BUS-001', is_active_trip: true,
        route_name: 'Moonupedika', route_direction: 'forward',
        location_source: 'vehicle_gps', last_location_update: '2026-10-15T07:00:00Z',
        provider_gps: {fix_time: '2026-10-15T12:30:00Z', protocol: 'kingstrack'},
        gps_freshness: {is_fresh: true, age_seconds: 5},
        route_stops: [
            {sequence: 1, stop_name: 'Start', stop_code: 'ST001', tracking_status: 'completed'},
            {sequence: 2, stop_name: 'Middle', stop_code: 'ST002', tracking_status: 'approaching'},
            {sequence: 3, stop_name: 'End', stop_code: 'ST003', tracking_status: 'pending'},
        ],
    };
    context.render([trip], buses);
    assert.match(panel.innerHTML, /2<\/strong> registered buses/);
    assert.match(panel.innerHTML, /1<\/strong> routes running/);
    assert.match(panel.innerHTML, /1<\/strong> showing stop progress/);
    assert.match(panel.innerHTML, /BUS-002/);
    assert.match(panel.innerHTML, /Route not running/);
    assert.match(panel.innerHTML, /STOP 1[\s\S]*?Start[\s\S]*?Passed/);
    assert.match(panel.innerHTML, /STOP 2[\s\S]*?Middle[\s\S]*?Approaching/);
    assert.match(panel.innerHTML, /STOP 3[\s\S]*?End[\s\S]*?Upcoming/);
    assert.doesNotMatch(panel.innerHTML, new RegExp(new Date(trip.provider_gps.fix_time).toLocaleString()));

    trip.route_direction = 'reverse';
    trip.route_stops = [
        {sequence: 1, stop_name: 'End', tracking_status: 'completed'},
        {sequence: 2, stop_name: 'Middle', tracking_status: 'skipped'},
        {sequence: 3, stop_name: 'Start', tracking_status: 'reached'},
    ];
    context.render([trip], buses);
    assert.match(panel.innerHTML, /Return journey/);
    assert.match(panel.innerHTML, /STOP 2[\s\S]*?Middle[\s\S]*?Skipped/);
    assert.match(panel.innerHTML, /STOP 3[\s\S]*?Start[\s\S]*?Reached/);
});

test('waiting buses load assigned stops without inventing live progress', async () => {
    const responses = {
        '/api/routes': [{id: 7, bus_id: 2, route_name: 'Assigned route'}],
        '/api/route-stops/7': [
            {id: 11, stop_name: 'One'}, {id: 12, stop_name: 'Two'},
        ],
    };
    const {context, panel} = monitor({
        fetch: async url => ({ok: true, json: async () => responses[url]}),
    });
    context.render([], [{id: 2, bus_number: 'BUS-002'}]);
    await new Promise(resolve => setImmediate(resolve));
    assert.match(panel.innerHTML, /Assigned route/);
    assert.match(panel.innerHTML, /One[\s\S]*?Upcoming/);
    assert.match(panel.innerHTML, /Two[\s\S]*?Upcoming/);
    assert.match(panel.innerHTML, /Route not running/);
    assert.doesNotMatch(panel.innerHTML, /Reached/);
});

test('track view warns when the live feed stops refreshing', () => {
    const {context, panel} = monitor();
    vm.runInContext('reportFleetTrackFeedError("Live tracking feed is unavailable.")', context);
    assert.match(panel.innerHTML, /Live tracking feed is unavailable/);
    assert.match(panel.innerHTML, /track-monitor-checked error/);
});

test('map switch shows route progress and restores the Leaflet map size', () => {
    const source = read('frontend/modules/js/live_tracking.js')
        .replace(/^import[\s\S]*?from ".*?";\r?\n/m, '')
        .replace(/^export /gm, '');
    const toggle = {
        textContent: 'View route progress',
        attributes: {},
        addEventListener(_name, callback) { this.click = callback; },
        setAttribute(name, value) { this.attributes[name] = value; },
    };
    const mapView = {hidden: false};
    const trackView = {hidden: true};
    const page = {querySelector: selector => ({
        '#trackingViewToggle': toggle,
        '#fleetMapView': mapView,
        '#fleetTrackUpdates': trackView,
    })[selector]};
    let resized = 0;
    const context = vm.createContext({
        document: {createElement: () => page},
        setTimeout() {},
        requestAnimationFrame(callback) { callback(); },
        resizeFleetMap() { resized += 1; },
        initializeFleetMap() {}, startFleetRefresh() {}, cleanupFleetTracking() {},
        console: {log() {}},
    });
    vm.runInContext(source, context);
    vm.runInContext('render()', context);
    toggle.click();
    assert.equal(mapView.hidden, true);
    assert.equal(trackView.hidden, false);
    assert.equal(toggle.textContent, 'View live map');
    assert.equal(toggle.attributes['aria-pressed'], 'true');
    toggle.click();
    assert.equal(mapView.hidden, false);
    assert.equal(trackView.hidden, true);
    assert.equal(toggle.textContent, 'View route progress');
    assert.equal(toggle.attributes['aria-pressed'], 'false');
    assert.equal(resized, 1);
});
