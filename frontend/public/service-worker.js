/* Valuation Studio — PWA service worker.
   Network-first so content stays fresh (dev + prod); cache is an offline / cold-start
   fallback only. Never caches error responses (e.g. Cloudflare 5xx while the origin is
   waking up) so a cold-start error page can't get "stuck" in the cache. */
const CACHE = "vs-cache-v2";
const CORE = ["/", "/index.html", "/manifest.json", "/icon-192.png", "/icon-512.png", "/apple-touch-icon.png"];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE).catch(() => {})));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Only genuine, same-origin, successful responses are cacheable.
function isCacheable(res) {
  return res && res.ok && res.status === 200 && (res.type === "basic" || res.type === "default");
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // only same-origin
  if (url.pathname.startsWith("/api")) return;        // never touch the API

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (isCacheable(res)) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        }
        // Bad response (e.g. Cloudflare 5xx during cold start): don't cache it. For a
        // navigation, prefer the last good cached shell so the app still boots and its
        // own "waking up" retry screen can take over.
        if (req.mode === "navigate") {
          return caches.match("/index.html").then((cached) => cached || res);
        }
        return res;
      })
      .catch(() =>
        caches.match(req).then((r) => r || (req.mode === "navigate" ? caches.match("/index.html") : undefined))
      )
  );
});
