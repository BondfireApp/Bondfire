import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import {
  createColophonGatewayRequest,
  createColophonScopedEnv,
} from '../functions/api/_lib/colophonScopedRuntime.js';
import { privateRecords } from '../functions/api/_lib/privateStore.js';
import { privateRequestGate } from '../functions/api/_lib/privateGate.js';
import { signJwt } from '../functions/api/_lib/jwt.js';
import { encryptPrivate } from '../src/lib/privateCrypto.js';
import { clearDebugLogs, debugLog } from '../src/lib/debugBus.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const auth = read('functions/api/_lib/auth.js');
const blobs = read('functions/api/_lib/privateBlobs.js');
const destruction = read('functions/api/_lib/destruction.js');
const protocol = read('functions/api/_lib/privateProtocol.js');
const privateClient = read('src/lib/privateClient.js');
const privateStore = read('functions/api/_lib/privateStore.js');
const privateGateSource = read('functions/api/_lib/privateGate.js');
const debug = read('src/debug/initDebug.js');
const debugBus = read('src/lib/debugBus.js');
const gatewayRuntime = read('functions/api/_lib/colophonScopedRuntime.js');
const gatewayRouter = read('functions/api/orgs/[orgId]/colophon/[[path]].js');

// Authentication credentials must not be accepted from URLs.
assert.doesNotMatch(auth, /searchParams\.get\(\s*['"](?:token|access_token|auth|authorization)['"]/i);
assert.doesNotMatch(auth, /[?&](?:token|access_token|authorization)=/i);

// Organization Page settings are intentionally public configuration even when
// the owning workspace is zero-knowledge. Private module data remains gated.
assert.match(privateGateSource, /page\?\.\[1\]===['"]public['"][\s\S]*return null/);
assert.match(privateGateSource, /route===['"]public\/get['"][\s\S]*route===['"]public\/save['"]/);
assert.match(privateClient, /\['public\/get','public\/save','public\/publication','public\/domains'\]\.includes\(tail\)/);
assert.doesNotMatch(privateClient, /dispatchPrivate\(`\/api\/orgs\/\$\{encodeURIComponent\(orgId\)\}\/public\/config/);

// Private member profiles may write only structurally valid ciphertext plus
// the membership identifier/key version. Readable profile fields remain blocked.
assert.match(privateGateSource, /function isMembershipCiphertext\(value\)/);
assert.match(privateGateSource, /\['userId','encrypted_blob','key_version'\]/);
assert.match(privateGateSource, /isMembershipCiphertext\(b\.encrypted_blob\)/);
assert.match(privateGateSource, /PRIVATE_MEMBERSHIP_FIELDS_FORBIDDEN/);

// Colophon gateway sessions must be signed with a server-held secret. They must
// also carry a real userId so Colophon does not treat them as bootstrap owners.
const request = new Request('https://bondfire.test/api/orgs/org-a/colophon/native-content');
const actor = { id: 'user-a', email: 'member@example.test', role: 'member' };
const envA = { JWT_SECRET: 'test-server-secret-a' };
const envB = { JWT_SECRET: 'test-server-secret-b' };
const scopedA = createColophonScopedEnv(envA, 'org-a');
const scopedB = createColophonScopedEnv(envB, 'org-a');
assert.notEqual(scopedA.colophon_SESSION_SECRET, scopedB.colophon_SESSION_SECRET);
assert.throws(() => createColophonScopedEnv({}, 'org-a'), /COLOPHON_GATEWAY_SECRET_REQUIRED/);

const gatewayRequest = await createColophonGatewayRequest(request, 'org-a', actor, envA);
const cookie = gatewayRequest.headers.get('cookie') || '';
const encodedSession = decodeURIComponent(cookie.match(/(?:^|;\s*)colophon_session=([^;]+)/)?.[1] || '');
const payloadPart = encodedSession.split('.')[0];
assert.ok(payloadPart, 'Colophon gateway session cookie was not created');
const payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8'));
assert.equal(payload.userId, 'user-a');
assert.equal(payload.role, 'contributor');
assert.equal(gatewayRequest.headers.get('x-bondfire-colophon-role'), 'member');
assert.match(gatewayRuntime, /export async function ensureColophonGatewayActor\(/);
assert.match(gatewayRuntime, /if \(value === ["']member["']\) return ["']contributor["']/);
assert.match(gatewayRouter, /ensureColophonGatewayActor\(scopedEnv,\s*orgId,\s*actor\)/);
assert.match(gatewayRouter, /bondfireRole:\s*role/);
assert.match(gatewayRouter, /createColophonGatewayRequest\([\s\S]*context\.env,[\s\S]*\)/);

// Private blob object naming is shared with destructive cleanup, and temporary
// upload objects can be deleted only through the authenticated org-scoped API.
assert.match(blobs, /export const privateBlobObjectKey=/);
assert.match(destruction, /import \{ privateBlobObjectKey \} from ['"]\.\/privateBlobs\.js['"]/);
assert.match(blobs, /export async function deletePrivateBlob\(/);
assert.match(protocol, /import \{ deletePrivateBlob, getPrivateBlob, putPrivateBlob \} from ['"]\.\/privateBlobs\.js['"]/);
assert.match(protocol, /request\.method===['"]DELETE['"]/);
assert.match(protocol, /deletePrivateBlob\(env,orgId,id,body\.fileId\)/);

// Failed or superseded encrypted Drive payloads must not be left behind.
assert.match(privateClient, /async function deletePayload\(/);
assert.match(privateClient, /catch\(error\) \{\s*try \{await deletePayload\(orgId,payloadId,fileId,transport\);\} catch \{\}\s*throw error;/s);
assert.match(privateClient, /if\(uploadedPayloadId\)try \{await deletePayload\(orgId,uploadedPayloadId,id,transport\);\} catch \{\}/);
assert.match(privateClient, /previous\?\.payloadId&&previous\.payloadId!==uploadedPayloadId[\s\S]*deletePayload\(orgId,previous\.payloadId,id,transport\)/);

// FireChat messages are append-only at the persistence boundary, not merely in
// the UI. An existing encrypted message cannot be replaced in-place.
assert.match(privateStore, /contract\.append\s*&&\s*existing\s*&&\s*method\s*!==\s*['"]DELETE['"]/);
assert.match(privateStore, /PRIVATE_APPEND_ONLY/);
{
  const sqlite = new DatabaseSync(':memory:');
  const db = {
    prepare(sql) {
      const stmt = sqlite.prepare(sql); let values = [];
      return {
        bind(...next) { values = next; return this; },
        async first() { return stmt.get(...values) ?? null; },
        async all() { return { results: stmt.all(...values) }; },
        async run() { return { success: true, meta: stmt.run(...values) }; },
      };
    },
    async batch(statements) {
      sqlite.exec('BEGIN');
      try { const out=[]; for (const statement of statements) out.push(await statement.run()); sqlite.exec('COMMIT'); return out; }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  };
  sqlite.exec(`
    CREATE TABLE users(id TEXT PRIMARY KEY);
    INSERT INTO users VALUES('member');
    CREATE TABLE orgs(id TEXT PRIMARY KEY,name TEXT);
    INSERT INTO orgs VALUES('org','Private organization');
    CREATE TABLE org_memberships(org_id TEXT,user_id TEXT,role TEXT,PRIMARY KEY(org_id,user_id));
    INSERT INTO org_memberships VALUES('org','member','member');
    CREATE TABLE org_private_mode(org_id TEXT PRIMARY KEY,state TEXT NOT NULL,started_at INTEGER NOT NULL,completed_at INTEGER,key_check TEXT NOT NULL);
    INSERT INTO org_private_mode VALUES('org','enabled',0,0,'check');
  `);
  const env = { BF_DB: db, JWT_SECRET: 'append-only-test' };
  const token = await signJwt(env.JWT_SECRET, { sub: 'member' }, 3600);
  const key = crypto.getRandomValues(new Uint8Array(32));
  const id = crypto.randomUUID();
  const ciphertext = await encryptPrivate(key, { body: 'SECRET message' }, 'org', 'chat/messages', id);
  const call = (method, revision) => privateRecords({
    env,
    orgId: 'org',
    kind: 'chat/messages',
    request: new Request('https://bondfire.test/api/orgs/org/chat/messages', {
      method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ id, ciphertext, revision }),
    }),
  });
  let response = await call('POST', 0);
  assert.equal(response.status, 200);
  response = await call('PUT', 1);
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error, 'PRIVATE_APPEND_ONLY');
  sqlite.close();
}

// Tester diagnostics may expose counts and runtime state, not cached org records,
// full URLs, request bodies, contact details, ciphertext, or arbitrary strings.
assert.doesNotMatch(debug, /href:\s*window\.location\.href/);
assert.doesNotMatch(debug, /out\.orgs\s*=/);
assert.match(debug, /out\.orgCount/);
assert.match(debug, /args\.map\(/);
assert.match(debugBus, /function sanitize\(/);
assert.match(debugBus, /detail:\s*sanitize\(/);
assert.match(debugBus, /SENSITIVE_KEY/);
assert.doesNotMatch(debugBus, /detail:\s*detail\s*&&\s*typeof detail/);
{
  const makeStorage = () => {
    const values = new Map();
    return {
      getItem(key) { return values.has(key) ? values.get(key) : null; },
      setItem(key, value) { values.set(key, String(value)); },
      removeItem(key) { values.delete(key); },
    };
  };
  const oldWindow = globalThis.window;
  const oldLocalStorage = globalThis.localStorage;
  const oldSessionStorage = globalThis.sessionStorage;
  globalThis.window = { location: { search: '?debug=1' }, __BF_DEBUG__: null };
  globalThis.localStorage = makeStorage();
  globalThis.sessionStorage = makeStorage();
  debugLog('api.request', {
    body: 'SECRET BODY',
    misc: 'SECRET MISC',
    email: 'secret@example.test',
    status: 200,
    method: 'POST',
    error: 'PRIVATE_KEY_ROTATION_REQUIRED',
  });
  const persisted = sessionStorage.getItem('bf_debug_logs') || '';
  assert(!persisted.includes('SECRET BODY'));
  assert(!persisted.includes('SECRET MISC'));
  assert(!persisted.includes('secret@example.test'));
  assert(persisted.includes('PRIVATE_KEY_ROTATION_REQUIRED'));
  assert(persisted.includes('POST'));
  clearDebugLogs();
  if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow;
  if (oldLocalStorage === undefined) delete globalThis.localStorage; else globalThis.localStorage = oldLocalStorage;
  if (oldSessionStorage === undefined) delete globalThis.sessionStorage; else globalThis.sessionStorage = oldSessionStorage;
}

console.log('Security boundary regression checks passed');
