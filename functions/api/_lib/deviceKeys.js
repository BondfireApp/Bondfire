import { deviceKeyId } from '../../../shared/privateContent.js';
export { deviceKeyId };
export async function ensureDeviceKeySchema(db) {
  await db.prepare('CREATE TABLE IF NOT EXISTS user_device_keys (user_id TEXT NOT NULL,device_id TEXT NOT NULL,public_key TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(user_id,device_id))').run();
  await db.prepare('CREATE TABLE IF NOT EXISTS org_private_device_wraps (org_id TEXT NOT NULL,user_id TEXT NOT NULL,device_id TEXT NOT NULL,wrapped_key TEXT NOT NULL,PRIMARY KEY(org_id,user_id,device_id))').run();
}
export async function registerDeviceKey(db,userId,publicKey) {
  const jwk=typeof publicKey==='string'?JSON.parse(publicKey):publicKey;
  await ensureDeviceKeySchema(db);const id=await deviceKeyId(jwk);
  await db.prepare('INSERT OR IGNORE INTO user_device_keys(user_id,device_id,public_key,created_at) VALUES(?,?,?,?)').bind(userId,id,JSON.stringify(jwk),Date.now()).run();
  return id;
}
