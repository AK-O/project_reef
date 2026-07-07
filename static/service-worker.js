// ProjectReef service worker — v5
// Network-first for JS/CSS so code updates are always picked up.
// Cache-first only for images/icons.

const CACHE = "projectreef-v59";

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(["/", "/manifest.json", "/offline.html"])));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  // Delete ALL old caches (including projectreef-v1)
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const url = e.request.url;

  // SPA navigation — network-first so the latest index.html is always
  // picked up immediately (no stale shell on reload). Falls back to cache
  // only when offline. Also updates the cache so offline always has the
  // latest version.
  if (e.request.mode === "navigate") {
    e.respondWith(
      fetch("/")
        .then(resp => {
          const clone = resp.clone();
          caches.open(CACHE).then(c => c.put("/", clone));
          return resp;
        })
        .catch(async () => (await caches.match("/")) || caches.match("/offline.html"))
    );
    return;
  }

  // API calls — always network, never cache
  if (url.includes("/api/")) {
    e.respondWith(fetch(e.request));
    return;
  }

  // JS / CSS — network first so updates land immediately
  if (url.includes(".js") || url.includes(".css")) {
    e.respondWith(
      fetch(e.request)
        .then((resp) => {
          const clone = resp.clone();
          caches.open(CACHE).then((c) => c.put(e.request, clone));
          return resp;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // Everything else (images, HTML) — cache first
  e.respondWith(
    caches.match(e.request).then((cached) => cached || fetch(e.request))
  );
});
