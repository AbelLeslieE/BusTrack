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
