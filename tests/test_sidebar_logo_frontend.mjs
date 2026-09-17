import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const asset = "/static/assets/images/logo.png?v=20260917c";

for (const path of [
    "frontend/common/sidebar.js",
    "frontend/modules/js/driverSidebar.js",
    "frontend/modules/js/studentSidebar.js",
    "frontend/modules/js/technicianSidebar.js",
]) {
    assert.match(read(path), new RegExp(asset.replace(/[.?]/g, "\\$&")), `${path} must use the current logo asset`);
}

const css = read("frontend/common/sidebar.css");
assert.match(css, new RegExp(asset.replace(/[.?]/g, "\\$&")), "sidebar CSS must provide a logo fallback for cached markup");
assert.match(css, /\.brand-mark\s*\{[\s\S]*?font-size:\s*0\s*;/, "the legacy emoji must be hidden");

const dashboard = read("frontend/dashboard.html");
assert.match(dashboard, /sidebar\.css\?v=20260917c/, "dashboard must cache-bust the sidebar stylesheet");

console.log("Sidebar logo frontend checks passed.");
