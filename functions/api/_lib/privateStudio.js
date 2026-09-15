import { getDb, requireOrgRole } from './auth.js';
import { requireCookieCsrf } from './csrf.js';
import { bad, json } from './http.js';
import { contentContext, isCiphertext } from '../../../shared/privateContent.js';
import { storedRecord } from './privateStore.js';

// The editor saves a complete workspace. A revision covers both collections so
// an old tab cannot delete or overwrite documents another member just saved.
export async function privateStudio({env, request, orgId}) {
  const method=request.method;
  const gate=await requireOrgRole({env,request,orgId,minRole:method==='GET'?'viewer':'member'});
  if(!gate.ok)return gate.resp;
  if(!['GET','POST'].includes(method))return bad(405,'METHOD_NOT_ALLOWED');
  const db=getDb(env);
  await db.prepare('CREATE TABLE IF NOT EXISTS org_private_studio_state (org_id TEXT PRIMARY KEY, revision INTEGER NOT NULL)').run();
  await db.prepare('INSERT OR IGNORE INTO org_private_studio_state(org_id,revision) VALUES(?,0)').bind(orgId).run();
  if(method==='GET') {
    // One statement gives records and workspace revision from one DB snapshot.
    const rows=(await db.prepare("SELECT s.revision AS workspace_revision,r.* FROM org_private_studio_state s LEFT JOIN org_private_records r ON r.org_id=s.org_id AND r.kind IN ('studio/docs','studio/blocks') WHERE s.org_id=? ORDER BY r.id").bind(orgId).all()).results||[];
    return json({ok:true,private_mode:true,revision:rows[0]?.workspace_revision??0,
      docs:rows.filter(r=>r.kind==='studio/docs').map(storedRecord),
      blocks:rows.filter(r=>r.kind==='studio/blocks').map(storedRecord)});
  }
  const csrf=requireCookieCsrf(request);if(csrf)return csrf;
  const body=await request.json().catch(()=>null);
  if(!body||Object.keys(body).some(k=>!['docs','blocks','revision'].includes(k))||!Number.isSafeInteger(body.revision)||body.revision<0)return bad(400,'INVALID_PRIVATE_STUDIO_REQUEST');
  let bytes=0;
  for(const type of ['docs','blocks']) {
    if(!Array.isArray(body[type])||body[type].length>500)return bad(400,'INVALID_PRIVATE_STUDIO_REQUEST');
    const seen=new Set();
    for(const row of body[type]) {
      if(!row||Object.keys(row).some(k=>!['id','ciphertext'].includes(k))||! /^[A-Za-z0-9_.:-]{1,160}$/.test(row.id)||seen.has(row.id))return bad(400,'INVALID_PRIVATE_STUDIO_RECORD');
      if(typeof row.ciphertext!=='string'||!isCiphertext(row.ciphertext,contentContext(orgId,'studio/'+type,row.id)))return bad(400,'VALID_CIPHERTEXT_REQUIRED');
      seen.add(row.id);bytes+=row.ciphertext.length;
    }
  }
  if(bytes>16*1024*1024)return bad(413,'PRIVATE_STUDIO_TOO_LARGE');
  await db.prepare('CREATE TABLE IF NOT EXISTS org_private_assertions (org_id TEXT PRIMARY KEY, valid INTEGER CHECK(valid=1))').run();
  const t=Date.now();
  const statements=[
    db.prepare('UPDATE org_private_studio_state SET revision=revision+1 WHERE org_id=? AND revision=?').bind(orgId,body.revision),
    db.prepare('INSERT OR REPLACE INTO org_private_assertions(org_id,valid) VALUES(?,changes())').bind(orgId),
  ];
  for(const type of ['docs','blocks']) {
    const kind='studio/'+type,ids=body[type].map(r=>r.id);
    statements.push(db.prepare(`DELETE FROM org_private_records WHERE org_id=? AND kind=?${ids.length?' AND id NOT IN ('+ids.map(()=>'?').join(',')+')':''}`).bind(orgId,kind,...ids));
    for(const row of body[type])statements.push(db.prepare('INSERT INTO org_private_records(org_id,kind,id,ciphertext,revision,created_at,updated_at) VALUES(?,?,?,?,1,?,?) ON CONFLICT(org_id,kind,id) DO UPDATE SET ciphertext=excluded.ciphertext,revision=org_private_records.revision+1,updated_at=excluded.updated_at').bind(orgId,kind,row.id,row.ciphertext,t,t));
  }
  statements.push(db.prepare('DELETE FROM org_private_assertions WHERE org_id=?').bind(orgId));
  try {await db.batch(statements);}
  catch(e) {
    if(/CHECK constraint failed/i.test(String(e?.message)))return bad(409,'PRIVATE_REVISION_CONFLICT');
    throw e;
  }
  return json({ok:true,private_mode:true,revision:body.revision+1,docs_saved:body.docs.length,blocks_saved:body.blocks.length});
}
