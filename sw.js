/* Offline Foundry service worker: precache the app shell, serve cache-first
   within scope, and let cached portraits answer when offline. Payload fetches
   (.json links) always go to the network; syncing is an online act. */
const VERSION = "0.1.7";
const SHELL_CACHE = `of-shell-${VERSION}`;
const PORTRAITS = "of-portraits";
const SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./css/app.css",
  "./js/app.js",
  "./js/db.js",
  "./js/scanner.js",
  "./js/sheet.js",
  "./js/sync.js",
  "./js/lib/jsQR.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(SHELL_CACHE).then(cache => cache.addAll(SHELL)));
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith("of-shell-") && key !== SHELL_CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener("message", event => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  if (new URL(request.url).pathname.endsWith(".json") && !request.url.includes("manifest")) return;
  event.respondWith((async () => {
    const cached = await caches.match(request, { ignoreSearch: false });
    if (cached) return cached;
    try {
      return await fetch(request);
    } catch (err) {
      const portrait = await caches.match(request.url, { cacheName: PORTRAITS });
      if (portrait) return portrait;
      throw err;
    }
  })());
});
