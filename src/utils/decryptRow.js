// src/utils/decryptRow.js
// Shared, defensive decryption helpers.
//
// Goals:
// - One place to decrypt rows that contain encrypted_blob (or similar).
// - Never throw from UI code paths.
// - Avoid page-specific hacks: caller chooses how to present "still encrypted" UI.

import { decryptWithOrgKey } from "../lib/zk.js";

/**
 * Safely decrypt a JSON blob and return an object.
 * @returns {{ ok: true, value: any } | { ok: false, error: string }}
 */
export async function safeDecryptJson(orgKeyBytes, blob) {
  try {
    if (!orgKeyBytes) return { ok: false, error: "missing_org_key" };
    if (!blob) return { ok: false, error: "missing_blob" };
    const s = await decryptWithOrgKey(orgKeyBytes, blob);
    const value = JSON.parse(s);
    return { ok: true, value };
  } catch (e) {
    return { ok: false, error: String(e?.message || e || "decrypt_failed") };
  }
}

/**
 * Decrypt a single row and merge decrypted fields onto the row.
 * If decryption fails, returns the original row unchanged.
 */
export async function decryptRow(orgKeyBytes, row, { blobField = "encrypted_blob" } = {}) {
  if (!row || !row[blobField]) return row;
  const r = await safeDecryptJson(orgKeyBytes, row[blobField]);
  if (!r.ok) return row;
  // Decrypted value should be a plain object. If not, still return original.
  if (!r.value || typeof r.value !== "object" || Array.isArray(r.value)) return row;
  return { ...row, ...r.value };
}

/**
 * Decrypt a list of rows.
 */
export async function decryptRows(orgKeyBytes, rows, opts) {
  const arr = Array.isArray(rows) ? rows : [];
  if (!orgKeyBytes) return arr;
  const out = [];
  for (const row of arr) out.push(await decryptRow(orgKeyBytes, row, opts));
  return out;
}
