// Service worker — caches the app shell so BatCave opens without a network.
//
// Why this file exists: manifest.json plus the apple-mobile-web-app meta
// tags already made this installable to the home screen, but installable
// is not the same as offline. Without a service worker the home-screen
// icon opens a white page the moment the connection drops — which is
// exactly the moment a daily-habit app gets abandoned. It's also the
// prerequisite for ever doing web push (iOS only allows it for
// home-screen PWAs with a registered worker).
//
// Three rules, applied in order:
//   1. Anything that isn't a same-origin GET is none of this worker's
//      business. Supabase, Gemini, Finnhub, Twelve Data, Open Library,
//      rss2json and the Google Fonts stylesheet all fall through
//      untouched. A stale API response would be worse than a request
//      that simply fails, and an opaque cross-origin response can't be
//      inspected to know whether it succeeded anyway.
//   2. Navigations are network-first: online you always get the newest
//      index.html, so a deploy is picked up immediately; offline you get
//      the cached one.
//   3. Other same-origin assets are stale-while-revalidate: served
//      instantly from cache, refreshed in the background for next time.
//
// IMPORTANT: CACHE_VERSION must be bumped in the same commit as the
// `?v=` cache-bust strings in index.html. The two together are what
// guarantee a deploy is actually seen — bumping index.html's query
// strings alone would leave this worker serving the previous files for
// one extra load. Everything not matching the current CACHE_VERSION is
// deleted on activate, so old copies can't accumulate.

const CACHE_VERSION = "batcave-v20260923-1";

// Relative to this file, which sits next to index.html — so the same list
// works unchanged at the root of a local dev server and at
// /my-life-app/ on GitHub Pages. No absolute paths anywhere, for that
// reason.
const SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/brand-mark.png",
  "./apple-touch-icon.png",
  "./config.js",
  "./sync.js",
  "./script.js",
  "./news.js",
  "./goals.js",
  "./markets.js",
  "./fitness.js",
  "./food.js",
  "./water.js",
  "./blueprint.js",
  "./alfred.js",
  "./journal.js",
  "./reading.js",
  "./recovery.js",
  "./review.js",
  "./notes.js",
  "./quotes.js",
  "./overview.js",
  "./global-bar.js",
  "./mobile-nav.js",
  "./backup.js",
  "./offline.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_VERSION);
      await Promise.all(
        SHELL.map(async (url) => {
          try {
            // `cache: "reload"` so a new worker can't quietly re-adopt
            // whatever the HTTP cache is still holding — that's how you
            // ship a "new version" that is actually the old files.
            const res = await fetch(new Request(url, { cache: "reload" }));
            if (res.ok) await cache.put(url, res);
          } catch {
            // One unreachable file must not fail the whole install, which
            // would leave the app with no service worker at all.
            // config.js is the expected case: it's gitignored, so the
            // live GitHub Pages copy genuinely 404s on it.
          }
        })
      );
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((name) => name !== CACHE_VERSION).map((name) => caches.delete(name)));
      await self.clients.claim();
    })()
  );
});

// offline.js sends this only when the user taps "Reload" on the update
// pill — never on its own. A worker that calls skipWaiting() at install
// time swaps the code out from under a half-typed journal entry, and
// this repo has already paid for one class of self-reloading bug (see
// the reload-loop comment in sync.js's pullFromSupabase).
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // rule 1

  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req);
          const cache = await caches.open(CACHE_VERSION);
          cache.put("./index.html", fresh.clone());
          return fresh;
        } catch {
          const cached = await caches.match("./index.html", { ignoreSearch: true });
          return cached || Response.error();
        }
      })()
    );
    return;
  }

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_VERSION);
      // Exact match first; ignoreSearch only as a fallback. Every script
      // and style tag carries a ?v=… string the precache list above
      // doesn't have, so the fallback is what serves them on the very
      // first offline load — but once the real versioned URL has been
      // fetched and cached, the exact match wins, so an ignoreSearch hit
      // can never hand back a previous version's file.
      const cached = (await cache.match(req)) || (await cache.match(req, { ignoreSearch: true }));
      const network = fetch(req)
        .then((res) => {
          if (res.ok) cache.put(req, res.clone());
          return res;
        })
        .catch(() => null);
      return cached || (await network) || Response.error();
    })()
  );
});
