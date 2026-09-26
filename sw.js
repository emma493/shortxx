/* Shortxx service worker — app-shell caching only.
 * Video streams (HLS/mp4), Firestore traffic, analytics and ad networks
 * always go straight to the network so playback and data stay fresh. */
const CACHE = "shortxx-v2";
const SHELL = [
  "/",
  "/index.html",
  "/vid2.html",
  "/ntok.css",
  "/css/base.css",
  "/css/effects.css",
  "/css/features/auth.css",
  "/css/features/menu.css",
  "/css/features/comments.css",
  "/css/features/discover.css",
  "/css/features/feed.css",
  "/css/features/trending.css",
  "/css/features/player.css",
  "/css/features/creator-page.css",
  "/css/features/pwa.css",
  "/js/main.js",
  "/js/store.js",
  "/js/lib/dom.js",
  "/js/features/player.js",
  "/js/features/creator.js",
  "/js/features/creator-page.js",
  "/js/features/auth.js",
  "/js/features/likes.js",
  "/js/features/follow.js",
  "/js/features/save.js",
  "/js/features/comments.js",
  "/js/features/discover.js",
  "/js/features/menu.js",
  "/js/features/feed.js",
  "/js/features/trending.js",
  "/js/features/mute.js",
  "/js/features/share.js",
  "/js/features/chrome.js",
  "/js/features/nav.js",
  "/js/features/progress.js",
  "/script.js",
  "/vid.js",
  "/tracking.js",
  "/app-mode.js",
  "/pwa-install.js",
  "/pwa-banner.js",
  "/manifest.json",
  "/auth-modal.css",
  "/logo.png",
  "/icon.png",
  "/gif.webp",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/maskable-512.png",
  "/icons/shortcut-home.png",
  "/icons/shortcut-fire.png",
  "/icons/shortcut-bookmark.png",
  "/icons/shortcut-video.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
    ).then(() => self.clients.claim()),
  );
});

function isBypass(url) {
  return (
    url.includes("firestore.googleapis.com") ||
    url.includes("firebaseinstallations.googleapis.com") ||
    url.includes("googletagmanager.com") ||
    url.includes("google-analytics.com") ||
    url.includes("effectivecpmnetwork.com") ||
    url.includes("highperformanceformat.com") ||
    url.includes("profitableratecpmnetwork.com") ||
    url.includes(".m3u8") ||
    url.includes(".m3u8?") ||
    url.includes(".ts") ||
    url.includes(".mp4")
  );
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Media segments, streams, backend and ads: never intercept.
  if (isBypass(req.url)) return;
  if (req.headers.has("range")) return;

  // Navigations: network first, offline falls back to cached shell.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put("/index.html", copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match("/index.html")),
    );
    return;
  }

  // Same-origin static assets: cache first.
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then((hit) => {
        if (hit) return hit;
        return fetch(req).then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => {});
          }
          return res;
        });
      }),
    );
    return;
  }

  // Cross-origin libraries (CDN): network first, cache fallback.
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req)),
  );
});
