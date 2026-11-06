const standalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
let installPrompt = null;

function announceNetwork(message) {
    let banner = document.querySelector(".pwa-network-status");
    if (!banner) {
        banner = document.createElement("div");
        banner.className = "pwa-network-status";
        banner.setAttribute("role", "status");
        document.body.append(banner);
    }
    banner.textContent = message;
    clearTimeout(announceNetwork.timer);
    if (navigator.onLine) announceNetwork.timer = setTimeout(() => banner.remove(), 3200);
}

function ensureInstallButton() {
    if (standalone || document.querySelector(".pwa-install-button")) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "pwa-install-button";
    button.hidden = !installPrompt;
    button.textContent = "＋ Install BusTrack";
    button.addEventListener("click", async () => {
        if (!installPrompt) return;
        button.hidden = true;
        installPrompt.prompt();
        await installPrompt.userChoice;
        installPrompt = null;
    });
    document.body.append(button);
}

window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    installPrompt = event;
    ensureInstallButton();
    document.querySelector(".pwa-install-button")?.removeAttribute("hidden");
});

window.addEventListener("appinstalled", () => {
    installPrompt = null;
    document.querySelector(".pwa-install-button")?.remove();
});

window.addEventListener("offline", () => announceNetwork("BusTrack is offline · saved tracer samples remain on this phone"));
window.addEventListener("online", () => announceNetwork("Connection restored · BusTrack is online"));

if ("serviceWorker" in navigator && window.isSecureContext) {
    window.addEventListener("load", () => {
        navigator.serviceWorker.register("/service-worker.js", {scope: "/", updateViaCache: "none"})
            .then(registration => registration.update())
            .catch(error => console.warn("BusTrack offline support could not start:", error));
    }, {once: true});
}

ensureInstallButton();
