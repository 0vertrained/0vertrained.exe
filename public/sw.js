// 0VERTRAINED service worker — push + deliberately small last-good shell cache
// (V13.4). Hashed assets are immutable; navigations remain network-first with
// a short timeout so an installed app can cold-open in a gym basement without
// silently living on an old shell forever.

const CACHE_NAME = "ovt-shell-v19.2.1";
const NAV_TIMEOUT_MS = 3000;
const CORE_URLS = [
  "/",
  "/manifest.json",
  "/favicon-64.png",
  "/favicon-180.png",
  "/icon.png",
  "/icon-maskable.png",
];

async function cacheCurrentShell() {
  const cache = await caches.open(CACHE_NAME);
  const response = await fetch("/", { cache: "no-store" });
  if (!response.ok) throw new Error("shell fetch failed");
  const html = await response.clone().text();
  await cache.put("/", response.clone());
  const assetUrls = [...html.matchAll(/(?:src|href)=["'](\/assets\/[^"']+)["']/g)].map((match) => match[1]);
  await Promise.allSettled([...new Set([...CORE_URLS.slice(1), ...assetUrls])].map(async (url) => {
    const asset = await fetch(url, { cache: "no-store" });
    if (asset.ok) await cache.put(url, asset);
  }));
}

self.addEventListener("install", (event) => {
  event.waitUntil(cacheCurrentShell().catch(() => {}).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith("ovt-shell-") && key !== CACHE_NAME).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

async function networkWithTimeout(request, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      fetch(request),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("network timeout")), timeoutMs); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/") || url.pathname.startsWith("/.netlify/")) return;

  if (request.mode === "navigate") {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        const response = await networkWithTimeout(request, NAV_TIMEOUT_MS);
        if (response?.ok) await cache.put("/", response.clone());
        return response;
      } catch {
        return (await cache.match("/")) || new Response(
          "<!doctype html><title>0VERTRAINED offline</title><meta name=viewport content='width=device-width'><style>body{font:16px system-ui;padding:2rem;background:#faf9f6;color:#1a1a1a}</style><h1>0VERTRAINED</h1><p>The app has not completed its first online load yet. Reconnect once, then offline cold opens will use the last-good version.</p>",
          { headers: { "content-type": "text/html; charset=utf-8" } },
        );
      }
    })());
    return;
  }

  if (url.pathname.startsWith("/assets/")) {
    event.respondWith((async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(request, response.clone());
      }
      return response;
    })());
  }
});

self.addEventListener("push", (event) => {
  let payload;
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: "0VERTRAINED", body: event.data ? event.data.text() : "" };
  }
  const title = payload.title || "0VERTRAINED";
  const options = {
    body: payload.body || "",
    icon: "/favicon-180.png",
    badge: "/favicon-64.png",
    tag: payload.tag || "ovt",
    data: { url: payload.url || "/" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  // V13.6 · Only ever open a same-origin path. Push payloads are VAPID-signed
  // (server-controlled), so this is defense-in-depth: a malformed or unexpected
  // data.url can never send a tapped notification to a foreign origin.
  let target = "/";
  try {
    const resolved = new URL(event.notification.data?.url || "/", self.location.origin);
    if (resolved.origin === self.location.origin) target = resolved.pathname + resolved.search;
  } catch {
    target = "/";
  }
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) return client.focus();
      }
      return self.clients.openWindow(target);
    }),
  );
});
