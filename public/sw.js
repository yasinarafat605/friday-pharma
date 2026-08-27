// আশ শিফা ফার্মেসী — minimal offline shell service worker.
// UI-এর ডেটা IndexedDB (Dexie) থেকে আসে, তাই SW শুধু app shell cache করে।
const CACHE = 'asshifa-shell-v1';
const SHELL = ['/', '/dashboard', '/manifest.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  // Never cache Supabase API calls — always network (offline handled by Dexie outbox).
  if (request.url.includes('supabase.co')) return;
  event.respondWith(
    fetch(request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(request).then((r) => r || caches.match('/dashboard')))
  );
});
