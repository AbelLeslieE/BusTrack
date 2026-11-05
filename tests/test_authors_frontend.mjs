import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { Script } from "node:vm";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const page = read("frontend/authors.html");
const styles = page.match(/<style>([\s\S]*?)<\/style>/)?.[1];
const script = page.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(styles && script, "The page must carry its own styles and JavaScript");
new Script(script, { filename: "authors.html" });
// Every rendered image is embedded, so moving the HTML alone preserves the page.
assert.doesNotMatch(page, /<script[^>]+src=|<link[^>]+(?:stylesheet|preload)/i);
assert.doesNotMatch(styles, /@import|url\((?!["']?data:|["']?#)/i);
const imageSources = [...page.matchAll(/<(?:img|image)\b[^>]*\b(?:src|href)="([^"]+)"/g)].map(match => match[1]);
assert.equal(imageSources.length, 4);
for (const source of imageSources) {
  assert.match(source, /^data:image\/(?:png|jpeg);base64,/);
  const decoded = Buffer.from(source.split(",")[1], "base64");
  assert.ok(decoded.length > 100, "Embedded image must not be empty");
  if (source.startsWith("data:image/png")) assert.equal(decoded.subarray(1, 4).toString(), "PNG");
  else assert.equal(decoded.subarray(0, 2).toString("hex"), "ffd8");
}
const embeddedHero = page.match(/<img src="(data:image\/png;base64,[^"]+)" alt="Sahrdaya College campus with a college bus">/)?.[1];
assert.ok(embeddedHero, "The edited campus-bus hero must be embedded in the standalone page");
assert.deepEqual(
  Buffer.from(embeddedHero.split(",")[1], "base64"),
  readFileSync(new URL("../frontend/assets/images/authors-campus-bus-kl03aa2007.png", import.meta.url)),
);
const embeddedAbel = page.match(/<img class="authors-portrait-photo" src="(data:image\/png;base64,[^"]+)" alt="Portrait of Abel Leslie E">/)?.[1];
const embeddedAgna = page.match(/<img class="authors-portrait-photo" src="(data:image\/jpeg;base64,[^"]+)" alt="Portrait of Agna Rose Johnson">/)?.[1];
assert.ok(embeddedAbel && embeddedAgna, "Both supplied author portraits must be embedded");
assert.deepEqual(
  Buffer.from(embeddedAbel.split(",")[1], "base64"),
  readFileSync(new URL("../frontend/assets/images/author-abel-leslie.png", import.meta.url)),
);
assert.deepEqual(
  Buffer.from(embeddedAgna.split(",")[1], "base64"),
  readFileSync(new URL("../frontend/assets/images/author-agna-rose.jpg", import.meta.url)),
);
const login = read("frontend/login.html");
const backend = read("backend/main.py");
const security = read("backend/security.py");
const studentSidebar = read("frontend/modules/js/studentSidebar.js");
const scriptHash = createHash("sha256").update(script, "utf8").digest("base64");

assert.match(page, /The people behind/);
assert.match(page, /Abel Leslie E/);
assert.match(page, /Agna Rose Johnson/);
assert.doesNotMatch(page, /<strong>(?:AL|AR)<\/strong>/);
assert.match(page, /College bus registration KL 03 AA 2007/);
assert.match(page, /<strong>KL 03 AA 2007<\/strong>/);
assert.match(page, /data-tilt/);
assert.match(page, /id="features"/);
assert.match(page, /id="creators"/);
assert.match(page, /id="journey"/);
assert.match(styles, /@media \(max-width: 700px\)/);
assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
assert.match(page, /class="authors-no-js authors-full-motion"/);
assert.match(script, /bustrack-authors-motion-v2/);
assert.match(styles, /authors-route-flow/);
assert.match(styles, /\.authors-campus-frame > img[\s\S]*?object-position: center/);
assert.match(script, /IntersectionObserver/);
assert.match(page, /<body id="top" class="authors-intro-pending">/);
assert.match(page, /<dialog class="film" id="opening-film" open/);
assert.doesNotMatch(styles, /body\.authors-intro-pending \.film \*/);
assert.match(styles, /\.film:not\(\[data-phase="reveal"\]\) \.signal-id \{ visibility: hidden; opacity: 0; \}/);
assert.match(script, /startPageReveals/);
assert.match(script, /--section-scroll/);
assert.match(script, /pointermove/);
assert.match(script, /dataTiltStrength|dataset\.tiltStrength/);
assert.match(login, /href="\/authors"/);
assert.match(studentSidebar, /href="\/authors"/);
assert.match(studentSidebar, /Meet the creators/);
assert.match(backend, /@app\.get\("\/authors"/);
assert.ok(
  security.includes(`'sha256-${scriptHash}'`),
  "The Cloud Run CSP must authorize the exact embedded animation script",
);

console.log("Standalone author page, embedded assets, and JavaScript checks passed.");
