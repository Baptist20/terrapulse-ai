const CACHE_NAME = "terrapulse-shell-v2";
const SHELL_CACHE = CACHE_NAME;
const STATIC_CACHE = "terrapulse-static-v2";
const VALID_CACHES = [SHELL_CACHE, STATIC_CACHE];

const PRECACHE_ROUTES = [
  "/",
  "/dashboard",
  "/logs",
  "/synthesis",
  "/settings",
  "/manifest.webmanifest",
  "/icon.svg",
];

const IGNORED_API_HOSTS = [
  "firebasevertexai.googleapis.com",
  "firestore.googleapis.com",
  "identitytoolkit.googleapis.com",
  "securetoken.googleapis.com",
  "firebaseinstallations.googleapis.com",
  "firebaseremoteconfig.googleapis.com",
  "firebaseappcheck.googleapis.com",
  "www.gstatic.com",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) =>
        Promise.allSettled(
          PRECACHE_ROUTES.map(async (route) => {
            try {
              const res = await fetch(route, { cache: "no-cache" });
              if (res.ok) {
                await cache.put(route, res.clone());
              }
            } catch {
              // Ignore individual route precache failures (e.g. dynamic /logs index)
            }
          })
        )
      )
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => !VALID_CACHES.includes(key))
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "WARM_APP_SHELL") {
    event.waitUntil(
      caches.open(SHELL_CACHE).then((cache) =>
        Promise.allSettled(
          PRECACHE_ROUTES.map(async (route) => {
            try {
              const res = await fetch(route, { cache: "no-cache" });
              if (res.ok) await cache.put(route, res.clone());
            } catch {
              // ignore offline
            }
          })
        )
      )
    );
  }
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Ignore non-GET requests (POST, PUT, DELETE, etc.)
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Ignore cross-origin requests and Firebase / Google API traffic so Firestore
  // IndexedDB persistence and AI SDK calls handle their own offline state cleanly.
  if (
    url.origin !== self.location.origin ||
    IGNORED_API_HOSTS.some((host) => url.hostname.includes(host))
  ) {
    return;
  }

  // Cache-First for Next.js static chunks & core static assets
  if (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/images/") ||
    url.pathname === "/icon.svg" ||
    url.pathname === "/manifest.webmanifest"
  ) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) return cached;
        const networkResponse = await fetch(request);
        if (networkResponse && networkResponse.ok) {
          cache.put(request, networkResponse.clone());
        }
        return networkResponse;
      })
    );
    return;
  }

  // Network-First with Cache Fallback for same-origin page navigations
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        const cache = await caches.open(SHELL_CACHE);
        try {
          const networkResponse = await fetch(request);
          if (networkResponse && networkResponse.ok) {
            cache.put(request, networkResponse.clone());
          }
          return networkResponse;
        } catch {
          // Serve exact cached route if available
          const exactMatch = await cache.match(request, { ignoreSearch: true });
          if (exactMatch) return exactMatch;

          // Fallback to cached /dashboard for dynamic /logs/[id] routes so client-side
          // Firestore IndexedDB renders the log detail offline
          const dashboardFallback = await cache.match("/dashboard");
          if (dashboardFallback) return dashboardFallback;

          const homeFallback = await cache.match("/");
          if (homeFallback) return homeFallback;

          return new Response(
            "TerraPulse AI is offline and this page has not been cached yet. Reconnect once to cache the App Shell.",
            {
              status: 503,
              headers: { "Content-Type": "text/plain; charset=utf-8" },
            }
          );
        }
      })()
    );
  }
});
