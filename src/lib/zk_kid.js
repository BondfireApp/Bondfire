// src/lib/zk_kid.js
// Synchronous KID helper used by Security.jsx.
// Not a security boundary: just a stable identifier for matching/display.

function base64url(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fnv1a32(str, seed = 0x811c9dc5) {
  let h = seed >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h + ((h << 1) >>> 0) + ((h << 4) >>> 0) + ((h << 7) >>> 0) + ((h << 8) >>> 0) + ((h << 24) >>> 0)) >>> 0;
  }
  return h >>> 0;
}

function pickJwkStableFields(jwk) {
  if (!jwk || typeof jwk !== "object") return {};
  const out = {};
  const keys = ["kty", "crv", "x", "y", "n", "e", "kid"];
  for (const k of keys) if (jwk[k] != null) out[k] = String(jwk[k]);
  return out;
}

export function kidFromJwk(jwk) {
  try {
    const stable = pickJwkStableFields(jwk);
    const ordered = {};
    Object.keys(stable).sort().forEach((k) => (ordered[k] = stable[k]));
    const material = JSON.stringify(ordered);

    const h1 = fnv1a32(material, 0x811c9dc5);
    const h2 = fnv1a32(material, 0x9e3779b9);

    const bytes = new Uint8Array(8);
    bytes[0] = (h1 >>> 24) & 0xff;
    bytes[1] = (h1 >>> 16) & 0xff;
    bytes[2] = (h1 >>> 8) & 0xff;
    bytes[3] = h1 & 0xff;
    bytes[4] = (h2 >>> 24) & 0xff;
    bytes[5] = (h2 >>> 16) & 0xff;
    bytes[6] = (h2 >>> 8) & 0xff;
    bytes[7] = h2 & 0xff;

    return base64url(bytes);
  } catch {
    return "";
  }
}
