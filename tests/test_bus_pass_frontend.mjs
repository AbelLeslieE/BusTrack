import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../frontend/modules/js/busPass.js', import.meta.url), 'utf8')
    .replace(/^import .*;\r?$/gm, '').replace('export function render()', 'function render()');

function screen(data) {
    const calls = [];
    const qrBox = {
        innerHTML: '', children: [],
        replaceChildren() { this.innerHTML = ''; this.children = []; },
        append(child) { this.children.push(child); },
    };
    const page = {
        innerHTML: '',
        querySelector(selector) {
            if (selector === '.live-pass-qr' && this.innerHTML.includes('class="live-pass-qr"')) return qrBox;
            return null;
        },
    };
    const document = {
        hidden: false,
        createElement(name) { return name === 'section' ? page : { textContent: '' }; },
        addEventListener() {}, removeEventListener() {},
    };
    const request = async path => {
        calls.push(path);
        return path.endsWith('/live-token')
            ? { qrImage: 'data:image/png;base64,TEST', expiresAt: 30, serverTime: 10 }
            : data;
    };
    const context = vm.createContext({ document, request, errorState: String, Date, Intl,
        performance, AbortController, setTimeout, clearTimeout, setInterval, clearInterval });
    vm.runInContext(source, context);
    context.render();
    return { page, qrBox, calls };
}

const base = {
    student: { name: 'Test Student', student_code: 'S1', photo: 'data:image/jpeg;base64,TEST' },
    bus_pass: { pass_number: 'BP-1', status: 'Active', effective_status: 'Active', is_valid: true,
        valid_from: '2026-01-01', valid_until: '2027-01-01' },
    transport: { bus: { bus_number: '05' }, route: { route_name: 'Route 5' } },
};
const settle = () => new Promise(resolve => setImmediate(resolve));

for (const [name, update, reason] of [
    ['inactive pass', { bus_pass: { ...base.bus_pass, effective_status: 'Suspended', is_valid: false } }, /suspended/i],
    ['missing photo', { student: { ...base.student, photo: null } }, /official photo/i],
    ['ambiguous route', { transport: { ...base.transport, route: null } }, /route and bus assignment/i],
]) {
    test(`${name} gives a useful reason without requesting a live token`, async () => {
        const ui = screen({ ...base, ...update });
        await settle();
        assert.deepEqual(ui.calls, ['/students/me/bus-pass']);
        assert.match(ui.qrBox.children[0].textContent, reason);
        ui.page.cleanup();
    });
}

test('eligible pass requests and displays the generated live QR', async () => {
    const ui = screen(base);
    await settle();
    assert.deepEqual(ui.calls, ['/students/me/bus-pass', '/students/me/bus-pass/live-token']);
    assert.match(ui.qrBox.innerHTML, /data:image\/png;base64,TEST/);
    ui.page.cleanup();
});
