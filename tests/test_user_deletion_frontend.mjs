import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const users = read('frontend/modules/js/users.js');
const form = read('frontend/modules/js/userForm.js');
const modal = read('frontend/common/modal.js');
const router = read('frontend/common/router.js');

assert.match(users, /let deletionPending = false/);
assert.match(users, /if \(deletionPending\) return/);
assert.match(users, /linked active records were deleted successfully/);
assert.match(users, /Historical audit records remain detached/);
assert.doesNotMatch(users, /console\.log/);
assert.doesNotMatch(form, /console\.log/);
assert.match(modal, /button\.dataset\.busy === "true"/);
assert.match(modal, /actionButtons\.forEach/);
assert.match(router, /users\.js\?v=20261106delete1/);

console.log('Reliable user deletion frontend checks passed.');
