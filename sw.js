// OLC Database service worker: makes the app installable and loads fast.
// App files: network first, always re-checked with the server (so updates show up
// right away), cache as backup for offline.
// Fonts and the Supabase library: cache first.
// Database requests are never cached.
const CACHE = "olc-v3";
const SHELL = [
  "./", "index.html", "app.css", "app.js", "config.js", "game.js", "manifest.webmanifest",
  "logo.svg", "icon-192.png", "icon-512.png", "icon-maskable.png", "apple-touch-icon.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (url.hostname.endsWith("supabase.co")) return; // live data only

  const staticLib = url.hostname === "cdn.jsdelivr.net" ||
    url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com";

  if (staticLib) {
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
        return res;
      }))
    );
    return;
  }

  if (url.origin === self.location.origin) {
    e.respondWith(
      fetch(req, { cache: "no-cache" }).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
        return res;
      }).catch(() => caches.match(req).then((hit) => hit || caches.match("index.html")))
    );
  }
});
