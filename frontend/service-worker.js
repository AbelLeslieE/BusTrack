const RELEASE = "20261106-pwa1";
const SHELL_CACHE = `bustrack-shell-${RELEASE}`;
const ASSET_CACHE = `bustrack-assets-${RELEASE}`;
const OWNED_CACHE_PREFIX = "bustrack-";

const APP_SHELL = [
    "/offline.html",
    "/manifest.webmanifest",
    "/static/common/pwa.css?v=20261106pwa1",
    "/static/assets/images/pwa-icon-192.png",
    "/static/assets/images/pwa-icon-512.png",
    "/static/assets/images/pwa-icon-maskable-512.png",
];

self.addEventListener("install", event => {
    event.waitUntil(
        caches.open(SHELL_CACHE)
            .then(cache => cache.addAll(APP_SHELL))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener("activate", event => {
    event.waitUntil((async () => {
        const keys = await caches.keys();
        await Promise.all(keys
            .filter(key => key.startsWith(OWNED_CACHE_PREFIX) && ![SHELL_CACHE, ASSET_CACHE].includes(key))
            .map(key => caches.delete(key)));
        await self.clients.claim();
    })());
});

function isPrivateOrDynamic(pathname) {
    return pathname.startsWith("/api/")
        || pathname === "/health"
        || pathname === "/ready"
        || pathname === "/service-worker.js";
}

async function networkFirstNavigation(request) {
    try {
        // HTML is intentionally never written to Cache Storage. Login state,
        // role redirects, and startup behavior must always come from BusTrack.
        return await fetch(request);
    } catch {
        return (await caches.match("/offline.html")) || Response.error();
    }
}

async function staleWhileRevalidateStatic(request) {
    const cache = await caches.open(ASSET_CACHE);
    const cached = await cache.match(request);
    const network = fetch(request).then(response => {
        if (response.ok && response.type === "basic") void cache.put(request, response.clone());
        return response;
    }).catch(() => null);
    return cached || (await network) || Response.error();
}

self.addEventListener("fetch", event => {
    const request = event.request;
    if (request.method !== "GET") return;

    const url = new URL(request.url);
    if (url.origin !== self.location.origin || isPrivateOrDynamic(url.pathname)) return;

    if (request.mode === "navigate") {
        event.respondWith(networkFirstNavigation(request));
        return;
    }

    if (url.pathname.startsWith("/static/") || url.pathname === "/manifest.webmanifest") {
        event.respondWith(staleWhileRevalidateStatic(request));
    }
});
