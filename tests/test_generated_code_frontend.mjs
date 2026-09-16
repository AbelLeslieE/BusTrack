import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const routeForm = read("frontend/modules/js/routeForm.js");
const routes = read("frontend/modules/js/routes.js");
const busForm = read("frontend/modules/js/busForm.js");
const buses = read("frontend/modules/js/buses.js");
const userForm = read("frontend/modules/js/userForm.js");
const users = read("frontend/modules/js/users.js");
const driverForm = read("frontend/modules/js/driverForm.js");
const drivers = read("frontend/modules/js/drivers.js");

assert.match(routeForm, /id:\s*["']route_code["'][\s\S]*?readOnly:\s*true/);
assert.match(routes, /fetch\(`\$\{API\.ROUTES\}\/next-code`/);
assert.match(busForm, /id:\s*["']bus_number["'][\s\S]*?readOnly:\s*true/);
assert.match(buses, /fetch\(`\$\{API\.BUSES\}next-number`/);
assert.match(userForm, /fetch\(["']\/api\/users\/next-code["']/);
assert.match(userForm, /id:\s*["']driver_code["'][\s\S]*?readOnly:\s*true/);
assert.match(userForm, /id:\s*["']student_code["'][\s\S]*?readOnly:\s*true/);
assert.match(driverForm, /id:\s*["']driver_code["'][\s\S]*?readOnly:\s*true/);

const userSaveCatch = users.match(/async function saveUser[\s\S]*?catch \(error\) \{([\s\S]*?)\n\s*\}\n\s*\}/)?.[1] || "";
assert.match(userSaveCatch, /showUserFormError\(/);
assert.doesNotMatch(userSaveCatch, /Modal\.error\(/);

const driverSaveCatch = drivers.match(/async function saveDriver[\s\S]*?catch \(error\) \{([\s\S]*?)\n\s*\}\n\s*\}/)?.[1] || "";
assert.match(driverSaveCatch, /driver-save-error/);
assert.doesNotMatch(driverSaveCatch, /Modal\.error\(/);

console.log("Generated code frontend tests passed.");
