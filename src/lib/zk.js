// src/lib/zk.js
import { api } from "../utils/api.js";

/*
  Pragmatic ZK v1 (+ Recovery Option A)
  - Device keypair: ECDH P-256 stored in IndexedDB (private) + public JWK in localStorage + server.
  - Org key: random 32 bytes; wrapped per member via ECDH(shared) -> HKDF -> AES-GCM.
  - Record encryption: AES-GCM with org key.
  - Recovery (Option A): passphrase-derived key encrypts org key; ciphertext stored server-side.
*/

const DB_NAME = "bondfire_zk";
const STORE = "keys";
const DEVICE_KEY_ID = "device_keypair_v1";
const LS_PUB = "bf_device_public_jwk_v1";
const LS_ORGKEY_CACHE_PREFIX = "bf_orgkey_cache_v1:";

/* ---------------- base64 helpers ---------------- */
function b64urlEncodeBytes(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function b64urlDecodeToBytes(s) {
  if (typeof s !== "string") throw new Error("Invalid base64 payload (not a string)");
  let t = s.trim().replace(/-/g, "+").replace(/_/g, "/");
  // padding
  while (t.length % 4) t += "=";
  let bin;
  try {
    bin = atob(t);
  } catch {
    throw new Error("Invalid base64 payload (decode failed)");
  }
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Back-compat aliases used by various patches/UI
export const toB64 = b64urlEncodeBytes;
export const fromB64 = b64urlDecodeToBytes;

export function kidFromJwk(jwk) {
  try {
    const x = String(jwk?.x || "");
    const y = String(jwk?.y || "");
    const raw = (x + "." + y).slice(0, 120);
    const b64s = btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
    return b64s.slice(0, 16) || "unknown";
  } catch {
    return "unknown";
  }
}

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const st = tx.objectStore(STORE);
    const req = st.get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key, val) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const st = tx.objectStore(STORE);
    const req = st.put(val, key);
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}

async function hkdfAesKey(sharedBits, saltBytes, infoStr) {
  const baseKey = await crypto.subtle.importKey("raw", sharedBits, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: saltBytes, info: new TextEncoder().encode(infoStr) },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function ensureDeviceKeypair({ register = true } = {}) {
  const existing = await idbGet(DEVICE_KEY_ID);
  if (existing?.privJwk && existing?.pubJwk) {
    if (!localStorage.getItem(LS_PUB)) localStorage.setItem(LS_PUB, JSON.stringify(existing.pubJwk));
    if (register) {
      await api("/api/auth/keys", { method: "POST", body: JSON.stringify({ public_key: JSON.stringify(existing.pubJwk) }) });
    }
    return existing;
  }

  const kp = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const pubJwk = await crypto.subtle.exportKey("jwk", kp.publicKey);
  const privJwk = await crypto.subtle.exportKey("jwk", kp.privateKey);

  await idbSet(DEVICE_KEY_ID, { pubJwk, privJwk });
  localStorage.setItem(LS_PUB, JSON.stringify(pubJwk));

  try {
    await api("/api/auth/keys", { method: "POST", body: JSON.stringify({ public_key: JSON.stringify(pubJwk) }) });
  } catch {
    // ignore
  }

  return { pubJwk, privJwk };
}

async function importPriv(privJwk) {
  return crypto.subtle.importKey("jwk", privJwk, { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
}

async function importPub(pubJwk) {
  return crypto.subtle.importKey("jwk", pubJwk, { name: "ECDH", namedCurve: "P-256" }, false, []);
}

export async function wrapForMember(orgKeyBytes, memberPublicJwk) {
  const device = await ensureDeviceKeypair();
  const priv = await importPriv(device.privJwk);
  const pub = await importPub(memberPublicJwk);

  const shared = await crypto.subtle.deriveBits({ name: "ECDH", public: pub }, priv, 256);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const aes = await hkdfAesKey(shared, salt, "bondfire:orgkey-wrap:v1");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, aes, orgKeyBytes);

  return JSON.stringify({ v: 1, sender_pub: device.pubJwk, salt: toB64(salt), iv: toB64(iv), ct: toB64(new Uint8Array(ct)) });
}

export async function unwrapOrgKey(wrappedStr) {
  const device = await ensureDeviceKeypair();
  const priv = await importPriv(device.privJwk);

  const wrapped = JSON.parse(wrappedStr);
  const salt = fromB64(wrapped.salt);
  const iv = fromB64(wrapped.iv);
  const ct = fromB64(wrapped.ct);

  const senderPubJwk = wrapped.sender_pub;
  if (!senderPubJwk) throw new Error("MISSING_SENDER_PUB");
  const senderPub = await importPub(senderPubJwk);

  const shared = await crypto.subtle.deriveBits({ name: "ECDH", public: senderPub }, priv, 256);
  const aes = await hkdfAesKey(shared, salt, "bondfire:orgkey-wrap:v1");
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, aes, ct);
  return new Uint8Array(pt);
}

export function randomOrgKey() {
  const k = new Uint8Array(32);
  crypto.getRandomValues(k);
  return k;
}

function assertOrgKeyBytes(orgKeyBytes) {
  if (!(orgKeyBytes instanceof Uint8Array)) {
    throw new Error("ORG_KEY_NOT_BYTES");
  }
  // We want 32 bytes for AES-256.
  if (orgKeyBytes.byteLength !== 32 && orgKeyBytes.byteLength !== 16) {
    throw new Error("ORG_KEY_BAD_LENGTH");
  }
}

export async function encryptWithOrgKey(orgKeyBytes, plaintext) {
  assertOrgKeyBytes(orgKeyBytes);
  const key = await crypto.subtle.importKey("raw", orgKeyBytes, { name: "AES-GCM" }, false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const pt = new TextEncoder().encode(plaintext);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, pt);
  return JSON.stringify({ v: 1, iv: toB64(iv), ct: toB64(new Uint8Array(ct)) });
}

export async function decryptWithOrgKey(orgKeyBytes, blobStr) {
  assertOrgKeyBytes(orgKeyBytes);
  const blob = typeof blobStr === "string" ? JSON.parse(blobStr) : blobStr || {};
  const key = await crypto.subtle.importKey("raw", orgKeyBytes, { name: "AES-GCM" }, false, ["decrypt"]);
  const iv = fromB64(blob.iv);
  const ct = fromB64(blob.ct);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return new TextDecoder().decode(pt);
}

export async function encryptJsonWithOrgKey(orgKeyBytes, obj) {
  return encryptWithOrgKey(orgKeyBytes, JSON.stringify(obj));
}

export async function decryptJsonWithOrgKey(orgKeyBytes, blobStr) {
  const s = await decryptWithOrgKey(orgKeyBytes, blobStr);
  return JSON.parse(s);
}

export function cacheOrgKey(orgId, keyBytes) {
  // Accept bytes only. If something passes a string here, you're about to brick yourself.
  if (typeof keyBytes === "string") {
    // If it is base64, decode to bytes.
    const decoded = fromB64(keyBytes);
    keyBytes = decoded;
  }
  assertOrgKeyBytes(keyBytes);
  localStorage.setItem(LS_ORGKEY_CACHE_PREFIX + orgId, toB64(keyBytes));
}

export function getCachedOrgKey(orgId) {
  const candidates = [];
  try { if (orgId) candidates.push(String(orgId)); } catch {}
  try { if (orgId) candidates.push(encodeURIComponent(String(orgId))); } catch {}
  try { if (orgId) candidates.push(decodeURIComponent(String(orgId))); } catch {}
  try { if (orgId) candidates.push(decodeURIComponent(decodeURIComponent(String(orgId)))); } catch {}

  for (const id of candidates) {
    try {
      const b64key = localStorage.getItem(LS_ORGKEY_CACHE_PREFIX + id);
      if (!b64key) continue;
      return fromB64(b64key);
    } catch {
      // ignore
    }
  }

  for (const id of candidates) {
    try {
      const b64key = localStorage.getItem(`bf_org_key_${id}`);
      if (!b64key) continue;
      if (String(b64key).trim().startsWith("[")) {
        try {
          const arr = JSON.parse(b64key);
          if (Array.isArray(arr)) return new Uint8Array(arr);
        } catch {}
      }
      return fromB64(b64key);
    } catch {
      // ignore
    }
  }

  return null;
}

/* ---------------- Recovery (Option A) ---------------- */
async function pbkdf2Key(passphrase, saltBytes) {
  const base = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: saltBytes, iterations: 210_000, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function wrapOrgKeyForRecovery(orgKeyBytes, passphrase) {
  if (!passphrase || String(passphrase).length < 8) throw new Error("Passphrase too short (min 8 chars).");
  assertOrgKeyBytes(orgKeyBytes);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await pbkdf2Key(passphrase, salt);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, orgKeyBytes);
  return {
    v: 1,
    kdf: { name: "PBKDF2", hash: "SHA-256", iterations: 210000 },
    salt: toB64(salt),
    iv: toB64(iv),
    ct: toB64(new Uint8Array(ct)),
  };
}

export async function unwrapOrgKeyFromRecovery(recoveryRow, passphrase) {
  if (!passphrase) throw new Error("Missing passphrase");
  const payload = recoveryRow?.payload || recoveryRow?.wrapped || recoveryRow;
  if (!payload) throw new Error("Missing recovery payload");

  const v = payload.v ?? payload.version ?? 1;
  if (Number(v) !== 1) throw new Error("Unsupported recovery version");

  const salt = fromB64(payload.salt);
  const iv = fromB64(payload.iv);
  const ct = fromB64(payload.ct);

  const key = await pbkdf2Key(passphrase, salt);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  const bytes = new Uint8Array(pt);
  assertOrgKeyBytes(bytes);
  return bytes;
}

export async function saveRecoveryToServer(orgId, wrappedPayload) {
  // Server should store this *for the current user + org*.
  return api(`/api/orgs/${orgId}/zk/recovery`, {
    method: "POST",
    body: JSON.stringify({ payload: wrappedPayload }),
  });
}

export async function loadRecoveryFromServer(orgId) {
  return api(`/api/orgs/${orgId}/zk/recovery`, { method: "GET" });
}

export async function deleteRecoveryFromServer(orgId) {
  return api(`/api/orgs/${orgId}/zk/recovery`, { method: "DELETE" });
}

// ---------------------------------------------------------------------------
// Back-compat shim
//
// Some older UI builds imported `getSessionMasterKey` from this module.
// The current design caches per-org keys (`getCachedOrgKey`) instead.
// Exporting a stub prevents build failures when that import still exists.
// ---------------------------------------------------------------------------
export function getSessionMasterKey() {
  return null;
}
