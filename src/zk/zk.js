// Zero-knowledge (beta) client crypto utilities.
// Goal: the server never sees plaintext org keys or encrypted content.
// This file is intentionally dependency-free (WebCrypto only).

function b64u(bytes) {
  const bin = String.fromCharCode(...bytes);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function unb64u(input) {
  if (input == null) return new Uint8Array();
  let s = String(input).trim();

  // Strip data URL prefix if it ever sneaks in.
  if (s.startsWith("data:")) {
    const idx = s.indexOf(",");
    if (idx >= 0) s = s.slice(idx + 1);
  }

  // base64url -> base64
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  // remove whitespace/newlines
  s = s.replace(/\s+/g, "");
  // keep only legal base64 chars
  s = s.replace(/[^A-Za-z0-9+/=]/g, "");

  // pad to multiple of 4
  const pad = s.length % 4;
  if (pad) s += "=".repeat(4 - pad);

  try {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch (e) {
    const msg = e?.message || String(e);
    throw new Error(`Invalid base64 payload (decode failed): ${msg}`);
  }
}

async function hkdfAesKey(sharedSecret) {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    sharedSecret,
    "HKDF",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(32),
      info: new TextEncoder().encode("bondfire-orgkey-wrap-v1"),
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function generateUserKeypair() {
  // ECDH keypair used to wrap org symmetric keys.
  return crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"]
  );
}

export async function exportPublicKeyJwk(publicKey) {
  return crypto.subtle.exportKey("jwk", publicKey);
}

export async function exportPrivateKeyJwk(privateKey) {
  return crypto.subtle.exportKey("jwk", privateKey);
}

export async function importPublicKeyJwk(jwk) {
  return crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "ECDH", namedCurve: "P-256" },
    true,
    []
  );
}

export async function importPrivateKeyJwk(jwk) {
  return crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    ["deriveBits"]
  );
}

export async function wrapOrgKeyForMember(memberPublicKeyJwk, orgKeyRaw) {
  const memberPub = await importPublicKeyJwk(memberPublicKeyJwk);
  const eph = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"]
  );
  const shared = await crypto.subtle.deriveBits(
    { name: "ECDH", public: memberPub },
    eph.privateKey,
    256
  );
  const aes = await hkdfAesKey(shared);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, aes, orgKeyRaw)
  );
  const epkRaw = new Uint8Array(
    await crypto.subtle.exportKey("raw", eph.publicKey)
  );
  return {
    v: 1,
    alg: "ECDH-P256+HKDF-SHA256+AES-256-GCM",
    epk: b64u(epkRaw),
    iv: b64u(iv),
    ct: b64u(ct),
  };
}

export async function unwrapOrgKey(privateKeyJwk, wrapped) {
  const priv = await importPrivateKeyJwk(privateKeyJwk);
  const epkRaw = unb64u(wrapped.epk);
  const epk = await crypto.subtle.importKey(
    "raw",
    epkRaw,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    []
  );
  const shared = await crypto.subtle.deriveBits(
    { name: "ECDH", public: epk },
    priv,
    256
  );
  const aes = await hkdfAesKey(shared);
  const iv = unb64u(wrapped.iv);
  const ct = unb64u(wrapped.ct);
  const pt = new Uint8Array(
    await crypto.subtle.decrypt({ name: "AES-GCM", iv }, aes, ct)
  );
  return pt; // raw 32-byte org key
}

// Convenience: create a brand-new 32-byte org key.
export function newOrgKeyRaw() {
  return crypto.getRandomValues(new Uint8Array(32));
}
