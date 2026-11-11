/* ClinixStudy service worker (v3.37) — "always the newest version, still opens offline".
   Network first for the app's own files: every push to GitHub is what you see the next time you open the app (no reinstall, no update prompt).
   When there is no network the last copy that was loaded is used. Calls to Google / other APIs (other origins) are never touched. */
const CACHE = "clinix-shell-v1";
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(
  caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
));
self.addEventListener("fetch", (e) => {
  const r = e.request;
  if (r.method !== "GET" || new URL(r.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(r, { cache: "no-cache" })
      .then((res) => { if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(r, copy)).catch(() => {}); } return res; })
      .catch(() => caches.match(r).then((hit) => hit || caches.match("./index.html")))
  );
});
