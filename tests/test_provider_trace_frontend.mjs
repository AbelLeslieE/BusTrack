import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const page = readFileSync(new URL('../frontend/modules/js/traceAssignment.js', import.meta.url), 'utf8');
const sidebar = readFileSync(new URL('../frontend/modules/js/technicianSidebar.js', import.meta.url), 'utf8');

assert.match(page, /\/provider-capture/);
assert.match(page, /morning_enabled/);
assert.match(page, /evening_enabled/);
assert.match(page, /07:00–09:15/);
assert.match(page, /16:15–19:15/);
assert.match(page, /live tracking continues normally/i);
assert.match(sidebar, /Route capture/);
assert.match(sidebar, /Traced paths/);
console.log('Provider GPS route-capture controls are present.');
