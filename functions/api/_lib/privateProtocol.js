import {readPrivateSubmissions} from './privateSubmissions.js';
import { scopedKeys, provisionOwnScopedDevice } from './privateKeyScopes.js';
import { privateEncryptionReset } from './privateReset.js';
import { installPrivateWriteGuards } from './privateWriteGuards.js';
import { getDb, requireOrgRole } from './auth.js';
import { bad, json } from './http.js';
import { ensurePrivateSchema, getPrivateMode } from './privateStore.js';
import { migrationInventory, migrationPage, migrateRecord, cleanupPrivateSources, legacyPrivateFile } from './privateMigration.js';
import { deletePrivateBlob, getPrivateBlob, putPrivateBlob } from './privateBlobs.js';
import { contentContext, isCiphertext } from '../../../shared/privateContent.js';
import {publishPrivateCopy,reservePublicSlug} from './privatePublication.js';
import { publishColophonCopy } from './privateColophonPublication.js';
import { driveAccessForUser } from './driveShares.js';

export async function privateProtocol({env,request,orgId,path=''}) {
  if(path==='submissions')return readPrivateSubmissions({env,request,orgId});
  if(path==='reset')return privateEncryptionReset({env,request,orgId});
  if(path==='keys/device')return provisionOwnScopedDevice({env,request,orgId});
  if(path==='keys') {
    if((await getPrivateMode(env,orgId))?.state!=='enabled')return bad(409,'PRIVATE_MODE_NOT_READY');
    return scopedKeys({env,request,orgId});
  }
  if(path==='publish'||path==='public-slug'||path==='colophon-publish') {
    const state=await getPrivateMode(env,orgId);
    if(state?.state!=='enabled')return bad(409,'PRIVATE_MODE_NOT_READY');
    if(path==='colophon-publish') return publishColophonCopy({env,request,orgId});
    return path==='publish'?publishPrivateCopy({env,request,orgId}):reservePublicSlug({env,request,orgId});
  }
  const writing=request.method!=='GET';
  const minRole=path.startsWith('blob/')?(writing?'member':'viewer'):(writing||path==='source'||path==='source-file'?'owner':'viewer');
  const gate=await requireOrgRole({env,request,orgId,minRole});
  if(!gate.ok) return gate.resp;
  const db=getDb(env); await ensurePrivateSchema(db);
  const mode=await getPrivateMode(env,orgId);
  const url=new URL(request.url);
  try {
    if(request.method==='GET' && !path) {
      const audit=url.searchParams.get('audit')==='1';
      if(audit && gate.role!=='owner') return bad(403,'OWNER_REQUIRED');
      return json({ok:true,state:mode?.state||'off',keyCheck:mode?.key_check||null,userId:gate.user.sub,role:gate.role,
        ...(audit?{inventory:await migrationInventory(env,orgId)}:{})});
    }
    if(path==='begin'&&request.method==='POST') {
      if(mode) return json({ok:true,state:mode.state});
      const body=await request.json();
      if(!isCiphertext(body.keyCheck,contentContext(orgId,'key-check',orgId))) return bad(400,'VALID_KEY_CHECK_REQUIRED');
      const wrap=await db.prepare('SELECT wrapped_key FROM org_key_wrapped WHERE org_id=? AND user_id=?').bind(orgId,gate.user.sub).first();
      if(!wrap?.wrapped_key) return bad(409,'WRAPPED_KEY_REQUIRED');
      const inventory=await migrationInventory(env,orgId);
      if(inventory.blockers.length) return bad(409,'PRIVATE_MIGRATION_BLOCKED',{inventory});
      await installPrivateWriteGuards(db);
      await db.prepare("INSERT OR IGNORE INTO org_private_mode(org_id,state,started_at,key_check) VALUES(?,'migrating',?,?)").bind(orgId,Date.now(),body.keyCheck).run();
      return json({ok:true,state:'migrating'});
    }
    if(!mode) return bad(409,'PRIVATE_MODE_NOT_STARTED');
    if(path.startsWith('blob/')) {
      const id=path.slice(5);
      const blobRow=await db.prepare('SELECT file_id FROM org_private_blobs WHERE org_id=? AND id=?').bind(orgId,id).first();
      if(request.method==='GET') {
        if(blobRow?.file_id) {
          const file=await db.prepare("SELECT id FROM org_private_records WHERE org_id=? AND kind='drive/files' AND id=?").bind(orgId,blobRow.file_id).first();
          if(file) {
            const access=await driveAccessForUser(db,orgId,'drive/files',blobRow.file_id,gate.user.sub);
            if(!access.allowed) return bad(403,'DRIVE_SHARE_ACCESS_DENIED');
          }
        }
        return json({ok:true,ciphertext:await getPrivateBlob(env,orgId,id)});
      }
      if(request.method==='POST') {
        const body=await request.json();
        if(Object.keys(body).some(k=>!['ciphertext','fileId','parentId'].includes(k))) return bad(400,'PLAINTEXT_FIELDS_FORBIDDEN');
        const file=await db.prepare("SELECT id FROM org_private_records WHERE org_id=? AND kind='drive/files' AND id=?").bind(orgId,body.fileId).first();
        if(file) {
          const access=await driveAccessForUser(db,orgId,'drive/files',body.fileId,gate.user.sub);
          if(!access.allowed||access.permission==='view') return bad(403,'DRIVE_SHARE_READ_ONLY');
        } else if(body.parentId) {
          const parentAccess=await driveAccessForUser(db,orgId,'drive/folders',body.parentId,gate.user.sub);
          if(!parentAccess.allowed||parentAccess.permission==='view') return bad(403,'DRIVE_SHARE_READ_ONLY');
        }
        await putPrivateBlob(env,orgId,id,body.ciphertext,body.fileId,body.parentId);
        return json({ok:true,id});
      }
      if(request.method==='DELETE') {
        const body=await request.json().catch(()=>({}));
        if(Object.keys(body).some(k=>k!=='fileId')) return bad(400,'PLAINTEXT_FIELDS_FORBIDDEN');
        if(body.fileId) {
          const access=await driveAccessForUser(db,orgId,'drive/files',body.fileId,gate.user.sub);
          if(!access.allowed||access.permission==='view') return bad(403,'DRIVE_SHARE_READ_ONLY');
        }
        await deletePrivateBlob(env,orgId,id,body.fileId);
        return json({ok:true,id});
      }
    }
    if(path==='source'&&request.method==='GET'&&mode.state==='migrating') return json({ok:true,records:await migrationPage(env,orgId,url.searchParams.get('kind'))});
    if(path==='source-file'&&request.method==='GET'&&mode.state==='migrating') return json({ok:true,file:await legacyPrivateFile(env,orgId,url.searchParams.get('id'))});
    if(path==='record'&&request.method==='POST'&&mode.state==='migrating') {
      const body=await request.json();
      if(Object.keys(body).some(k=>!['kind','id','ciphertext','sourceHash','payloadId'].includes(k))) return bad(400,'PLAINTEXT_FIELDS_FORBIDDEN');
      await migrateRecord(env,orgId,body);
      return json({ok:true});
    }
    if(path==='finish'&&request.method==='POST'&&mode.state==='migrating') {
      await cleanupPrivateSources(env,orgId);
      const inventory=await migrationInventory(env,orgId);
      if(inventory.remaining||inventory.blockers.length) return bad(409,'PRIVATE_MIGRATION_INCOMPLETE',{inventory});
      await db.prepare("UPDATE org_private_mode SET state='enabled',completed_at=? WHERE org_id=? AND state='migrating'").bind(Date.now(),orgId).run();
      return json({ok:true,state:'enabled'});
    }
    return bad(405,'METHOD_NOT_ALLOWED');
  } catch(error) {
    const code=String(error?.message||'PRIVATE_STORAGE_FAILED');
    const safe=/^[A-Z_]+$/.test(code)?code:'PRIVATE_STORAGE_FAILED';
    return bad(safe.includes('CHANGED')?409:400,safe);
  }
}
