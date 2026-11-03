import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const dashboard = read("frontend/dashboard.html");
const glass = read("frontend/modules/css/fleetGlass.css");

assert.match(dashboard, /fleetGlass\.css\?v=20261103fleetglass4/);

for (const selector of [
  ".bus-passes-page .glass-card",
  ".users-page .glass-card",
  ".active-users-page .glass-card",
  ".notifications-page .glass-card",
  ".settings-page .glass-card",
  ".profile-page .glass-card",
  ".student-theme .portal-page .portal-header",
  ".student-theme .portal-page .portal-card",
  ".student-theme .account-settings-page .portal-form input",
  ".bus-pass-page .portal-header",
  ".bus-pass-page .portal-card",
  ".bus-pass-page .digital-bus-pass",
]) {
  assert.ok(glass.includes(selector), `Missing shared glass selector: ${selector}`);
}

assert.match(glass, /rgba\(131, 185, 225, \.28\)/);
assert.match(glass, /backdrop-filter: blur\(24px\) saturate\(145%\)/);

console.log("Shared fleet glass frontend tests passed.");
