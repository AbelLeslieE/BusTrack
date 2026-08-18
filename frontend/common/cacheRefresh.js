/**
 * Clear BusTrack's browser-side cache and reload the current page.
 *
 * Browsers do not expose a JavaScript API to erase their complete HTTP cache.
 * The Ctrl+Shift+R shortcut is already a native hard reload, so this handler
 * clears the storage APIs available to this origin before issuing a reload.
 */

let refreshInProgress = false;

async function clearBrowserSideData() {
    try { window.localStorage.clear(); } catch { /* Storage can be disabled by the browser. */ }
    try { window.sessionStorage.clear(); } catch { /* Storage can be disabled by the browser. */ }

    const tasks = [];
    if ("caches" in window) {
        tasks.push(
            window.caches.keys()
                .then(keys => Promise.all(keys.map(key => window.caches.delete(key))))
        );
    }
    if ("serviceWorker" in navigator) {
        tasks.push(
            navigator.serviceWorker.getRegistrations()
                .then(registrations => Promise.all(registrations.map(registration => registration.unregister())))
        );
    }
    await Promise.allSettled(tasks);
}

export function installHardRefreshShortcut() {
    if (window.__busTrackHardRefreshInstalled) return;
    window.__busTrackHardRefreshInstalled = true;

    window.addEventListener("keydown", async event => {
        const isRefreshShortcut = (event.ctrlKey || event.metaKey)
            && event.shiftKey
            && (event.key.toLowerCase() === "r" || event.code === "KeyR");
        if (!isRefreshShortcut) return;

        // Take ownership so the asynchronous Cache Storage cleanup completes
        // before navigation. This applies to Ctrl+Shift+R and Cmd+Shift+R.
        event.preventDefault();
        if (refreshInProgress) return;
        refreshInProgress = true;

        try {
            await clearBrowserSideData();
        } finally {
            // Reload causes the browser to validate static assets again; the
            // origin storage caches were already cleared above.
            window.location.reload();
        }
    }, { capture: true });
}
