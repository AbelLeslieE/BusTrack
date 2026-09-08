// One scan per result. Only the authenticated backend can produce a VALID result.
export function createPassScannerSession(send, onResult, timeoutMs = 10000) {
    let generation = 0;
    let ready = true;
    let controller;
    return {
        async scan(signedToken) {
            if (!ready) return false;
            ready = false;
            const current = generation;
            const requestController = new AbortController();
            controller = requestController;
            const timer = setTimeout(() => requestController.abort(), timeoutMs);
            try {
                const result = await send(signedToken, requestController.signal);
                if (current !== generation) return false;
                if (typeof result?.valid !== "boolean" || (result.valid && (result.status !== "VALID" || !result.student?.photo))) {
                    throw new Error("Unable to authenticate this pass. Try again.");
                }
                onResult(result);
            } catch (error) {
                if (current !== generation) return false;
                onResult({ valid: false, status: "UNABLE_TO_AUTHENTICATE",
                    message: "Connection required. The pass has not been authenticated. " + (error.name === "AbortError" ? "The server did not respond in time." : error.message) });
            } finally {
                clearTimeout(timer);
            }
            return true;
        },
        next() { generation++; controller?.abort(); ready = true; },
        close() { generation++; controller?.abort(); ready = false; }
    };
}
