import { initialScopedKeyStatements } from './privateKeyScopes.js';
import { ensureDeviceKeySchema } from './deviceKeys.js';
import { installPrivateWriteGuards } from './privateWriteGuards.js';
import { json, bad } from './http.js';
import { requireCookieCsrf } from './csrf.js';
import { ensurePrivateSchema } from './privateStore.js';
import { ensureZkSchema } from './zk.js';
import { isCiphertext, contentContext } from '../../../shared/privateContent.js';
import { MODULE_CONFIG_SCHEMA_VERSION, ensureModulesTable, parseEnabledModules } from '../orgs/[orgId]/modules.js';
import { validRecoveryPayload, validWrappedKey } from './wrappedKeyValidation.js';

export async function createPrivateOrg({db,request,userId,body}) {
  const csrf=requireCookieCsrf(request);if(csrf)return csrf;
  const {id,ciphertext,keyCheck,wrappedKey,device_id,recovery,enabled_modules,scopeKeys,submissionPublicKey}=body;
  if(Object.keys(body).some(k=>!['private_mode','id','ciphertext','keyCheck','wrappedKey','device_id','recovery','enabled_modules','scopeKeys','submissionPublicKey'].includes(k))) return bad(400,'PLAINTEXT_FIELDS_FORBIDDEN');
  if(!/^[a-f0-9-]{36}$/.test(id)||!isCiphertext(ciphertext,contentContext(id,'organization',id))||!isCiphertext(keyCheck,contentContext(id,'key-check',id))||!validWrappedKey(wrappedKey)) return bad(400,'INVALID_PRIVATE_ORGANIZATION');
  if(!validRecoveryPayload(recovery)||Object.keys(recovery).some(k=>!['salt','iv','ct'].includes(k))) return bad(400,'INVALID_RECOVERY_PAYLOAD');
  if(enabled_modules!==undefined&&(!Array.isArray(enabled_modules)||enabled_modules.some(v=>typeof v!=='string'))) return bad(400,'INVALID_MODULE_SELECTION');
  await ensurePrivateSchema(db);await ensureZkSchema(db);await ensureDeviceKeySchema(db);
  if(device_id && !await db.prepare('SELECT device_id FROM user_device_keys WHERE user_id=? AND device_id=?').bind(userId,device_id).first())return bad(400,'KEY_RECIPIENT_DEVICE_UNKNOWN');
  await db.prepare('CREATE TABLE IF NOT EXISTS org_keys (org_id TEXT PRIMARY KEY,encrypted_org_metadata TEXT)').run();
  await installPrivateWriteGuards(db);
  await ensureModulesTable(db);
  const t=Date.now();
  const caps=new Set((await db.prepare('PRAGMA table_info(org_key_recovery)').all()).results.map(c=>c.name));
  const recoveryStatement=caps.has('recovery_payload')
    ? db.prepare('INSERT INTO org_key_recovery(org_id,user_id,recovery_payload,updated_at) VALUES(?,?,?,?)').bind(id,userId,JSON.stringify(recovery),t)
    : db.prepare('INSERT INTO org_key_recovery(org_id,user_id,wrapped_key,salt,kdf,updated_at) VALUES(?,?,?,?,?,?)').bind(id,userId,JSON.stringify(recovery),recovery.salt,'PBKDF2-SHA256:210000',t);
  const modules=enabled_modules===undefined?[]:[db.prepare('INSERT INTO org_module_configs(org_id,enabled_modules_json,version,module_schema_version,updated_at,updated_by) VALUES(?,?,1,?,?,?)').bind(id,JSON.stringify(parseEnabledModules(enabled_modules)),MODULE_CONFIG_SCHEMA_VERSION,t,userId)];
  const wraps=device_id?[db.prepare('INSERT INTO org_private_device_wraps(org_id,user_id,device_id,wrapped_key) VALUES(?,?,?,?)').bind(id,userId,device_id,wrappedKey)]:[];
  if(scopeKeys&&!device_id)return bad(400,'REGISTER_DEVICE_FIRST');
  const scoped=scopeKeys?await initialScopedKeyStatements(db,id,userId,device_id,scopeKeys,submissionPublicKey):[];
  await db.batch([
    db.prepare('INSERT INTO orgs(id,name,created_at) VALUES(?,?,?)').bind(id,'Private organization',t),
    db.prepare("INSERT INTO org_memberships(org_id,user_id,role,created_at) VALUES(?,?,'owner',?)").bind(id,userId,t),
    db.prepare('INSERT INTO org_keys(org_id,encrypted_org_metadata) VALUES(?,NULL)').bind(id),
    db.prepare('INSERT INTO org_key_wrapped(org_id,user_id,wrapped_key,key_version) VALUES(?,?,?,1)').bind(id,userId,wrappedKey),
    ...wraps,
    recoveryStatement,
    ...modules,
    ...scoped,
    db.prepare("INSERT INTO org_private_mode(org_id,state,started_at,completed_at,key_check) VALUES(?,'enabled',?,?,?)").bind(id,t,t,keyCheck),
    db.prepare("INSERT INTO org_private_records(org_id,kind,id,ciphertext,revision,created_at,updated_at) VALUES(?,'organization',?,?,1,?,?)").bind(id,id,ciphertext,t,t),
  ]);
  return json({ok:true,org:{id,name:'Private organization',private_mode:true},membership:{role:'owner'}});
}
