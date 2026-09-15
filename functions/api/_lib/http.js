export function json(data, init = {}) {
  const responseInit = typeof init === "number" ? { status: init } : (init || {});
  const headers = new Headers(responseInit.headers || {});
  headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(data), { ...responseInit, headers });
}

export function bad(status, error, extra) {
  return json({ ok: false, error, ...(extra || {}) }, { status });
}

export function now() {
  return Date.now();
}

export function uuid() {
  return crypto.randomUUID();
}

export function ok(data = {}, init = {}) {
  const payload = (data && typeof data === "object") ? data : { value: data };
  return json({ ok: true, ...payload }, init);
}

export function err(status, message, extra) {
  return bad(status, message, extra);
}

export function error(status, message, extra) {
  return err(status, message, extra);
}

export function readJSON(req) {
  // Cloudflare Request.json() throws on empty body / invalid JSON.
  // We return {} instead of exploding.
  return req.json().catch(() => ({}));
}

export function requireMethod(req, method) {
  const want = String(method || "").toUpperCase();
  const got = String(req.method || "").toUpperCase();
  if (want && got !== want) {
    // 405 Method Not Allowed
    return err(405, `METHOD_NOT_ALLOWED`, { want, got });
  }
  return null;
}

// --- cookies ---
// Minimal cookie utilities for Pages Functions (no external deps).
export function parseCookies(request) {
  const h = request?.headers?.get("cookie") || "";
  const out = {};
  if (!h) return out;
  const parts = h.split(";");
  for (const p of parts) {
    const idx = p.indexOf("=");
    if (idx < 0) continue;
    const k = p.slice(0, idx).trim();
    const v = p.slice(idx + 1).trim();
    if (!k) continue;
    try {
      out[k] = decodeURIComponent(v);
    } catch {
      out[k] = v;
    }
  }
  return out;
}

export function getCookie(request, name) {
  const c = parseCookies(request);
  return c[name] || "";
}

// Returns a value suitable for a single Set-Cookie header.
export function cookieString(name, value, opts = {}) {
  const enc = encodeURIComponent(String(value ?? ""));
  let s = `${name}=${enc}`;
  if (opts.maxAge != null) s += `; Max-Age=${Math.floor(opts.maxAge)}`;
  if (opts.expires) s += `; Expires=${opts.expires.toUTCString()}`;
  s += `; Path=${opts.path || "/"}`;
  if (opts.httpOnly) s += "; HttpOnly";
  if (opts.secure) s += "; Secure";
  if (opts.sameSite) s += `; SameSite=${opts.sameSite}`;
  return s;
}
