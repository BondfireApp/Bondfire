// Cloudflare Pages Functions helper crypto utilities
// - AES-GCM encrypt/decrypt for storing secrets at rest
// - TOTP (RFC 6238) verify with clock-skew window

const te = new TextEncoder();
const td = new TextDecoder();

/* ---------------- base32 (RFC 4648) ---------------- */
const B32_ALPH = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function randomBase32(byteLen = 20) {
  const bytes = new Uint8Array(byteLen);
  crypto.getRandomValues(bytes);
  return bytesToBase32(bytes);
}

export function bytesToBase32(bytes) {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32_ALPH[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32_ALPH[(value << (5 - bits)) & 31];
  return out;
}

export function base32ToBytes(b32) {
  const clean = String(b32 || "")
    .toUpperCase()
    .replace(/=+$/g, "")
    .replace(/[^A-Z2-7]/g, "");

  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    const idx = B32_ALPH.indexOf(ch);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

/* ---------------- hashing ---------------- */
export async function sha256Hex(input) {
  const buf = await crypto.subtle.digest("SHA-256", te.encode(String(input)));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/* ---------------- AES-GCM for at-rest secrets ---------------- */
async function importAesKeyFromString(secret) {
  // Derive a stable 256-bit key from an env string.
  const digest = await crypto.subtle.digest("SHA-256", te.encode(String(secret || "")));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function aesGcmEncrypt(plaintext, secretString) {
  const key = await importAesKeyFromString(secretString);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, te.encode(String(plaintext)));
  const b64 = (u8) => btoa(String.fromCharCode(...u8));
  return {
    v: 1,
    iv: b64(iv),
    ct: b64(new Uint8Array(ct)),
  };
}

export async function aesGcmDecrypt(encObj, secretString) {
  const key = await importAesKeyFromString(secretString);
  const fromB64 = (s) => new Uint8Array(atob(String(s)).split("").map((c) => c.charCodeAt(0)));
  const iv = fromB64(encObj?.iv);
  const ct = fromB64(encObj?.ct);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return td.decode(pt);
}

/* ---------------- TOTP (RFC 6238) ---------------- */
async function hmacSha1(keyBytes, msgBytes) {
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, msgBytes);
  return new Uint8Array(sig);
}

function counterBytes(counter) {
  // 8-byte big-endian
  const buf = new Uint8Array(8);
  let x = BigInt(counter);
  for (let i = 7; i >= 0; i--) {
    buf[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  return buf;
}

async function totpAt(secretB32, counter, digits = 6) {
  const keyBytes = base32ToBytes(secretB32);
  const msg = counterBytes(counter);
  const h = await hmacSha1(keyBytes, msg);
  const offset = h[h.length - 1] & 0x0f;
  const bin =
    ((h[offset] & 0x7f) << 24) |
    (h[offset + 1] << 16) |
    (h[offset + 2] << 8) |
    h[offset + 3];
  const mod = 10 ** digits;
  const code = (bin % mod).toString().padStart(digits, "0");
  return code;
}

export async function totpVerify(secretB32, code, opts = {}) {
  const digits = opts.digits ?? 6;
  const step = opts.step ?? 30;
  const window = opts.window ?? 1; // accept ±1 step by default

  const cleanCode = String(code || "").replace(/\s+/g, "");
  if (!/^[0-9]{6,8}$/.test(cleanCode)) return false;

  const now = Math.floor(Date.now() / 1000);
  const counter = Math.floor(now / step);

  for (let w = -window; w <= window; w++) {
    const expected = await totpAt(secretB32, counter + w, digits);
    if (timingSafeEqual(expected, cleanCode)) return true;
  }
  return false;
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}
