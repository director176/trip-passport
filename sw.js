/* Trip Passport service worker: the app shell is cached so it opens with no signal. */
const V = "tp-v1";
const SHELL = ["./", "index.html", "config.js", "adapter.js", "supabase.js", "manifest.webmanifest", "icon-192.png", "icon-512.png", "apple-touch-icon.png"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(V).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== V && k !== "tp-fonts").map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  if (u.hostname.endsWith("supabase.co")) return; // live data: never cache
  if (u.hostname === "fonts.googleapis.com" || u.hostname === "fonts.gstatic.com") {
    e.respondWith(caches.open("tp-fonts").then(async (c) => { const hit = await c.match(e.request); const net = fetch(e.request).then((r) => { c.put(e.request, r.clone()); return r; }).catch(() => hit); return hit || net; }));
    return;
  }
  if (u.origin === location.origin) {
    // network first (so updates land), fall back to cache when offline
    e.respondWith(fetch(e.request).then((r) => { const cp = r.clone(); caches.open(V).then((c) => c.put(e.request, cp)); return r; }).catch(() => caches.match(e.request).then((h) => h || caches.match("index.html"))));
  }
});
