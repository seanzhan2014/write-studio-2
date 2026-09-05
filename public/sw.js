const worker = globalThis;
const shellCacheName = "writer-studio-shell-v6";
const cacheableAssetPattern = /\.(?:css|js|mjs|png|jpe?g|gif|webp|svg|ico|woff2?)(?:\?.*)?$/i;
const cacheableDestinations = new Set(["script", "style", "image", "font", "worker"]);
const viteOfflineClient = `
globalThis.process ??= { env: { NODE_ENV: "development", __NEXT_VERSION: "vinext" } };
const noop = () => undefined;
export class ErrorOverlay {}
export const createHotContext = () => ({ accept: noop, acceptExports: noop, dispose: noop, prune: noop, invalidate: noop, on: noop, off: noop, send: noop, data: {} });
export const injectQuery = (url) => url;
export const removeStyle = noop;
export const updateStyle = noop;
`;

async function cacheResponse(cache, request, response) {
  if (response.ok && response.type !== "opaque") await cache.put(request, response.clone());
  return response;
}

function shellUrlsFromHtml(html) {
  const urls = new Set();
  for (const match of html.matchAll(/<(?:script|link)\b[^>]*(?:src|href)=["']([^"']+)["']/gi)) {
    try {
      const url = new URL(match[1], worker.location.origin);
      if (url.origin === worker.location.origin && !url.pathname.startsWith("/api/") && url.pathname !== "/@vite/client") urls.add(url.href);
    } catch { /* Ignore malformed or non-HTTP asset references. */ }
  }
  return [...urls];
}

async function cacheHtmlDependencies(cache, response) {
  const html = await response.text();
  await Promise.allSettled(shellUrlsFromHtml(html).map(async (url) => {
    const asset = await fetch(url, { cache: "reload" });
    await cacheResponse(cache, url, asset);
  }));
}

async function precacheShell() {
  const cache = await caches.open(shellCacheName);
  try {
    const response = await fetch("/", { cache: "reload" });
    if (!response.ok) return;
    await cache.put("/", response.clone());
    const html = await response.text();
    const urls = new Set(["/manifest.webmanifest", "/favicon.svg"]);
    for (const url of shellUrlsFromHtml(html)) urls.add(url);
    await Promise.allSettled([...urls].map(async (url) => {
      const asset = await fetch(url, { cache: "reload" });
      await cacheResponse(cache, url, asset);
    }));
  } catch { /* A later online visit can populate the shell cache. */ }
}

async function cacheLoadedShell(urls) {
  const cache = await caches.open(shellCacheName);
  await Promise.allSettled(urls.map(async (candidate) => {
    const url = new URL(candidate, worker.location.origin);
    if (url.origin !== worker.location.origin || url.pathname.startsWith("/api/") || url.pathname === "/@vite/client") return;
    const response = await fetch(url.href, { cache: "reload" });
    await cacheResponse(cache, url.href, response);
  }));
}

worker.addEventListener("install", (event) => {
  event.waitUntil(precacheShell().then(() => worker.skipWaiting()));
});

worker.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name.startsWith("writer-studio-shell-") && name !== shellCacheName).map((name) => caches.delete(name)));
    await worker.clients.claim();
  })());
});

worker.addEventListener("message", (event) => {
  if (event.data?.type !== "CACHE_LOADED_SHELL" || !Array.isArray(event.data.urls)) return;
  const urls = [...new Set(event.data.urls.filter((url) => typeof url === "string"))];
  event.waitUntil(cacheLoadedShell(urls).finally(() => event.ports[0]?.postMessage({ cached: true })));
});

worker.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== worker.location.origin || url.pathname.startsWith("/api/")) return;

  if (url.pathname === "/@vite/client") {
    event.respondWith(fetch(request).catch(() => new Response(viteOfflineClient, { headers: { "Content-Type": "text/javascript" } })));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        const cache = await caches.open(shellCacheName);
        if (response.ok && response.type !== "opaque") {
          await cache.put(request, response.clone());
          await cacheHtmlDependencies(cache, response.clone());
        }
        return response;
      } catch {
        return (await caches.match(request, { ignoreSearch: true, ignoreVary: true })) ?? (await caches.match("/", { ignoreVary: true })) ?? Response.error();
      }
    })());
    return;
  }

  if (!cacheableAssetPattern.test(url.pathname) && !cacheableDestinations.has(request.destination) && url.pathname !== "/manifest.webmanifest") return;
  event.respondWith((async () => {
    const cached = await caches.match(request, { ignoreVary: true });
    if (cached) return cached;
    const response = await fetch(request);
    const cache = await caches.open(shellCacheName);
    return cacheResponse(cache, request, response);
  })());
});
