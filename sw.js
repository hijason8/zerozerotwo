const CACHE_NAME = "zerozerotwo-v35";
const ASSETS_TO_CACHE = [
  "./",
  "./index.html",
  "./styles.css",
  "./i18n.js",
  "./scheduler.js",
  "./manifest.json",
  "./icon.svg",
  "./icon-192.png",
  "./icon-512.png",
  "./apple-touch-icon.png"
];

// 1. 安裝事件：快取關鍵離線靜態資源
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    }).then(() => self.skipWaiting())
  );
});

// 2. 啟動事件：清理舊版快取並立即接管頁面
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// 3. 抓取事件：僅快取同源 GET 靜態資源，絕不攔截 API 與 POST
self.addEventListener("fetch", (event) => {
  // 規則 A：非 GET 請求（如 POST generateSchedule）一律放行，不經 Service Worker
  if (event.request.method !== "GET") {
    return;
  }

  const url = event.request.url;

  // 規則 B：後端 Cloud Functions (5001/cloudfunctions) 及 Firebase API 一律放行
  if (
    url.includes(":5001") ||
    url.includes("cloudfunctions.net") ||
    url.includes("firebasedatabase.app") ||
    url.includes("google-analytics.com") ||
    url.includes("googletagmanager.com")
  ) {
    return;
  }

  // 規則 C：Network First 靜態資源策略，並具備優雅的 Response 保底
  // 對 HTML 或頁面導航請求強制 cache: "no-cache"，杜絕瀏覽器磁碟快取導致版本落後
  const isDoc = (event.request.mode === "navigate" || event.request.destination === "document");
  const fetchPromise = isDoc
    ? fetch(event.request, { cache: "no-cache" })
    : fetch(event.request);

  event.respondWith(
    fetchPromise
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === "basic") {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      })
      .catch(async () => {
        // 斷網或離線時，先嘗試精確比對
        const cached = await caches.match(event.request);
        if (cached) return cached;

        // 若帶有 query 參數（如 /?t=T-12345），回退至首頁 SPA 快取
        if (event.request.mode === "navigate") {
          const fallback = await caches.match("./index.html") || await caches.match("./");
          if (fallback) return fallback;
        }

        // 絕對保底回傳合法 Response 物件，杜絕 Failed to convert value to 'Response' 錯誤
        return new Response("Offline / Network Error", {
          status: 503,
          statusText: "Service Unavailable",
          headers: { "Content-Type": "text/plain" }
        });
      })
  );
});
