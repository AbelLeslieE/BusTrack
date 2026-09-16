import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const auth = read("frontend/common/auth.js");
const student = read("frontend/modules/js/studentTracking.js");
const admin = read("frontend/modules/js/adminTrackingService.js");
const driver = read("frontend/modules/js/trackingService.js");
const technician = read("frontend/modules/js/providerHealth.js");
const technicianDashboard = read("frontend/modules/js/technicianDashboard.js");
const activeUsers = read("frontend/modules/js/activeUsers.js");
const notifications = read("frontend/modules/js/notifications.js");
const history = read("frontend/modules/js/adminTripHistory.js");
const busPass = read("frontend/modules/js/busPass.js");
const vehicleMotion = read("frontend/common/vehicleMotion.js");

assert.match(auth, /SESSION_MONITOR_INTERVAL_MS\s*=\s*60\s*\*\s*60\s*\*\s*1000/);
assert.match(auth, /lastSessionCheckAt = Date\.now\(\)/);
assert.match(auth, /sessionCheckInFlight\s*\|\|\s*document\.hidden/);
assert.doesNotMatch(auth, /setInterval\(verify,\s*15_000\)/);

assert.match(student, /STUDENT_TRACKING_REFRESH_MS\s*=\s*5_000/);
assert.match(student, /if \(document\.hidden\) return/);
assert.match(student, /new window\.EventSource\(`\$\{API\.TRACKING\}\/stream`/);
assert.match(student, /startTrackingPollingFallback/);
assert.match(student, /ROAD_ROUTE_CACHE_TTL_MS\s*=\s*7\s*\*\s*24/);
assert.doesNotMatch(student, /\?overview=false/);
assert.doesNotMatch(student, /Read the saved position every two seconds/);
assert.match(vehicleMotion, /function knownRoutePath/);
assert.match(vehicleMotion, /motion\.routePath/);

assert.match(admin, /ADMIN_LIVE_REFRESH_MS\s*=\s*10_000/);
assert.match(admin, /ADMIN_BUS_CACHE_TTL_MS\s*=\s*5\s*\*\s*60\s*\*\s*1000/);
assert.match(admin, /document\.hidden \|\| session !== fleetSession/);
assert.match(admin, /new window\.EventSource\(/);
assert.match(admin, /\/api\/gps\/live\/stream/);
assert.match(admin, /startFleetPollingFallback/);

assert.match(driver, /DRIVER_SOURCE_REFRESH_MS\s*=\s*5_000/);
assert.match(driver, /SERVER_UPDATE_INTERVAL\s*=\s*5_000/);
assert.match(driver, /MOBILE_STATIONARY_HEARTBEAT_MS\s*=\s*30_000/);
assert.match(driver, /MOBILE_MIN_UPLOAD_MOVEMENT_METERS\s*=\s*10/);
assert.match(driver, /driver\/source\/stream/);
assert.match(driver, /startDriverSourcePollingFallback/);
assert.match(technician, /PROVIDER_HEALTH_REFRESH_MS\s*=\s*60_000/);
assert.match(technicianDashboard, /const allTokensRequest = request\("\/integrations\/gps\/tokens"\)/);
assert.match(technicianDashboard, /: allTokensRequest/);
assert.match(activeUsers, /ACTIVE_USERS_REFRESH_MS\s*=\s*60_000/);
assert.match(notifications, /NOTIFICATIONS_REFRESH_MS\s*=\s*60_000/);
assert.match(history, /HISTORY_REFRESH_INTERVAL_MS\s*=\s*60_000/);
assert.match(busPass, /let nextRefreshDelay = 60_000/);

console.log("Request optimization frontend policy tests passed.");
