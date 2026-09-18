import assert from 'node:assert/strict';
import { DatabaseSync, constants } from 'node:sqlite';
import { signJwt } from '../functions/api/_lib/jwt.js';
import { onRequestPost as lockdown } from '../functions/api/orgs/[orgId]/emergency/lockdown.js';
import { onRequestPost as isolate } from '../functions/api/orgs/[orgId]/emergency/isolate.js';
import { onRequestPost as recover } from '../functions/api/orgs/[orgId]/emergency/recover.js';
import { onRequestPost as prepare } from '../functions/api/orgs/[orgId]/emergency/prepare.js';
import { onRequestPost as destroy } from '../functions/api/orgs/[orgId]/emergency/destroy.js';
import { onRequestGet as protocol } from '../functions/api/orgs/[orgId]/emergency/protocol.js';
import { onRequestDelete as legacyDelete } from '../functions/api/orgs/[orgId].js';
import { onRequestPost as destroyAccount } from '../functions/api/auth/destroy-account.js';
import { onRequest as middleware } from '../functions/api/_middleware.js';
import { requireUser } from '../functions/api/_lib/auth.js';
import { getOrgDestructionPreview } from '../functions/api/_lib/destruction.js';
import { orgPrefix, scopedObjectKey } from '../functions/api/_lib/colophonScopedRuntime.js';

const sqlite = new DatabaseSync(':memory:');
sqlite.exec('PRAGMA foreign_keys=ON');
let failSql = null;
const db = { prepare(sql) {
  const stmt = sqlite.prepare(sql);
  let args = [];
  const check = () => { if (failSql?.test(sql)) throw new Error('injected database failure'); };
  return {
    bind(...values) { args = values; return this; },
    async first() { check(); return stmt.get(...args) ?? null; },
    async all() { check(); return { results: stmt.all(...args) }; },
    async run() { check(); return { success: true, meta: stmt.run(...args) }; },
  };
}, async batch(statements) {
  sqlite.exec('BEGIN');
  try { const out = []; for (const statement of statements) out.push(await statement.run()); sqlite.exec('COMMIT'); return out; }
  catch (error) { sqlite.exec('ROLLBACK'); throw error; }
} };
const prefix = orgPrefix('org'), otherPrefix = orgPrefix('other');
sqlite.exec(`
  CREATE TABLE _cf_KV (key TEXT PRIMARY KEY, value TEXT);
  INSERT INTO _cf_KV VALUES ('provider', 'keep');
  CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT, name TEXT, password_hash TEXT);
  CREATE TABLE orgs (id TEXT PRIMARY KEY, name TEXT);
  INSERT INTO orgs VALUES ('org', 'Example'), ('other', 'Other');
  CREATE TABLE org_memberships (org_id TEXT REFERENCES orgs(id), user_id TEXT REFERENCES users(id), role TEXT);
  CREATE TABLE org_key_wrapped (org_id TEXT REFERENCES orgs(id), user_id TEXT, payload TEXT);
  CREATE TABLE private_records (id TEXT PRIMARY KEY, org_id TEXT REFERENCES orgs(id), encrypted_blob TEXT, created_by TEXT REFERENCES users(id));
  CREATE TABLE record_attachments (id TEXT PRIMARY KEY, record_id TEXT REFERENCES private_records(id), body TEXT);
  CREATE TABLE drive_files (id TEXT PRIMARY KEY, org_id TEXT, storage_key TEXT);
  INSERT INTO drive_files VALUES ('f1','org','org/drive/files/f1'), ('f2','other','other/drive/files/f2');
  CREATE TABLE ${prefix}posts (id TEXT PRIMARY KEY, body TEXT);
  CREATE TABLE ${otherPrefix}posts (id TEXT PRIMARY KEY, body TEXT);
  INSERT INTO ${prefix}posts VALUES ('p','private publication');
  INSERT INTO ${otherPrefix}posts VALUES ('p','other publication');
`);
const password = 'test emergency password';
const salt = new Uint8Array(16).fill(7);
const passwordKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
const hash = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, passwordKey, 256));
const stored = Buffer.concat([salt, hash]).toString('base64');
for (const id of ['owner', 'admin', 'member', 'other-owner']) sqlite.prepare('INSERT INTO users VALUES (?,?,?,?)').run(id, `${id}@example.test`, id, stored);
sqlite.exec(`
  INSERT INTO org_memberships VALUES ('org','owner','owner'),('org','admin','admin'),('org','member','member'),('other','other-owner','owner'),('other','owner','member');
  INSERT INTO org_key_wrapped VALUES ('org','owner','key material'),('other','other-owner','other key');
  INSERT INTO private_records VALUES ('one','org','ciphertext','owner'),('two','other','other ciphertext','owner');
  INSERT INTO record_attachments VALUES ('a1','one','attached content'),('a2','two','other content');
`);
const denyInternal = (action, name, arg) => action === constants.SQLITE_PRAGMA && /^_cf_/i.test(arg) ? constants.SQLITE_DENY : constants.SQLITE_OK;
sqlite.setAuthorizer(denyInternal);
assert.throws(() => sqlite.prepare('PRAGMA table_info("_cf_KV")'), /not authorized/);
let failStorage = false;
const objects = new Map([
  ['org/drive/files/f1', 'private file'], ['org/drive/orphan', 'orphan file'], ['other/drive/files/f2','other file'],
  [scopedObjectKey('media/private', 'org'), 'publication file'], [scopedObjectKey('media/other', 'other'), 'other publication file'],
]);
const bucket = {
  async get(key) { return objects.get(key); }, async put(key, value) { objects.set(key, value); },
  async delete(key) { if (failStorage && key === 'org/drive/orphan') throw new Error('storage unavailable'); objects.delete(key); },
  async list({ prefix }) { return { objects: [...objects.keys()].filter((key) => key.startsWith(prefix)).map((key) => ({ key })), truncated: false }; },
};
const publicCopies = new Map([['org:org',JSON.stringify({slug:'example'})],['slug:example','org'],['slug:other','other']]);
const publicStore = {
  async get(key) { return publicCopies.get(key); }, async put(key, value) { publicCopies.set(key, value); }, async delete(key) { publicCopies.delete(key); },
};
const env = { BF_DB: db, JWT_SECRET: 'test-only', BF_DRIVE_BUCKET: bucket, BF_PUBLIC: publicStore };
const tokens = Object.fromEntries(await Promise.all(['owner','admin','member'].map(async (id) => [id, await signJwt(env.JWT_SECRET, { sub: id }, 3600)])));
const ctx = (path, { user = 'owner', body, url, method } = {}) => ({ env, params: { orgId: 'org' }, request: new Request(url || `https://example.test/api/orgs/org/emergency/${path}`, {
  method: method || (body ? 'POST' : 'GET'), headers: { authorization: `Bearer ${tokens[user]}`, 'content-type': 'application/json' },
  ...(body ? { body: JSON.stringify(body) } : {}),
}) });
const authBody = (extra = {}) => ({ password, ...extra });
const expect = async (handler, context, status, code) => { const response = await handler(context); const data = await response.json(); assert.equal(response.status, status, JSON.stringify(data)); if (code) assert.equal(data.error, code); return data; };
const rowCount = (table) => Number(sqlite.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n);
const throughGate = (context) => middleware({ ...context, next: async () => Response.json({ reached: true }) });

await expect(throughGate, ctx('', { body: {name:'New org'}, url:'https://example.test/api/orgs/create' }), 200);
await expect(legacyDelete, ctx('', { method: 'DELETE' }), 409, 'EMERGENCY_PROTOCOL_REQUIRED');
await expect(lockdown, ctx('lockdown', { body: {} }), 400, 'INVALID_LOCKDOWN_STATE');
await expect(destroy, ctx('destroy', { body: authBody() }), 409, 'DESTRUCTION_NOT_PREPARED');
await expect(lockdown, ctx('lockdown', { user:'member', body:{ enabled:true } }), 403, 'INSUFFICIENT_ROLE');
// A database failure rolls back lock, stage, and report together.
failSql = /INSERT INTO emergency_reports/;
await assert.rejects(lockdown(ctx('lockdown',{body:{enabled:true}})), /injected/);
failSql = null;
assert.equal(rowCount('org_emergency_state'), 0);
await expect(lockdown, ctx('lockdown', { user:'admin', body:{enabled:true} }), 200);
let state = await expect(protocol, ctx('protocol'), 200);
assert.equal(state.protocol.stage, 'lockdown'); assert.equal(state.preview, null);
assert.equal(rowCount('private_records'), 2); assert.equal(rowCount('org_key_wrapped'), 2);
await expect(throughGate, ctx('', { user:'member', url:'https://example.test/api/orgs/org/anything', body:{value:'blocked'} }),403,'ORG_LOCKDOWN_ACTIVE');
await expect(throughGate, ctx('', { url:'https://example.test/api/p/example/intake', body:{value:'blocked'} }),403,'ORG_LOCKDOWN_ACTIVE');
failSql = /SELECT lockdown_enabled/;
await expect(throughGate, ctx('', { body:{value:'blocked'}, url:'https://example.test/api/orgs/org/anything' }),500,'INTERNAL');
failSql = null;
await expect(isolate, ctx('isolate',{user:'admin',body:authBody()}),403,'INSUFFICIENT_ROLE');
await expect(isolate, ctx('isolate',{body:{password:'wrong'}}),401,'INVALID_PASSWORD');
// Cookie-authenticated destructive actions require the CSRF token.
const cookieContext = ctx('isolate', { body: authBody() });
cookieContext.request.headers.delete('authorization');
cookieContext.request.headers.set('cookie', `bf_at=${tokens.owner}; bf_csrf=csrf-test`);
await expect(isolate, cookieContext, 403, 'CSRF_REQUIRED');
// Missing MFA schema is supported, but an unreadable configured MFA table is not.
sqlite.exec('CREATE TABLE user_mfa (user_id TEXT PRIMARY KEY, totp_secret_encrypted TEXT, mfa_enabled INTEGER)');
sqlite.prepare('INSERT INTO user_mfa VALUES (?, ?, 1)').run('owner', '{}');
await expect(isolate, ctx('isolate',{body:authBody()}),400,'MFA_REQUIRED');
failSql = /SELECT totp_secret_encrypted/;
await assert.rejects(isolate(ctx('isolate',{body:authBody()})), /injected/);
failSql = null;
sqlite.exec('DELETE FROM user_mfa; DELETE FROM rate_limits');
await expect(isolate, ctx('isolate',{body:authBody()}),200);
await expect(throughGate, ctx('',{user:'member',url:'https://example.test/api/orgs/org/anything'}),403,'ORG_ISOLATED');
await expect(throughGate, ctx('',{url:'https://example.test/api/public/example'}),403,'ORG_ISOLATED');
await expect(lockdown, ctx('lockdown',{body:{enabled:false}}),409,'PROTOCOL_STAGE_CHANGED');
await expect(recover, ctx('recover',{body:authBody()}),200);
assert.equal((await expect(protocol,ctx('protocol'),200)).protocol.stage,'normal');
assert.equal(rowCount('private_records'),2); assert.equal(rowCount('org_key_wrapped'),2);
await expect(throughGate, ctx('', { user:'member',body:{value:'allowed'},url:'https://example.test/api/orgs/org/anything' }),200);
// Account deletion must not orphan the last owner’s organization.
await expect(destroyAccount, ctx('',{url:'https://example.test/api/auth/destroy-account',body:authBody({confirmation:'DELETE MY ACCOUNT',acknowledgeHistoricalLimit:true})}),409,'SOLE_OWNED_ORGS_REMAIN');
await expect(lockdown,ctx('lockdown',{body:{enabled:true}}),200);
await expect(isolate,ctx('isolate',{body:authBody()}),200);
await expect(prepare,ctx('prepare',{body:authBody()}),400,'DESTRUCTION_REVIEW_ACK_REQUIRED');
state = await expect(prepare,ctx('prepare',{body:authBody({acknowledgeDestructionReview:true})}),200);
assert.equal(state.preview.tableCounts.record_attachments,1);
assert.equal(state.preview.tableCounts[`${prefix}posts`],1);
assert.equal(state.preview.erasure.activeDataDeleted,false);
const destructionBody = authBody({confirmation:'DESTROY Example',acknowledgeHistoricalLimit:true});
await expect(destroy,ctx('destroy',{body:{...destructionBody,confirmation:'wrong'}}),400,'CONFIRMATION_MISMATCH');
// Fail after at least one external object has been removed.
failStorage = true;
await expect(destroy,ctx('destroy',{body:destructionBody}),500,'storage unavailable');
assert.equal((await expect(protocol,ctx('protocol'),200)).protocol.stage,'destroying');
assert.equal(rowCount('private_records'),2); assert.equal(rowCount('org_key_wrapped'),2);
assert.equal(objects.has('org/drive/files/f1'),false);
await expect(recover,ctx('recover',{body:authBody()}),409,'PROTOCOL_STAGE_CHANGED');
sqlite.exec('DELETE FROM rate_limits');
failStorage = false;
// Database failure after external deletion preserves every DB record for retry.
failSql = /DELETE FROM "private_records"/;
await expect(destroy,ctx('destroy',{body:destructionBody}),500,'injected database failure');
failSql = null;
assert.equal(rowCount('private_records'),2); assert.equal(rowCount('org_key_wrapped'),2);
await expect(destroy,ctx('destroy',{body:destructionBody}),200);
assert.equal(rowCount('private_records'),1); assert.equal(rowCount('record_attachments'),1);
assert.equal(rowCount(`${prefix}posts`),0); assert.equal(rowCount(`${otherPrefix}posts`),1);
assert.equal(rowCount('org_key_wrapped'),1);
assert.equal(objects.size,2); assert.equal(objects.has('other/drive/files/f2'),true);
assert.equal(publicCopies.has('org:org'),false); assert.equal(publicCopies.has('slug:example'),false); assert.equal(publicCopies.get('slug:other'),'other');
failSql = /DELETE FROM users/;
await assert.rejects(destroyAccount(ctx('',{url:'https://example.test/api/auth/destroy-account',body:authBody({confirmation:'DELETE MY ACCOUNT',acknowledgeHistoricalLimit:true})})), /injected/);
failSql = null;
assert.equal(rowCount('users'),4);
assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM org_memberships WHERE user_id='owner'").get().n,1);
await expect(destroyAccount,ctx('',{url:'https://example.test/api/auth/destroy-account',body:authBody({confirmation:'DELETE MY ACCOUNT',acknowledgeHistoricalLimit:true})}),200);
assert.equal((await requireUser({env,request:ctx('').request})).ok,false);
assert.equal(sqlite.prepare("SELECT created_by FROM private_records WHERE id='two'").get().created_by,null);
assert.equal(sqlite.prepare('SELECT value FROM _cf_KV').get().value,'keep');
// Real application introspection errors must not be silently ignored.
sqlite.setAuthorizer((action,name,arg) => action===constants.SQLITE_PRAGMA && arg==='private_records' ? constants.SQLITE_DENY : constants.SQLITE_OK);
await assert.rejects(getOrgDestructionPreview({db,orgId:'other'}),/not authorized/);
sqlite.close();
console.log('Emergency protocol regression passed: authorization, atomic transitions, recovery, isolation/public gates, preparation, partial-failure retry, storage/database deletion, account cleanup and token invalidation.');
