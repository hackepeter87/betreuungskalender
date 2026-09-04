const CACHE_NAME = "betreuungskalender-v6";
const CACHE_PREFIX = "betreuungskalender-";
const APP_SHELL = [
  "/index.html",
  "/appearance.js",
  "/manifest.webmanifest",
  "/icons/app-icon.svg",
  "/icons/app-icon-192.png",
  "/icons/app-icon-512.png",
  "/icons/apple-touch-icon.png",
  "/icons/favicon-32.png"
];

const NETWORK_ONLY_PATHS = new Set(["/impressum", "/datenschutz"]);
const NETWORK_ONLY_PREFIXES = ["/api/", "/auth/", "/setup", "/invite", "/recovery"];

function isNetworkOnlyPath(pathname) {
  return NETWORK_ONLY_PATHS.has(pathname) || NETWORK_ONLY_PREFIXES.some((prefix) => (
    pathname === prefix || pathname.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`)
  ));
}

function isCacheableStaticPath(pathname) {
  return pathname.startsWith("/assets/") || APP_SHELL.includes(pathname);
}

function responseAllowsStorage(response) {
  return response.ok &&
    !response.redirected &&
    response.type !== "opaqueredirect" &&
    !(response.headers.get("cache-control") || "").toLowerCase().includes("no-store");
}

function isCacheableNavigationResponse(response) {
  if (!responseAllowsStorage(response)) return false;
  const finalUrl = new URL(response.url, self.location.origin);
  if (finalUrl.origin !== self.location.origin || isNetworkOnlyPath(finalUrl.pathname)) return false;
  return (response.headers.get("content-type") || "").toLowerCase().includes("text/html");
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
          .map((key) => caches.delete(key)))
      )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) return;
  if (isNetworkOnlyPath(requestUrl.pathname)) {
    event.respondWith(fetch(event.request));
    return;
  }

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then(async (response) => {
          if (isCacheableNavigationResponse(response)) {
            await caches.open(CACHE_NAME).then((cache) => cache.put("/index.html", response.clone()));
          }
          return response;
        })
        .catch(() => caches.match("/index.html"))
    );
    return;
  }

  if (!isCacheableStaticPath(requestUrl.pathname)) {
    event.respondWith(fetch(event.request));
    return;
  }

  event.respondWith(
    caches.match(event.request).then(
      (cached) =>
        cached ||
        fetch(event.request).then((response) => {
          if (responseAllowsStorage(response)) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
    )
  );
});

self.addEventListener("push", (event) => {
  let payload = {
    title: "Betreuung bestätigen",
    body: "Wurde eine geplante Betreuung durchgeführt?",
    url: "/"
  };
  try {
    if (event.data) payload = { ...payload, ...event.data.json() };
  } catch {
    // Keep the privacy-safe default notification payload.
  }
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: "/icons/app-icon-192.png",
      badge: "/icons/favicon-32.png",
      data: { url: payload.url }
    })
  );
});

function notificationTargetUrl(value) {
  try {
    const url = new URL(value || "/", self.location.origin);
    return url.origin === self.location.origin ? url.href : new URL("/", self.location.origin).href;
  } catch {
    return new URL("/", self.location.origin).href;
  }
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = notificationTargetUrl(event.notification.data?.url);
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
