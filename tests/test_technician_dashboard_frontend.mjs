import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../frontend/modules/js/technicianDashboard.js', import.meta.url), 'utf8')
    .replace(/^import .*;\r?$/gm, '')
    .replace(/^export /gm, '');

function dashboard(request) {
    const page = {innerHTML: '', querySelector: () => null, querySelectorAll: () => []};
    const context = vm.createContext({
        request, page, URLSearchParams,
        escapeHtml: value => String(value ?? ''),
        createDropdown: () => ({classList: {add() {}}}),
        Modal: {error() {}},
    });
    vm.runInContext(source, context);
    vm.runInContext('page = testPage', Object.assign(context, {testPage: page}));
    return {context, page};
}

test('one failed technician endpoint does not hide the working sections', async () => {
    const {context, page} = dashboard(async path => {
        if (path === '/integrations/gps/status') throw new Error('GPS status unavailable');
        if (path.includes('/tokens')) return [{id: 1, label: 'Real token', is_active: true}];
        if (path.includes('/audit')) return {events: [], total: 0, has_more: false};
        if (path.includes('/requests')) return {requests: [], total: 0, has_more: false, offset: 0};
        if (path.includes('/translator')) return {field_paths: {latitude: ['lat']}};
        return [];
    });
    await vm.runInContext('refresh()', context);
    assert.match(page.innerHTML, /Real token/);
    assert.match(page.innerHTML, /Could not load live signal/);
    assert.doesNotMatch(page.innerHTML, /undefineds ago|NaN/);
});

test('invalid dates do not crash technician rendering after navigation away', () => {
    const {context, page} = dashboard(async () => []);
    vm.runInContext(`state.tokens = [{id: 1, label: 'Token', last_used_at: 'bad-date'}]; renderDashboard();`, context);
    assert.match(page.innerHTML, /Invalid timestamp/);
    vm.runInContext('page = null; renderDashboard()', context);
});
