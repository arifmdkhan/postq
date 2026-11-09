const cacheName = "postq-offline-v2";
const offlinePage = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(cacheName).then((cache) => cache.add(offlinePage)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(
    keys.filter((key) => key.startsWith("postq-offline-") && key !== cacheName).map((key) => caches.delete(key)),
  )));
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || event.request.mode !== "navigate") return;
  event.respondWith(fetch(event.request).catch(async () =>
    (await caches.match(offlinePage)) ?? new Response("PostQ is offline", { status: 503 }),
  ));
});
