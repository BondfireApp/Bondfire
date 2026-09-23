import {getDb,requireOrgRole} from './auth.js';
import {bad,json} from './http.js';
import {requireCookieCsrf} from './csrf.js';
import {validWrappedKey,validRecoveryPayload,validPublicKey} from './wrappedKeyValidation.js';
import {KEY_SCOPES,canReadScope,contentScope} from '../../../shared/privateKeyScopes.js';
import {contentContext,isCiphertext} from '../../../shared/privateContent.js';
import {deviceKeyId,registerDeviceKey} from './deviceKeys.js';

export async function ensureScopedKeys(db) {
  for(const sql of [
    'CREATE TABLE IF NOT EXISTS org_private_key_state(org_id TEXT PRIMARY KEY,epoch INTEGER NOT NULL,roster_revision INTEGER NOT NULL,rotated_revision INTEGER NOT NULL)',
    'CREATE TABLE IF NOT EXISTS org_private_scope_keys(org_id TEXT,scope TEXT,epoch INTEGER,key_check TEXT NOT NULL,archive TEXT NOT NULL,PRIMARY KEY(org_id,scope))',
    'CREATE TABLE IF NOT EXISTS org_private_scope_wraps(org_id TEXT,scope TEXT,user_id TEXT,device_id TEXT,wrapped_key TEXT NOT NULL,PRIMARY KEY(org_id,scope,user_id,device_id))',
    'CREATE TABLE IF NOT EXISTS org_private_scope_recovery(org_id TEXT,scope TEXT,user_id TEXT,payload TEXT NOT NULL,PRIMARY KEY(org_id,scope,user_id))',
    'CREATE TABLE IF NOT EXISTS org_private_submission_keys(org_id TEXT PRIMARY KEY,epoch INTEGER NOT NULL,public_key TEXT NOT NULL)',
    'CREATE TABLE IF NOT EXISTS org_private_key_assertions(org_id TEXT PRIMARY KEY,valid INTEGER CHECK(valid=1))',
  ])await db.prepare(sql).run();
  for(const [op,ref] of [['INSERT','NEW'],['DELETE','OLD'],['UPDATE OF role','NEW']]) {
    const name=op.split(' ')[0].toLowerCase();
    await db.prepare(`CREATE TRIGGER IF NOT EXISTS bf_private_roster_${name} AFTER ${op} ON org_memberships BEGIN UPDATE org_private_key_state SET roster_revision=roster_revision+1 WHERE org_id=${ref}.org_id; END`).run();
  }
  // Device registration alone does not grant access to any organization key.
  // It must not pause private writes across every organization a user belongs
  // to. Membership and role changes above remain the rotation boundary.
  await db.prepare('DROP TRIGGER IF EXISTS bf_private_roster_device').run();
  const scopeSql="CASE WHEN NEW.kind='public/config' OR NEW.kind LIKE 'intake/%' OR NEW.kind LIKE 'newsletter/%' THEN 'admin' WHEN NEW.kind='pledges' THEN 'member' ELSE 'viewer' END";
  for(const op of ['INSERT','UPDATE OF ciphertext'])await db.prepare(`CREATE TRIGGER IF NOT EXISTS bf_private_epoch_${op.split(' ')[0].toLowerCase()} BEFORE ${op} ON org_private_records WHEN EXISTS(SELECT 1 FROM org_private_key_state WHERE org_id=NEW.org_id AND epoch>0) AND NOT EXISTS(SELECT 1 FROM org_private_key_state WHERE org_id=NEW.org_id AND roster_revision=rotated_revision AND json_extract(NEW.ciphertext,'$.v')=3 AND json_extract(NEW.ciphertext,'$.epoch')=epoch AND json_extract(NEW.ciphertext,'$.scope')=${scopeSql}) BEGIN SELECT RAISE(ABORT,'PRIVATE_KEY_ROTATION_REQUIRED'); END`).run();
}

// Older deployments counted a newly registered device as a roster change. A
// stale state can be repaired only when the current membership and roles are
// already fully represented by the existing key wraps and the only absent
// recipients are additional devices for people who already hold that scope.
// Membership removals, role changes, and new members keep their rotation gate.
async function repairDeviceOnlyRotation(db,orgId,state) {
  if(!state?.epoch||state.roster_revision===state.rotated_revision)return false;
  const roster=(await db.prepare('SELECT m.user_id,m.role,d.device_id FROM org_memberships m LEFT JOIN user_device_keys d ON d.user_id=m.user_id WHERE m.org_id=?').bind(orgId).all()).results||[];
  if(!roster.length||roster.some(row=>!row.device_id))return false;
  const wraps=(await db.prepare('SELECT scope,user_id,device_id FROM org_private_scope_wraps WHERE org_id=?').bind(orgId).all()).results||[];
  const active=new Map();
  for(const row of roster)active.set(`${row.user_id}:${row.device_id}`,row.role);
  for(const wrap of wraps) {
    const role=active.get(`${wrap.user_id}:${wrap.device_id}`);
    if(!role||!canReadScope(role,wrap.scope))return false;
  }
  for(const scope of KEY_SCOPES) {
    for(const row of roster) {
      if(!canReadScope(row.role,scope))continue;
      if(!wraps.some(wrap=>wrap.scope===scope&&wrap.user_id===row.user_id&&active.has(`${wrap.user_id}:${wrap.device_id}`)))return false;
    }
  }
  const result=await db.prepare('UPDATE org_private_key_state SET rotated_revision=roster_revision WHERE org_id=? AND epoch=? AND roster_revision=? AND rotated_revision=?').bind(orgId,state.epoch,state.roster_revision,state.rotated_revision).run();
  return Number(result?.meta?.changes||0)===1;
}
export async function scopedKeys({env,request,orgId}) {
  const gate=await requireOrgRole({env,request,orgId,minRole:request.method==='GET'?'viewer':'owner'});
  if(!gate.ok)return gate.resp;
  const db=getDb(env);
  await ensureScopedKeys(db);
  await db.prepare('INSERT OR IGNORE INTO org_private_key_state VALUES(?,0,0,0)').bind(orgId).run();
  let state=await db.prepare('SELECT * FROM org_private_key_state WHERE org_id=?').bind(orgId).first();
  if(await repairDeviceOnlyRotation(db,orgId,state))state=await db.prepare('SELECT * FROM org_private_key_state WHERE org_id=?').bind(orgId).first();
  if(request.method==='GET') {
    const device=new URL(request.url).searchParams.get('device_id')||'';
    const rows=(await db.prepare('SELECT k.*,w.wrapped_key,r.payload AS recovery FROM org_private_scope_keys k LEFT JOIN org_private_scope_wraps w ON w.org_id=k.org_id AND w.scope=k.scope AND w.user_id=? AND w.device_id=? LEFT JOIN org_private_scope_recovery r ON r.org_id=k.org_id AND r.scope=k.scope AND r.user_id=? WHERE k.org_id=?').bind(gate.user.sub,device,gate.user.sub,orgId).all()).results||[];
    const roster=gate.role==='owner'?(await db.prepare('SELECT m.user_id,m.role,d.device_id,d.public_key FROM org_memberships m LEFT JOIN user_device_keys d ON d.user_id=m.user_id WHERE m.org_id=? ORDER BY m.user_id,d.device_id').bind(orgId).all()).results:undefined;
    return json({ok:true,userId:gate.user.sub,epoch:state?.epoch||0,rosterRevision:state?.roster_revision||0,rotationRequired:!!state&&state.roster_revision!==state.rotated_revision,keys:rows.filter(k=>canReadScope(gate.role,k.scope)),...(roster?{roster}:{})});
  }
  if(request.method!=='POST')return bad(405,'METHOD_NOT_ALLOWED');
  const csrf=requireCookieCsrf(request);if(csrf)return csrf;
  const body=await request.json().catch(()=>null);
  if(!body||Object.keys(body).some(k=>!['epoch','rosterRevision','keys','submissionPublicKey'].includes(k))||body.epoch!==(state?.epoch||0)+1||body.rosterRevision!==(state?.roster_revision||0)||!Array.isArray(body.keys)||body.keys.length!==3)return bad(409,'PRIVATE_KEY_ROSTER_CHANGED');
  const previousRecipient=await db.prepare('SELECT public_key FROM org_private_submission_keys WHERE org_id=?').bind(orgId).first();
  if(previousRecipient&&(!body.submissionPublicKey||JSON.stringify(body.submissionPublicKey)===previousRecipient.public_key))return bad(400,'NEW_SUBMISSION_KEY_REQUIRED');
  if(body.submissionPublicKey&&!validPublicKey(body.submissionPublicKey))return bad(400,'INVALID_SUBMISSION_PUBLIC_KEY');
  const roster=(await db.prepare('SELECT m.user_id,m.role,d.device_id FROM org_memberships m JOIN user_device_keys d ON d.user_id=m.user_id WHERE m.org_id=?').bind(orgId).all()).results;
  if(!roster.some(r=>r.user_id===gate.user.sub))return bad(409,'REGISTER_DEVICE_FIRST');
  for(const scope of KEY_SCOPES) {
    const key=body.keys.find(k=>k.scope===scope);
    if(!key||Object.keys(key).some(k=>!['scope','check','archive','wraps','recovery'].includes(k))||!isCiphertext(key.check,contentContext(orgId,'scope-check/'+scope,orgId))||!isCiphertext(key.archive,contentContext(orgId,'scope-archive/'+scope,orgId))||!validRecoveryPayload(key.recovery)||Object.keys(key.recovery).some(k=>!['salt','iv','ct'].includes(k))||!Array.isArray(key.wraps))return bad(400,'INVALID_SCOPED_KEY');
    const expected=new Set(roster.filter(r=>canReadScope(r.role,scope)).map(r=>JSON.stringify([r.user_id,r.device_id])));
    for(const w of key.wraps) {
      if(Object.keys(w).some(k=>!['user_id','device_id','wrapped_key'].includes(k))||!validWrappedKey(w.wrapped_key)||!expected.delete(JSON.stringify([w.user_id,w.device_id])))return bad(400,'INVALID_KEY_RECIPIENT');
    }
    if(expected.size)return bad(400,'KEY_RECIPIENT_MISSING');
  }
  // Seed before the transaction so concurrent roster changes increment its revision.
  await db.prepare('INSERT OR IGNORE INTO org_private_key_state VALUES(?,0,0,0)').bind(orgId).run();
  const stmts=[db.prepare('UPDATE org_private_key_state SET epoch=?,rotated_revision=roster_revision WHERE org_id=? AND epoch=? AND roster_revision=?').bind(body.epoch,orgId,body.epoch-1,body.rosterRevision),db.prepare('INSERT OR REPLACE INTO org_private_key_assertions VALUES(?,changes())').bind(orgId),db.prepare('DELETE FROM org_private_scope_wraps WHERE org_id=?').bind(orgId),db.prepare('DELETE FROM org_private_scope_recovery WHERE org_id=?').bind(orgId)];
  for(const k of body.keys) {
    stmts.push(db.prepare('INSERT INTO org_private_scope_keys VALUES(?,?,?,?,?) ON CONFLICT(org_id,scope) DO UPDATE SET epoch=excluded.epoch,key_check=excluded.key_check,archive=excluded.archive').bind(orgId,k.scope,body.epoch,k.check,k.archive));
    for(const w of k.wraps)stmts.push(db.prepare('INSERT INTO org_private_scope_wraps VALUES(?,?,?,?,?)').bind(orgId,k.scope,w.user_id,w.device_id,w.wrapped_key));
    stmts.push(db.prepare('INSERT INTO org_private_scope_recovery VALUES(?,?,?,?)').bind(orgId,k.scope,gate.user.sub,JSON.stringify(k.recovery)));
  }
  if(body.submissionPublicKey)stmts.push(db.prepare('INSERT INTO org_private_submission_keys VALUES(?,?,?) ON CONFLICT(org_id) DO UPDATE SET epoch=excluded.epoch,public_key=excluded.public_key').bind(orgId,body.epoch,JSON.stringify(body.submissionPublicKey)));
  stmts.push(db.prepare('DELETE FROM org_private_key_assertions WHERE org_id=?').bind(orgId));
  try{await db.batch(stmts);}catch(e){const detail=`${e?.code||''} ${e?.message||''}`;if(/CHECK constraint failed|SQLITE_CONSTRAINT_CHECK|org_private_key_assertions/.test(detail))return bad(409,'PRIVATE_KEY_ROSTER_CHANGED');throw e;}
  return json({ok:true,epoch:body.epoch});
}

export async function initialScopedKeyStatements(db,orgId,userId,deviceId,keys,submissionPublicKey) {
  if(!Array.isArray(keys)||keys.length!==3)throw new Error('INVALID_SCOPED_KEY');
  await ensureScopedKeys(db);
  if(submissionPublicKey&&!validPublicKey(submissionPublicKey))throw new Error('INVALID_SUBMISSION_PUBLIC_KEY');
  const statements=[db.prepare('INSERT INTO org_private_key_state VALUES(?,1,0,0)').bind(orgId)];
  if(submissionPublicKey)statements.push(db.prepare('INSERT INTO org_private_submission_keys VALUES(?,?,?)').bind(orgId,1,JSON.stringify(submissionPublicKey)));
  for(const scope of KEY_SCOPES) {
    const key=keys.find(k=>k.scope===scope);
    if(!key||Object.keys(key).some(k=>!['scope','check','archive','wrapped_key','recovery'].includes(k))||!isCiphertext(key.check,contentContext(orgId,'scope-check/'+scope,orgId))||!isCiphertext(key.archive,contentContext(orgId,'scope-archive/'+scope,orgId))||!validWrappedKey(key.wrapped_key)||!validRecoveryPayload(key.recovery)||Object.keys(key.recovery).some(k=>!['salt','iv','ct'].includes(k)))throw new Error('INVALID_SCOPED_KEY');
    statements.push(db.prepare('INSERT INTO org_private_scope_keys VALUES(?,?,1,?,?)').bind(orgId,scope,key.check,key.archive));
    statements.push(db.prepare('INSERT INTO org_private_scope_wraps VALUES(?,?,?,?,?)').bind(orgId,scope,userId,deviceId,key.wrapped_key));
    statements.push(db.prepare('INSERT INTO org_private_scope_recovery VALUES(?,?,?,?)').bind(orgId,scope,userId,JSON.stringify(key.recovery)));
  }
  return statements;
}

export async function provisionOwnScopedDevice({env,request,orgId}) {
  if(request.method!=='POST')return bad(405,'METHOD_NOT_ALLOWED');
  const gate=await requireOrgRole({env,request,orgId,minRole:'viewer'});if(!gate.ok)return gate.resp;
  const csrf=requireCookieCsrf(request);if(csrf)return csrf;
  const db=getDb(env);await ensureScopedKeys(db);
  const b=await request.json().catch(()=>null);
  if(!b||Object.keys(b).some(k=>!['epoch','device_id','device_public_key','keys'].includes(k))||!Array.isArray(b.keys))return bad(400,'INVALID_SCOPED_KEY');
  const state=await db.prepare('SELECT epoch FROM org_private_key_state WHERE org_id=?').bind(orgId).first();
  if(!state||b.epoch!==state.epoch)return bad(409,'PRIVATE_KEY_ROSTER_CHANGED');
  const existingDevice=await db.prepare('SELECT device_id FROM user_device_keys WHERE user_id=? AND device_id=?').bind(gate.user.sub,b.device_id).first();
  if(!existingDevice) {
    if(!validPublicKey(b.device_public_key)||await deviceKeyId(b.device_public_key)!==b.device_id)return bad(400,'KEY_RECIPIENT_DEVICE_UNKNOWN');
    await registerDeviceKey(db,gate.user.sub,b.device_public_key);
  }
  const expected=new Set(KEY_SCOPES.filter(scope=>canReadScope(gate.role,scope)));
  for(const k of b.keys)if(!expected.delete(k.scope)||Object.keys(k).some(f=>!['scope','wrapped_key','recovery'].includes(f))||!validWrappedKey(k.wrapped_key)||(k.recovery!==undefined&&(!validRecoveryPayload(k.recovery)||Object.keys(k.recovery).some(f=>!['salt','iv','ct'].includes(f)))))return bad(400,'INVALID_SCOPED_KEY');
  if(expected.size)return bad(400,'KEY_RECIPIENT_MISSING');
  const statements=[db.prepare('INSERT OR REPLACE INTO org_private_key_assertions SELECT ?,CASE WHEN EXISTS(SELECT 1 FROM org_private_key_state s JOIN org_memberships m ON m.org_id=s.org_id WHERE s.org_id=? AND s.epoch=? AND m.user_id=? AND m.role=?) THEN 1 ELSE 0 END').bind(orgId,orgId,b.epoch,gate.user.sub,gate.role)];
  for(const k of b.keys) {
    statements.push(db.prepare('INSERT INTO org_private_scope_wraps VALUES(?,?,?,?,?) ON CONFLICT(org_id,scope,user_id,device_id) DO UPDATE SET wrapped_key=excluded.wrapped_key').bind(orgId,k.scope,gate.user.sub,b.device_id,k.wrapped_key));
    if(k.recovery!==undefined)statements.push(db.prepare('INSERT INTO org_private_scope_recovery VALUES(?,?,?,?) ON CONFLICT(org_id,scope,user_id) DO UPDATE SET payload=excluded.payload').bind(orgId,k.scope,gate.user.sub,JSON.stringify(k.recovery)));
  }
  statements.push(db.prepare('DELETE FROM org_private_key_assertions WHERE org_id=?').bind(orgId));
  try{await db.batch(statements);}catch(e){const detail=`${e?.code||''} ${e?.message||''}`;if(/CHECK constraint failed|SQLITE_CONSTRAINT_CHECK|org_private_key_assertions/.test(detail))return bad(409,'PRIVATE_KEY_ROSTER_CHANGED');throw e;}
  return json({ok:true});
}
