import QrScanner from "/static/vendor/qr-scanner/qr-scanner.min.js";
import { request } from "/static/common/api.js";
import { escapeHtml } from "/static/common/security.js";
import { createPassScannerSession } from "/static/common/passScannerSession.js";

export function render() {
    const page = document.createElement("section");
    page.className = "verify-pass-page portal-page";
    page.innerHTML = `<header class="portal-header"><p class="portal-eyebrow">DRIVER PORTAL</p><h1>Verify Bus Pass</h1>
        <p>Scan the student's live QR, then compare the official photo with the person boarding.</p></header>
        <section class="portal-card pass-scanner"><video muted playsinline aria-label="QR camera preview"></video>
        <p class="scanner-message" role="status">Your active trip determines the bus and route. Camera access requires HTTPS or localhost.</p>
        <button type="button" class="scanner-start">Start scanner</button></section>
        <section class="pass-scan-result" aria-live="polite" hidden></section>
        <button type="button" class="scanner-next" hidden>Scan next pass</button>`;
    const video = page.querySelector("video");
    const startButton = page.querySelector(".scanner-start");
    const nextButton = page.querySelector(".scanner-next");
    const resultBox = page.querySelector(".pass-scan-result");
    const message = page.querySelector(".scanner-message");
    let disposed = false;
    let scanning = false;
    let starting = false;
    const session = createPassScannerSession((signedToken, signal) => request("/driver/bus-pass/verify", {
        method: "POST", body: JSON.stringify({ signedToken }), signal, cache: "no-store"
    }), result => {
        if (disposed) return;
        resultBox.hidden = false;
        resultBox.className = `pass-scan-result ${result.valid ? "is-valid" : "is-invalid"}`;
        const owner = result.student;
        resultBox.innerHTML = `<h2>${result.valid ? "✓ VALID BUS PASS" : "✕ " + escapeHtml(result.status.replaceAll("_", " "))}</h2>
            <p>${escapeHtml(result.message)}</p>${result.valid ? `
            <img class="official-pass-photo" src="${escapeHtml(owner.photo)}" alt="Official photo of ${escapeHtml(owner.name)}">
            <h3>${escapeHtml(owner.name)}</h3><p>${escapeHtml(owner.studentId)} · ${escapeHtml(owner.department)}</p>
            <p>Bus ${escapeHtml(result.bus_pass.busNumber)} · ${escapeHtml(result.bus_pass.routeName)}</p>
            <p>${result.trip.direction === "reverse" ? "Return" : "Outbound"} · Valid until ${escapeHtml(result.bus_pass.validUntil)}</p>
            <strong>Confirm the person matches this photo before boarding.</strong>
            <p>Verified at ${escapeHtml(new Date(result.verifiedAt).toLocaleTimeString())}</p>` : ""}
            ${result.assignedBus ? `<p>Assigned bus: ${escapeHtml(result.assignedBus)} · Current bus: ${escapeHtml(result.currentBus)}</p>` : ""}`;
        message.textContent = "Scan complete.";
        nextButton.hidden = false;
    });
    const scanner = new QrScanner(video, result => {
        if (!scanning || disposed) return;
        scanning = false;
        scanner.stop();
        message.textContent = "Authenticating with the server…";
        void session.scan(result.data);
    }, { preferredCamera: "environment", maxScansPerSecond: 5, returnDetailedScanResult: true });

    const start = async () => {
        if (disposed || starting) return;
        session.next();
        resultBox.hidden = true;
        resultBox.replaceChildren();
        nextButton.hidden = true;
        startButton.hidden = true;
        starting = true;
        try {
            if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
                throw new Error("Camera scanning is unavailable. Open BusTrack over HTTPS in a camera-capable browser.");
            }
            await scanner.start();
            if (disposed || document.hidden) { scanner.stop(); return; }
            scanning = true;
            message.textContent = "Place the student's live QR inside the camera view.";
        } catch (error) {
            if (!disposed) {
                message.textContent = "Cannot start camera. Allow camera permission, check that a camera is connected and not in use, then retry. " + String(error.message || error);
                startButton.hidden = false;
            }
        } finally { starting = false; }
    };
    startButton.addEventListener("click", () => void start());
    nextButton.addEventListener("click", () => void start());
    const hide = () => {
        if (!document.hidden) return;
        scanning = false;
        scanner.stop(); session.close();
        resultBox.hidden = true; resultBox.replaceChildren();
        nextButton.hidden = true; startButton.hidden = false;
        message.textContent = "Scanner paused. Start scanning again when ready.";
    };
    document.addEventListener("visibilitychange", hide);
    page.cleanup = () => {
        disposed = true; scanning = false;
        session.close(); scanner.destroy();
        document.removeEventListener("visibilitychange", hide);
    };
    return page;
}
