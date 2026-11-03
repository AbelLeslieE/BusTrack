import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const login = read("frontend/login.html");
const signup = read("frontend/google-signup.html");
const signupScript = read("frontend/common/googleSignup.js");
const authScript = read("frontend/common/auth.js");

assert.match(login, /href="\/api\/auth\/google\/signup"/);
assert.match(login, /Sign up with Google/);
assert.match(login, /@sahrdaya\.ac\.in/);
assert.match(signup, /Create your login/);
assert.match(signup, /autocomplete="new-password"/);
assert.match(signupScript, /fetch\("\/api\/auth\/google\/pending"/);
assert.match(signupScript, /fetch\("\/api\/auth\/google\/complete"/);
assert.doesNotMatch(signupScript, /localStorage|sessionStorage/);
assert.match(authScript, /account_exists: "An account already exists for this Google email/);

console.log("Google student signup frontend tests passed.");
