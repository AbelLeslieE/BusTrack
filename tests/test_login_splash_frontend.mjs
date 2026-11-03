import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const login = read("frontend/login.html");
const splash = read("frontend/common/loginSplash.js");

assert.match(login, /loginSplash\.js\?v=20261103fullready1/);
assert.match(splash, /window\.addEventListener\("load", resolve/);
assert.match(splash, /document\.fonts\?\.ready/);
assert.match(splash, /Promise\.all\(\[stylesheetReady, backdropReady, pageReady, fontsReady\]\)/);
assert.match(splash, /requestAnimationFrame/);
assert.doesNotMatch(splash, /setTimeout\(releaseSplash/);

console.log("Complete login splash loading tests passed.");
