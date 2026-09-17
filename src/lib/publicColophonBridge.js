const API_BASE = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/+$/, "");

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

export function createPublicColophonProjectionLoader({ orgId, baseFetch = fetch } = {}) {
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
      return data;
    });

    return cachedPromise;
  };
}

export function createPublicColophonFetchBridge({ orgId, baseFetch = fetch, origin = window.location.origin } = {}) {
  const loadProjection = createPublicColophonProjectionLoader({ orgId, baseFetch });

  return async function publicColophonFetch(input, init) {
    let url;
    try {
      url = requestUrl(input, origin);
    } catch {
      return baseFetch(input, init);
    }

    if (url.origin !== origin) return baseFetch(input, init);

    const method = requestMethod(input, init);

    if (url.pathname === "/api/native-content" && method === "GET") {
      const projection = await loadProjection();
      return responseJson({
        ok: true,
        mode: "d1",
        publicProjection: true,
        items: Array.isArray(projection?.items) ? projection.items : [],
      });
    }

    if (url.pathname === "/api/public-site-config" && method === "GET") {
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

    if (url.pathname === "/api/public-site-config" && method === "OPTIONS") {
      return responseJson({
        ok: true,
        canEdit: false,
        authMode: "public-projection",
        authReason: "Public publication domains are read-only.",
        mode: "d1",
      });
    }

    // The public publication shell is intentionally read-only. Never proxy a
    // Colophon write request through Bondfire's authenticated/private APIs.
    if (
      (url.pathname === "/api/native-content" || url.pathname === "/api/public-site-config")
      && !["GET", "HEAD", "OPTIONS"].includes(method)
    ) {
      return responseJson({ ok: false, error: "PUBLICATION_READ_ONLY" }, 405);
    }

    return baseFetch(input, init);
  };
}
