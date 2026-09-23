import { getDb, requireOrgRole } from '../../../_lib/auth.js';
import { contentContext, isCiphertext } from '../../../../../shared/privateContent.js';
import { bad, json } from '../../../_lib/http.js';
import { requireCookieCsrf } from '../../../_lib/csrf.js';
import { ensurePublicDriveShares, publicShareItemAccess, validShareCiphertext, PUBLIC_DRIVE_KINDS } from '../../../_lib/publicDriveShares.js';

export async function onRequest({ env, request, params }) {
  if (!['GET', 'POST', 'DELETE'].includes(request.method)) return bad(405, 'METHOD_NOT_ALLOWED');
  const orgId = String(params.orgId || '');
  const gate = await requireOrgRole({ env, request, orgId, minRole: 'member' });
  if (!gate.ok) return gate.resp;
  if (request.method !== 'GET') {
    const csrf = requireCookieCsrf(request);
    if (csrf) return csrf;
  }
  const body = request.method === 'GET' ? Object.fromEntries(new URL(request.url).searchParams) : await request.json().catch(() => ({}));
  const kind = String(body.kind || ''), itemId = String(body.itemId || '');
  if (!await publicShareItemAccess(env, orgId, kind, itemId, gate.user.sub)) return bad(403, 'DRIVE_SHARE_ACCESS_DENIED');
  const db = getDb(env);
  await ensurePublicDriveShares(db);
  const previous = await db.prepare('SELECT * FROM drive_public_shares WHERE org_id=? AND kind=? AND item_id=?').bind(orgId, kind, itemId).first();
  if (request.method === 'GET') return json({ ok: true, enabled: !!previous, token: previous?.token || '', wrappedKey: previous?.wrapped_key || '', updatedAt: previous?.updated_at || null });
  if (request.method === 'DELETE') {
    const statements = [db.prepare('DELETE FROM drive_public_shares WHERE org_id=? AND kind=? AND item_id=?').bind(orgId, kind, itemId)];
    if (previous) statements.push(db.prepare('DELETE FROM drive_public_share_chunks WHERE version=?').bind(previous.version));
    await db.batch(statements);
    return json({ ok: true, enabled: false });
  }
  if (Object.keys(body).some(key => !['kind', 'itemId', 'manifest', 'ciphertext', 'wrappedKey', 'token'].includes(key))) return bad(400, 'INVALID_PUBLIC_SHARE');
  if (!validShareCiphertext(body.ciphertext) || !isCiphertext(body.wrappedKey, contentContext(orgId, kind, itemId)) || body.wrappedKey.length > 8192) return bad(400, 'INVALID_PUBLIC_SHARE_CIPHERTEXT');
  if (!Array.isArray(body.manifest) || !body.manifest.length || !body.manifest.some(item => item.kind === kind && item.id === itemId)) return bad(400, 'INVALID_PUBLIC_SHARE');
  const manifest = [];
  for (const item of body.manifest) {
    if (!PUBLIC_DRIVE_KINDS.has(item?.kind) || typeof item.id !== 'string' || !await publicShareItemAccess(env, orgId, item.kind, item.id, gate.user.sub)) return bad(403, 'DRIVE_SHARE_ACCESS_DENIED');
    manifest.push({ kind: item.kind, id: item.id });
  }
  // Refuse stale updates after revocation or another publisher's replacement.
  if (String(body.token || '') !== String(previous?.token || '')) return bad(409, 'PUBLIC_SHARE_CHANGED');
  const token = previous?.token || Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('');
  const version = crypto.randomUUID(), updatedAt = Date.now();
  const statements = [];
  for (let offset = 0, position = 0; offset < body.ciphertext.length; offset += 64000, position++) {
    statements.push(db.prepare('INSERT INTO drive_public_share_chunks VALUES(?,?,?)').bind(version, position, body.ciphertext.slice(offset, offset + 64000)));
  }
  const publishIndex = statements.length;
  if (previous) {
    statements.push(db.prepare(`UPDATE drive_public_shares SET wrapped_key=?,publisher=?,manifest=?,version=?,updated_at=?
      WHERE org_id=? AND kind=? AND item_id=? AND token=? AND version=?`)
      .bind(body.wrappedKey, gate.user.sub, JSON.stringify(manifest), version, updatedAt, orgId, kind, itemId, previous.token, previous.version));
    statements.push(db.prepare(`DELETE FROM drive_public_share_chunks WHERE version=? AND EXISTS
      (SELECT 1 FROM drive_public_shares WHERE org_id=? AND kind=? AND item_id=? AND version=?)`).bind(previous.version, orgId, kind, itemId, version));
  } else {
    statements.push(db.prepare('INSERT OR IGNORE INTO drive_public_shares VALUES(?,?,?,?,?,?,?,?,?)')
      .bind(orgId, kind, itemId, token, body.wrappedKey, gate.user.sub, JSON.stringify(manifest), version, updatedAt));
  }
  const results = await db.batch(statements);
  if (Number(results[publishIndex]?.meta?.changes || 0) !== 1) {
    await db.prepare('DELETE FROM drive_public_share_chunks WHERE version=?').bind(version).run();
    return bad(409, 'PUBLIC_SHARE_CHANGED');
  }
  return json({ ok: true, enabled: true, token, wrappedKey: body.wrappedKey, updatedAt });
}
