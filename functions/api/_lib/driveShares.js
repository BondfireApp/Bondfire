import { getDb } from './auth.js';

export const DRIVE_SHARE_KINDS = new Set(['drive/folders','drive/notes','drive/files']);

async function tryRun(db, sql) {
  try { await db.prepare(sql).run(); }
  catch (error) {
    const message = String(error?.message || error || '').toLowerCase();
    if (message.includes('duplicate column') || message.includes('already exists')) return;
    throw error;
  }
}

export async function ensureDriveShareSchema(db) {
  await tryRun(db, 'ALTER TABLE org_private_records ADD COLUMN created_by TEXT');
  await db.prepare(`CREATE TABLE IF NOT EXISTS drive_share_policies (
    org_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    item_id TEXT NOT NULL,
    owner_user_id TEXT NOT NULL,
    active_version INTEGER NOT NULL DEFAULT 0,
    pending_version INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY(org_id, kind, item_id)
  )`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS drive_share_grants (
    org_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    item_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    permission TEXT NOT NULL,
    PRIMARY KEY(org_id, kind, item_id, version, user_id)
  )`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS drive_share_keys (
    org_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    item_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    device_id TEXT NOT NULL,
    wrapped_key TEXT NOT NULL,
    PRIMARY KEY(org_id, kind, item_id, version, user_id, device_id)
  )`).run();
  await db.prepare('CREATE INDEX IF NOT EXISTS drive_share_grants_user ON drive_share_grants(org_id,user_id,version)').run();
  await db.prepare('CREATE INDEX IF NOT EXISTS drive_share_keys_user ON drive_share_keys(org_id,user_id,device_id,version)').run();
}

export function normalizeDriveShareKind(kind) {
  const value = String(kind || '').trim();
  if (!DRIVE_SHARE_KINDS.has(value)) throw new Error('INVALID_DRIVE_SHARE_KIND');
  return value;
}

async function recordRow(db, orgId, kind, itemId) {
  return db.prepare('SELECT id,parent_id,created_by FROM org_private_records WHERE org_id=? AND kind=? AND id=?')
    .bind(orgId, kind, itemId).first();
}

async function policyRow(db, orgId, kind, itemId) {
  return db.prepare('SELECT * FROM drive_share_policies WHERE org_id=? AND kind=? AND item_id=?')
    .bind(orgId, kind, itemId).first();
}

function pickVersion(policy, preferPending) {
  if (!policy) return 0;
  if (preferPending && Number(policy.pending_version || 0) > 0) return Number(policy.pending_version);
  return Number(policy.active_version || 0);
}

export async function getEffectiveDriveSharePolicy(db, orgId, kind, itemId, {
  preferPending = false,
  parentId,
} = {}) {
  await ensureDriveShareSchema(db);
  kind = normalizeDriveShareKind(kind);

  const direct = await policyRow(db, orgId, kind, itemId);
  const directVersion = pickVersion(direct, preferPending);
  if (direct && directVersion > 0) return { ...direct, version: directVersion, inherited: false, sourceKind: kind, sourceItemId: itemId };

  let cursor;
  if (parentId !== undefined) cursor = parentId || null;
  else cursor = (await recordRow(db, orgId, kind, itemId))?.parent_id || null;

  const seen = new Set();
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    const folderPolicy = await policyRow(db, orgId, 'drive/folders', cursor);
    const version = pickVersion(folderPolicy, preferPending);
    if (folderPolicy && version > 0) {
      return { ...folderPolicy, version, inherited: true, sourceKind: 'drive/folders', sourceItemId: cursor };
    }
    const parent = await recordRow(db, orgId, 'drive/folders', cursor);
    cursor = parent?.parent_id || null;
  }
  return null;
}

export async function driveAccessForUser(db, orgId, kind, itemId, userId, options = {}) {
  const policy = await getEffectiveDriveSharePolicy(db, orgId, kind, itemId, options);
  if (!policy || Number(policy.active_version || 0) < 1) {
    return { allowed: true, permission: 'edit', restricted: false, policy: null, canManage: false };
  }
  const version = Number(policy.active_version || 0);
  if (String(policy.owner_user_id) === String(userId)) {
    return { allowed: true, permission: 'owner', restricted: true, policy: { ...policy, version }, canManage: true };
  }
  const grant = await db.prepare(`SELECT permission FROM drive_share_grants
    WHERE org_id=? AND kind=? AND item_id=? AND version=? AND user_id=?`)
    .bind(orgId, policy.kind, policy.item_id, version, userId).first();
  const permission = grant?.permission === 'edit' ? 'edit' : grant?.permission === 'view' ? 'view' : '';
  return {
    allowed: !!permission,
    permission,
    restricted: true,
    policy: { ...policy, version },
    canManage: false,
  };
}

export async function decorateDriveRecord(db, orgId, kind, row, userId) {
  const access = await driveAccessForUser(db, orgId, kind, row.id, userId);
  if (!access.allowed) return null;
  return {
    ...row,
    sharePermission: access.permission,
    shareRestricted: access.restricted,
    shareOwnerUserId: access.policy?.owner_user_id || null,
    shareRootKind: access.policy?.kind || null,
    shareRootId: access.policy?.item_id || null,
    shareInherited: !!access.policy?.inherited,
  };
}

export async function listSharedWithUser(env, orgId, userId) {
  const db = getDb(env);
  await ensureDriveShareSchema(db);
  const rows = await db.prepare(`
    SELECT p.kind,p.item_id,p.owner_user_id,p.active_version,g.permission,p.updated_at
    FROM drive_share_policies p
    JOIN drive_share_grants g
      ON g.org_id=p.org_id AND g.kind=p.kind AND g.item_id=p.item_id AND g.version=p.active_version
    WHERE p.org_id=? AND p.active_version>0 AND g.user_id=? AND p.owner_user_id<>?
    ORDER BY p.updated_at DESC
  `).bind(orgId, userId, userId).all();
  return (rows.results || []).map((row) => ({
    kind: row.kind,
    itemId: row.item_id,
    ownerUserId: row.owner_user_id,
    permission: row.permission,
    version: Number(row.active_version || 0),
    updatedAt: Number(row.updated_at || 0),
  }));
}

export async function getShareDetail(db, orgId, kind, itemId, userId, deviceId, { preferPending = false, parentId } = {}) {
  const policy = await getEffectiveDriveSharePolicy(db, orgId, kind, itemId, { preferPending, parentId });
  if (!policy) return { mode: 'organization', restricted: false, permission: 'edit', canManage: false, wrappedKey: null };

  const activeVersion = Number(policy.active_version || 0);
  const requestedVersion = preferPending && Number(policy.pending_version || 0) > 0
    ? Number(policy.pending_version)
    : activeVersion;
  let permission = '';
  const isOwner = String(policy.owner_user_id) === String(userId);
  if (isOwner) permission = 'owner';
  else if (activeVersion > 0) {
    const grant = await db.prepare(`SELECT permission FROM drive_share_grants
      WHERE org_id=? AND kind=? AND item_id=? AND version=? AND user_id=?`)
      .bind(orgId, policy.kind, policy.item_id, activeVersion, userId).first();
    permission = grant?.permission || '';
  }

  const wrapped = requestedVersion > 0 && deviceId
    ? await db.prepare(`SELECT wrapped_key FROM drive_share_keys
        WHERE org_id=? AND kind=? AND item_id=? AND version=? AND user_id=? AND device_id=?`)
        .bind(orgId, policy.kind, policy.item_id, requestedVersion, userId, deviceId).first()
    : null;

  return {
    mode: 'restricted',
    restricted: activeVersion > 0,
    permission,
    canManage: isOwner,
    ownerUserId: policy.owner_user_id,
    policyKind: policy.kind,
    policyItemId: policy.item_id,
    inherited: !!policy.inherited,
    activeVersion,
    pendingVersion: Number(policy.pending_version || 0) || null,
    requestedVersion,
    wrappedKey: wrapped?.wrapped_key || null,
  };
}


export async function deleteDriveShareMetadata(db, orgId, items = []) {
  await ensureDriveShareSchema(db);
  const unique = new Map();
  for (const item of items || []) {
    const kind = String(item?.kind || "").trim();
    const itemId = String(item?.itemId || item?.id || "").trim();
    if (!DRIVE_SHARE_KINDS.has(kind) || !itemId) continue;
    unique.set(`${kind}\u0000${itemId}`, { kind, itemId });
  }
  for (const { kind, itemId } of unique.values()) {
    await db.batch([
      db.prepare("DELETE FROM drive_share_keys WHERE org_id=? AND kind=? AND item_id=?").bind(orgId, kind, itemId),
      db.prepare("DELETE FROM drive_share_grants WHERE org_id=? AND kind=? AND item_id=?").bind(orgId, kind, itemId),
      db.prepare("DELETE FROM drive_share_policies WHERE org_id=? AND kind=? AND item_id=?").bind(orgId, kind, itemId),
    ]);
  }
}
