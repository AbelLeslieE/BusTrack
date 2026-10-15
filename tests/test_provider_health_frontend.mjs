import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';


function portal(request, overrides = {}) {
    const source = fs
        .readFileSync(new URL('../frontend/modules/js/providerHealth.js', import.meta.url), 'utf8')
        .replace(/^import .*;\r?$/gm, '')
        .replace(/^export /gm, '');
    const page = {
        innerHTML: '',
        querySelector: () => null,
        querySelectorAll: () => [],
    };
    const context = vm.createContext({
        console: {log() {}, warn() {}, error() {}},
        request,
        escapeHtml: value => String(value ?? ''),
        Modal: overrides.Modal || {},
        URLSearchParams,
        window: overrides.window || {setInterval() {}, clearInterval() {}, setTimeout() {}, clearTimeout() {}},
        document: overrides.document || {},
        crypto: {randomUUID: () => 'test'},
        AbortController,
    });
    vm.runInContext(source, context);
    context.testPage = page;
    vm.runInContext('page = testPage;', context);
    return {context, page};
}


test('provider health clearly labels and filters Kingstrack independently', async () => {
    const requests = [];
    const {context, page} = portal(async path => {
        requests.push(path);
        if (path.includes('/positions')) return {positions: []};
        return {
            counts: {healthy: 1},
            buses: [{
                bus_id: 3,
                bus_number: 'BUS-003',
                registration_number: 'KL64P4797',
                protocol: 'kingstrack',
                health_status: 'healthy',
            }],
            poll_interval_seconds: 20,
            history_retention_minutes: 1440,
        };
    });
    vm.runInContext(`state.loading = false; state.selectedProvider = 'kingstrack';`, context);

    await vm.runInContext('refreshData()', context);

    assert.ok(requests.some(path => path.includes('provider=kingstrack')));
    assert.match(page.innerHTML, /Filter by provider/);
    assert.match(page.innerHTML, /Kingstrack/);
    assert.match(page.innerHTML, /provider-source-pill kingstrack/);
});


test('manual refresh uses the combined providers endpoint and selected source', async () => {
    const requests = [];
    const {context} = portal(async (path) => {
        requests.push(path);
        if (path.includes('/providers/refresh')) return {errors: []};
        if (path.includes('/positions')) return {positions: []};
        return {counts: {}, buses: [], poll_interval_seconds: 20, history_retention_minutes: 1440};
    });
    vm.runInContext(`state.loading = false; state.selectedProvider = 'airotrack';`, context);

    await vm.runInContext('pullProviderNow()', context);

    assert.ok(requests.some(path => path.includes('/providers/refresh?provider=airotrack')));
    assert.ok(requests.every(path => !path.includes('/airotrack/refresh')));
});


test('clock fallback distinguishes trusted tracking time from raw device time', async () => {
    const {context, page} = portal(async path => {
        if (path.includes('/positions')) {
            return {
                positions: [{
                    id: 9,
                    bus_number: 'BUS-014',
                    registration_number: 'KL64M9190',
                    protocol: 'kingstrack',
                    received_at: '2026-09-14T07:00:58Z',
                    fix_time: '2026-09-12T12:50:33Z',
                    effective_time: '2026-09-14T07:00:58Z',
                    timestamp_basis: 'receipt_clock_fallback',
                    clock_fallback_active: true,
                    applied_to_current_state: true,
                    quarantined: false,
                }],
            };
        }
        return {
            counts: {healthy: 1},
            buses: [{
                bus_id: 14,
                bus_number: 'BUS-014',
                registration_number: 'KL64M9190',
                protocol: 'kingstrack',
                health_status: 'healthy',
                latest_tracking_time: '2026-09-14T07:00:58Z',
                latest_device_time: '2026-09-12T12:50:33Z',
                clock_fallback_active: true,
            }],
            poll_interval_seconds: 20,
            history_retention_minutes: 1440,
        };
    });
    vm.runInContext('state.loading = false;', context);

    await vm.runInContext('refreshData()', context);

    assert.match(page.innerHTML, /Trusted BusTrack receipt time/);
    assert.match(page.innerHTML, /original provider value/);
    assert.match(page.innerHTML, /Device clock correction is active/);
    assert.match(page.innerHTML, /Safe receipt-clock fallback/);
});


test('coordinate feed requests and renders one bounded server-side page', async () => {
    const requests = [];
    const {context, page} = portal(async path => {
        requests.push(path);
        if (path.includes('/positions')) {
            return {
                positions: Array.from({length: 10}, (_, index) => ({
                    id: 21 + index,
                    bus_number: `BUS-${21 + index}`,
                    protocol: 'airotrack',
                })),
                total: 31,
                limit: 10,
                offset: 20,
                has_more: true,
            };
        }
        return {counts: {}, buses: [], poll_interval_seconds: 20, history_retention_minutes: 1440};
    });
    vm.runInContext('state.loading = false; state.positionPage = 3;', context);

    await vm.runInContext('refreshData()', context);

    assert.ok(requests.some(path => path.includes('limit=10') && path.includes('offset=20')));
    assert.match(page.innerHTML, /Showing <strong>21–30<\/strong> of <strong>31<\/strong> responses/);
    assert.match(page.innerHTML, /data-provider-page="3" aria-current="page"/);
    assert.match(page.innerHTML, /data-provider-page="4"/);
});


test('coordinate feed recovers when retention removes the requested page', async () => {
    const offsets = [];
    const {context, page} = portal(async path => {
        if (path.includes('/positions')) {
            const offset = Number(new URL(`https://example.test${path}`).searchParams.get('offset'));
            offsets.push(offset);
            return {
                positions: offset === 10 ? [{id: 11, bus_number: 'BUS-011', protocol: 'kingstrack'}] : [],
                total: 11,
                limit: 10,
                offset,
                has_more: false,
            };
        }
        return {counts: {}, buses: [], poll_interval_seconds: 20, history_retention_minutes: 1440};
    });
    vm.runInContext('state.loading = false; state.positionPage = 9;', context);

    await vm.runInContext('refreshData()', context);

    assert.deepEqual(offsets, [80, 10]);
    assert.equal(vm.runInContext('state.positionPage', context), 2);
    assert.match(page.innerHTML, /Showing <strong>11–11<\/strong> of <strong>11<\/strong> responses/);
});


test('fleet reset requires typed confirmation and sends one destructive reset request', async () => {
    const requests = [];
    const confirmation = {value: 'RESET', disabled: false, focus() {}};
    const errorBox = {textContent: ''};
    let formOptions;
    const Modal = {
        form(options) { formOptions = options; },
        close() {},
        success() {},
        error() {},
    };
    const document = {
        getElementById(id) {
            return id === 'provider-reset-all-confirm' ? confirmation : errorBox;
        },
    };
    const {context, page} = portal(async (path, options = {}) => {
        requests.push({path, options});
        if (path.endsWith('/reset-all')) {
            return {active_routes_reset_outbound: 2};
        }
        if (path.includes('/positions')) {
            return {positions: [], total: 0, has_more: false};
        }
        return {counts: {}, buses: [], poll_interval_seconds: 20, history_retention_minutes: 1440};
    }, {Modal, document});
    vm.runInContext('state.loading = false; state.health = {counts: {}, buses: []}; renderPage(); openResetAllDialog();', context);

    assert.match(page.innerHTML, /Reset all tracking/);
    assert.match(formOptions.title, /Reset all fleet tracking/);
    await formOptions.onSubmit();

    const resetRequest = requests.find(item => item.path.endsWith('/reset-all'));
    assert.ok(resetRequest);
    assert.equal(resetRequest.options.method, 'POST');
    assert.equal(JSON.parse(resetRequest.options.body).confirmation, 'RESET_ALL_GPS_DATA');
    assert.equal(vm.runInContext('state.resettingAll', context), false);
});

test('fleet reset reports success even when the following health read is slow', async () => {
    const confirmation = {value: 'RESET', disabled: false, focus() {}};
    const errorBox = {textContent: ''};
    const notices = [];
    let formOptions;
    const Modal = {
        form(options) { formOptions = options; },
        close() {},
        success(options) { notices.push(options); },
        error(options) { notices.push(options); },
    };
    const document = {
        getElementById(id) {
            return id === 'provider-reset-all-confirm' ? confirmation : errorBox;
        },
    };
    const {context, page} = portal(async path => {
        if (path.endsWith('/reset-all')) return {active_routes_reset_outbound: 2};
        if (path.includes('/positions')) return {positions: [], total: 0};
        return new Promise(() => {});
    }, {Modal, document});
    vm.runInContext('state.loading = false; state.health = {counts: {}, buses: []}; renderPage(); openResetAllDialog();', context);

    await formOptions.onSubmit();

    assert.match(notices[0].title, /Fleet tracking reset/);
    assert.equal(vm.runInContext('state.resettingAll', context), false);
    assert.match(page.innerHTML, /Reset all tracking/);
    assert.doesNotMatch(page.innerHTML, /Resetting…/);
});

test('timed-out fleet reset clears busy state and retains its retry ID', async () => {
    const confirmation = {value: 'RESET', disabled: false, focus() {}};
    const errorBox = {textContent: ''};
    const requestIds = [];
    let formOptions;
    const {context, page} = portal(async (path, options) => {
        if (!path.endsWith('/reset-all')) return {counts: {}, buses: []};
        requestIds.push(JSON.parse(options.body).request_id);
        return new Promise((_, reject) => {
            options.signal.addEventListener('abort', () => reject(new Error('aborted')));
        });
    }, {
        document: {
            getElementById(id) {
                return id === 'provider-reset-all-confirm' ? confirmation : errorBox;
            },
        },
        Modal: {form(options) { formOptions = options; }, error() {}},
        window: {
            setTimeout(callback) { queueMicrotask(callback); return 1; },
            clearTimeout() {},
            setInterval() {},
            clearInterval() {},
        },
    });
    vm.runInContext('state.loading = false; state.health = {counts: {}, buses: []}; renderPage(); openResetAllDialog();', context);

    await formOptions.onSubmit();
    assert.match(errorBox.textContent, /may still finish/);
    assert.equal(vm.runInContext('state.resettingAll', context), false);
    assert.doesNotMatch(page.innerHTML, /Resetting…/);

    await formOptions.onSubmit();
    assert.deepEqual(requestIds, ['test', 'test']);
});

test('missing telemetry is not displayed as zero coordinates or NaN speed', async () => {
    const {context, page} = portal(async path => path.includes('/positions')
        ? {positions: [{id: 1, bus_number: 'BUS-001', latitude: null, longitude: null, speed_kmh: undefined}], total: 1}
        : {counts: {no_data: 1}, buses: [{bus_id: 1, bus_number: 'BUS-001', health_status: 'no_data', latitude: null, longitude: null}]});
    await vm.runInContext('refreshData()', context);
    assert.match(page.innerHTML, /No coordinate received/);
    assert.doesNotMatch(page.innerHTML, /0\.000000|NaN km\/h|Unknown ago/);
});

test('failed provider refresh clears stale visible telemetry and shows an error', async () => {
    const {context, page} = portal(async () => { throw new Error('service unavailable'); });
    vm.runInContext(`state.health = {counts: {healthy: 1}, buses: [{bus_id: 1, bus_number: 'STALE'}]}; state.positions = [{id: 1, bus_number: 'STALE'}];`, context);
    await vm.runInContext('refreshData()', context);
    assert.match(page.innerHTML, /service unavailable/);
    assert.doesNotMatch(page.innerHTML, /STALE/);
});

test('timed-out health refresh releases the busy state', async () => {
    const {context, page} = portal(async (_path, options) => new Promise((_, reject) => {
        options.signal.addEventListener('abort', () => reject(new Error('aborted')));
    }), {
        window: {
            setTimeout(callback) { queueMicrotask(callback); return 1; },
            clearTimeout() {},
            setInterval() {},
            clearInterval() {},
        },
    });

    await vm.runInContext('refreshData()', context);

    assert.equal(vm.runInContext('state.refreshing', context), false);
    assert.match(page.innerHTML, /taking too long to load/);
});
