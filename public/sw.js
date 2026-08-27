// আশ শিফা ফার্মেসী — offline shell service worker.
// UI-এর ডেটা IndexedDB (Dexie) থেকে আসে, তাই SW শুধু পেজের খোলস cache করে।
// কোনো cloud বা API নেই — সব ডেটা এই ডিভাইসেই।
const CACHE = 'asshifa-shell-v2';

// static export-এ প্রতিটি রুট ফোল্ডার, তাই শেষে স্ল্যাশ থাকতেই হবে।
const SHELL = ['/', '/dashboard/', '/sales/', '/add-stock/', '/manifest.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) =>
      // একটি ঠিকানা না পাওয়া গেলেও বাকিগুলো যেন cache হয়।
      Promise.all(SHELL.map((u) => c.add(u).catch(() => {})))
    )
  );
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
  if (new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
        return res;
      })
      .catch(() =>
        caches.match(request).then((r) => r || caches.match('/dashboard/') || caches.match('/'))
      )
  );
});
