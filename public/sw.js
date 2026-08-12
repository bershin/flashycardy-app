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

// Bumped to v2 to drop entries written by the previous worker: it stored
// redirected responses, which cannot be replayed into a navigation.
const CACHE = "flashycardy-v2";
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

/**
 * Development builds serve assets under stable filenames, so caching them
 * first would pin the app to whatever was built when the worker installed —
 * every edit afterwards appears to have no effect. Production filenames are
 * content-hashed, so there the cache is safe and useful.
 */
const IS_DEV =
  self.location.hostname === "localhost" ||
  self.location.hostname === "127.0.0.1";

self.addEventListener("fetch", (event) => {
  const request = event.request;

  if (IS_DEV) return;

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
          // `no-cache` revalidates with the server rather than accepting the
          // browser's copy. The host serves this HTML with max-age=600, so
          // without it a deploy stayed invisible for ten minutes: the stale
          // page named the old chunks, and those were cached too. This is a
          // conditional request, so an unchanged page still costs almost
          // nothing.
          const response = await fetch(request, { cache: "no-cache" });

          // A redirected response cannot satisfy a navigation: the browser
          // refuses it and shows its own "this page couldn't load" instead of
          // the app. Pages redirects every extensionless path to its trailing
          // slash form — /deck?id=1 becomes /deck/?id=1 — so any link opened in
          // a new tab, bookmarked, or typed lands here. Copying the body into a
          // fresh response drops the redirect flag; the content is unchanged.
          const usable = response.redirected
            ? new Response(response.body, {
                status: response.status,
                statusText: response.statusText,
                headers: response.headers,
              })
            : response;

          const cache = await caches.open(CACHE);
          cache.put(request, usable.clone());
          return usable;
        } catch {
          // `ignoreSearch` because the query is the app's own routing: every
          // deck lives at /deck/ and differs only by ?id=. Matching on the full
          // URL would mean an offline visit to a deck other than the last one
          // cached found nothing and failed outright.
          return (
            (await caches.match(request, { ignoreSearch: true })) ??
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
