// ZeroZeroTwo - Service Worker Retirement & Cleanup Script
// This script unregisters any active service worker and clears CacheStorage
// to ensure seamless native LINE LIFF authentication and zero stale cache.

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => {
        return Promise.all(keys.map((key) => caches.delete(key)));
      })
      .then(() => {
        return self.registration.unregister();
      })
      .then(() => {
        return self.clients.claim();
      })
      .catch((err) => {
        console.warn("[SW Cleanup] Failed to unregister:", err);
      })
  );
});
