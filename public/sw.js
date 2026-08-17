const CACHE = "o2-inventory-v15";
const FILES = ["./index.html", "./manifest.json", "./icon-192.png", "./icon-512.png", "./icon-192-maskable.png", "./icon-512-maskable.png", "./apple-touch-icon.png"];

self.addEventListener("install", e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES)));
  self.skipWaiting();
});

self.addEventListener("activate", e=>{
  e.waitUntil(
    caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))
  );
  self.clients.claim();
});

// Network-first: always try to fetch the latest version first so updates
// (new features, fixed icons, etc.) show up immediately when online.
// Only fall back to the cached copy if the network request fails (offline).
//
// Only intercept same-origin GET requests for our own static app files.
// The Cache API can't store non-GET requests, we never want to cache
// third-party API traffic, and /api/* routes are live data from our own
// backend — those should always hit the network directly, never cached.
self.addEventListener("fetch", e=>{
  const url = new URL(e.request.url);
  const isApi = url.pathname.startsWith("/api/");
  if(e.request.method !== "GET" || url.origin !== self.location.origin || isApi){
    return; // let the browser handle it normally, untouched
  }
  e.respondWith(
    fetch(e.request).then(res=>{
      const copy = res.clone();
      caches.open(CACHE).then(c=>c.put(e.request, copy));
      return res;
    }).catch(()=> caches.match(e.request))
  );
});

