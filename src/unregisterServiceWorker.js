// src/unregisterServiceWorker.js
// Bondfire: do not run as a PWA right now. A stale service worker causes the
// "site blinks and resets" problem and can desync Matrix crypto stores.
//
// Import this ONCE from your app entry (e.g. src/main.jsx) BEFORE React renders.

export async function bfUnregisterAllServiceWorkers() {
  try {
    if (!("serviceWorker" in navigator)) return;
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map((r) => r.unregister().catch(() => null)));
  } catch {
    // ignore
  }
}

// Optional: also clear SW caches so old assets stop resurfacing.
export async function bfClearServiceWorkerCaches() {
  try {
    if (!("caches" in window)) return;
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k).catch(() => null)));
  } catch {
    // ignore
  }
}

// Fire-and-forget on import.
bfUnregisterAllServiceWorkers();
