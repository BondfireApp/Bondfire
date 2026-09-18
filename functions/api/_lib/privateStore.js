import { deletePrivateFileBlobs } from './privateBlobs.js';
import { getDb, requireOrgRole } from './auth.js';
import { bad, json } from './http.js';
import { requireCookieCsrf } from './csrf.js';
import { PRIVATE_CONTENT, PRIVATE_KINDS, contentContext, isCiphertext } from '../../../shared/privateContent.js';
import {ensurePublicationSchema} from './privatePublication.js';

export async function ensurePrivateSchema(db) {
  for (const sql of [
    `CREATE TABLE IF NOT EXISTS org_private_mode (org_id TEXT PRIMARY KEY, state TEXT NOT NULL, started_at INTEGER NOT NULL, completed_at INTEGER, key_check TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS org_private_records (org_id TEXT NOT NULL, kind TEXT NOT NULL, id TEXT NOT NULL, parent_id TEXT, ciphertext TEXT NOT NULL, revision INTEGER NOT NULL, deleting INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY(org_id,kind,id))`,
    `CREATE INDEX IF NOT EXISTS private_records_parent ON org_private_records(org_id,kind,parent_id)`,
    `CREATE TABLE IF NOT EXISTS org_private_migrations (org_id TEXT NOT NULL, kind TEXT NOT NULL, id TEXT NOT NULL, source_hash TEXT NOT NULL, PRIMARY KEY(org_id,kind,id))`,
  ]) await db.prepare(sql).run();
}
export async function getPrivateMode(env, orgId) {
  const db = getDb(env);
  const exists = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='org_private_mode'").first();
  if (!exists) return null;
  return await db.prepare('SELECT * FROM org_private_mode WHERE org_id=?').bind(orgId).first();
}
export function storedRecord(row) {
  if (!row) return null;
  return { id: row.id, parentId: row.parent_id, roomId: row.parent_id, ciphertext: row.ciphertext,
    revision: row.revision, deleting: !!row.deleting, created_at: row.created_at, updated_at: row.updated_at,
    createdAt: row.created_at, updatedAt: row.updated_at };
}
export async function privateRecords({ env, request, orgId, kind, id = '' }) {
  const contract = PRIVATE_CONTENT[kind];
  if (!contract) return bad(404, 'PRIVATE_CONTENT_KIND_UNKNOWN');
  const method = request.method;
  if (method !== 'GET') {
    const csrf = requireCookieCsrf(request);
    if (csrf) return csrf;
  }
  const minRole = method === 'GET' ? (contract.read || 'viewer') : method === 'DELETE' ? (contract.remove || 'admin') : (contract.write || 'member');
  const gate = await requireOrgRole({ env, request, orgId, minRole });
  if (!gate.ok) return gate.resp;
  const db = getDb(env);
  await ensurePrivateSchema(db);
  const state = await getPrivateMode(env, orgId);
  if (!state) return bad(409, 'PRIVATE_MODE_NOT_STARTED');
  if (state.state !== 'enabled' && method !== 'GET') return bad(409, 'PRIVATE_MIGRATION_IN_PROGRESS');
  const url = new URL(request.url);
  if (method === 'GET') {
    if (id) {
      const row = await db.prepare('SELECT * FROM org_private_records WHERE org_id=? AND kind=? AND id=?').bind(orgId, kind, id).first();
      if (!row) return bad(404, 'NOT_FOUND');
      return json({ ok: true, [contract.one]: storedRecord(row) });
    }
    const parent = url.searchParams.get('roomId');
    const rows = parent !== null
      ? await db.prepare('SELECT * FROM org_private_records WHERE org_id=? AND kind=? AND parent_id=? ORDER BY created_at').bind(orgId, kind, parent).all()
      : await db.prepare('SELECT * FROM org_private_records WHERE org_id=? AND kind=? ORDER BY created_at').bind(orgId, kind).all();
    const data = (rows.results || []).map(storedRecord);
    return json({ ok: true, [contract.list]: data, ...(kind === 'witness' ? { records: data } : {}) });
  }
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return bad(405, 'METHOD_NOT_ALLOWED');
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) return bad(400, 'INVALID_PRIVATE_REQUEST');
  if (Object.keys(body).some((k) => !['id', 'ciphertext', 'revision', 'parentId'].includes(k))) return bad(400, 'PLAINTEXT_FIELDS_FORBIDDEN');
  id = id || String(body.id || '');
  if (!/^[A-Za-z0-9_.:-]{1,160}$/.test(id)) return bad(400, 'INVALID_ID');
  const existing = await db.prepare('SELECT * FROM org_private_records WHERE org_id=? AND kind=? AND id=?').bind(orgId, kind, id).first();
  if (contract.append && existing && method !== 'DELETE') return bad(409, 'PRIVATE_APPEND_ONLY');
  if (method === 'DELETE') {
    if (!existing) return bad(404, 'NOT_FOUND');
    if (Number(body.revision) !== existing.revision) return bad(409, 'PRIVATE_REVISION_CONFLICT');
    if (contract.binary) {
      let revision = existing.revision;
      if (!existing.deleting) {
        const locked = await db.prepare('UPDATE org_private_records SET deleting=1,revision=revision+1 WHERE org_id=? AND kind=? AND id=? AND revision=?').bind(orgId,kind,id,body.revision).run();
        if (Number(locked?.meta?.changes||0)!==1) return bad(409,'PRIVATE_REVISION_CONFLICT');
        revision += 1;
      }
      await deletePrivateFileBlobs(env,orgId,id);
      await db.prepare('DELETE FROM org_private_records WHERE org_id=? AND kind=? AND id=? AND revision=? AND deleting=1').bind(orgId,kind,id,revision).run();
      return json({ok:true,deleted:true,id});
    }
    if (kind === 'drive/folders') {
      const subtree = await db.prepare(
        "WITH RECURSIVE subtree(id) AS (" +
        "SELECT id FROM org_private_records WHERE org_id=? AND kind='drive/folders' AND id=? " +
        "UNION ALL " +
        "SELECT child.id FROM org_private_records child JOIN subtree parent ON child.parent_id=parent.id " +
        "WHERE child.org_id=? AND child.kind='drive/folders'" +
        ") SELECT id FROM subtree"
      ).bind(orgId,id,orgId).all();
      const folderIds=(subtree.results||[]).map(row=>String(row.id||'')).filter(Boolean);
      if (!folderIds.length) return bad(404,'NOT_FOUND');
      const placeholders=folderIds.map(()=>'?').join(',');
      const fileRows=await db.prepare(
        `SELECT id FROM org_private_records WHERE org_id=? AND kind='drive/files' AND parent_id IN (${placeholders})`
      ).bind(orgId,...folderIds).all();
      for (const fileRow of fileRows.results||[]) await deletePrivateFileBlobs(env,orgId,fileRow.id);
      const statements=[
        db.prepare(`DELETE FROM org_private_records WHERE org_id=? AND kind IN ('drive/notes','drive/files') AND parent_id IN (${placeholders})`).bind(orgId,...folderIds),
        db.prepare(`DELETE FROM org_private_records WHERE org_id=? AND kind='drive/folders' AND id IN (${placeholders})`).bind(orgId,...folderIds),
      ];
      await db.batch(statements);
      return json({ok:true,deleted:true,id,deletedFolderIds:folderIds});
    }
    const statements = [];
    await ensurePublicationSchema(db);
    statements.push(db.prepare('DELETE FROM org_public_projections WHERE org_id=? AND kind=? AND id=? AND EXISTS(SELECT 1 FROM org_private_records WHERE org_id=? AND kind=? AND id=? AND revision=?)').bind(orgId,kind,id,orgId,kind,id,body.revision));
    statements.push(db.prepare('DELETE FROM org_private_records WHERE org_id=? AND kind=? AND id=? AND revision=?').bind(orgId, kind, id, body.revision));
    const result = await db.batch(statements);
    if (Number(result.at(-1)?.meta?.changes || 0) !== 1) return bad(409, 'PRIVATE_REVISION_CONFLICT');
    return json({ ok: true, deleted: true, id });
  }
  if (existing?.deleting) return bad(409,'PRIVATE_FILE_DELETION_IN_PROGRESS');
  if (typeof body.ciphertext === 'string' && body.ciphertext.length > 1024*1024) return bad(413,'PRIVATE_RECORD_TOO_LARGE');
  if (!isCiphertext(body.ciphertext, contentContext(orgId, kind, id))) return bad(400, 'VALID_CIPHERTEXT_REQUIRED');
  if (existing && Number(body.revision) !== existing.revision) return bad(409, 'PRIVATE_REVISION_CONFLICT');
  if (!existing && (method !== 'POST' || Number(body.revision) !== 0)) return bad(409, 'PRIVATE_REVISION_CONFLICT');
  const parentId = body.parentId === undefined ? existing?.parent_id || null : body.parentId;
  if (parentId !== null) {
    if (!contract.parentKind || typeof parentId !== 'string') return bad(400, 'INVALID_PARENT');
    const parent = await db.prepare('SELECT id FROM org_private_records WHERE org_id=? AND kind=? AND id=?').bind(orgId, contract.parentKind, parentId).first();
    if (!parent || (kind === contract.parentKind && parentId === id)) return bad(400, 'INVALID_PARENT');
    if (kind === 'drive/folders') {
      let cursor = parentId; const seen = new Set([id]);
      while (cursor) {
        if (seen.has(cursor)) return bad(400, 'FOLDER_CYCLE');
        seen.add(cursor);
        const p = await db.prepare("SELECT parent_id FROM org_private_records WHERE org_id=? AND kind='drive/folders' AND id=?").bind(orgId, cursor).first();
        cursor = p?.parent_id;
      }
    }
  }
  const t = Date.now();
  const result = existing
    ? await db.prepare('UPDATE org_private_records SET ciphertext=?,parent_id=?,revision=revision+1,updated_at=? WHERE org_id=? AND kind=? AND id=? AND revision=?').bind(body.ciphertext, parentId, t, orgId, kind, id, body.revision).run()
    : await db.prepare('INSERT OR IGNORE INTO org_private_records (org_id,kind,id,parent_id,ciphertext,revision,created_at,updated_at) VALUES (?,?,?,?,?,1,?,?)').bind(orgId, kind, id, parentId, body.ciphertext, t, t).run();
  if (Number(result?.meta?.changes || 0) !== 1) return bad(409, 'PRIVATE_REVISION_CONFLICT');
  const row = await db.prepare('SELECT * FROM org_private_records WHERE org_id=? AND kind=? AND id=?').bind(orgId, kind, id).first();
  const records = await db.prepare('SELECT * FROM org_private_records WHERE org_id=? AND kind=? ORDER BY created_at').bind(orgId, kind).all();
  return json({ ok: true, id, [contract.one]: storedRecord(row), ...(kind === 'pledges' ? { pledges: records.results.map(storedRecord) } : {}) });
}
export { PRIVATE_CONTENT, PRIVATE_KINDS };
