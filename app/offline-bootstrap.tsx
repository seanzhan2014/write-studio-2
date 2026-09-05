"use client";

import { useEffect } from "react";

function cacheLoadedShell(worker: ServiceWorker) {
  const channel = new MessageChannel();
  const resources = performance.getEntriesByType("resource").map((entry) => entry.name);
  const development = resources.some((name) => {
    try { return new URL(name).pathname === "/@vite/client"; } catch { return false; }
  });
  const urls = [
    window.location.href,
    ...(development ? resources : []),
  ];
  const done = new Promise<void>((resolve) => {
    const timeout = window.setTimeout(resolve, 10_000);
    channel.port1.onmessage = () => {
      window.clearTimeout(timeout);
      resolve();
    };
  });
  worker.postMessage({ type: "CACHE_LOADED_SHELL", urls }, [channel.port2]);
  return done;
}

export default function OfflineBootstrap() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    // Keep the service worker out of unrelated Playwright contexts. The dedicated
    // offline test opts in so it still exercises the real browser cache path.
    if (navigator.webdriver && new URLSearchParams(window.location.search).get("offline-test") !== "1") return;
    const register = () => {
      void navigator.serviceWorker.register("/sw.js", { scope: "/" }).then(async (registration) => {
        await registration.update();
        const readyRegistration = await navigator.serviceWorker.ready;
        const worker = navigator.serviceWorker.controller ?? readyRegistration.active;
        if (!worker) return;
        await cacheLoadedShell(worker);
        document.documentElement.dataset.offlineReady = "true";
      }).catch(() => undefined);
      void navigator.storage?.persist?.().catch(() => false);
    };
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}
