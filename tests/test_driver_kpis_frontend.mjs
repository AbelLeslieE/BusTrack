import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
    new URL("../frontend/modules/js/drivers.js", import.meta.url),
    "utf8",
);

const calculation = source.match(
    /function calculateStatistics\(\) \{([\s\S]*?)\n\}/,
)?.[1] || "";

assert.match(source, /fetch\(API\.DRIVERS, \{ cache: "no-store" \}\)/);
assert.match(calculation, /driver\.is_assigned === true/);
assert.match(calculation, /driver\.status === DRIVER_STATUS\.AVAILABLE[\s\S]*?!isAssigned\(driver\)/);
assert.match(calculation, /state\.statistics\.onDuty[\s\S]*?filter\([\s\S]*?isAssigned/);
assert.match(calculation, /today\.setHours\(0, 0, 0, 0\)/);
assert.match(calculation, /new Date\([\s\S]*?dateParts\[0\][\s\S]*?dateParts\[1\] - 1[\s\S]*?dateParts\[2\]/);

console.log("Driver KPI frontend tests passed.");
