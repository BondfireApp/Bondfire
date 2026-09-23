import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { signJwt } from '../functions/api/_lib/jwt.js';
import { workEndpoint, publicTreasury, ensureWorkSchema } from '../functions/api/_lib/workStore.js';
import { onRequest as middleware } from '../functions/api/_middleware.js';
import { ensureScopedKeys } from '../functions/api/_lib/privateKeyScopes.js';
import { registerDeviceKey } from '../functions/api/_lib/deviceKeys.js';
import { encryptPrivate, decryptPrivate } from '../src/lib/privateCrypto.js';
import { WORK_MODULES, partKind, moneyMinor, treasuryTotals, validateTransaction, buildTreasuryProjection, validTreasuryProjection, nextDueDate } from '../shared/workModel.js';
import { getDefaultEnabledModuleIds, normalizeSelectedModuleIds } from '../src/platform/moduleRegistry.js';
import { parseEnabledModules } from '../functions/api/orgs/[orgId]/modules.js';

const sql = new DatabaseSync(':memory:');
const db = {
  prepare(query) { const stmt = sql.prepare(query); let values = []; return { bind(...v) { values = v; return this; }, async first() { return stmt.get(...values) || null; }, async all() { return { results: stmt.all(...values) }; }, async run() { return { meta: stmt.run(...values) }; } }; },
  async batch(statements) { sql.exec('BEGIN'); try { const results = []; for (const s of statements) results.push(await s.run()); sql.exec('COMMIT'); return results; } catch (e) { sql.exec('ROLLBACK'); throw e; } },
};
sql.exec(`CREATE TABLE users(id TEXT PRIMARY KEY); INSERT INTO users VALUES('owner'),('admin'),('member'),('viewer'),('outside');
CREATE TABLE org_memberships(org_id TEXT,user_id TEXT,role TEXT,created_at INTEGER,PRIMARY KEY(org_id,user_id));
CREATE TABLE org_private_submissions(org_id TEXT,id TEXT,type TEXT,epoch INTEGER,sender_pub TEXT,salt TEXT,ciphertext TEXT,created_at INTEGER,PRIMARY KEY(org_id,id));`);
const kv = new Map(), env = { BF_DB: db, JWT_SECRET: 'workflow-tests', BF_PUBLIC: { get: async k => kv.get(k) || null } };
await ensureWorkSchema(db);
const modules = [...new Set(Object.values(WORK_MODULES))];
sql.exec('CREATE TABLE org_module_configs(org_id TEXT PRIMARY KEY,enabled_modules_json TEXT,version INTEGER,module_schema_version INTEGER,updated_at INTEGER,updated_by TEXT)');
for (const org of ['a', 'b']) {
  sql.prepare('INSERT INTO org_private_mode VALUES(?,?,0,0,?)').run(org, 'enabled', 'key-check');
  sql.prepare('INSERT INTO org_module_configs VALUES(?,?,1,2,0,NULL)').run(org, JSON.stringify(modules));
  for (const user of ['owner', 'admin', 'member', 'viewer']) sql.prepare('INSERT INTO org_memberships VALUES(?,?,?,0)').run(org, user, user);
}
const key = crypto.getRandomValues(new Uint8Array(32));
const device = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
const pub = await crypto.subtle.exportKey('jwk', device.publicKey);
const b64 = bytes => Buffer.from(bytes).toString('base64url');
const wrappedKey = JSON.stringify({ v: 1, sender_pub: pub, salt: b64(new Uint8Array(16)), iv: b64(new Uint8Array(12)), ct: b64(new Uint8Array(48)) });
let deviceId;
for (const user of ['owner', 'admin', 'member', 'viewer']) deviceId = await registerDeviceKey(db, user, pub);
const tokens = Object.fromEntries(await Promise.all(['owner', 'admin', 'member', 'viewer', 'outside'].map(async id => [id, await signJwt(env.JWT_SECRET, { sub: id }, 3600)])));
async function call(path, { user = 'owner', orgId = 'a', body, method = body ? 'POST' : 'GET', cookie = false } = {}, expected = 200) {
  const request = new Request(`https://example.test/api/orgs/${orgId}/work/${path}${path.includes('?') ? '&' : '?'}deviceId=${deviceId}`, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie: `bf_at=${tokens[user]}` } : { authorization: `Bearer ${tokens[user]}` }) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const res = await workEndpoint({ env, request, orgId, path: path.split('?')[0] });
  const data = await res.json(); assert.equal(res.status, expected, `${path}: ${JSON.stringify(data)}`); return data;
}
async function body(type, id, { grants = [], parents = [], content = {}, state = {}, source, users = grants.length ? grants : ['owner', 'admin', 'member', 'viewer'], rawKey = key } = {}) {
  if (['funds', 'transactions', 'cases', 'case-settings', 'treasury-settings'].includes(type) && !grants.length) users = ['owner', 'admin'];
  const parts = { content: await encryptPrivate(rawKey, { title: 'SECRET ' + id, ...content }, 'a', partKind(type, 'content'), id), state: await encryptPrivate(rawKey, state, 'a', partKind(type, 'state'), id) };
  if (source) parts.source = await encryptPrivate(rawKey, { data: { details: 'SECRET original', attachments: ['secret-file'] } }, 'a', partKind(type, 'source'), id);
  return { id, action: 'create', revision: 0, grants, parents, wraps: users.map(userId => ({ userId, deviceId, wrappedKey })), parts, ...(source ? { source } : {}) };
}
async function edit(type, id, revision, action, value) {
  const part = action === 'edit' ? 'content' : action;
  return { id, action, revision, parts: { [part]: await encryptPrivate(key, value, 'a', partKind(type, part), id) } };
}
// New modules never appear in an existing/default organization implicitly.
for (const module of modules) assert(!getDefaultEnabledModuleIds().includes(module));
assert(modules.every(module => normalizeSelectedModuleIds(modules).includes(module)));
assert(modules.every(module => parseEnabledModules(modules).includes(module)));
await call('tasks', { user: 'outside' }, 403);
await call('tasks', { body: { title: 'SECRET plaintext' } }, 400);
const disabled = JSON.stringify(modules.filter(m => m !== 'tasks'));
sql.prepare('UPDATE org_module_configs SET enabled_modules_json=? WHERE org_id=?').run(disabled, 'a');
await call('tasks', {}, 404); await call('tasks', { body: await body('tasks', 'disabled') }, 404);
sql.prepare('UPDATE org_module_configs SET enabled_modules_json=? WHERE org_id=?').run(JSON.stringify(modules), 'a');

// Every object enforces membership, module access, ciphertext identity and org isolation.
for (const type of ['tasks', 'groups', 'decisions', 'cases', 'funds', 'transactions']) {
  const payload = await body(type, type + '-one');
  await call(type, { body: payload });
  assert.equal((await call(type)).records.length, 1);
  await call(type + '/' + payload.id, { orgId: 'b' }, 404);
  await call(type + '/' + payload.id, { user: 'outside' }, 403);
  assert.equal((await call(type + '/' + payload.id)).records[0].revision, 1);
  await call(type + '/' + payload.id, { method: 'PUT', body: { ...await edit(type, payload.id, 0, 'edit', {}), title: 'plaintext' } }, 400);
  await call(type + '/' + payload.id, { method: 'PUT', body: await edit(type, payload.id, 0, 'edit', {}) }, 409);
}
await call('funds', { user: 'member' }, 404);
await call('cases', { user: 'viewer' }, 404);
await call('tasks', { user: 'viewer', body: await body('tasks', 'viewer-create') }, 403);
await call('tasks', { cookie: true, body: await body('tasks', 'csrf') }, 403);

// Group restrictions are enforced recursively, even if the group module is disabled.
await call('groups', { body: await body('groups', 'restricted', { grants: ['owner', 'member'] }) });
await call('tasks', { body: await body('tasks', 'group-task', { parents: [{ type: 'groups', id: 'restricted' }], users: ['owner', 'member'] }) });
await call('groups/restricted', { user: 'admin' }, 404);
await call('tasks/group-task', { user: 'admin' }, 404);
assert(!(await call('tasks', { user: 'viewer' })).records.some(r => r.id === 'group-task'));
assert((await call('tasks/group-task', { user: 'member' })).records[0].wrappedKey);
const noGroup = modules.filter(m => m !== 'working-groups');
sql.prepare('UPDATE org_module_configs SET enabled_modules_json=? WHERE org_id=?').run(JSON.stringify(noGroup), 'a');
await call('tasks/group-task', { user: 'admin' }, 404);
sql.prepare('UPDATE org_module_configs SET enabled_modules_json=? WHERE org_id=?').run(JSON.stringify(modules), 'a');
await call('tasks', { body: await body('tasks', 'outsider-parent', { parents: [{ type: 'groups', id: 'does-not-exist' }] }) }, 404);
const wrongRecipients = await body('tasks', 'wrong-wrap', { grants: ['owner'] }); wrongRecipients.wraps.push({ userId: 'viewer', deviceId, wrappedKey });
await call('tasks', { body: wrongRecipients }, 400);

// Separate encrypted sections prevent edit permission being used as assign/approve.
await call('tasks/tasks-one', { user: 'member', method: 'PUT', body: await edit('tasks', 'tasks-one', 1, 'assignment', { assignees: ['viewer'] }) }, 403);
await call('tasks/tasks-one', { user: 'member', method: 'PUT', body: { ...await edit('tasks', 'tasks-one', 1, 'edit', {}), parts: { assignment: await encryptPrivate(key, {}, 'a', partKind('tasks', 'assignment'), 'tasks-one') } } }, 400);
await call('tasks/tasks-one', { user: 'member', method: 'PUT', body: await edit('tasks', 'tasks-one', 1, 'edit', { title: 'updated' }) });
await call('tasks/tasks-one', { method: 'PUT', body: await edit('tasks', 'tasks-one', 2, 'assignment', { assignees: ['member'] }) });
assert.equal((await call('tasks/tasks-one')).records[0].revision, 3);
await call('tasks', { body: await body('tasks', 'decision-task', { parents: [{ type: 'decisions', id: 'decisions-one' }] }) });
assert.deepEqual((await call('tasks/decision-task')).records[0].parents, [{ type: 'decisions', id: 'decisions-one' }]);

// Resealing a record must not bypass its independently controlled fragments.
await call('tasks', { user: 'member', body: await body('tasks', 'member-owned') });
await call('tasks/member-owned', { method: 'PUT', body: await edit('tasks', 'member-owned', 1, 'assignment', { assignees: ['viewer'] }) });
const memberOwned = (await call('tasks/member-owned', { user: 'member' })).records[0];
assert.equal(memberOwned.canManageAccess, false);
const reseal = await body('tasks', 'member-owned');
reseal.action = 'access'; reseal.revision = 2;
reseal.parts.assignment = await encryptPrivate(key, { assignees: ['member'] }, 'a', partKind('tasks', 'assignment'), 'member-owned');
await call('tasks/member-owned', { user: 'member', method: 'PUT', body: reseal }, 403);
const closePolicy = (await call('context')).permissions.tasks;
await call('permissions', { method: 'PUT', body: { module: 'tasks', permissions: { ...closePolicy, close: 'admin' }, version: 0 } });
await call('tasks', { user: 'member', body: await body('tasks', 'closed-at-create', { state: { status: 'completed' } }) }, 403);
await call('permissions', { method: 'PUT', body: { module: 'tasks', permissions: closePolicy, version: 1 } });

// Promotion is idempotent and cannot change or delete the original submission.
sql.prepare('INSERT INTO org_private_submissions VALUES(?,?,?,?,?,?,?,?)').run('a', 'submission-one', 'intake', 1, '{}', 'salt', 'original encrypted submission', 123);
const promoted = await body('cases', 'promoted', { grants: ['owner'], source: { type: 'intake', id: 'submission-one' } });
await call('cases', { body: promoted });
const duplicate = await call('cases', { body: await body('cases', 'promoted-again', { grants: ['owner'], source: { type: 'intake', id: 'submission-one' } }) });
assert.equal(duplicate.id, 'promoted');
assert.equal(sql.prepare('SELECT ciphertext FROM org_private_submissions WHERE org_id=? AND id=?').get('a', 'submission-one').ciphertext, 'original encrypted submission');
await call('cases/promoted', { user: 'admin' }, 404);
await call('cases/promoted', { user: 'outside' }, 403);
await call('cases/promoted', { method: 'PUT', body: { ...await edit('cases', 'promoted', 1, 'edit', {}), source: { type: 'intake', id: 'changed' } } }, 400);
await call('cases/promoted', { method: 'PUT', body: await edit('cases', 'promoted', 1, 'state', { status: 'closed', outcome: 'Resolved' }) });
await call('cases/promoted', { method: 'PUT', body: await edit('cases', 'promoted', 2, 'state', { status: 'open' }) });
assert((await call('cases/promoted')).records[0].parts.source);

// Financial approvals are authoritative metadata and are invalidated by edits.
await call('options', { method: 'PUT', body: { approvalsRequired: true, version: 0 } });
await call('transactions', { body: await body('transactions', 'requires-approval') });
assert((await call('transactions/requires-approval')).records[0].approvalRequired);
await call('transactions/requires-approval', { method: 'PUT', body: await edit('transactions', 'requires-approval', 1, 'approval', { value: 'approved' }) });
await call('transactions/requires-approval', { method: 'PUT', body: await edit('transactions', 'requires-approval', 2, 'edit', { amountMinor: 5, approvalRequired: false }) });
const changed = (await call('transactions/requires-approval')).records[0];
assert(changed.approvalRequired); assert(!changed.parts.approval);

// No private fields can ride along with a public financial projection.
const funds = [{ id: 'f1', title: 'Our own fund label', currency: 'USD', startingMinor: 10000, budgetMinor: 9000 }, { id: 'f2', title: 'Second fund', currency: 'USD', startingMinor: 0 }];
const txs = [
  { id: 'i', type: 'income', amountMinor: 12345, fundId: 'f1', date: '2026-09-01', status: 'posted', description: 'SECRET internal', publicDescription: 'Donation', notes: 'SECRET', member: 'SECRET', receipt: 'SECRET', category: 'Donations' },
  { id: 'e', type: 'expense', amountMinor: 2345, fundId: 'f1', date: '2026-09-02', status: 'posted' },
  { id: 't', type: 'transfer', amountMinor: 5000, fundId: 'f1', toFundId: 'f2', date: '2026-09-03', status: 'posted' },
  { id: 'r', type: 'reimbursement', amountMinor: 700, fundId: 'f1', date: '2026-09-03', status: 'posted', reimbursementState: 'requested' },
  { id: 'pending', type: 'expense', amountMinor: 800, fundId: 'f1', status: 'posted', approvalRequired: true, approval: 'pending' },
];
const totals = treasuryTotals(funds, txs);
assert.equal(totals[0].balance, 15000); assert.equal(totals[1].balance, 5000); assert.equal(totals[0].outstanding, 700);
assert.equal(totals.reduce((n, f) => n + f.balance, 0), 20000, 'transfers preserve the combined balance');
assert.equal(totals[0].remainingBudget, 6655, 'transfers are not budget spending');
assert.equal(treasuryTotals(funds, txs.map(t => ({ ...t, archived: true })))[0].balance, totals[0].balance, 'archiving must not rewrite balances');
assert.equal(moneyMinor('0.29'), 29); assert.equal(moneyMinor('-1.01'), -101); assert.throws(() => moneyMinor('1.001'));
assert.throws(() => validateTransaction({ ...txs[2], toFundId: 'f1' }, funds));
assert.throws(() => validateTransaction(txs[2], [funds[0], { ...funds[1], currency: 'EUR' }]));
assert.equal(nextDueDate('2026-01-31', 'monthly'), '2026-02-28');
const projection = buildTreasuryProjection({ heading: 'Our funds', introduction: 'Selected activity', funds, transactions: txs, selections: { funds: { f1: { publish: true, balance: true } }, transactions: { i: { publish: true, description: true, category: true } } } });
assert(validTreasuryProjection(projection)); assert(!JSON.stringify(projection).includes('SECRET')); assert(!JSON.stringify(projection).includes('f1')); assert.equal(projection.funds[0].name, 'Our own fund label');
assert(!validTreasuryProjection({ ...projection, notes: 'SECRET' }));
assert(!validTreasuryProjection({ ...projection, transactions: [{ ...projection.transactions[0], receipt: 'SECRET' }] }));
const publicRequest = new Request('https://example.test/api/p/test/treasury');
kv.set('slug:test', 'a'); kv.set('org:a', JSON.stringify({ enabled: true, slug: 'test' }));
assert.equal((await publicTreasury({ env, request: publicRequest, slug: 'test' })).status, 404);
await call('publication', { method: 'PUT', body: { public: projection, sources: [] }, user: 'member' }, 404);
await call('publication', { method: 'PUT', body: { public: { ...projection, notes: 'SECRET' }, sources: [] } }, 400);
await call('publication', { method: 'PUT', body: { public: projection, sources: [{ type: 'funds', id: 'funds-one', revision: 99 }] } }, 409);
await call('publication', { method: 'PUT', body: { public: projection, sources: [{ type: 'funds', id: 'funds-one', revision: 1 }] } });
const published = await (await publicTreasury({ env, request: publicRequest, slug: 'test' })).json(); assert.deepEqual(published.public, projection);
await call('publication', { method: 'DELETE' });
assert.equal((await publicTreasury({ env, request: publicRequest, slug: 'test' })).status, 404);

// Outer epoch checks still protect every new encrypted fragment.
await ensureScopedKeys(db);
sql.prepare('INSERT INTO org_private_key_state VALUES(?,1,0,0)').run('a');
key.epoch = 1;
await call('tasks', { body: await body('tasks', 'scoped') });
const stale = new Uint8Array(key);
await assert.rejects(call('tasks', { body: await body('tasks', 'stale', { rawKey: stale }) }), /PRIVATE_KEY_ROTATION_REQUIRED/);
sql.prepare('UPDATE org_private_key_state SET roster_revision=1 WHERE org_id=?').run('a');
await assert.rejects(call('tasks', { body: await body('tasks', 'rotation-required') }), /PRIVATE_KEY_ROTATION_REQUIRED/);
assert(!sql.prepare('SELECT id FROM org_work_access WHERE id=?').get('rotation-required'));
const middlewareResponse = await middleware({ env, request: new Request('https://example.test/api/orgs/a/work/tasks', { method: 'POST', headers: { authorization: 'Bearer ' + tokens.owner, 'content-type': 'application/json' }, body: JSON.stringify(await body('tasks', 'blocked')) }), next: () => { throw new Error('Unexpected route bypass'); } });
assert.equal(middlewareResponse.status, 409);
assert(!JSON.stringify(sql.prepare('SELECT * FROM org_private_records').all()).includes('SECRET'));
sql.prepare('DELETE FROM org_private_records WHERE org_id=? AND kind=? AND id=?').run('a', 'work/tasks', 'scoped');
assert(!sql.prepare('SELECT id FROM org_work_access WHERE org_id=? AND id=?').get('a', 'scoped'));
console.log('Workflow regressions passed: isolation, disabled modules, restrictions, section permissions, promotion, finance, publication and epoch boundaries.');
