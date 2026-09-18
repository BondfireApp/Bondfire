export function parseCookies(cookieHeader) {
  const out = {};
  const s = cookieHeader || "";
  if (!s) return out;
  const parts = s.split(";");
  for (const part of parts) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (!k) continue;
    try {
      out[k] = decodeURIComponent(v);
    } catch {
      out[k] = v;
    }
  }
  return out;
}

export function serializeCookie(name, value, opts = {}) {
  const enc = encodeURIComponent(String(value));
  let s = `${name}=${enc}`;
  if (opts.maxAge != null) s += `; Max-Age=${Math.floor(opts.maxAge)}`;
  if (opts.expires) s += `; Expires=${opts.expires.toUTCString()}`;
  if (opts.path) s += `; Path=${opts.path}`;
  if (opts.domain) s += `; Domain=${opts.domain}`;
  if (opts.sameSite) s += `; SameSite=${opts.sameSite}`;
  if (opts.secure) s += `; Secure`;
  if (opts.httpOnly) s += `; HttpOnly`;
  return s;
}

export function clearCookie(name, opts = {}) {
  return serializeCookie(name, "", { ...opts, maxAge: 0 });
}
