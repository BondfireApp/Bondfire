import { getDriveBucket } from './drive.js';
import { getDb } from './auth.js';
import { contentContext, isCiphertext } from '../../../shared/privateContent.js';

export async function ensurePrivateBlobs(db) {
  await db.prepare('CREATE TABLE IF NOT EXISTS org_private_blobs (org_id TEXT NOT NULL,id TEXT NOT NULL,file_id TEXT NOT NULL,inline_ciphertext TEXT,created_at INTEGER NOT NULL,PRIMARY KEY(org_id,id))').run();
}
export const privateBlobObjectKey=(orgId,id)=>`${orgId}/drive/private/${id}`;
const objectKey=privateBlobObjectKey;
export async function putPrivateBlob(env,orgId,id,ciphertext,fileId) {
  if(!/^[a-f0-9-]{36}$/.test(id)||!isCiphertext(ciphertext,contentContext(orgId,'drive/blob',id))) throw new Error('VALID_CIPHERTEXT_REQUIRED');
  if(!/^[A-Za-z0-9_.:-]{1,160}$/.test(fileId))throw new Error('INVALID_FILE_ID');
  const db=getDb(env); await ensurePrivateBlobs(db);
  const hasEpochs=await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='org_private_key_state'").first();
  const state=hasEpochs?await db.prepare('SELECT * FROM org_private_key_state WHERE org_id=?').bind(orgId).first():null;
  const envelope=JSON.parse(ciphertext);
  if(state?.epoch&&(state.roster_revision!==state.rotated_revision||envelope.v!==3||envelope.epoch!==state.epoch||envelope.scope!=='viewer'))throw new Error('PRIVATE_KEY_ROTATION_REQUIRED');
  const file=await db.prepare("SELECT deleting FROM org_private_records WHERE org_id=? AND kind='drive/files' AND id=?").bind(orgId,fileId).first();
  if(file?.deleting)throw new Error('PRIVATE_FILE_DELETION_IN_PROGRESS');
  const exists=await db.prepare('SELECT id FROM org_private_blobs WHERE org_id=? AND id=?').bind(orgId,id).first();
  if(exists) throw new Error('BLOB_ALREADY_EXISTS');
  const bucket=getDriveBucket(env);
  if(!bucket&&ciphertext.length>512*1024) throw new Error('ENCRYPTED_FILE_BUCKET_REQUIRED');
  if(bucket) await bucket.put(objectKey(orgId,id),ciphertext,{httpMetadata:{contentType:'application/octet-stream'}});
  const sql=state?.epoch?'INSERT INTO org_private_blobs(org_id,id,file_id,inline_ciphertext,created_at) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM org_private_key_state WHERE org_id=? AND epoch=? AND roster_revision=rotated_revision)':'INSERT INTO org_private_blobs(org_id,id,file_id,inline_ciphertext,created_at) VALUES(?,?,?,?,?)';
  const args=[orgId,id,fileId,bucket?null:ciphertext,Date.now(),...(state?.epoch?[orgId,state.epoch]:[])];
  const result=await db.prepare(sql).bind(...args).run();
  if(Number(result?.meta?.changes||0)!==1) {
    if(bucket)await bucket.delete(objectKey(orgId,id));
    throw new Error('PRIVATE_KEY_ROTATION_REQUIRED');
  }
}
export async function getPrivateBlob(env,orgId,id) {
  const db=getDb(env); await ensurePrivateBlobs(db);
  const row=await db.prepare('SELECT inline_ciphertext FROM org_private_blobs WHERE org_id=? AND id=?').bind(orgId,id).first();
  if(!row) throw new Error('BLOB_NOT_FOUND');
  if(row.inline_ciphertext!==null) return row.inline_ciphertext;
  const object=await getDriveBucket(env)?.get(objectKey(orgId,id));
  if(!object) throw new Error('BLOB_NOT_FOUND');
  return await object.text();
}

export async function deletePrivateBlob(env,orgId,id,fileId) {
  if(!/^[a-f0-9-]{36}$/.test(id))throw new Error('INVALID_BLOB_ID');
  if(!/^[A-Za-z0-9_.:-]{1,160}$/.test(fileId))throw new Error('INVALID_FILE_ID');
  const db=getDb(env);await ensurePrivateBlobs(db);
  const row=await db.prepare('SELECT file_id,inline_ciphertext FROM org_private_blobs WHERE org_id=? AND id=?').bind(orgId,id).first();
  if(!row)return;
  if(row.file_id!==fileId)throw new Error('BLOB_FILE_MISMATCH');
  if(row.inline_ciphertext===null) {
    const bucket=getDriveBucket(env);if(!bucket)throw new Error('ENCRYPTED_FILE_BUCKET_REQUIRED');
    await bucket.delete(objectKey(orgId,id));
  }
  await db.prepare('DELETE FROM org_private_blobs WHERE org_id=? AND id=? AND file_id=?').bind(orgId,id,fileId).run();
}

export async function cleanupOrphanedPrivateBlobs(env,orgId,{olderThanMs=24*60*60*1000,now=Date.now()}={}) {
  const db=getDb(env);await ensurePrivateBlobs(db);
  const cutoff=now-olderThanMs;
  const rows=await db.prepare('SELECT id,file_id,inline_ciphertext FROM org_private_blobs WHERE org_id=? AND created_at<=?').bind(orgId,cutoff).all();
  let removed=0;
  for(const row of rows.results||[]) {
    const attached=await db.prepare("SELECT id FROM org_private_records WHERE org_id=? AND kind='drive/files' AND id=?").bind(orgId,row.file_id).first();
    if(attached)continue;
    if(row.inline_ciphertext===null) {
      const bucket=getDriveBucket(env);if(!bucket)continue;
      await bucket.delete(objectKey(orgId,row.id));
    }
    await db.prepare('DELETE FROM org_private_blobs WHERE org_id=? AND id=?').bind(orgId,row.id).run();
    removed+=1;
  }
  return {removed};
}

export async function deletePrivateFileBlobs(env,orgId,fileId) {
  const db=getDb(env);await ensurePrivateBlobs(db);
  const rows=await db.prepare('SELECT id,inline_ciphertext FROM org_private_blobs WHERE org_id=? AND file_id=?').bind(orgId,fileId).all();
  for(const row of rows.results||[]) {
    if(row.inline_ciphertext===null) {
      const bucket=getDriveBucket(env);if(!bucket)throw new Error('ENCRYPTED_FILE_BUCKET_REQUIRED');
      await bucket.delete(objectKey(orgId,row.id));
    }
  }
  await db.prepare('DELETE FROM org_private_blobs WHERE org_id=? AND file_id=?').bind(orgId,fileId).run();
}
