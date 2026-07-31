/**
 * Offline support.
 *
 * All the data already lives in IndexedDB, so the only thing standing between
 * the app and working offline is fetching the shell. This caches responses as
 * they are requested and serves them back when the network is unavailable.
 *
 * `BASE_PATH` is derived from the worker's own location: on GitHub Pages the
 * app is served from /<repo>/, and hardcoding "/" would break every path.
 */

const CACHE = "flashycardy-v1";
const BASE_PATH = new URL(self.registration.scope).pathname.replace(/\/$/, "");

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Drop caches from previous versions so an old shell can't linger.
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;

  // Only GETs are cacheable, and only our own origin. In particular this must
  // never touch api.github.com or api.openai.com — a stale sync response would
  // be far worse than a failed one.
  if (request.method !== "GET") return;
  if (new URL(request.url).origin !== self.location.origin) return;

  // Navigations: try the network, fall back to whatever shell we have. Static
  // export means any cached page can bootstrap the app, since routing and data
  // are entirely client-side.
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          const cache = await caches.open(CACHE);
          cache.put(request, response.clone());
          return response;
        } catch {
          return (
            (await caches.match(request)) ??
            (await caches.match(`${BASE_PATH}/dashboard/`)) ??
            (await caches.match(`${BASE_PATH}/`)) ??
            Response.error()
          );
        }
      })(),
    );
    return;
  }

  // Assets: serve from cache when present, and refresh in the background.
  event.respondWith(
    (async () => {
      const cached = await caches.match(request);
      const network = fetch(request)
        .then(async (response) => {
          if (response.ok) {
            const cache = await caches.open(CACHE);
            cache.put(request, response.clone());
          }
          return response;
        })
        .catch(() => cached ?? Response.error());
      return cached ?? network;
    })(),
  );
});

self.addEventListener("push", (event) => {
  if (event.data) {
    const data = event.data.json();
    const options = {
      body: data.body,
      icon: data.icon || `${BASE_PATH}/icon-192x192.png`,
      badge: `${BASE_PATH}/icon-192x192.png`,
      vibrate: [100, 50, 100],
    };
    event.waitUntil(self.registration.showNotification(data.title, options));
  }
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow(`${BASE_PATH}/dashboard/`));
});
