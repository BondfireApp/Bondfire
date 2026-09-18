import { decryptWithOrgKey, encryptWithOrgKey, getCachedOrgKey } from './zk.js';

export const DRIVE_ZK_PREFIX = 'bfzk1:';
export const DRIVE_ZK_FILE_MIME = 'application/vnd.bondfire.zk-file';

function toB64(bytes) {
  let bin = '';
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  for (let i = 0; i < arr.length; i += 1) bin += String.fromCharCode(arr[i]);
  return btoa(bin);
}
function fromB64(str) {
  const bin = atob(String(str || ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}
export function getDriveOrgKey(orgId) {
  try { return getCachedOrgKey(orgId); } catch { return null; }
}
export function isZkString(value) {
  return typeof value === 'string' && value.startsWith(DRIVE_ZK_PREFIX);
}
export async function encryptDriveText(orgId, plaintext) {
  const key = getDriveOrgKey(orgId);
  if (!key) throw new Error('ORG_KEY_MISSING');
  return DRIVE_ZK_PREFIX + await encryptWithOrgKey(key, String(plaintext || ''));
}
export async function decryptDriveText(orgId, value, fallback = '') {
  if (value == null || value === '') return fallback;
  if (!isZkString(value)) throw new Error('CIPHERTEXT_REQUIRED');
  const key = getDriveOrgKey(orgId);
  if (!key) throw new Error('ORG_KEY_MISSING');
  try {
    return await decryptWithOrgKey(key, String(value).slice(DRIVE_ZK_PREFIX.length));
  } catch {
    throw new Error('DECRYPT_FAILED');
  }
}
export async function encryptDriveJson(orgId, obj) {
  return encryptDriveText(orgId, JSON.stringify(obj));
}
export async function decryptDriveJson(orgId, value, fallback = null) {
  try {
    const text = await decryptDriveText(orgId, value, '');
    if (!text) return fallback;
    return JSON.parse(text);
  } catch (error) {
    if (error?.message === 'ORG_KEY_MISSING') throw error;
    return fallback;
  }
}
async function importAesKey(keyBytes, usage) {
  return crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, [usage]);
}
export async function encryptDriveBytesToString(orgId, bytes) {
  const keyBytes = getDriveOrgKey(orgId);
  if (!keyBytes) throw new Error('ORG_KEY_MISSING');
  const key = await importAesKey(keyBytes, 'encrypt');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const payload = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, payload);
  return JSON.stringify({ v: 1, iv: toB64(iv), ct: toB64(new Uint8Array(ct)) });
}
export async function decryptDriveBytesString(orgId, value) {
  const keyBytes = getDriveOrgKey(orgId);
  if (!keyBytes) throw new Error('ORG_KEY_MISSING');
  const key = await importAesKey(keyBytes, 'decrypt');
  const blob = typeof value === 'string' ? JSON.parse(value) : value || {};
  const iv = fromB64(blob.iv || '');
  const ct = fromB64(blob.ct || '');
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return new Uint8Array(pt);
}
