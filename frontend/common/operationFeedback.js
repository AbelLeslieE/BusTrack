/* ===========================================================================
   BUSTRACK — SHARED CRUD FEEDBACK
   Keeps destructive confirmations and status messages independent of the
   page/modal currently being edited, so a failed action never disappears into
   the browser console.
============================================================================ */

let feedbackHost;

function getFeedbackHost() {
    if (feedbackHost?.isConnected) return feedbackHost;

    feedbackHost = document.createElement("div");
    feedbackHost.className = "operation-feedback-host";
    feedbackHost.setAttribute("aria-live", "polite");
    feedbackHost.setAttribute("aria-atomic", "true");
    document.body.append(feedbackHost);
    return feedbackHost;
}

function formatMessage(message, fallback) {
    if (Array.isArray(message)) {
        return message
            .map(item => item?.msg || item?.message || String(item))
            .join(" ");
    }

    return String(message || fallback);
}

/** Show a non-blocking, accessible result for save/edit/delete operations. */
export function showOperationFeedback({
    type = "info",
    title,
    message,
    duration = 5500
} = {}) {
    const notice = document.createElement("section");
    notice.className = `operation-notice operation-notice-${type}`;
    notice.setAttribute("role", type === "error" ? "alert" : "status");

    const heading = document.createElement("strong");
    heading.textContent = title || (type === "success" ? "Saved" : "Update");

    const detail = document.createElement("p");
    detail.textContent = formatMessage(message, "Please try again.");

    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "operation-notice-close";
    closeButton.setAttribute("aria-label", "Dismiss message");
    closeButton.textContent = "×";

    const close = () => {
        notice.classList.remove("is-visible");
        window.setTimeout(() => notice.remove(), 180);
    };

    closeButton.addEventListener("click", close);
    notice.append(heading, detail, closeButton);
    getFeedbackHost().append(notice);
    requestAnimationFrame(() => notice.classList.add("is-visible"));

    if (duration > 0) window.setTimeout(close, duration);
    return close;
}

/**
 * Ask for a destructive-action confirmation without replacing an open form.
 * Returns true only after the user explicitly confirms.
 */
export function confirmDeletion({
    title = "Delete item?",
    message = "This action cannot be undone.",
    confirmText = "Delete"
} = {}) {
    return new Promise(resolve => {
        const overlay = document.createElement("div");
        overlay.className = "operation-confirm-overlay";
        overlay.innerHTML = `
            <section class="operation-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="operation-confirm-title">
                <p class="operation-confirm-eyebrow">Confirmation required</p>
                <h2 id="operation-confirm-title"></h2>
                <p class="operation-confirm-message"></p>
                <div class="operation-confirm-actions">
                    <button type="button" class="operation-confirm-cancel">Cancel</button>
                    <button type="button" class="operation-confirm-delete"></button>
                </div>
            </section>`;

        overlay.querySelector("#operation-confirm-title").textContent = title;
        overlay.querySelector(".operation-confirm-message").textContent = formatMessage(message, "This action cannot be undone.");
        const cancelButton = overlay.querySelector(".operation-confirm-cancel");
        const deleteButton = overlay.querySelector(".operation-confirm-delete");
        deleteButton.textContent = confirmText;

        let settled = false;
        const finish = value => {
            if (settled) return;
            settled = true;
            document.removeEventListener("keydown", onKeyDown);
            overlay.classList.remove("is-visible");
            window.setTimeout(() => overlay.remove(), 180);
            resolve(value);
        };
        const onKeyDown = event => {
            if (event.key === "Escape") finish(false);
        };

        cancelButton.addEventListener("click", () => finish(false));
        deleteButton.addEventListener("click", () => finish(true));
        overlay.addEventListener("click", event => {
            if (event.target === overlay) finish(false);
        });
        document.addEventListener("keydown", onKeyDown);
        document.body.append(overlay);
        requestAnimationFrame(() => {
            overlay.classList.add("is-visible");
            deleteButton.focus();
        });
    });
}
