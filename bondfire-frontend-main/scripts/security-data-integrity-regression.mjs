import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

import { signJwt } from '../functions/api/_lib/jwt.js';
import { requireUser } from '../functions/api/_lib/auth.js';
import { onRequest as middleware } from '../functions/api/_middleware.js';
import { ensurePrivateSchema, privateRecords } from '../functions/api/_lib/privateStore.js';
import { cleanupOrphanedPrivateBlobs, putPrivateBlob } from '../functions/api/_lib/privateBlobs.js';
import { migrateRecord, migrationPage, sourceHash } from '../functions/api/_lib/privateMigration.js';
import { contentContext, isCiphertext } from '../shared/privateContent.js';
import { encryptPrivate, decryptPrivate } from '../src/lib/privateCrypto.js';

class D1Stmt {
  constructor(stmt) { this.stmt = stmt; this.args = []; }
  bind(...args) { this.args = args; return this; }
  async first() { return this.stmt.get(...this.args) ?? null; }
  async all() { return { results: this.stmt.all(...this.args) }; }
  async run() { return { success: true, meta: this.stmt.run(...this.args) }; }
}

class D1Like {
  constructor() { this.db = new DatabaseSync(':memory:'); }
  prepare(sql) { return new D1Stmt(this.db.prepare(sql)); }
  async batch(statements) {
    this.db.exec('BEGIN');
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.db.exec('COMMIT');
      return results;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
}

function request(url, { method = 'GET', token, cookie, csrf, body } = {}) {
  const headers = new Headers();
  if (token) headers.set('authorization', `Bearer ${token}`);
  if (cookie) headers.set('cookie', cookie);
  if (csrf) headers.set('x-csrf', csrf);
  if (body !== undefined) headers.set('content-type', 'application/json');
  return new Request(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

async function json(res) {
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function setupPrivateEnv() {
  const BF_DB = new D1Like();
  const env = { BF_DB, JWT_SECRET: 'security-regression-secret' };
  await BF_DB.prepare('CREATE TABLE users (id TEXT PRIMARY KEY)').run();
  await BF_DB.prepare('CREATE TABLE orgs (id TEXT PRIMARY KEY, name TEXT)').run();
  await BF_DB.prepare('CREATE TABLE org_memberships (org_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL)').run();
  for (const user of ['owner','admin','member','viewer','outsider']) await BF_DB.prepare('INSERT INTO users(id) VALUES(?)').bind(user).run();
  await BF_DB.prepare('INSERT INTO orgs(id,name) VALUES(?,?)').bind('org-sec','Security Org').run();
  for (const [user,role] of [['owner','owner'],['admin','admin'],['member','member'],['viewer','viewer']]) {
    await BF_DB.prepare('INSERT INTO org_memberships(org_id,user_id,role) VALUES(?,?,?)').bind('org-sec',user,role).run();
  }
  await ensurePrivateSchema(BF_DB);
  await BF_DB.prepare("INSERT INTO org_private_mode(org_id,state,started_at,completed_at,key_check) VALUES(?,'enabled',?,?,?)").bind('org-sec',Date.now(),Date.now(),'test-key-check').run();
  const tokens = {};
  for (const user of ['owner','admin','member','viewer','outsider']) tokens[user] = await signJwt(env.JWT_SECRET,{sub:user},3600);
  return { env, db: BF_DB, tokens };
}

async function privateStoreAndAuthorizationChecks() {
  const { env, db, tokens } = await setupPrivateEnv();
  const key = crypto.getRandomValues(new Uint8Array(32));
  const sentinel = 'private-phone-360-555-0199';
  const needId = 'need-sec-1';
  const needClear = { title:'Encrypted need', description:'Do not store me plaintext', phone:sentinel, status:'open' };
  const ciphertext = await encryptPrivate(key,needClear,'org-sec','needs',needId);
  assert.equal(isCiphertext(ciphertext,contentContext('org-sec','needs',needId)),true);
  assert.equal(ciphertext.includes(sentinel),false);
  assert.equal(ciphertext.includes(needClear.description),false);

  let res = await privateRecords({env,request:request(`https://test.local/api/orgs/org-sec/needs/${needId}`,{method:'POST',token:tokens.member,body:{id:needId,ciphertext,revision:0}}),orgId:'org-sec',kind:'needs',id:needId});
  assert.equal(res.status,200);
  const stored = await db.prepare("SELECT * FROM org_private_records WHERE org_id=? AND kind='needs' AND id=?").bind('org-sec',needId).first();
  assert(stored?.ciphertext);
  assert.equal(JSON.stringify(stored).includes(sentinel),false);
  assert.equal(JSON.stringify(stored).includes(needClear.description),false);

  res = await privateRecords({env,request:request('https://test.local/api/orgs/org-sec/needs/plaintext',{method:'POST',token:tokens.member,body:{id:'plaintext',title:sentinel,revision:0}}),orgId:'org-sec',kind:'needs',id:'plaintext'});
  assert.equal(res.status,400);
  assert.equal((await json(res)).error,'PLAINTEXT_FIELDS_FORBIDDEN');

  res = await privateRecords({env,request:request('https://test.local/api/orgs/org-sec/needs/viewer-write',{method:'POST',token:tokens.viewer,body:{id:'viewer-write',ciphertext:await encryptPrivate(key,{title:'x'},'org-sec','needs','viewer-write'),revision:0}}),orgId:'org-sec',kind:'needs',id:'viewer-write'});
  assert.equal(res.status,403);
  assert.equal((await json(res)).error,'INSUFFICIENT_ROLE');

  res = await privateRecords({env,request:request(`https://test.local/api/orgs/org-sec/needs/${needId}`,{token:tokens.outsider}),orgId:'org-sec',kind:'needs',id:needId});
  assert.equal(res.status,403);
  assert.equal((await json(res)).error,'NOT_A_MEMBER');

  res = await privateRecords({env,request:request(`https://test.local/api/orgs/org-sec/needs/${needId}`),orgId:'org-sec',kind:'needs',id:needId});
  assert.equal(res.status,401);

  const reviewId='review-1';
  const reviewCipher=await encryptPrivate(key,{details:'admin only'},'org-sec','intake/reviews',reviewId);
  res=await privateRecords({env,request:request(`https://test.local/api/orgs/org-sec/intake/reviews/${reviewId}`,{method:'POST',token:tokens.admin,body:{id:reviewId,ciphertext:reviewCipher,revision:0}}),orgId:'org-sec',kind:'intake/reviews',id:reviewId});
  assert.equal(res.status,200);
  res=await privateRecords({env,request:request('https://test.local/api/orgs/org-sec/intake/reviews',{token:tokens.member}),orgId:'org-sec',kind:'intake/reviews'});
  assert.equal(res.status,403);
  assert.equal((await json(res)).error,'INSUFFICIENT_ROLE');

  const queryAuth=await requireUser({env,request:request(`https://test.local/api/orgs/org-sec/needs?bf_token=${encodeURIComponent(tokens.member)}`)});
  assert.equal(queryAuth.ok,false);
  assert.equal(queryAuth.resp.status,401);

  const cookieNeed='cookie-need';
  const cookieCipher=await encryptPrivate(key,{title:'cookie protected'},'org-sec','needs',cookieNeed);
  const cookie=`bf_at=${encodeURIComponent(tokens.member)}; bf_csrf=csrf-regression`;
  res=await privateRecords({env,request:request(`https://test.local/api/orgs/org-sec/needs/${cookieNeed}`,{method:'POST',cookie,body:{id:cookieNeed,ciphertext:cookieCipher,revision:0}}),orgId:'org-sec',kind:'needs',id:'cookie-need'});
  assert.equal(res.status,403);
  assert.equal((await json(res)).error,'CSRF_REQUIRED');
  res=await privateRecords({env,request:request(`https://test.local/api/orgs/org-sec/needs/${cookieNeed}`,{method:'POST',cookie,csrf:'csrf-regression',body:{id:cookieNeed,ciphertext:cookieCipher,revision:0}}),orgId:'org-sec',kind:'needs',id:'cookie-need'});
  assert.equal(res.status,200);

  const backupResponse=await privateRecords({env,request:request(`https://test.local/api/orgs/org-sec/needs/${needId}`,{token:tokens.member}),orgId:'org-sec',kind:'needs',id:needId});
  const backup=JSON.parse(JSON.stringify((await json(backupResponse)).need));
  assert.equal(JSON.stringify(backup).includes(sentinel),false);
  const revision=backup.revision;
  res=await privateRecords({env,request:request(`https://test.local/api/orgs/org-sec/needs/${needId}`,{method:'DELETE',token:tokens.admin,body:{id:needId,revision}}),orgId:'org-sec',kind:'needs',id:needId});
  assert.equal(res.status,200);
  res=await privateRecords({env,request:request(`https://test.local/api/orgs/org-sec/needs/${needId}`,{method:'POST',token:tokens.member,body:{id:needId,ciphertext:backup.ciphertext,revision:0}}),orgId:'org-sec',kind:'needs',id:needId});
  assert.equal(res.status,200);
  const restored=await decryptPrivate(key,(await json(res)).need.ciphertext,'org-sec','needs',needId);
  assert.deepEqual(restored,needClear);

  await assert.rejects(()=>decryptPrivate(crypto.getRandomValues(new Uint8Array(32)),ciphertext,'org-sec','needs',needId));
  const tampered=JSON.parse(ciphertext);tampered.ct=tampered.ct.slice(0,-1)+(tampered.ct.endsWith('A')?'B':'A');
  await assert.rejects(()=>decryptPrivate(key,JSON.stringify(tampered),'org-sec','needs',needId));
  const unsupported={...JSON.parse(ciphertext),v:99};
  assert.equal(isCiphertext(JSON.stringify(unsupported),contentContext('org-sec','needs',needId)),false);

  const orphanId=crypto.randomUUID();
  const orphanCipher=await encryptPrivate(key,new TextEncoder().encode('encrypted orphan bytes'),'org-sec','drive/blob',orphanId);
  await putPrivateBlob(env,'org-sec',orphanId,orphanCipher,'orphan-file');
  await db.prepare('UPDATE org_private_blobs SET created_at=0 WHERE org_id=? AND id=?').bind('org-sec',orphanId).run();
  const cleanup=await cleanupOrphanedPrivateBlobs(env,'org-sec',{olderThanMs:0,now:1});
  assert.equal(cleanup.removed,1);
  assert.equal(await db.prepare('SELECT id FROM org_private_blobs WHERE org_id=? AND id=?').bind('org-sec',orphanId).first(),null);

  const attachedFile='attached-file';
  const attachedBlob=crypto.randomUUID();
  const attachedPayload=await encryptPrivate(key,new TextEncoder().encode('attached encrypted bytes'),'org-sec','drive/blob',attachedBlob);
  await putPrivateBlob(env,'org-sec',attachedBlob,attachedPayload,attachedFile);
  const fileCipher=await encryptPrivate(key,{name:'safe.bin',payloadId:attachedBlob},'org-sec','drive/files',attachedFile);
  res=await privateRecords({env,request:request(`https://test.local/api/orgs/org-sec/drive/files/${attachedFile}`,{method:'POST',token:tokens.member,body:{id:attachedFile,ciphertext:fileCipher,revision:0}}),orgId:'org-sec',kind:'drive/files',id:attachedFile});
  assert.equal(res.status,200);
  await db.prepare('UPDATE org_private_blobs SET created_at=0 WHERE org_id=? AND id=?').bind('org-sec',attachedBlob).run();
  const attachedCleanup=await cleanupOrphanedPrivateBlobs(env,'org-sec',{olderThanMs:0,now:1});
  assert.equal(attachedCleanup.removed,0);
  assert(await db.prepare('SELECT id FROM org_private_blobs WHERE org_id=? AND id=?').bind('org-sec',attachedBlob).first());
}

async function migrationChecks() {
  const BF_DB=new D1Like();
  const env={BF_DB};
  await BF_DB.prepare('CREATE TABLE needs (id TEXT PRIMARY KEY, org_id TEXT NOT NULL, title TEXT, description TEXT, created_at INTEGER, updated_at INTEGER)').run();
  await ensurePrivateSchema(BF_DB);
  const legacy={id:'legacy-need',org_id:'org-migrate',title:'Legacy private title',description:'legacy-secret-value',created_at:1,updated_at:1};
  await BF_DB.prepare('INSERT INTO needs(id,org_id,title,description,created_at,updated_at) VALUES(?,?,?,?,?,?)').bind(...Object.values(legacy)).run();
  const hash=await sourceHash(legacy);
  const key=crypto.getRandomValues(new Uint8Array(32));
  const ciphertext=await encryptPrivate(key,legacy,'org-migrate','needs',legacy.id);
  await migrateRecord(env,'org-migrate',{kind:'needs',id:legacy.id,ciphertext,sourceHash:hash});
  const source=await BF_DB.prepare('SELECT * FROM needs WHERE id=?').bind(legacy.id).first();
  assert.equal(source.title,null);
  assert.equal(source.description,null);
  const authoritative=await BF_DB.prepare("SELECT ciphertext FROM org_private_records WHERE org_id=? AND kind='needs' AND id=?").bind('org-migrate',legacy.id).first();
  assert(authoritative?.ciphertext);
  assert.equal(authoritative.ciphertext.includes(legacy.description),false);
  assert.deepEqual(await decryptPrivate(key,authoritative.ciphertext,'org-migrate','needs',legacy.id),legacy);
  assert.deepEqual(await migrationPage(env,'org-migrate','needs'),[]);
  await assert.rejects(()=>migrateRecord(env,'org-migrate',{kind:'needs',id:legacy.id,ciphertext,sourceHash:hash}),/MIGRATION_SOURCE_CHANGED/);
}

async function errorRedactionCheck() {
  const req=request('https://test.local/api/not-a-real-route');
  const res=await middleware({env:{},request:req,next:async()=>{throw new Error('private-sentinel-must-not-leak');}});
  assert.equal(res.status,500);
  const body=await res.text();
  assert.equal(body.includes('private-sentinel-must-not-leak'),false);
  assert.equal(body.includes('detail'),false);
  assert.equal(res.headers.get('cache-control'),'no-store');
}

await privateStoreAndAuthorizationChecks();
await migrationChecks();
await errorRedactionCheck();
console.log('security/data-integrity regression checks passed');
