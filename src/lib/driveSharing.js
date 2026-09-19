import { deviceKeyId } from '../../shared/privateContent.js';
import { ensureDeviceKeypair, randomOrgKey, unwrapOrgKey, wrapForMember } from './zk.js';

const driveShareKeyCache = new Map();

function cacheKey(orgId, kind, itemId, version = 0) {
  return [String(orgId || ''), String(kind || ''), String(itemId || ''), Number(version || 0)].join(':');
}

function parseJwk(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try { return JSON.parse(String(value)); } catch { return null; }
}

export function cacheDriveShareKey(orgId, kind, itemId, version, keyBytes) {
  if (!(keyBytes instanceof Uint8Array) || keyBytes.byteLength !== 32) throw new Error('Invalid Drive share key.');
  driveShareKeyCache.set(cacheKey(orgId, kind, itemId, version), keyBytes);
  driveShareKeyCache.set(cacheKey(orgId, kind, itemId, 0), keyBytes);
}

export function clearDriveShareKey(orgId, kind, itemId) {
  const prefix = [String(orgId || ''), String(kind || ''), String(itemId || '')].join(':') + ':';
  for (const key of driveShareKeyCache.keys()) if (key.startsWith(prefix)) driveShareKeyCache.delete(key);
}

export function getCachedDriveShareKey(orgId, kind, itemId, version = 0) {
  return driveShareKeyCache.get(cacheKey(orgId, kind, itemId, version))
    || driveShareKeyCache.get(cacheKey(orgId, kind, itemId, 0))
    || null;
}

export async function resolveDriveShareKey(orgId, kind, itemId, transport, {
  preferPending = false,
  parentId,
} = {}) {
  const device = await ensureDeviceKeypair();
  const deviceId = await deviceKeyId(device.pubJwk);
  const params = new URLSearchParams({ kind, itemId, deviceId });
  if (preferPending) params.set('pending', '1');
  if (parentId !== undefined) params.set('parentId', parentId === null ? '' : String(parentId));
  const detail = await transport(`/api/orgs/${encodeURIComponent(orgId)}/drive/shares?${params.toString()}`);
  if (!detail?.restricted && !detail?.pendingVersion) return { ...detail, key: null };

  const version = Number(detail?.requestedVersion || detail?.activeVersion || detail?.pendingVersion || 0);
  const rootKind = detail?.policyKind || kind;
  const rootId = detail?.policyItemId || itemId;
  let key = getCachedDriveShareKey(orgId, rootKind, rootId, version)
    || getCachedDriveShareKey(orgId, kind, itemId, version);

  if (!key && detail?.wrappedKey) {
    key = await unwrapOrgKey(detail.wrappedKey);
    cacheDriveShareKey(orgId, rootKind, rootId, version, key);
  }
  if (key) cacheDriveShareKey(orgId, kind, itemId, version, key);
  return { ...detail, version, key };
}

export async function buildDriveSharePreparation({ orgId, kind, itemId, members, meUserId, grants }) {
  const itemKey = randomOrgKey();
  const localDevice = await ensureDeviceKeypair();
  const localDeviceId = await deviceKeyId(localDevice.pubJwk);
  const normalizedGrants = [];
  const wanted = new Map();

  for (const row of Array.isArray(grants) ? grants : []) {
    const userId = String(row?.userId || '').trim();
    const permission = row?.permission === 'view' ? 'view' : 'edit';
    if (!userId) continue;
    wanted.set(userId, permission);
  }
  if (meUserId) wanted.set(String(meUserId), 'edit');
  for (const [userId, permission] of wanted) normalizedGrants.push({ userId, permission });

  const wraps = [];
  const seen = new Set();
  async function addWrap(userId, deviceId, publicKey) {
    const jwk = parseJwk(publicKey);
    if (!jwk || !deviceId) return;
    const marker = `${userId}\u0000${deviceId}`;
    if (seen.has(marker)) return;
    seen.add(marker);
    wraps.push({
      userId,
      deviceId,
      wrappedKey: await wrapForMember(itemKey, jwk),
    });
  }

  for (const member of Array.isArray(members) ? members : []) {
    const userId = String(member?.userId || member?.user_id || '').trim();
    if (!wanted.has(userId)) continue;
    for (const device of Array.isArray(member?.devices) ? member.devices : []) {
      await addWrap(userId, String(device?.device_id || device?.deviceId || ''), device?.public_key || device?.publicKey);
    }
    if ((!member?.devices || !member.devices.length) && member?.public_key) {
      const jwk = parseJwk(member.public_key);
      if (jwk) await addWrap(userId, await deviceKeyId(jwk), jwk);
    }
  }

  if (meUserId) await addWrap(String(meUserId), localDeviceId, localDevice.pubJwk);
  if (!wraps.some((row) => row.userId === String(meUserId))) throw new Error('This device does not have a usable encryption key.');

  return { orgId, kind, itemId, itemKey, grants: normalizedGrants, wraps };
}
