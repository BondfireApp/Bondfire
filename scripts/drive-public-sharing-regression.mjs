import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { ensurePrivateSchema } from '../functions/api/_lib/privateStore.js';
import { signJwt } from '../functions/api/_lib/jwt.js';
import { onRequest as manage } from '../functions/api/orgs/[orgId]/drive/public-share.js';
import { onRequestGet as publicGet } from '../functions/api/drive-public/[token].js';
import { onRequest as middleware } from '../functions/api/_middleware.js';
import { encryptPrivate } from '../src/lib/privateCrypto.js';
import { encryptWithOrgKey, decryptWithOrgKey, randomOrgKey } from '../src/lib/zk.js';
import { publicDriveItem } from '../src/lib/drivePublicSharing.js';

const sql = new DatabaseSync(':memory:');
const db = {
  prepare(query) {
    const statement = sql.prepare(query); let values = [];
    return { bind(...args) { values = args; return this; }, async first() { return statement.get(...values) || null; }, async all() { return { results: statement.all(...values) }; }, async run() { return { meta: statement.run(...values) }; } };
  },
  async batch(statements) {
    sql.exec('BEGIN');
    try { const results = []; for (const statement of statements) results.push(await statement.run()); sql.exec('COMMIT'); return results; }
    catch (e) { sql.exec('ROLLBACK'); throw e; }
  },
};
const env = { BF_DB: db, JWT_SECRET: 'drive-share-test' };
sql.exec(`CREATE TABLE users(id TEXT PRIMARY KEY); INSERT INTO users VALUES('member'),('viewer'),('other');
CREATE TABLE orgs(id TEXT PRIMARY KEY); INSERT INTO orgs VALUES('org');
CREATE TABLE org_memberships(org_id TEXT,user_id TEXT,role TEXT); INSERT INTO org_memberships VALUES('org','member','member'),('org','viewer','viewer'),('elsewhere','other','owner');`);
await ensurePrivateSchema(db);
sql.prepare('INSERT INTO org_private_mode VALUES(?,?,0,0,?)').run('org', 'enabled', '');
for (const kind of ['drive/files', 'drive/notes', 'drive/folders', 'drive/templates']) {
  sql.prepare('INSERT INTO org_private_records(org_id,kind,id,ciphertext,revision,created_at,updated_at) VALUES(?,?,?,?,1,0,0)').run('org', kind, kind.split('/')[1], 'private original');
}
const jwt = await signJwt(env.JWT_SECRET, { sub: 'member' }, 3600);
const wrapKey = randomOrgKey(), shareKey = randomOrgKey();
const ciphertext = await encryptWithOrgKey(shareKey, JSON.stringify({ title: 'Only the shared copy', text: 'x'.repeat(100000) }));
const wrappedKey = await encryptPrivate(wrapKey, { key: [...shareKey] }, 'org', 'drive/files', 'files');
const body = { kind: 'drive/files', itemId: 'files', ciphertext, wrappedKey, manifest: [{ kind: 'drive/files', id: 'files' }] };
async function call(method, value = body, token = jwt, orgId = 'org') {
  const request = new Request(`https://example.test/api/orgs/${orgId}/drive/public-share${method === 'GET' ? '?' + new URLSearchParams(value) : ''}`, { method, headers: token ? { authorization: `Bearer ${token}`, 'content-type': 'application/json' } : {}, ...(method !== 'GET' ? { body: JSON.stringify(value) } : {}) });
  return middleware({ env, request, next: () => manage({ env, request, params: { orgId } }) });
}
async function anonymous(token) {
  const request = new Request(`https://example.test/api/drive-public/${token}`);
  return middleware({ env, request, next: () => publicGet({ env, request, params: { token } }) });
}
assert.ok([401,403].includes((await call('POST', body, '')).status));
assert.equal((await call('POST', body, await signJwt(env.JWT_SECRET, { sub: 'viewer' }, 3600))).status, 403);
assert.equal((await call('POST', body, await signJwt(env.JWT_SECRET, { sub: 'other' }, 3600))).status, 403);
assert.equal((await call('POST', { ...body, ciphertext: 'plaintext' })).status, 400);
assert.equal((await call('POST', { ...body, manifest: [{ kind: 'drive/files', id: 'missing' }, ...body.manifest] })).status, 403);
const created = await call('POST');
assert.equal(created.status, 200, await created.clone().text());
const detail = await created.json();
assert.match(detail.token, /^[a-f0-9]{64}$/);
const published = await anonymous(detail.token);
assert.equal(published.status, 200);
assert.equal(published.headers.get('cache-control'), 'no-store');
const bytes = await published.text();
assert.equal(bytes, ciphertext, 'chunked ciphertext must round-trip without truncation');
assert.ok(!bytes.includes('Only the shared copy') && !bytes.includes('private original'));
assert.equal(JSON.parse(await decryptWithOrgKey(shareKey, bytes)).title, 'Only the shared copy');
await assert.rejects(decryptWithOrgKey(wrapKey, bytes), 'organization key must not unlock public shares');
assert.equal((await anonymous('0'.repeat(64))).status, 404);
assert.equal((await call('POST', { ...body, token: detail.token })).status, 200, 'update must keep the same link');
assert.equal(sql.prepare('SELECT COUNT(DISTINCT version) n FROM drive_public_share_chunks').get().n, 1, 'updates must remove old chunks');
assert.equal((await call('POST', body)).status, 409, 'stale creation must not overwrite an existing link');
sql.exec("CREATE TABLE emergency_protocol_state(org_id TEXT,isolated INTEGER,stage TEXT); INSERT INTO emergency_protocol_state VALUES('org',1,'isolated')");
assert.equal((await anonymous(detail.token)).status, 404, 'emergency isolation must disable public shares');
sql.exec("UPDATE emergency_protocol_state SET isolated=0,stage='normal'");
sql.exec("UPDATE org_memberships SET role='viewer' WHERE user_id='member'");
assert.equal((await anonymous(detail.token)).status, 404, 'publisher permission loss must disable the link');
sql.exec("UPDATE org_memberships SET role='member' WHERE user_id='member'");
assert.equal((await call('DELETE', { kind: body.kind, itemId: body.itemId })).status, 200);
assert.equal((await anonymous(detail.token)).status, 404);
assert.equal(sql.prepare('SELECT COUNT(*) n FROM drive_public_share_chunks').get().n, 0);
assert.equal((await call('POST', { ...body, token: detail.token })).status, 409, 'a revoked link must never be resurrected by a stale update');
const fresh = await (await call('POST')).json();
assert.notEqual(fresh.token, detail.token);
sql.exec("DELETE FROM org_private_records WHERE kind='drive/files'");
assert.equal((await anonymous(fresh.token)).status, 404, 'deletion must invalidate public access');

const form = publicDriveItem('drive/files', { name: 'intake.bfform', mime: 'application/vnd.bondfire.form+json', textContent: JSON.stringify({ title: 'Public questions', blocks: [{ label: 'Question' }], responses: [{ answer: 'secret answer' }], publicShare: { recipientPrivateKey: 'secret key' } }), dataUrl: 'data:PRIVATE ORIGINAL' });
assert.ok(!JSON.stringify(form).includes('secret') && !JSON.stringify(form).includes('PRIVATE ORIGINAL'));
for (const [kind, id] of [['drive/notes', 'notes'], ['drive/folders', 'folders'], ['drive/templates', 'templates']]) {
  const result = await call('POST', { kind, itemId: id, ciphertext, wrappedKey: await encryptPrivate(wrapKey, {}, 'org', kind, id), manifest: [{ kind, id }] });
  assert.equal(result.status, 200, `${kind}: ${await result.clone().text()}`);
  assert.equal((await anonymous((await result.json()).token)).status, 200);
}
// Restricted items cannot be republished by an organization member without edit access.
sql.prepare('INSERT INTO drive_share_policies VALUES(?,?,?,?,1,NULL,0,0)').run('org', 'drive/notes', 'notes', 'someone-else');
assert.equal((await call('POST', { ...body, kind: 'drive/notes', itemId: 'notes' })).status, 403);
console.log('PASS: anonymous encrypted Drive shares, all item kinds, chunking, isolation, permissions, deletion, revocation, and form privacy');
