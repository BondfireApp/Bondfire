import { api as contentApi } from '../utils/api.js';
// src/lib/api.js
import { debugLog } from "./debugBus.js";

const API_BASE = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/+$/, "");

let refreshing = null;

// Robust JSON parsing: tolerate 204 and empty bodies.
async function readJsonMaybe(res) {
  if (!res) return null;
  if (res.status === 204 || res.status === 205) return null;

  const text = await res.text().catch(() => "");
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

export async function apiFetch(path, opts = {}) {
  if (/^\/api\/orgs\//.test(path)) {
    try {
      const body = opts.body && typeof opts.body === 'object' && !(opts.body instanceof Blob) && !(opts.body instanceof FormData) ? JSON.stringify(opts.body) : opts.body;
      const data = await contentApi(path, { ...opts, body });
      return new Response(JSON.stringify(data), {status:200,headers:{'content-type':'application/json'}});
    } catch (error) {
      return new Response(JSON.stringify({ok:false,error:error.message}), {status:error.status||400,headers:{'content-type':'application/json'}});
    }
  }
  const startedAt = Date.now();

  const rel = path.startsWith("/") ? path : `/${path}`;
  const isAbs = path.startsWith("http");
  const candidates = (() => {
    if (isAbs) return [path];
    if (!API_BASE) return [rel];

    // Prefer same-origin Pages Functions for "/api/*" routes.
    // Fall back to API_BASE for deployments where the API lives elsewhere.
    if (rel.startsWith("/api/")) return [rel, `${API_BASE}${rel}`];

    // Non-API paths (rare): assume API_BASE.
    return [`${API_BASE}${rel}`];
  })();

  const init = {
    credentials: "include",
    ...opts,
    headers: {
      ...(opts.headers || {}),
    },
  };

  // default json content-type for bodies that are plain objects
  if (init.body && typeof init.body === "object" && !(init.body instanceof FormData) && !(init.body instanceof Blob)) {
    init.headers["Content-Type"] = init.headers["Content-Type"] || "application/json";
    init.body = JSON.stringify(init.body);
  }

  // Try each candidate URL until one gives a non-404/5xx response (or is the last option).
  let lastRes = null;
  let lastUrl = candidates[0];
  for (let i = 0; i < candidates.length; i++) {
    const u = candidates[i];
    lastUrl = u;
    try {
      debugLog("api:request", { url: u, method: (opts?.method || "GET").toString() });
      const r = await fetch(u, init);
      debugLog("api:response", { url: u, status: r.status, ms: Date.now() - startedAt });

      lastRes = r;

      // If this looks like the wrong host (common when API_BASE is set but Pages Functions are the real endpoint),
      // try the fallback.
      const shouldTryNext =
        i < candidates.length - 1 &&
        (r.status === 404 || r.status >= 500);

      if (!shouldTryNext) break;
    } catch (e) {
      debugLog("api:network_error", { url: u, message: String(e?.message || e) });
      lastRes = null;
      // try next candidate
    }
  }

  if (!lastRes) {
    // bubble up a normal fetch error shape
    return fetch(lastUrl, init);
  }

  if (lastRes.status !== 401) return lastRes;

  // 401: Try one refresh then retry once against the SAME URL that returned 401.
  if (!refreshing) {
    refreshing = (async () => {
      try {
        debugLog("api:refresh_start", { url: lastUrl });
        const refreshUrls = API_BASE ? ["/api/auth/refresh", `${API_BASE}/api/auth/refresh`] : ["/api/auth/refresh"];
        let ok = false;
        for (const ru of refreshUrls) {
          try {
            const rr = await fetch(ru, { method: "POST", credentials: "include" });
            debugLog("api:refresh_result", { url: ru, ok: rr.ok, status: rr.status });
            if (rr.ok) { ok = true; break; }
          } catch (e) {
            debugLog("api:refresh_error", { url: ru, message: String(e?.message || e) });
          }
        }
        return ok;
      } finally {
        refreshing = null;
      }
    })();
  }

  const okRefresh = await refreshing;
  if (!okRefresh) {
    debugLog("api:refresh_failed", { url: lastUrl });
    return lastRes;
  }

  const res2 = await fetch(lastUrl, init);
  debugLog("api:retry_response", { url: lastUrl, status: res2.status });
  return res2;
}

export async function apiJSON(path, opts) {
  const res = await apiFetch(path, opts);

  const data = await readJsonMaybe(res);

  if (!res.ok) {
    const msg =
      data?.error ||
      data?.message ||
      data?.raw ||
      `HTTP_${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    err.data = data;
    throw err;
  }

  // Maintain old behavior: callers expect an object
  return data || {};
}