import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';


function loadApi(fetchImplementation) {
    const source = fs
        .readFileSync(new URL('../frontend/modules/js/stopsApi.js', import.meta.url), 'utf8')
        .replace(/^export /gm, '');
    const context = vm.createContext({fetch: fetchImplementation});
    vm.runInContext(source, context);
    return context;
}


test('stop-code preview bypasses cache and create supports a server-assigned code', async () => {
    const requests = [];
    const context = loadApi(async (path, options = {}) => {
        requests.push({path, options});
        if (path.endsWith('/next-code')) {
            return {ok: true, json: async () => ({stop_code: 'ST030'})};
        }
        return {
            ok: true,
            json: async () => ({success: true, stop: {stop_code: 'ST030'}}),
        };
    });

    const preview = await context.getNextStopCode();
    assert.equal(preview.stop_code, 'ST030');
    assert.equal(requests[0].path, '/api/stops/next-code');
    assert.equal(requests[0].options.cache, 'no-store');

    const created = await context.createStop({stop_name: 'Koparkala'});
    assert.equal(created.stop.stop_code, 'ST030');
    assert.deepEqual(JSON.parse(requests[1].options.body), {stop_name: 'Koparkala'});
});

test('bus stop workspace loads ordered routes and removes only the route entry', async () => {
    const requests = [];
    const context = loadApi(async (path, options = {}) => {
        requests.push({path, options});
        return {ok: true, json: async () => ({buses: [], unassigned_routes: [], statistics: {}})};
    });

    await context.getBusRouteStops();
    await context.removeRouteStop(42);

    assert.equal(requests[0].path, '/api/stops/bus-routes');
    assert.equal(requests[0].options.cache, 'no-store');
    assert.equal(requests[1].path, '/api/route-stops/42');
    assert.equal(requests[1].options.method, 'DELETE');
});

test('Stops UI is bus-first with ordered View, Edit and Delete controls', () => {
    const source = fs.readFileSync(new URL('../frontend/modules/js/stops.js', import.meta.url), 'utf8');
    const styles = fs.readFileSync(new URL('../frontend/modules/css/stops.css', import.meta.url), 'utf8');
    assert.match(source, /Stops by bus/);
    assert.match(source, /ordered-stop-list/);
    assert.match(source, /data-action="view"/);
    assert.match(source, /data-action="edit"/);
    assert.match(source, /data-action="remove"/);
    assert.match(source, /Delete from route/);
    assert.match(source, /PAGE_SIZE = 6/);
    assert.match(styles, /\.bus-stop-card/);
    assert.match(styles, /\.ordered-stop__rail/);
});


test('stops overview bypasses cache and returns synchronized KPI data', async () => {
    const requests = [];
    const expected = {
        stops: [{id: 1, stop_code: 'ST001'}],
        statistics: {
            total_stops: 1,
            total_routes: 2,
            average_stops_per_route: 0.5,
            mapped_stops: 1,
        },
    };
    const context = loadApi(async (path, options = {}) => {
        requests.push({path, options});
        return {ok: true, json: async () => expected};
    });

    const overview = await context.getStopsOverview();

    assert.equal(requests[0].path, '/api/stops/overview');
    assert.equal(requests[0].options.cache, 'no-store');
    assert.deepEqual(overview, expected);
});
