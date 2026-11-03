const splash = document.querySelector("#login-splash");
const stylesheetUrl = "/static/common/login.css?v=20261103compact1";
const backdropUrl = "/static/assets/images/portal-background.png";

const stylesheet = document.createElement("link");
stylesheet.rel = "stylesheet";
stylesheet.href = stylesheetUrl;
const stylesheetReady = new Promise((resolve) => {
  stylesheet.addEventListener("load", resolve, { once: true });
  stylesheet.addEventListener("error", resolve, { once: true });
});
document.head.append(stylesheet);

const backdropReady = new Promise((resolve) => {
  const image = new Image();
  image.onload = resolve;
  image.onerror = resolve;
  image.src = backdropUrl;
  if (image.complete) resolve();
});

const pageReady = new Promise((resolve) => {
  if (document.readyState === "complete") {
    resolve();
    return;
  }
  window.addEventListener("load", resolve, { once: true });
});

const fontsReady = document.fonts?.ready?.catch(() => undefined) ?? Promise.resolve();

const nextPaint = () => new Promise((resolve) => {
  window.requestAnimationFrame(() => window.requestAnimationFrame(resolve));
});

const releaseSplash = () => {
  if (!splash) return;
  splash.classList.add("is-ready");
  window.setTimeout(() => splash.remove(), 300);
};

void Promise.all([stylesheetReady, backdropReady, pageReady, fontsReady])
  .then(nextPaint)
  .then(releaseSplash);
