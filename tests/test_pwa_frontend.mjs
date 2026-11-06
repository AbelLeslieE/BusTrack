import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const manifest = JSON.parse(read('frontend/manifest.webmanifest'));
const worker = read('frontend/service-worker.js');
const pwa = read('frontend/common/pwa.js');
const cacheRefresh = read('frontend/common/cacheRefresh.js');
const tracer = read('frontend/modules/js/routeStudio.js');

assert.equal(manifest.start_url, '/');
assert.equal(manifest.scope, '/');
assert.equal(manifest.display, 'standalone');
assert.ok(manifest.icons.some(icon => icon.sizes === '192x192'));
assert.ok(manifest.icons.some(icon => icon.sizes === '512x512' && icon.purpose === 'maskable'));

for (const page of ['login.html', 'dashboard.html', 'google-signup.html', 'authors.html']) {
    const source = read(`frontend/${page}`);
    assert.match(source, /rel="manifest" href="\/manifest\.webmanifest"/);
    assert.match(source, /apple-touch-icon/);
    assert.match(source, /name="theme-color"/);
    if (page === 'authors.html') assert.match(source, /serviceWorker\.register\("\/service-worker\.js"/);
    else assert.match(source, /pwa\.js\?v=20261106pwa1/);
}

assert.match(pwa, /serviceWorker\.register\("\/service-worker\.js"/);
assert.match(pwa, /beforeinstallprompt/);
assert.match(worker, /request\.method !== "GET"/);
assert.match(worker, /pathname\.startsWith\("\/api\/"\)/);
assert.match(worker, /request\.mode === "navigate"/);
assert.match(worker, /return await fetch\(request\)/);
assert.doesNotMatch(worker, /cache\.put\(request[\s\S]{0,200}request\.mode === "navigate"/);
assert.doesNotMatch(cacheRefresh, /registration\.unregister/);

assert.match(tracer, /navigator\.wakeLock\.request\("screen"\)/);
assert.match(tracer, /wakeLock\.release\(\)/);

console.log('PWA install, cache safety, and tracer Wake Lock checks passed.');
