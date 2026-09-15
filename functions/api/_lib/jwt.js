function b64url(bytes) {
  let s = btoa(String.fromCharCode(...bytes));
  return s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function ub64url(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmacSign(secret, data) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return new Uint8Array(sig);
}

export async function signJwt(secret, payload, ttlSeconds) {
  const header = { alg: "HS256", typ: "JWT" };
  const exp = Math.floor(Date.now() / 1000) + (ttlSeconds || 3600);
  const body = { ...payload, exp };
  const enc = (obj) => b64url(new TextEncoder().encode(JSON.stringify(obj)));

  const h = enc(header);
  const p = enc(body);
  const data = `${h}.${p}`;
  const sig = await hmacSign(secret, data);
  return `${data}.${b64url(sig)}`;
}

export async function verifyJwt(secret, token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) return null;

  const [h, p, s] = parts;
  const data = `${h}.${p}`;
  const sig = ub64url(s);
  const expected = await hmacSign(secret, data);

  if (sig.length !== expected.length) return null;
  for (let i = 0; i < sig.length; i++) if (sig[i] !== expected[i]) return null;

  const payload = JSON.parse(new TextDecoder().decode(ub64url(p)));
  if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) return null;

  return payload;
}
