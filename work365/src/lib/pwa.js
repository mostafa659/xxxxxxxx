/* v3.37 · the web build (GitHub Pages) is installable and always opens the newest version: see public/sw.js.
   Not registered inside the APK shell of the app (https://localhost), the desktop app (file://) or the dev server. */
export function registerPWA() {
  try {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    const { protocol, hostname } = window.location;
    if (!/^https?:$/.test(protocol) || /^(localhost|127\.|\[::1\])/.test(hostname)) return;
    window.addEventListener("load", () => { navigator.serviceWorker.register("./sw.js").catch(() => { /* optional */ }); });
  } catch (e) { /* optional */ }
}
