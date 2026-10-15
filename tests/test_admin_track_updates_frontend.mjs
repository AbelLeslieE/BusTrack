import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

function monitor() {
    const panel = {innerHTML: '', querySelector: () => null};
    const source = read('frontend/modules/js/adminTrackUpdates.js')
        .replace(/^import .*;\r?$/gm, '')
        .replace(/^export /gm, '');
    const context = vm.createContext({
        document: {getElementById: id => id === 'fleetTrackUpdates' ? panel : null},
        escapeHtml: value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;'),
        Date, Map, Intl, Number, String, Set,
    });
    vm.runInContext(source, context);
    context.render = (trips, buses) => vm.runInContext(
        'renderFleetTrackUpdates(testTrips, testBuses)',
        Object.assign(context, {testTrips: trips, testBuses: buses}),
    );
    return {context, panel};
}

test('track view includes every registered bus and counts only advancing fixes', () => {
    const {context, panel} = monitor();
    const buses = [
        {id: 1, bus_number: 'BUS-001', registration_number: 'KL001'},
        {id: 2, bus_number: 'BUS-002', registration_number: 'KL002'},
    ];
    const first = {
        bus_id: 1, bus_number: 'BUS-001',
        provider_gps: {effective_time: '2026-10-15T07:00:00Z', fix_time: '2026-10-15T12:30:00Z', received_at: '2026-10-15T07:00:02Z', protocol: 'airotrack', is_fresh: true, age_seconds: 2},
    };
    context.render([first], buses);
    assert.match(panel.innerHTML, /2<\/strong> registered/);
    assert.match(panel.innerHTML, /1<\/strong> waiting/);
    assert.match(panel.innerHTML, /0<\/strong> advanced here/);
    assert.match(panel.innerHTML, /BUS-002/);
    assert.doesNotMatch(panel.innerHTML, new RegExp(new Date(first.provider_gps.fix_time).toLocaleString()));

    context.render([first], buses);
    assert.match(panel.innerHTML, /0<\/strong> advanced here/);

    const second = structuredClone(first);
    second.provider_gps.effective_time = '2026-10-15T07:01:00Z';
    const newBus = {bus_id: 2, bus_number: 'BUS-002', last_location_update: '2026-10-15T07:01:00Z', location_source: 'mobile', gps_freshness: {is_fresh: true, age_seconds: 0}};
    context.render([second, newBus], buses);
    assert.match(panel.innerHTML, /2<\/strong> advanced here/);
    assert.equal(vm.runInContext('observed.get("1").changes', context), 1);
    assert.equal(vm.runInContext('observed.get("2").changes', context), 1);

    context.render([first, newBus], buses);
    assert.equal(vm.runInContext('observed.get("1").changes', context), 1);
    assert.equal(vm.runInContext('observed.get("1").latest', context), Date.parse('2026-10-15T07:01:00Z'));
    assert.match(panel.innerHTML, /2<\/strong> advanced here/);
    assert.ok(panel.innerHTML.includes(new Date('2026-10-15T07:01:00Z').toLocaleString()));

    context.render([], buses);
    assert.match(panel.innerHTML, /2<\/strong> waiting/);
    assert.match(panel.innerHTML, /0<\/strong> advanced here/);
    assert.equal(vm.runInContext('observed.get("1").latest', context), null);
});

test('track view warns when the live feed stops refreshing', () => {
    const {context, panel} = monitor();
    vm.runInContext('reportFleetTrackFeedError("Live tracking feed is unavailable.")', context);
    assert.match(panel.innerHTML, /Live tracking feed is unavailable/);
    assert.match(panel.innerHTML, /track-monitor-checked error/);
});

test('map switch shows the monitor and restores the Leaflet map size', () => {
    const source = read('frontend/modules/js/live_tracking.js')
        .replace(/^import[\s\S]*?from ".*?";\r?\n/m, '')
        .replace(/^export /gm, '');
    const toggle = {
        textContent: 'View track updates',
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
    toggle.click();
    assert.equal(mapView.hidden, false);
    assert.equal(trackView.hidden, true);
    assert.equal(toggle.textContent, 'View track updates');
    assert.equal(resized, 1);
});
