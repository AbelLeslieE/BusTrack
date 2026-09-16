import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const auth = read("frontend/common/auth.js");
const browserTrackingModules = [
    "frontend/modules/js/trackingService.js",
    "frontend/modules/js/studentTracking.js",
    "frontend/modules/js/adminTrackingService.js",
].map(read).join("\n");

assert.doesNotMatch(auth, /localStorage\.setItem\(\s*(?:TOKEN_KEY|LEGACY_TOKEN_KEY)/);
assert.match(auth, /localStorage\.removeItem\(LEGACY_TOKEN_KEY\)/);
assert.match(auth, /credentials:\s*options\.credentials\s*\|\|\s*["']same-origin["']/);
assert.match(auth, /fetch\(["']\/api\/auth\/me["'],\s*\{\s*credentials:\s*["']same-origin["']/);
assert.doesNotMatch(auth, /Authorization/);

assert.doesNotMatch(browserTrackingModules, /bus_tracker_access_token/);
assert.doesNotMatch(browserTrackingModules, /["']Authorization["']\s*:/);
assert.match(browserTrackingModules, /credentials:\s*["']same-origin["']/);

console.log("Cookie-only browser authentication tests passed.");
