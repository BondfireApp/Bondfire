const REC_API_BASE = (import.meta.env.VITE_REC_API_BASE_URL || "https://rec.bjgarr.workers.dev").replace(/\/+$/, "");

function toArrayBuffer(bytes) {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function base64ToBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function normalizeRecRecoveryPhrase(value) {
  return String(value || "").trim().toLowerCase().replace(/[.!?]+$/g, "").replace(/\s+/g, " ");
}

async function readJson(response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error || `REC request failed (${response.status})`);
  return payload;
}
async function deriveWrapKey(secret, salt) {
  const imported = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: toArrayBuffer(salt), iterations: 100000, hash: "SHA-256" },
    imported,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"]
  );
}

async function unwrapRecordingKey(manifest, phrase) {
  const salt = base64ToBytes(manifest.wrappedKey.wrappedKeySaltB64);
  const iv = base64ToBytes(manifest.wrappedKey.wrappedKeyIvB64);
  const wrapKey = await deriveWrapKey(normalizeRecRecoveryPhrase(phrase), salt);
  const raw = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: toArrayBuffer(iv) },
    wrapKey,
    toArrayBuffer(base64ToBytes(manifest.wrappedKey.wrappedKeyB64))
  );
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
}
async function fetchManifest(archiveId, phrase) {
  const response = await fetch(`${REC_API_BASE}/api/retrieve/anonymous/manifest`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ archiveId, phrase: normalizeRecRecoveryPhrase(phrase) }),
  });
  return readJson(response);
}

async function fetchChunk(archiveId, phrase, sequence) {
  const response = await fetch(`${REC_API_BASE}/api/retrieve/anonymous/chunk`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ archiveId, phrase: normalizeRecRecoveryPhrase(phrase), sequence }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload?.error || `Could not retrieve chunk ${sequence}`);
  }
  return response.arrayBuffer();
}

export async function recoverRecRecordingBlob(archiveId, phrase) {
  const manifest = await fetchManifest(archiveId, phrase);
  const key = await unwrapRecordingKey(manifest, phrase);
  const parts = [];
  const chunks = [...(manifest.chunks || [])].sort((a, b) => Number(a.sequence) - Number(b.sequence));
  for (const chunk of chunks) {
    const ciphertext = await fetchChunk(archiveId, phrase, chunk.sequence);
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: toArrayBuffer(base64ToBytes(chunk.ivB64)) },
      key,
      ciphertext
    );
    parts.push(new Uint8Array(plain));
  }
  return {
    blob: new Blob(parts, { type: "video/webm" }),
    manifest,
  };
}

export function downloadRecBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
