import { getDb, requireOrgRole } from './auth.js';
import { requireCookieCsrf } from './csrf.js';
import { bad, json } from './http.js';
import { ensureDeviceKeySchema } from './deviceKeys.js';
import { ensureScopedKeys } from './privateKeyScopes.js';
import { ensurePrivateBlobs } from './privateBlobs.js';
import { ensurePrivateSchema, getPrivateMode } from './privateStore.js';
import { ensureZkSchema } from './zk.js';
import { validPublicKey, validRecoveryPayload, validWrappedKey } from './wrappedKeyValidation.js';
import { KEY_SCOPES, canReadScope } from '../../../shared/privateKeyScopes.js';
import { contentContext, isCiphertext } from '../../../shared/privateContent.js';

const RESET_CONFIRMATION = 'RESET ENCRYPTION';

async function resetInventory(db, orgId) {
  await ensurePrivateSchema(db);
  await ensurePrivateBlobs(db);
  const members = await db.prepare('SELECT COUNT(*) AS count FROM org_memberships WHERE org_id=?').bind(orgId).first();
  const records = await db.prepare('SELECT kind,COUNT(*) AS count FROM org_private_records WHERE org_id=? GROUP BY kind ORDER BY kind').bind(orgId).all();
  const blobs = await db.prepare('SELECT COUNT(*) AS count FROM org_private_blobs WHERE org_id=?').bind(orgId).first();
  const byKind = (records?.results || []).map((row) => ({ kind: String(row.kind || ''), count: Number(row.count || 0) }));
  return {
    memberCount: Number(members?.count || 0),
    recordCount: byKind.reduce((sum, row) => sum + row.count, 0),
    blobCount: Number(blobs?.count || 0),
    records: byKind,
  };
}

function parsePublicKey(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch { return null; }
  }
  return value;
}

function exactWrapRecipients(rows) {
  return new Set(rows.map((row) => JSON.stringify([String(row.user_id), String(row.device_id)])));
}

export async function privateEncryptionReset({ env, request, orgId }) {
  const gate = await requireOrgRole({ env, request, orgId, minRole: 'owner', bypassWriteLockdown: true });
  if (!gate.ok) return gate.resp;

  const db = getDb(env);
  if (!db) return bad(500, 'NO_DB_BINDING');
  await ensurePrivateSchema(db);
  await ensureDeviceKeySchema(db);
  await ensureScopedKeys(db);
  await ensureZkSchema(db);

  const mode = await getPrivateMode(env, orgId);
  if (mode?.state !== 'enabled') return bad(409, 'PRIVATE_MODE_NOT_READY');

  const inventory = await resetInventory(db, orgId);
  if (request.method === 'GET') {
    return json({
      ok: true,
      inventory,
      confirmation: RESET_CONFIRMATION,
      preserves: ['organization id', 'membership', 'enabled modules', 'custom domains', 'published public copies'],
    });
  }
  if (request.method !== 'POST') return bad(405, 'METHOD_NOT_ALLOWED');

  const csrf = requireCookieCsrf(request);
  if (csrf) return csrf;

  if (inventory.memberCount !== 1) {
    return bad(409, 'RESET_REQUIRES_SINGLE_MEMBER_ORG', { inventory });
  }
  if (inventory.blobCount !== 0) {
    return bad(409, 'RESET_PRIVATE_FILES_PRESENT', { inventory });
  }

  const body = await request.json().catch(() => null);
  const allowed = new Set([
    'confirmation', 'ciphertext', 'keyCheck', 'wrappedKey', 'device_id', 'deviceWraps',
    'recovery', 'scopeKeys', 'submissionPublicKey',
  ]);
  if (!body || Object.keys(body).some((key) => !allowed.has(key))) return bad(400, 'INVALID_ENCRYPTION_RESET');
  if (body.confirmation !== RESET_CONFIRMATION) return bad(400, 'RESET_CONFIRMATION_REQUIRED');
  if (!/^[a-f0-9]{64}$/.test(String(body.device_id || ''))) return bad(400, 'KEY_RECIPIENT_DEVICE_UNKNOWN');
  if (!isCiphertext(body.ciphertext, contentContext(orgId, 'organization', orgId))) return bad(400, 'INVALID_PRIVATE_ORGANIZATION');
  if (!isCiphertext(body.keyCheck, contentContext(orgId, 'key-check', orgId))) return bad(400, 'VALID_KEY_CHECK_REQUIRED');
  if (!validWrappedKey(body.wrappedKey)) return bad(400, 'INVALID_WRAPPED_KEY');
  if (!validRecoveryPayload(body.recovery) || Object.keys(body.recovery || {}).some((key) => !['salt', 'iv', 'ct'].includes(key))) {
    return bad(400, 'INVALID_RECOVERY_PAYLOAD');
  }
  if (!validPublicKey(body.submissionPublicKey)) return bad(400, 'INVALID_SUBMISSION_PUBLIC_KEY');
  if (!Array.isArray(body.scopeKeys) || body.scopeKeys.length !== KEY_SCOPES.length) return bad(400, 'INVALID_SCOPED_KEY');
  if (!Array.isArray(body.deviceWraps)) return bad(400, 'INVALID_WRAPPED_KEY');

  const currentDevice = await db.prepare('SELECT device_id FROM user_device_keys WHERE user_id=? AND device_id=?')
    .bind(gate.user.sub, body.device_id).first();
  if (!currentDevice) return bad(400, 'KEY_RECIPIENT_DEVICE_UNKNOWN');

  const roster = (await db.prepare(`
    SELECT m.user_id,m.role,d.device_id,d.public_key
    FROM org_memberships m
    JOIN user_device_keys d ON d.user_id=m.user_id
    WHERE m.org_id=?
    ORDER BY m.user_id,d.device_id
  `).bind(orgId).all()).results || [];
  if (!roster.length || roster.some((row) => !parsePublicKey(row.public_key))) return bad(409, 'REGISTER_DEVICE_FIRST');

  const expectedRoot = exactWrapRecipients(roster);
  for (const wrap of body.deviceWraps) {
    if (!wrap || Object.keys(wrap).some((key) => !['user_id', 'device_id', 'wrapped_key'].includes(key))) return bad(400, 'INVALID_WRAPPED_KEY');
    if (!validWrappedKey(wrap.wrapped_key)) return bad(400, 'INVALID_WRAPPED_KEY');
    if (!expectedRoot.delete(JSON.stringify([String(wrap.user_id), String(wrap.device_id)]))) return bad(400, 'INVALID_KEY_RECIPIENT');
  }
  if (expectedRoot.size) return bad(400, 'KEY_RECIPIENT_MISSING');

  for (const scope of KEY_SCOPES) {
    const key = body.scopeKeys.find((item) => item?.scope === scope);
    if (!key || Object.keys(key).some((field) => !['scope', 'check', 'archive', 'wraps', 'recovery'].includes(field))) return bad(400, 'INVALID_SCOPED_KEY');
    if (!isCiphertext(key.check, contentContext(orgId, `scope-check/${scope}`, orgId))) return bad(400, 'INVALID_SCOPED_KEY');
    if (!isCiphertext(key.archive, contentContext(orgId, `scope-archive/${scope}`, orgId))) return bad(400, 'INVALID_SCOPED_KEY');
    if (!validRecoveryPayload(key.recovery) || Object.keys(key.recovery || {}).some((field) => !['salt', 'iv', 'ct'].includes(field))) return bad(400, 'INVALID_SCOPED_KEY');
    if (!Array.isArray(key.wraps)) return bad(400, 'INVALID_SCOPED_KEY');
    const expected = exactWrapRecipients(roster.filter((row) => canReadScope(row.role, scope)));
    for (const wrap of key.wraps) {
      if (!wrap || Object.keys(wrap).some((field) => !['user_id', 'device_id', 'wrapped_key'].includes(field))) return bad(400, 'INVALID_SCOPED_KEY');
      if (!validWrappedKey(wrap.wrapped_key)) return bad(400, 'INVALID_SCOPED_KEY');
      if (!expected.delete(JSON.stringify([String(wrap.user_id), String(wrap.device_id)]))) return bad(400, 'INVALID_KEY_RECIPIENT');
    }
    if (expected.size) return bad(400, 'KEY_RECIPIENT_MISSING');
  }

  await db.prepare('CREATE TABLE IF NOT EXISTS org_keys (org_id TEXT PRIMARY KEY,encrypted_org_metadata TEXT)').run();
  const t = Date.now();
  const recoveryColumns = new Set((await db.prepare('PRAGMA table_info(org_key_recovery)').all()).results.map((row) => row.name));
  const recoveryStatement = recoveryColumns.has('recovery_payload')
    ? db.prepare('INSERT INTO org_key_recovery(org_id,user_id,recovery_payload,updated_at) VALUES(?,?,?,?)').bind(orgId, gate.user.sub, JSON.stringify(body.recovery), t)
    : db.prepare('INSERT INTO org_key_recovery(org_id,user_id,wrapped_key,salt,kdf,updated_at) VALUES(?,?,?,?,?,?)').bind(orgId, gate.user.sub, JSON.stringify(body.recovery), body.recovery.salt, 'PBKDF2-SHA256:210000', t);

  const statements = [
    db.prepare('DELETE FROM org_private_records WHERE org_id=?').bind(orgId),
    db.prepare('DELETE FROM org_private_migrations WHERE org_id=?').bind(orgId),
    db.prepare('DELETE FROM org_private_scope_wraps WHERE org_id=?').bind(orgId),
    db.prepare('DELETE FROM org_private_scope_recovery WHERE org_id=?').bind(orgId),
    db.prepare('DELETE FROM org_private_scope_keys WHERE org_id=?').bind(orgId),
    db.prepare('DELETE FROM org_private_submission_keys WHERE org_id=?').bind(orgId),
    db.prepare('DELETE FROM org_private_key_assertions WHERE org_id=?').bind(orgId),
    db.prepare('DELETE FROM org_private_key_state WHERE org_id=?').bind(orgId),
    db.prepare('DELETE FROM org_private_device_wraps WHERE org_id=?').bind(orgId),
    db.prepare('DELETE FROM org_key_wrapped WHERE org_id=?').bind(orgId),
    db.prepare('DELETE FROM org_key_recovery WHERE org_id=?').bind(orgId),
    db.prepare('DELETE FROM org_crypto WHERE org_id=?').bind(orgId),
    db.prepare('INSERT INTO org_key_wrapped(org_id,user_id,wrapped_key,key_version,wrapped_at) VALUES(?,?,?,?,?)').bind(orgId, gate.user.sub, body.wrappedKey, 1, t),
    recoveryStatement,
    db.prepare('INSERT INTO org_private_key_state(org_id,epoch,roster_revision,rotated_revision) VALUES(?,1,0,0)').bind(orgId),
  ];

  for (const wrap of body.deviceWraps) {
    statements.push(db.prepare('INSERT INTO org_private_device_wraps(org_id,user_id,device_id,wrapped_key) VALUES(?,?,?,?)')
      .bind(orgId, wrap.user_id, wrap.device_id, wrap.wrapped_key));
  }
  for (const key of body.scopeKeys) {
    statements.push(db.prepare('INSERT INTO org_private_scope_keys(org_id,scope,epoch,key_check,archive) VALUES(?,?,?,?,?)')
      .bind(orgId, key.scope, 1, key.check, key.archive));
    for (const wrap of key.wraps) {
      statements.push(db.prepare('INSERT INTO org_private_scope_wraps(org_id,scope,user_id,device_id,wrapped_key) VALUES(?,?,?,?,?)')
        .bind(orgId, key.scope, wrap.user_id, wrap.device_id, wrap.wrapped_key));
    }
    statements.push(db.prepare('INSERT INTO org_private_scope_recovery(org_id,scope,user_id,payload) VALUES(?,?,?,?)')
      .bind(orgId, key.scope, gate.user.sub, JSON.stringify(key.recovery)));
  }
  statements.push(
    db.prepare('INSERT INTO org_private_submission_keys(org_id,epoch,public_key) VALUES(?,?,?)').bind(orgId, 1, JSON.stringify(body.submissionPublicKey)),
    db.prepare('UPDATE org_private_mode SET state=\'enabled\',started_at=?,completed_at=?,key_check=? WHERE org_id=?').bind(t, t, body.keyCheck, orgId),
    db.prepare('INSERT INTO org_private_records(org_id,kind,id,ciphertext,revision,created_at,updated_at) VALUES(?,\'organization\',?,?,1,?,?)').bind(orgId, orgId, body.ciphertext, t, t),
    db.prepare('INSERT INTO org_keys(org_id,encrypted_org_metadata) VALUES(?,NULL) ON CONFLICT(org_id) DO UPDATE SET encrypted_org_metadata=NULL').bind(orgId),
    db.prepare('UPDATE org_memberships SET encrypted_blob=NULL,key_version=1 WHERE org_id=?').bind(orgId),
  );

  try {
    await db.batch(statements);
  } catch (error) {
    return bad(500, 'ENCRYPTION_RESET_FAILED', { detail: String(error?.message || error) });
  }

  return json({ ok: true, reset: true, discarded: inventory, epoch: 1 });
}
