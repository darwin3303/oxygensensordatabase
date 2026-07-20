const CACHE = "o2-inventory-v12";
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
// IMPORTANT: only intercept same-origin GET requests for our own app files.
// The Cache API can't store non-GET requests (like Firebase Auth/Firestore's
// POST calls), and we never want to cache third-party API traffic anyway —
// doing so previously threw an error that silently broke Firebase sign-in.
self.addEventListener("fetch", e=>{
  const url = new URL(e.request.url);
  if(e.request.method !== "GET" || url.origin !== self.location.origin){
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

