const API_BASE = (import.meta.env?.VITE_API_BASE_URL || "").replace(/\/+$/, "");
const PUBLIC_RUNTIME_PREFIX = "/api/public/colophon-runtime";

function responseJson(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

function requestMethod(input, init) {
  return String(init?.method || (input instanceof Request ? input.method : "GET") || "GET").toUpperCase();
}

function requestUrl(input, origin) {
  const raw = input instanceof Request ? input.url : String(input || "");
  return new URL(raw, origin);
}

function runtimeEndpoint(pathname) {
  if (!pathname.startsWith(`${PUBLIC_RUNTIME_PREFIX}/`)) return "";
  return pathname.slice(PUBLIC_RUNTIME_PREFIX.length);
}

export function createPublicColophonProjectionLoader({ orgId, baseFetch = fetch, onProjection = null } = {}) {
  const normalizedOrgId = String(orgId || "").trim();
  let cachedPromise = null;

  return async function loadProjection({ force = false } = {}) {
    if (!normalizedOrgId) throw new Error("Missing publication organization id.");
    if (!force && cachedPromise) return cachedPromise;

    const query = new URLSearchParams({ org: normalizedOrgId });
    cachedPromise = baseFetch(`${API_BASE}/api/public/publication?${query.toString()}`, {
      method: "GET",
      headers: { Accept: "application/json" },
      credentials: "same-origin",
    }).then(async (response) => {
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data?.ok === false) {
        cachedPromise = null;
        throw new Error(data?.error || `Publication projection failed (${response.status})`);
      }
      if (typeof onProjection === "function") onProjection(data);
      return data;
    });

    return cachedPromise;
  };
}

export function createPublicColophonFetchBridge({ orgId, baseFetch = fetch, origin = window.location.origin, onProjection = null } = {}) {
  const loadProjection = createPublicColophonProjectionLoader({ orgId, baseFetch, onProjection });

  return async function publicColophonFetch(input, init) {
    let url;
    try {
      url = requestUrl(input, origin);
    } catch {
      return baseFetch(input, init);
    }

    if (url.origin !== origin) return baseFetch(input, init);

    const method = requestMethod(input, init);
    const endpoint = runtimeEndpoint(url.pathname);
    if (!endpoint) return baseFetch(input, init);

    if (endpoint === "/native-content" && method === "GET") {
      const projection = await loadProjection();
      return responseJson({
        ok: true,
        mode: "d1",
        publicProjection: true,
        items: Array.isArray(projection?.items) ? projection.items : [],
      });
    }

    if (endpoint === "/public-site-config" && method === "GET") {
      const projection = await loadProjection();
      return responseJson({
        ok: true,
        mode: "d1",
        scope: `public:${String(orgId || "")}`,
        canEdit: false,
        authMode: "public-projection",
        authReason: "Public publication domains are read-only.",
        version: 1,
        schemaVersion: Number(projection?.publication?.config?.schemaVersion || 1),
        updatedAt: "",
        config: projection?.publication?.config || {},
      });
    }

    if (endpoint === "/public-site-config" && method === "OPTIONS") {
      return responseJson({
        ok: true,
        canEdit: false,
        authMode: "public-projection",
        authReason: "Public publication domains are read-only.",
        mode: "d1",
      });
    }

    if (["/native-content", "/public-site-config"].includes(endpoint) && !["GET", "HEAD", "OPTIONS"].includes(method)) {
      return responseJson({ ok: false, error: "PUBLICATION_READ_ONLY" }, 405);
    }

    // Unknown canonical Colophon endpoints stay inside this namespace and fail
    // closed instead of falling through to Bondfire's private/general API surface.
    return responseJson({ ok: false, error: "PUBLICATION_RUNTIME_ENDPOINT_UNAVAILABLE" }, 404);
  };
}
