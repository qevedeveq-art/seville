/* Service worker : l'appli fonctionne hors ligne.
   - fichiers de l'appli : réseau d'abord, cache en secours (toujours à jour quand il y a du réseau)
   - librairies, polices, tuiles de carte : cache d'abord (les zones déjà vues restent disponibles)
   - données du groupe (Supabase) : jamais mises en cache ici (gérées par l'appli via localStorage) */
const VERSION = "sev-v7";
const APP = ["./", "index.html", "style.css", "app.js", "data.js", "neb.json", "manifest.webmanifest", "icons/icon-192.png",
  "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css",
  "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js"];
const TILE_MAX = 600;

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(APP)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION && k !== "sev-tiles").map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

async function trimTiles() {
  const c = await caches.open("sev-tiles"), keys = await c.keys();
  for (let i = 0; i < keys.length - TILE_MAX; i++) await c.delete(keys[i]);
}

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.hostname.endsWith("supabase.co") || url.hostname === "api.open-meteo.com") return;

  if (url.hostname === "tile.openstreetmap.org") {
    e.respondWith(caches.open("sev-tiles").then(async c => {
      const hit = await c.match(req);
      if (hit) return hit;
      try { const r = await fetch(req); if (r.ok) { c.put(req, r.clone()); trimTiles(); } return r; }
      catch (err) { return new Response("", { status: 504 }); }
    }));
    return;
  }
  if (url.origin !== location.origin) {           // CDN, polices
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(r => {
      if (r.ok || r.type === "opaque") caches.open(VERSION).then(c => c.put(req, r.clone()));
      return r;
    })));
    return;
  }
  e.respondWith(fetch(req).then(r => {             // appli : réseau d'abord
    if (r.ok) { const cl = r.clone(); caches.open(VERSION).then(c => c.put(req, cl)); }
    return r;
  }).catch(() => caches.match(req).then(hit => hit || caches.match("index.html"))));
});
