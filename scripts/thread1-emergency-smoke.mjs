import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

import { encryptWithOrgKey } from '../src/lib/zk.js';
import { signJwt } from '../functions/api/_lib/jwt.js';
import { onRequestGet as globalEmergencyGet } from '../functions/api/emergency/status.js';
import { onRequestGet as orgEmergencyGet } from '../functions/api/orgs/[orgId]/emergency/index.js';
import { onRequestPost as orgLockdownPost } from '../functions/api/orgs/[orgId]/emergency/lockdown.js';
import { onRequestPost as orgNeedsPost } from '../functions/api/orgs/[orgId]/needs.js';
import { onRequestPut as orgNeedsPut, onRequestDelete as orgNeedsDelete } from '../functions/api/orgs/[orgId]/needs.js';
import { onRequestPatch as orgDriveFolderPatch, onRequestDelete as orgDriveFolderDelete } from '../functions/api/orgs/[orgId]/drive/folders/[id].js';
import { onRequestPost as orgChatRoomsPost } from '../functions/api/orgs/[orgId]/chat/rooms.js';
import { onRequestPost as orgChatMessagesPost } from '../functions/api/orgs/[orgId]/chat/messages.js';

class D1Stmt {
  constructor(stmt) {
    this.stmt = stmt;
    this.args = [];
  }
  bind(...args) {
    this.args = args;
    return this;
  }
  async first() {
    const row = this.stmt.get(...this.args);
    return row ?? null;
  }
  async all() {
    const rows = this.stmt.all(...this.args);
    return { results: rows };
  }
  async run() {
    const info = this.stmt.run(...this.args);
    return { success: true, meta: info };
  }
}

class D1Like {
  constructor() {
    this.db = new DatabaseSync(':memory:');
  }
  prepare(sql) {
    return new D1Stmt(this.db.prepare(sql));
  }
  async batch(statements) {
    this.db.exec('BEGIN');
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.db.exec('COMMIT');
      return results;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
}

function makeRequest(url, { method = 'GET', token, body } = {}) {
  const headers = new Headers();
  if (token) headers.set('authorization', `Bearer ${token}`);
  if (body !== undefined) headers.set('content-type', 'application/json');
  return new Request(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function readJson(res) {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return { _raw: text };
  }
}

function assertNoSensitive(obj, path = '') {
  if (obj == null) return;
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i += 1) assertNoSensitive(obj[i], `${path}[${i}]`);
    return;
  }
  if (typeof obj !== 'object') return;

  for (const [key, value] of Object.entries(obj)) {
    const p = path ? `${path}.${key}` : key;
    assert(!/(token|secret|key|recovery|audit|blob|password|cookie|authorization)/i.test(key), `Sensitive key leaked: ${p}`);
    assertNoSensitive(value, p);
  }
}

async function main() {
  const BF_DB = new D1Like();
  const env = { BF_DB, JWT_SECRET: 'thread1-secret' };
  const encryptedMessage = await encryptWithOrgKey(crypto.getRandomValues(new Uint8Array(32)), JSON.stringify({ body: 'test message' }));
  await BF_DB.prepare('CREATE TABLE users (id TEXT PRIMARY KEY)').run();
  await BF_DB.prepare("INSERT INTO users VALUES ('user-admin')").run();

  await BF_DB.prepare('CREATE TABLE orgs (id TEXT PRIMARY KEY, name TEXT)').run();
  await BF_DB.prepare('CREATE TABLE org_memberships (org_id TEXT, user_id TEXT, role TEXT)').run();
  await BF_DB.prepare('CREATE TABLE needs (id TEXT PRIMARY KEY, org_id TEXT, title TEXT, description TEXT, status TEXT, priority INTEGER NOT NULL DEFAULT 0, is_public INTEGER NOT NULL DEFAULT 0, encrypted_description TEXT, encrypted_blob TEXT, key_version INTEGER, created_at INTEGER, updated_at INTEGER)').run();
  await BF_DB.prepare('CREATE TABLE org_crypto (org_id TEXT PRIMARY KEY, version INTEGER NOT NULL DEFAULT 1, key_version INTEGER NOT NULL DEFAULT 1)').run();
  await BF_DB.prepare('INSERT INTO org_crypto (org_id, version, key_version) VALUES (?, ?, ?)').bind('org-1', 1, 1).run();

  await BF_DB.prepare('INSERT INTO orgs (id, name) VALUES (?, ?)').bind('org-1', 'Org One').run();
  await BF_DB.prepare('INSERT INTO org_memberships (org_id, user_id, role) VALUES (?, ?, ?)').bind('org-1', 'user-admin', 'admin').run();

  const token = await signJwt(env.JWT_SECRET, { sub: 'user-admin', email: 'admin@example.com' }, 3600);
  const now = Date.now();
  await BF_DB.prepare('INSERT INTO needs (id, org_id, title, description, status, priority, is_public, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').bind('need-1', 'org-1', 'Need 1', '', 'open', 1, 0, now, now).run();

  // 1) Global status
  const globalRes = await globalEmergencyGet({ env, request: makeRequest('https://test.local/api/emergency/status', { token }) });
  assert.equal(globalRes.status, 200);
  const globalJson = await readJson(globalRes);
  assert.equal(globalJson.id, 'global');
  assert.equal(typeof globalJson.isActive, 'boolean');
  assertNoSensitive(globalJson);

  // 2) Org status
  const orgRes = await orgEmergencyGet({ env, params: { orgId: 'org-1' }, request: makeRequest('https://test.local/api/orgs/org-1/emergency', { token }) });
  assert.equal(orgRes.status, 200);
  const orgJson = await readJson(orgRes);
  assert.equal(orgJson.status.id, 'global');
  assert.equal(orgJson.orgLockdown, null);
  assertNoSensitive(orgJson);

  // 3) Enable lockdown (payload uses locked:true per thread request)
  const lockOnRes = await orgLockdownPost({ env, params: { orgId: 'org-1' }, request: makeRequest('https://test.local/api/orgs/org-1/emergency/lockdown', { method: 'POST', token, body: { locked: true } }) });
  assert.equal(lockOnRes.status, 200);
  const lockOnJson = await readJson(lockOnRes);
  assert.equal(lockOnJson.state.enabled, true);
  assert.equal(lockOnJson.protocol.stage, 'lockdown');
  assert.equal(lockOnJson.protocol.isolated, false);

  // 4) confirm representative write blocking across methods
  const blockedRes = await orgNeedsPost({ env, params: { orgId: 'org-1' }, request: makeRequest('https://test.local/api/orgs/org-1/needs', { method: 'POST', token, body: { title: 'Blocked write' } }) });
  assert.equal(blockedRes.status, 403);
  const blockedJson = await readJson(blockedRes);
  assert.equal(blockedJson.ok, false);
  assert.equal(blockedJson.error, 'ORG_LOCKDOWN_ACTIVE');
  assertNoSensitive(blockedJson);

  const blockedPutRes = await orgNeedsPut({ env, params: { orgId: 'org-1' }, request: makeRequest('https://test.local/api/orgs/org-1/needs', { method: 'PUT', token, body: { id: 'need-1', title: 'Blocked put' } }) });
  assert.equal(blockedPutRes.status, 403);
  const blockedPutJson = await readJson(blockedPutRes);
  assert.equal(blockedPutJson.error, 'ORG_LOCKDOWN_ACTIVE');
  assertNoSensitive(blockedPutJson);

  const blockedPatchRes = await orgDriveFolderPatch({ env, params: { orgId: 'org-1', id: 'folder-1' }, request: makeRequest('https://test.local/api/orgs/org-1/drive/folders/folder-1', { method: 'PATCH', token, body: { name: 'Blocked patch' } }) });
  assert.equal(blockedPatchRes.status, 403);
  const blockedPatchJson = await readJson(blockedPatchRes);
  assert.equal(blockedPatchJson.error, 'ORG_LOCKDOWN_ACTIVE');
  assertNoSensitive(blockedPatchJson);

  const blockedDeleteRes = await orgNeedsDelete({ env, params: { orgId: 'org-1' }, request: makeRequest('https://test.local/api/orgs/org-1/needs', { method: 'DELETE', token, body: { id: 'need-1' } }) });
  assert.equal(blockedDeleteRes.status, 403);
  const blockedDeleteJson = await readJson(blockedDeleteRes);
  assert.equal(blockedDeleteJson.error, 'ORG_LOCKDOWN_ACTIVE');
  assertNoSensitive(blockedDeleteJson);

  // chat write routes must also be blocked under lockdown
  const blockedRoomRes = await orgChatRoomsPost({ env, params: { orgId: 'org-1' }, request: makeRequest('https://test.local/api/orgs/org-1/chat/rooms', { method: 'POST', token, body: { name: 'Ops' } }) });
  assert.equal(blockedRoomRes.status, 403);
  const blockedRoomJson = await readJson(blockedRoomRes);
  assert.equal(blockedRoomJson.error, 'ORG_LOCKDOWN_ACTIVE');
  assertNoSensitive(blockedRoomJson);

  const blockedMessageRes = await orgChatMessagesPost({ env, params: { orgId: 'org-1' }, request: makeRequest('https://test.local/api/orgs/org-1/chat/messages', { method: 'POST', token, body: { roomId: 'r1', encrypted_blob: encryptedMessage } }) });
  assert.equal(blockedMessageRes.status, 403);
  const blockedMessageJson = await readJson(blockedMessageRes);
  assert.equal(blockedMessageJson.error, 'ORG_LOCKDOWN_ACTIVE');
  assertNoSensitive(blockedMessageJson);

  // 5) confirm safe reads still work and the protocol stage is visible
  const orgResDuring = await orgEmergencyGet({ env, params: { orgId: 'org-1' }, request: makeRequest('https://test.local/api/orgs/org-1/emergency', { token }) });
  assert.equal(orgResDuring.status, 200);
  const orgJsonDuring = await readJson(orgResDuring);
  assert.equal(orgJsonDuring.orgLockdown?.enabled, true);
  assert.equal(orgJsonDuring.orgProtocol?.stage, 'lockdown');
  assert.equal(orgJsonDuring.orgProtocol?.isolated, false);

  const globalResDuring = await globalEmergencyGet({ env, request: makeRequest('https://test.local/api/emergency/status', { token }) });
  assert.equal(globalResDuring.status, 200);

  // 6) disable lockdown
  const lockOffRes = await orgLockdownPost({ env, params: { orgId: 'org-1' }, request: makeRequest('https://test.local/api/orgs/org-1/emergency/lockdown', { method: 'POST', token, body: { locked: false } }) });
  assert.equal(lockOffRes.status, 200);
  const lockOffJson = await readJson(lockOffRes);
  assert.equal(lockOffJson.state.enabled, false);
  assert.equal(lockOffJson.protocol.stage, 'normal');

  // 6b) writes unblocked again
  const allowedRes = await orgNeedsPost({ env, params: { orgId: 'org-1' }, request: makeRequest('https://test.local/api/orgs/org-1/needs', { method: 'POST', token, body: { title: 'Allowed write', is_public: true } }) });
  assert.equal(allowedRes.status, 200);
  const allowedJson = await readJson(allowedRes);
  assert.equal(allowedJson.ok, true);

  const allowedRoomRes = await orgChatRoomsPost({ env, params: { orgId: 'org-1' }, request: makeRequest('https://test.local/api/orgs/org-1/chat/rooms', { method: 'POST', token, body: { name: 'Ops' } }) });
  assert.equal(allowedRoomRes.status, 200);
  const allowedRoomJson = await readJson(allowedRoomRes);
  assert.equal(allowedRoomJson.ok, true);

  const allowedMessageRes = await orgChatMessagesPost({ env, params: { orgId: 'org-1' }, request: makeRequest('https://test.local/api/orgs/org-1/chat/messages', { method: 'POST', token, body: { roomId: allowedRoomJson.room.id, encrypted_blob: encryptedMessage } }) });
  assert.equal(allowedMessageRes.status, 200);
  const allowedMessageJson = await readJson(allowedMessageRes);
  assert.equal(allowedMessageJson.ok, true);

  console.log('THREAD 1 smoke passed.');
}

main().catch((err) => {
  console.error('THREAD 1 smoke failed:', err);
  process.exit(1);
});
