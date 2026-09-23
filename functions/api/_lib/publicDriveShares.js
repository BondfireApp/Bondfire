import { getDb } from './auth.js';
import { getPrivateMode, ensurePrivateSchema } from './privateStore.js';
import { ensureDriveSchema } from './drive.js';
import { driveAccessForUser } from './driveShares.js';
import { getOrgIsolationState } from './orgLockdown.js';

export const PUBLIC_DRIVE_KINDS = new Set(['drive/files', 'drive/notes', 'drive/folders', 'drive/templates']);

export async function ensurePublicDriveShares(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS drive_public_shares (
    org_id TEXT NOT NULL, kind TEXT NOT NULL, item_id TEXT NOT NULL,
    token TEXT NOT NULL UNIQUE, wrapped_key TEXT NOT NULL, publisher TEXT NOT NULL,
    manifest TEXT NOT NULL, version TEXT NOT NULL, updated_at INTEGER NOT NULL,
    PRIMARY KEY(org_id,kind,item_id)
  )`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS drive_public_share_chunks (
    version TEXT NOT NULL, position INTEGER NOT NULL, ciphertext TEXT NOT NULL,
    PRIMARY KEY(version,position)
  )`).run();
}

export async function publicShareItemAccess(env, orgId, kind, id, userId) {
  if (!PUBLIC_DRIVE_KINDS.has(kind) || !id) return false;
  const db = getDb(env);
  const mode = await getPrivateMode(env, orgId);
  if (mode) {
    if (mode.state !== 'enabled') return false;
    await ensurePrivateSchema(db);
    const row = await db.prepare('SELECT id FROM org_private_records WHERE org_id=? AND kind=? AND id=? AND deleting=0').bind(orgId, kind, id).first();
    if (!row) return false;
    if (kind === 'drive/templates') return true;
    const access = await driveAccessForUser(db, orgId, kind, id, userId);
    return access.allowed && access.permission !== 'view';
  }
  await ensureDriveSchema(env);
  const table = { 'drive/files': 'drive_files', 'drive/notes': 'drive_notes', 'drive/folders': 'drive_folders', 'drive/templates': 'drive_templates' }[kind];
  return !!await db.prepare(`SELECT id FROM ${table} WHERE org_id=? AND id=?`).bind(orgId, id).first();
}

export function validShareCiphertext(value) {
  try {
    const obj = JSON.parse(value);
    return obj.v === 1 && typeof obj.iv === 'string' && /^[A-Za-z0-9_-]{16}$/.test(obj.iv)
      && typeof obj.ct === 'string' && /^[A-Za-z0-9_-]{22,}$/.test(obj.ct)
      && Object.keys(obj).every(key => ['v', 'iv', 'ct'].includes(key));
  } catch { return false; }
}

export async function readPublicDriveShare(env, token) {
  const db = getDb(env);
  await ensurePublicDriveShares(db);
  const share = await db.prepare('SELECT * FROM drive_public_shares WHERE token=?').bind(token).first();
  if (!share) return null;
  if ((await getOrgIsolationState({ env, orgId: share.org_id })).isolated) return null;
  if (!await db.prepare('SELECT id FROM orgs WHERE id=?').bind(share.org_id).first()) return null;
  const membership = await db.prepare('SELECT role FROM org_memberships WHERE org_id=? AND user_id=?').bind(share.org_id, share.publisher).first();
  if (!['member', 'admin', 'owner'].includes(membership?.role)) return null;
  // A deleted item or revoked publisher access also disables its published copy.
  for (const item of JSON.parse(share.manifest)) {
    if (!await publicShareItemAccess(env, share.org_id, item.kind, item.id, share.publisher)) return null;
  }
  const chunks = await db.prepare('SELECT ciphertext FROM drive_public_share_chunks WHERE version=? ORDER BY position').bind(share.version).all();
  if (!chunks.results?.length) return null;
  return chunks.results.map(row => row.ciphertext).join('');
}
