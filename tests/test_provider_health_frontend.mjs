import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';


function portal(request) {
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
        Modal: {},
        URLSearchParams,
        window: {setInterval() {}, clearInterval() {}},
        document: {},
        crypto: {randomUUID: () => 'test'},
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
