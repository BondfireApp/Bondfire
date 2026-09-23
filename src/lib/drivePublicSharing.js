import { api } from '../utils/api.js';
import { loadPrivateKey, encryptPrivate, decryptPrivate } from './privateCrypto.js';
import { getCachedOrgKey, randomOrgKey, encryptWithOrgKey } from './zk.js';

const endpoint = orgId => `/api/orgs/${encodeURIComponent(orgId)}/drive/public-share`;
export const shareKeyHex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
const keyBytes = hex => Uint8Array.from(hex.match(/.{2}/g), pair => parseInt(pair, 16));

async function wrappingKey(orgId) {
  const status = await api(`/api/orgs/${encodeURIComponent(orgId)}/privacy`);
  const key = status?.state === 'enabled' ? await loadPrivateKey(orgId, status, api) : getCachedOrgKey(orgId);
  if (!key) throw new Error('Unlock Drive on this device before sharing.');
  return key;
}

export function publicDriveLink(detail) {
  return detail?.token && detail?.key ? `${window.location.origin}/drive-share.html?share=${detail.token}#${detail.key}` : '';
}

export async function loadPublicDriveShare(orgId, target) {
  const detail = await api(`${endpoint(orgId)}?${new URLSearchParams({ kind: target.kind, itemId: target.id })}`);
  if (!detail.enabled) return detail;
  try {
    const clear = await decryptPrivate(await wrappingKey(orgId), detail.wrappedKey, orgId, target.kind, target.id);
    return { ...detail, key: clear.key };
  } catch {
    return { ...detail, key: '', keyUnavailable: true };
  }
}

export function publicDriveItem(kind, row, path = '') {
  if (kind === 'drive/folders') return { kind, name: row.name || 'Folder', path };
  if (kind === 'drive/templates') return { kind, name: `${row.name || 'Template'}.bftemplate`, mime: 'application/json', text: JSON.stringify({ name: row.name, title: row.title || '', body: row.body || '' }), path };
  if (kind === 'drive/notes') {
    return { kind, name: `${row.title || row.name || 'Untitled'}.md`, mime: 'text/markdown', text: String(row.body || ''), path };
  }
  const item = { kind, name: row.name || 'File', mime: row.mime || 'application/octet-stream', path };
  if (row.textContent !== undefined) item.text = String(row.textContent);
  if (row.dataUrl) item.dataUrl = row.dataUrl;
  let parsed = null;
  try { parsed = JSON.parse(item.text || ''); } catch {}
  if (/\.bfform$/i.test(item.name) || item.mime.includes('bondfire.form') || parsed?.type === 'bondfire-form') {
    // Only publish the form definition, never submissions or response keys.
    const form = parsed || JSON.parse(item.text || '');
    item.text = JSON.stringify({ type: 'bondfire-form', version: form.version, title: form.title, description: form.description, blocks: form.blocks || [], fields: form.fields || [], responses: [], publicShare: { enabled: false } });
    delete item.dataUrl;
  }
  if (item.text === undefined && !item.dataUrl) throw new Error(`Could not read ${item.name} for sharing.`);
  return item;
}

export async function publishDriveShare(orgId, target, existing, items, manifest) {
  if (existing?.enabled && !existing.key) throw new Error('Stop sharing this old link first, then create a new link from this device.');
  const key = existing?.key ? keyBytes(existing.key) : randomOrgKey();
  const hex = shareKeyHex(key);
  const ciphertext = await encryptWithOrgKey(key, JSON.stringify({ version: 1, title: target.label || 'Shared Drive item', items }));
  const wrappedKey = await encryptPrivate(await wrappingKey(orgId), { key: hex }, orgId, target.kind, target.id);
  const result = await api(endpoint(orgId), { method: 'POST', body: JSON.stringify({ kind: target.kind, itemId: target.id, token: existing?.token || '', ciphertext, wrappedKey, manifest }) });
  return { ...result, key: hex };
}

export async function stopPublicDriveShare(orgId, target) {
  return api(endpoint(orgId), { method: 'DELETE', body: JSON.stringify({ kind: target.kind, itemId: target.id }) });
}
