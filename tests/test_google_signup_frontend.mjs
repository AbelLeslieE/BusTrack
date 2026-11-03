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
assert.match(signup, /Complete your student account/);
assert.match(signup, /Account role[\s\S]*Student/);
assert.match(signup, /autocomplete="new-password"/);
assert.match(signup, /id="signup-route"[\s\S]*required/);
assert.match(signup, /id="google-signup-form" hidden novalidate/);
assert.match(signup, /one-time choice/);
assert.match(signup, /googleSignup\.js\?v=20261103errors1/);
assert.match(signup, /Spaces are not allowed/);
assert.match(signupScript, /fetch\("\/api\/auth\/google\/pending"/);
assert.match(signupScript, /fetch\("\/api\/auth\/google\/complete"/);
assert.match(signupScript, /route_id: Number\(routeSelect\.value\)/);
assert.match(signupScript, /route\.bus_number/);
assert.match(signupScript, /Username can only use letters, numbers, dots, dashes, and underscores\. Spaces are not allowed\./);
assert.match(signupScript, /Please choose your bus route before creating the account\./);
assert.match(signupScript, /Password needs at least one uppercase letter\./);
assert.doesNotMatch(signupScript, /String should match pattern/);
assert.doesNotMatch(signupScript, /localStorage|sessionStorage/);
assert.match(authScript, /account_exists: "An account already exists for this Google email/);

console.log("Google student signup frontend tests passed.");
