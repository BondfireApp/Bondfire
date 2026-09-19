import { requireOrgRole, getDb } from '../../../_lib/auth.js';
import { bad, json } from '../../../_lib/http.js';
import { requireCookieCsrf } from '../../../_lib/csrf.js';
import {
  ensureDriveShareSchema,
  normalizeDriveShareKind,
  getShareDetail,
  listSharedWithUser,
} from '../../../_lib/driveShares.js';

const PERMISSIONS = new Set(['view', 'edit']);

async function record(db, orgId, kind, itemId) {
  return db.prepare('SELECT id,created_by FROM org_private_records WHERE org_id=? AND kind=? AND id=?')
    .bind(orgId, kind, itemId).first();
}

async function policy(db, orgId, kind, itemId) {
  return db.prepare('SELECT * FROM drive_share_policies WHERE org_id=? AND kind=? AND item_id=?')
    .bind(orgId, kind, itemId).first();
}

function cleanGrants(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  for (const row of value) {
    const userId = String(row?.userId || row?.user_id || '').trim();
    const permission = String(row?.permission || '').trim();
    if (!userId || !PERMISSIONS.has(permission) || seen.has(userId)) continue;
    seen.add(userId);
    out.push({ userId, permission });
  }
  return out;
}

function cleanWraps(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  const seen = new Set();
  for (const row of value) {
    const userId = String(row?.userId || row?.user_id || '').trim();
    const deviceId = String(row?.deviceId || row?.device_id || '').trim();
    const wrappedKey = String(row?.wrappedKey || row?.wrapped_key || '').trim();
    const key = `${userId}\u0000${deviceId}`;
    if (!userId || !deviceId || !wrappedKey || seen.has(key)) continue;
    if (wrappedKey.length > 32 * 1024) continue;
    seen.add(key);
    out.push({ userId, deviceId, wrappedKey });
  }
  return out;
}

async function validateRecipients(db, orgId, grants, wraps) {
  const userIds = [...new Set([...grants.map((row) => row.userId), ...wraps.map((row) => row.userId)])];
  if (!userIds.length) return true;
  const placeholders = userIds.map(() => '?').join(',');
  const members = await db.prepare(`SELECT user_id FROM org_memberships WHERE org_id=? AND user_id IN (${placeholders})`)
    .bind(orgId, ...userIds).all();
  const allowedUsers = new Set((members.results || []).map((row) => String(row.user_id)));
  if (userIds.some((id) => !allowedUsers.has(id))) return false;

  for (const row of wraps) {
    const device = await db.prepare('SELECT device_id FROM user_device_keys WHERE user_id=? AND device_id=?')
      .bind(row.userId, row.deviceId).first();
    if (!device) return false;
  }
  return true;
}

export async function onRequest({ env, request, params }) {
  const orgId = params.orgId;
  const db = getDb(env);
  if (!db) return bad(500, 'NO_DB_BINDING');
  await ensureDriveShareSchema(db);

  if (request.method === 'GET') {
    const gate = await requireOrgRole({ env, request, orgId, minRole: 'viewer' });
    if (!gate.ok) return gate.resp;
    const url = new URL(request.url);
    if (url.searchParams.get('mine') === '1') {
      return json({ ok: true, items: await listSharedWithUser(env, orgId, gate.user.sub) });
    }

    let kind;
    try { kind = normalizeDriveShareKind(url.searchParams.get('kind')); }
    catch { return bad(400, 'INVALID_DRIVE_SHARE_KIND'); }
    const itemId = String(url.searchParams.get('itemId') || '').trim();
    const deviceId = String(url.searchParams.get('deviceId') || '').trim();
    const parentId = url.searchParams.has('parentId') ? (String(url.searchParams.get('parentId') || '').trim() || null) : undefined;
    if (!itemId) return bad(400, 'MISSING_ITEM_ID');

    const detail = await getShareDetail(db, orgId, kind, itemId, gate.user.sub, deviceId, {
      preferPending: url.searchParams.get('pending') === '1',
      parentId,
    });
    if (detail.restricted && !detail.permission && !['admin', 'owner'].includes(String(gate.role || ''))) {
      return bad(403, 'DRIVE_SHARE_ACCESS_DENIED');
    }

    const canManage = detail.canManage || ['admin', 'owner'].includes(String(gate.role || ''));
    let grants = [];
    if (canManage && detail.policyKind && detail.policyItemId) {
      const version = url.searchParams.get('pending') === '1' && detail.pendingVersion
        ? detail.pendingVersion
        : detail.activeVersion;
      if (version) {
        const rows = await db.prepare(`SELECT user_id,permission FROM drive_share_grants
          WHERE org_id=? AND kind=? AND item_id=? AND version=? ORDER BY user_id`)
          .bind(orgId, detail.policyKind, detail.policyItemId, version).all();
        grants = (rows.results || []).map((row) => ({ userId: row.user_id, permission: row.permission }));
      }
    }
    return json({ ok: true, ...detail, canManage, grants });
  }

  const gate = await requireOrgRole({ env, request, orgId, minRole: 'member' });
  if (!gate.ok) return gate.resp;
  const csrf = requireCookieCsrf(request);
  if (csrf) return csrf;
  if (request.method !== 'POST') return bad(405, 'METHOD_NOT_ALLOWED');

  const body = await request.json().catch(() => ({}));
  let kind;
  try { kind = normalizeDriveShareKind(body.kind); }
  catch { return bad(400, 'INVALID_DRIVE_SHARE_KIND'); }
  const itemId = String(body.itemId || '').trim();
  if (!itemId) return bad(400, 'MISSING_ITEM_ID');
  const item = await record(db, orgId, kind, itemId);
  if (!item) return bad(404, 'NOT_FOUND');

  const existing = await policy(db, orgId, kind, itemId);
  const ownerUserId = String(existing?.owner_user_id || item.created_by || '').trim();
  const adminish = ['admin', 'owner'].includes(String(gate.role || ''));
  if (ownerUserId && ownerUserId !== String(gate.user.sub) && !adminish) return bad(403, 'DRIVE_SHARE_MANAGER_REQUIRED');
  if (!ownerUserId && !adminish) return bad(403, 'DRIVE_SHARE_OWNER_UNKNOWN');

  const action = String(body.action || 'prepare');
  if (action === 'cancel') {
    if (!existing) return json({ ok: true, cancelled: true });
    const pending = Number(existing.pending_version || 0);
    if (pending) {
      await db.batch([
        db.prepare('DELETE FROM drive_share_grants WHERE org_id=? AND kind=? AND item_id=? AND version=?').bind(orgId, kind, itemId, pending),
        db.prepare('DELETE FROM drive_share_keys WHERE org_id=? AND kind=? AND item_id=? AND version=?').bind(orgId, kind, itemId, pending),
        db.prepare('UPDATE drive_share_policies SET pending_version=NULL,updated_at=? WHERE org_id=? AND kind=? AND item_id=?').bind(Date.now(), orgId, kind, itemId),
      ]);
    }
    return json({ ok: true, cancelled: true });
  }

  if (action === 'finalize') {
    if (!existing?.pending_version) return bad(409, 'DRIVE_SHARE_NOT_PREPARED');
    const nextVersion = Number(existing.pending_version);
    await db.batch([
      db.prepare('UPDATE drive_share_policies SET active_version=?,pending_version=NULL,updated_at=? WHERE org_id=? AND kind=? AND item_id=?')
        .bind(nextVersion, Date.now(), orgId, kind, itemId),
      db.prepare('DELETE FROM drive_share_grants WHERE org_id=? AND kind=? AND item_id=? AND version<>?')
        .bind(orgId, kind, itemId, nextVersion),
      db.prepare('DELETE FROM drive_share_keys WHERE org_id=? AND kind=? AND item_id=? AND version<>?')
        .bind(orgId, kind, itemId, nextVersion),
    ]);
    return json({ ok: true, finalized: true, version: nextVersion });
  }

  if (action !== 'prepare') return bad(400, 'INVALID_DRIVE_SHARE_ACTION');
  const grants = cleanGrants(body.grants);
  const wraps = cleanWraps(body.wraps);
  if (!await validateRecipients(db, orgId, grants, wraps)) return bad(400, 'INVALID_DRIVE_SHARE_RECIPIENT');

  const owner = ownerUserId || String(gate.user.sub);
  if (!grants.some((row) => row.userId === owner)) grants.push({ userId: owner, permission: 'edit' });
  const ownerWraps = wraps.filter((row) => row.userId === owner);
  if (!ownerWraps.length) return bad(400, 'DRIVE_SHARE_OWNER_KEY_REQUIRED');
  if (grants.some((grant) => !wraps.some((wrap) => wrap.userId === grant.userId))) return bad(400, 'DRIVE_SHARE_RECIPIENT_KEY_REQUIRED');

  const current = existing || { active_version: 0, pending_version: 0 };
  const nextVersion = Math.max(Number(current.active_version || 0), Number(current.pending_version || 0)) + 1;
  const now = Date.now();

  await db.batch([
    db.prepare(`INSERT INTO drive_share_policies(org_id,kind,item_id,owner_user_id,active_version,pending_version,created_at,updated_at)
      VALUES(?,?,?,?,0,?,?,?)
      ON CONFLICT(org_id,kind,item_id) DO UPDATE SET owner_user_id=excluded.owner_user_id,pending_version=excluded.pending_version,updated_at=excluded.updated_at`)
      .bind(orgId, kind, itemId, owner, nextVersion, now, now),
    db.prepare('DELETE FROM drive_share_grants WHERE org_id=? AND kind=? AND item_id=? AND version=?').bind(orgId, kind, itemId, nextVersion),
    db.prepare('DELETE FROM drive_share_keys WHERE org_id=? AND kind=? AND item_id=? AND version=?').bind(orgId, kind, itemId, nextVersion),
  ]);

  for (const grant of grants) {
    await db.prepare(`INSERT INTO drive_share_grants(org_id,kind,item_id,version,user_id,permission)
      VALUES(?,?,?,?,?,?)`).bind(orgId, kind, itemId, nextVersion, grant.userId, grant.permission).run();
  }
  for (const wrap of wraps) {
    await db.prepare(`INSERT INTO drive_share_keys(org_id,kind,item_id,version,user_id,device_id,wrapped_key)
      VALUES(?,?,?,?,?,?,?)`).bind(orgId, kind, itemId, nextVersion, wrap.userId, wrap.deviceId, wrap.wrappedKey).run();
  }

  return json({ ok: true, prepared: true, version: nextVersion });
}
