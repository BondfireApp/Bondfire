import { getDb, requireOrgRole } from './auth.js';
import { bad, json } from './http.js';
import { requireCookieCsrf } from './csrf.js';
import { ensurePrivateSchema, getPrivateMode } from './privateStore.js';
import { ensureDeviceKeySchema } from './deviceKeys.js';
import { ensurePublicationSchema } from './privatePublication.js';
import { isOrgModuleEnabled } from './orgModules.js';
import { validWrappedKey } from './wrappedKeyValidation.js';
import { contentContext, isCiphertext } from '../../../shared/privateContent.js';
import { WORK_MODULES, WORK_ROLES, PARTS, partKind, defaultPermissions, canWork, rank } from '../../../shared/workModel.js';

import { treasuryTransparencyState, toggleTreasuryTransparency, prepareTreasuryPublicWrite, readTreasuryLedger } from './treasuryTransparency.js';

const parse = (s, fallback) => { try { return JSON.parse(s); } catch { return fallback; } };
const validId = v => typeof v === 'string' && /^[A-Za-z0-9_.:-]{1,160}$/.test(v);
const partPermission = { content: 'edit', state: 'close', assignment: 'assign', approval: 'approve' };
const mayReseal = (parts, role, permissions) => parts.every(part => part === 'source' ? rank(role) >= rank('admin') : canWork(role, permissions, partPermission[part]));
const exact = (o, keys) => o && typeof o === 'object' && !Array.isArray(o) && Object.keys(o).every(k => keys.includes(k));
export async function ensureWorkSchema(db) {
  await ensurePrivateSchema(db);
  await ensureDeviceKeySchema(db);
  await ensurePublicationSchema(db);
  for (const sql of [
    `CREATE TABLE IF NOT EXISTS org_work_access(org_id TEXT NOT NULL,type TEXT NOT NULL,id TEXT NOT NULL,grants_json TEXT NOT NULL,parents_json TEXT NOT NULL,keys_json TEXT NOT NULL,owner_id TEXT NOT NULL,source_type TEXT,source_id TEXT,approval_required INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(org_id,type,id),UNIQUE(org_id,source_type,source_id))`,
    `CREATE TABLE IF NOT EXISTS org_work_options(org_id TEXT PRIMARY KEY,approvals_required INTEGER NOT NULL DEFAULT 0,version INTEGER NOT NULL DEFAULT 1)`,
    `CREATE TABLE IF NOT EXISTS org_work_permissions(org_id TEXT NOT NULL,module TEXT NOT NULL,permissions_json TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,PRIMARY KEY(org_id,module))`,
    `CREATE TABLE IF NOT EXISTS org_work_history(org_id TEXT NOT NULL,type TEXT NOT NULL,id TEXT NOT NULL,revision INTEGER NOT NULL,action TEXT NOT NULL,actor_id TEXT NOT NULL,at INTEGER NOT NULL,PRIMARY KEY(org_id,type,id,revision))`,
    `CREATE TABLE IF NOT EXISTS org_work_assertions(org_id TEXT NOT NULL,id TEXT NOT NULL,valid INTEGER CHECK(valid=1),PRIMARY KEY(org_id,id))`,
    `CREATE TRIGGER IF NOT EXISTS bf_work_ledger_cleanup AFTER DELETE ON org_private_records WHEN OLD.kind IN ('work/funds','work/transactions') BEGIN DELETE FROM org_public_projections WHERE org_id=OLD.org_id AND kind LIKE 'work/treasury%'; END`,
    // Metadata must disappear with the encrypted source on reset or emergency erasure.
    `CREATE TRIGGER IF NOT EXISTS bf_work_cleanup AFTER DELETE ON org_private_records WHEN OLD.kind LIKE 'work/%' AND instr(OLD.kind,':')=0 BEGIN DELETE FROM org_work_access WHERE org_id=OLD.org_id AND 'work/'||type=OLD.kind AND id=OLD.id; DELETE FROM org_work_history WHERE org_id=OLD.org_id AND 'work/'||type=OLD.kind AND id=OLD.id; END`,
  ]) await db.prepare(sql).run();
}

export async function workContext(db, env, orgId) {
  const rows = (await db.prepare(`SELECT a.*,r.revision,r.created_at,r.updated_at FROM org_work_access a JOIN org_private_records r ON r.org_id=a.org_id AND r.kind='work/'||a.type AND r.id=a.id WHERE a.org_id=?`).bind(orgId).all()).results || [];
  const policies = new Map(rows.map(r => [`${r.type}:${r.id}`, { ...r, grants: parse(r.grants_json, []), parents: parse(r.parents_json, []), wraps: parse(r.keys_json, []) }]));
  const settings = (await db.prepare('SELECT * FROM org_work_permissions WHERE org_id=?').bind(orgId).all()).results || [];
  const permissions = Object.fromEntries([...new Set(Object.values(WORK_MODULES))].map(module => [module, { ...defaultPermissions(module), ...parse(settings.find(s => s.module === module)?.permissions_json, {}) }]));
  const enabled = [];
  for (const module of Object.keys(permissions)) if (await isOrgModuleEnabled(env, orgId, module)) enabled.push(module);
  const options = await db.prepare('SELECT * FROM org_work_options WHERE org_id=?').bind(orgId).first();
  return { policies, permissions, enabled, settings, transparency: await treasuryTransparencyState(db, orgId), options: { approvalsRequired: !!options?.approvals_required, version: Number(options?.version || 0) } };
}

export function workAccess(context, policy, userId, role, seen = new Set()) {
  if (!policy || !canWork(role, context.permissions[WORK_MODULES[policy.type]], 'view')) return false;
  const marker = `${policy.type}:${policy.id}`;
  if (seen.has(marker)) return false;
  if (policy.grants.length && !policy.grants.includes(userId)) return false;
  const path = new Set(seen); path.add(marker);
  return policy.parents.every(p => workAccess(context, context.policies.get(`${p.type}:${p.id}`), userId, role, path));
}

async function decorated(db, orgId, policy, userId, deviceId, context, role) {
  const rows = (await db.prepare('SELECT kind,ciphertext FROM org_private_records WHERE org_id=? AND id=? AND (kind=? OR kind LIKE ?)').bind(orgId, policy.id, partKind(policy.type, 'content'), `work/${policy.type}:%`).all()).results || [];
  const parts = {};
  for (const part of PARTS) { const row = rows.find(r => r.kind === partKind(policy.type, part)); if (row) parts[part] = row.ciphertext; }
  const history = (await db.prepare('SELECT revision,action,actor_id,at FROM org_work_history WHERE org_id=? AND type=? AND id=? ORDER BY revision DESC LIMIT 100').bind(orgId, policy.type, policy.id).all()).results || [];
  return {
    id: policy.id, type: policy.type, revision: policy.revision, createdAt: policy.created_at, updatedAt: policy.updated_at,
    ownerId: policy.owner_id, grants: policy.grants, parents: policy.parents, parts, history,
    approvalRequired: !!policy.approval_required,
    canManageAccess: (policy.owner_id === userId ? canWork(role, context.permissions[WORK_MODULES[policy.type]], 'edit') : canWork(role, context.permissions[WORK_MODULES[policy.type]], 'settings')) && mayReseal(Object.keys(parts), role, context.permissions[WORK_MODULES[policy.type]]),
    source: policy.source_id ? { type: policy.source_type, id: policy.source_id } : null,
    wrappedKey: policy.wraps.find(w => w.userId === userId && w.deviceId === deviceId)?.wrappedKey || null,
    permissions: Object.fromEntries(Object.keys(context.permissions[WORK_MODULES[policy.type]]).map(action => [action, canWork(role, context.permissions[WORK_MODULES[policy.type]], action)])),
  };
}

async function roster(db, orgId) {
  return (await db.prepare('SELECT m.user_id,m.role,d.device_id,d.public_key FROM org_memberships m LEFT JOIN user_device_keys d ON d.user_id=m.user_id WHERE m.org_id=? ORDER BY m.user_id,d.device_id').bind(orgId).all()).results || [];
}

export async function workEndpoint({ env, request, orgId, path = '' }) {
  const gate = await requireOrgRole({ env, request, orgId, minRole: 'viewer' });
  if (!gate.ok) return gate.resp;
  const method = request.method, write = method !== 'GET';
  if (write) { const csrf = requireCookieCsrf(request); if (csrf) return csrf; }
  if (!['GET', 'POST', 'PUT', 'DELETE'].includes(method)) return bad(405, 'METHOD_NOT_ALLOWED');
  const db = getDb(env);
  const mode = await getPrivateMode(env, orgId);
  if (mode?.state !== 'enabled') return bad(409, 'PRIVATE_MODE_NOT_READY');
  await ensureWorkSchema(db);
  const context = await workContext(db, env, orgId);
  const userId = gate.user.sub, url = new URL(request.url), deviceId = url.searchParams.get('deviceId') || '';
  if (path === 'context' && method === 'GET') {
    const members = rank(gate.role) >= rank('member') ? await roster(db, orgId) : [];
    return json({ ok: true, userId, role: gate.role, enabled: context.enabled, permissions: context.permissions, options: context.options, transparency: context.transparency, permissionVersions: Object.fromEntries(context.settings.map(s => [s.module, s.version])), roster: members });
  }
  if (path === 'options' && method === 'PUT') {
    if (rank(gate.role) < rank('admin') || !context.enabled.includes('treasury')) return bad(403, 'INSUFFICIENT_ROLE');
    const b = await request.json().catch(() => null);
    if (!exact(b, ['approvalsRequired', 'version']) || typeof b.approvalsRequired !== 'boolean' || b.version !== context.options.version) return bad(409, 'PRIVATE_REVISION_CONFLICT');
    const result = b.version ? await db.prepare('UPDATE org_work_options SET approvals_required=?,version=version+1 WHERE org_id=? AND version=?').bind(Number(b.approvalsRequired), orgId, b.version).run() : await db.prepare('INSERT OR IGNORE INTO org_work_options VALUES(?,?,1)').bind(orgId, Number(b.approvalsRequired)).run();
    return Number(result.meta?.changes) === 1 ? json({ ok: true }) : bad(409, 'PRIVATE_REVISION_CONFLICT');
  }
  if (path === 'permissions' && method === 'PUT') {
    if (rank(gate.role) < rank('admin')) return bad(403, 'INSUFFICIENT_ROLE');
    const b = await request.json().catch(() => null);
    if (!exact(b, ['module', 'permissions', 'version']) || !context.enabled.includes(b.module) || !exact(b.permissions, Object.keys(defaultPermissions(b.module))) || !Object.values(b.permissions).every(v => WORK_ROLES.includes(v))) return bad(400, 'INVALID_PERMISSIONS');
    const permissions = { ...defaultPermissions(b.module), ...b.permissions };
    if (['settings', 'publish', 'approve'].some(a => rank(permissions[a]) < rank('admin')) || ['create', 'edit', 'assign', 'close'].some(a => rank(permissions[a]) < rank('member'))) return bad(400, 'INVALID_PERMISSIONS');
    const current = context.settings.find(s => s.module === b.module);
    if (Number(b.version) !== Number(current?.version || 0)) return bad(409, 'PRIVATE_REVISION_CONFLICT');
    const result = current
      ? await db.prepare('UPDATE org_work_permissions SET permissions_json=?,version=version+1 WHERE org_id=? AND module=? AND version=?').bind(JSON.stringify(permissions), orgId, b.module, b.version).run()
      : await db.prepare('INSERT OR IGNORE INTO org_work_permissions VALUES(?,?,?,1)').bind(orgId, b.module, JSON.stringify(permissions)).run();
    if (Number(result.meta?.changes) !== 1) return bad(409, 'PRIVATE_REVISION_CONFLICT');
    return json({ ok: true });
  }
  if (path === 'publication') {
    if (!context.enabled.includes('treasury') || !canWork(gate.role, context.permissions.treasury, 'publish')) return bad(404, 'NOT_FOUND');
    return toggleTreasuryTransparency({ db, orgId, request, context, userId, role: gate.role, access: workAccess, assertRevision, runBatch });
  }

  const [type, id = ''] = path.split('/');
  const module = WORK_MODULES[type];
  if (!module || !context.enabled.includes(module) || !canWork(gate.role, context.permissions[module], 'view')) return bad(404, 'NOT_FOUND');
  const existing = id ? context.policies.get(`${type}:${id}`) : null;
  if (id && (!existing || !workAccess(context, existing, userId, gate.role))) return bad(404, 'NOT_FOUND');
  if (method === 'GET') {
    const records = [];
    for (const p of context.policies.values()) if (p.type === type && (!id || p.id === id) && workAccess(context, p, userId, gate.role)) records.push(await decorated(db, orgId, p, userId, deviceId, context, gate.role));
    return json({ ok: true, records });
  }
  if (method === 'DELETE') return bad(405, 'ARCHIVE_RECORD_INSTEAD');
  const b = await request.json().catch(() => null);
  if (!exact(b, ['id', 'revision', 'action', 'parts', 'grants', 'parents', 'wraps', 'source', 'public'])) return bad(400, 'PLAINTEXT_FIELDS_FORBIDDEN');
  if (!['funds', 'transactions'].includes(type) && b.public !== undefined) return bad(400, 'PLAINTEXT_FIELDS_FORBIDDEN');
  const recordId = id || b.id, action = b.action;
  if (!validId(recordId) || (id && b.id && b.id !== id)) return bad(400, 'INVALID_ID');
  const creating = method === 'POST' && !id;
  if (creating && action !== 'create') return bad(400, 'INVALID_ACTION');
  if (!creating && (!existing || method !== 'PUT')) return bad(400, 'INVALID_ACTION');
  const permission = action === 'access' ? 'settings' : action === 'assignment' ? 'assign' : action === 'state' ? 'close' : action === 'approval' ? 'approve' : action === 'create' ? 'create' : 'edit';
  if (type.endsWith('-settings') && !canWork(gate.role, context.permissions[module], 'settings')) return bad(403, 'INSUFFICIENT_ROLE');
  const ownerManages = action === 'access' && existing?.owner_id === userId && canWork(gate.role, context.permissions[module], 'edit');
  if (!['create', 'edit', 'assignment', 'state', 'approval', 'access'].includes(action) || (!ownerManages && !canWork(gate.role, context.permissions[module], permission))) return bad(403, 'INSUFFICIENT_ROLE');
  if (action === 'approval' && type !== 'transactions') return bad(400, 'INVALID_ACTION');
  if (Number(b.revision) !== Number(existing?.revision || 0)) return bad(409, 'PRIVATE_REVISION_CONFLICT');
  if (creating && context.policies.has(`${type}:${recordId}`)) return bad(409, 'PRIVATE_REVISION_CONFLICT');
  const accessChange = creating || action === 'access';
  if (!accessChange && ['grants', 'parents', 'wraps', 'source'].some(k => b[k] !== undefined)) return bad(400, 'ACCESS_CHANGE_REQUIRED');
  const grants = accessChange ? b.grants : existing.grants, parents = accessChange ? b.parents : existing.parents;
  if (!Array.isArray(grants) || grants.length > 500 || grants.some(v => !validId(v)) || new Set(grants).size !== grants.length || !Array.isArray(parents) || parents.length > 20 || parents.some(p => !exact(p, ['type', 'id']) || !WORK_MODULES[p.type] || !validId(p.id))) return bad(400, 'INVALID_ACCESS');
  const proposed = { ...(existing || {}), id: recordId, type, grants, parents, owner_id: existing?.owner_id || userId };
  const nextContext = { ...context, policies: new Map(context.policies).set(`${type}:${recordId}`, proposed) };
  if (!workAccess(nextContext, proposed, userId, gate.role)) return bad(404, 'NOT_FOUND');
  for (const p of parents) if ((accessChange && !existing?.parents.some(old => old.type === p.type && old.id === p.id) && !context.enabled.includes(WORK_MODULES[p.type])) || !workAccess(context, context.policies.get(`${p.type}:${p.id}`), userId, gate.role)) return bad(404, 'NOT_FOUND');
  let wraps = existing?.wraps || [];
  if (accessChange) {
    if (!Array.isArray(b.wraps) || b.wraps.length > 5000) return bad(400, 'INVALID_KEY_RECIPIENT');
    const members = await roster(db, orgId);
    if (grants.some(user => !members.some(m => m.user_id === user))) return bad(400, 'INVALID_KEY_RECIPIENT');
    const eligible = members.filter(m => m.device_id && workAccess(nextContext, proposed, m.user_id, m.role));
    const expected = new Set(eligible.map(m => `${m.user_id}:${m.device_id}`));
    for (const w of b.wraps) if (!exact(w, ['userId', 'deviceId', 'wrappedKey']) || !validWrappedKey(w.wrappedKey) || !expected.delete(`${w.userId}:${w.deviceId}`)) return bad(400, 'INVALID_KEY_RECIPIENT');
    if (expected.size || !b.wraps.some(w => w.userId === userId)) return bad(409, 'KEY_RECIPIENT_MISSING');
    wraps = b.wraps;
  }
  const allowedParts = creating ? ['content', 'state', 'assignment', 'source'] : action === 'access' ? PARTS : action === 'edit' ? ['content'] : [action];
  if (!exact(b.parts, allowedParts) || !Object.keys(b.parts).length || (creating && !b.parts.content)) return bad(400, 'INVALID_RECORD_PARTS');
  if (creating && b.parts.state && !canWork(gate.role, context.permissions[module], 'close')) return bad(403, 'INSUFFICIENT_ROLE');
  if (action === 'access' && !mayReseal(Object.keys(b.parts), gate.role, context.permissions[module])) return bad(403, 'INSUFFICIENT_ROLE');
  if (creating && b.parts.assignment && !canWork(gate.role, context.permissions[module], 'assign')) return bad(403, 'INSUFFICIENT_ROLE');
  if (action === 'access') {
    const oldParts = (await db.prepare('SELECT kind FROM org_private_records WHERE org_id=? AND id=? AND (kind=? OR kind LIKE ?)').bind(orgId, recordId, partKind(type, 'content'), `work/${type}:%`).all()).results || [];
    if (oldParts.some(r => !PARTS.some(p => partKind(type, p) === r.kind && b.parts[p]))) return bad(400, 'RESEAL_ALL_PARTS');
  }
  for (const [part, ciphertext] of Object.entries(b.parts)) if (typeof ciphertext !== 'string' || ciphertext.length > 1024 * 1024 || !isCiphertext(ciphertext, contentContext(orgId, partKind(type, part), recordId))) return bad(400, 'VALID_CIPHERTEXT_REQUIRED');
  let source = existing?.source_id ? { type: existing.source_type, id: existing.source_id } : null;
  if (creating && b.source) {
    if (type !== 'cases' || rank(gate.role) < rank('admin') || !exact(b.source, ['type', 'id']) || !['intake', 'rsvp'].includes(b.source.type) || !validId(b.source.id) || !b.parts.source) return bad(400, 'INVALID_SUBMISSION');
    const row = await db.prepare('SELECT id FROM org_private_submissions WHERE org_id=? AND id=? AND type=?').bind(orgId, b.source.id, b.source.type).first();
    if (!row) return bad(404, 'NOT_FOUND');
    source = b.source;
    const duplicate = [...context.policies.values()].find(p => p.source_id === source.id && p.source_type === source.type);
    if (duplicate) return workAccess(context, duplicate, userId, gate.role) ? json({ ok: true, id: duplicate.id, existing: true }) : bad(404, 'NOT_FOUND');
  } else if (creating && b.parts.source) return bad(400, 'INVALID_SUBMISSION');
  if (!creating && b.source !== undefined) return bad(400, 'ORIGINAL_SUBMISSION_IMMUTABLE');
  const t = Date.now(), revision = Number(existing?.revision || 0) + 1, statements = [];
  if (existing) statements.push(assertRevision(db, orgId, type, recordId, existing.revision));
  else statements.push(db.prepare('INSERT OR REPLACE INTO org_work_assertions VALUES(?,?,(SELECT CASE WHEN COUNT(*)=0 THEN 1 ELSE 0 END FROM org_private_records WHERE org_id=? AND kind=? AND id=?))').bind(orgId, `${type}:${recordId}`, orgId, partKind(type, 'content'), recordId));
  // Any concurrent access change anywhere in the dependency graph invalidates the write.
  const checked = new Set();
  function checkParents(p) { for (const ref of p.parents) { const key = `${ref.type}:${ref.id}`, dependency = context.policies.get(key); if (!dependency || checked.has(key)) continue; checked.add(key); statements.push(assertRevision(db, orgId, ref.type, ref.id, dependency.revision)); checkParents(dependency); } }
  checkParents(proposed);
  for (const [part, ciphertext] of Object.entries(b.parts)) statements.push(db.prepare(`INSERT INTO org_private_records(org_id,kind,id,ciphertext,revision,created_at,updated_at,created_by) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(org_id,kind,id) DO UPDATE SET ciphertext=excluded.ciphertext,revision=excluded.revision,updated_at=excluded.updated_at`).bind(orgId, partKind(type, part), recordId, ciphertext, revision, t, t, userId));
  if (!b.parts.content) statements.push(db.prepare('UPDATE org_private_records SET revision=?,updated_at=? WHERE org_id=? AND kind=? AND id=?').bind(revision, t, orgId, partKind(type, 'content'), recordId));
  const approvalRequired = type === 'transactions' && (existing?.approval_required || context.options.approvalsRequired);
  if (['funds', 'transactions'].includes(type)) {
    const publication = await prepareTreasuryPublicWrite({ db, orgId, type, id: recordId, action, revision, body: b, context, approvalRequired: !!approvalRequired, parents });
    if (publication.error) return publication.error;
    statements.push(...publication.statements);
  }
  statements.push(db.prepare(`INSERT INTO org_work_access VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(org_id,type,id) DO UPDATE SET grants_json=excluded.grants_json,parents_json=excluded.parents_json,keys_json=excluded.keys_json,approval_required=excluded.approval_required`).bind(orgId, type, recordId, JSON.stringify(grants), JSON.stringify(parents), JSON.stringify(wraps), proposed.owner_id, source?.type || null, source?.id || null, Number(!!approvalRequired)));
  // Changing financial content invalidates a previous approval in the same transaction.
  if (type === 'transactions' && action === 'edit') statements.push(db.prepare('DELETE FROM org_private_records WHERE org_id=? AND kind=? AND id=?').bind(orgId, partKind(type, 'approval'), recordId));
  statements.push(db.prepare('INSERT INTO org_work_history VALUES(?,?,?,?,?,?,?)').bind(orgId, type, recordId, revision, action, userId, t));
  statements.push(db.prepare('DELETE FROM org_work_assertions WHERE org_id=?').bind(orgId));
  return runBatch(db, statements, { ok: true, id: recordId, revision });
}

function assertRevision(db, orgId, type, id, revision) {
  return db.prepare('INSERT OR REPLACE INTO org_work_assertions VALUES(?,?,(SELECT COUNT(*) FROM org_private_records WHERE org_id=? AND kind=? AND id=? AND revision=?))').bind(orgId, `${type}:${id}`, orgId, partKind(type, 'content'), id, revision);
}
async function runBatch(db, statements, result) {
  try { await db.batch(statements); return json(result); }
  catch (e) { if (/CHECK constraint|UNIQUE constraint/i.test(String(e.message))) return bad(409, 'PRIVATE_REVISION_CONFLICT'); throw e; }
}

export async function publicTreasury({ env, request, slug }) {
  if (request.method !== 'GET') return bad(405, 'METHOD_NOT_ALLOWED');
  const orgId = await env.BF_PUBLIC?.get(`slug:${slug}`);
  if (!orgId || !await isOrgModuleEnabled(env, orgId, 'treasury')) return bad(404, 'NOT_FOUND');
  const config = parse(await env.BF_PUBLIC.get(`org:${orgId}`), {});
  if (!config.enabled || config.slug !== slug) return bad(404, 'NOT_FOUND');
  const db = getDb(env); await ensurePublicationSchema(db);
  const state = await treasuryTransparencyState(db, orgId);
  if (!state.enabled) return bad(404, 'NOT_FOUND');
  const data = await readTreasuryLedger(db, orgId);
  return json({ ok: true, public: data, updatedAt: state.updatedAt }, { headers: { 'Cache-Control': 'no-store' } });
}
