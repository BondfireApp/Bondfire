import {publicSubmission} from './privateSubmissions.js';
import {getDb,requireOrgRole} from './auth.js';
import {requireCookieCsrf} from './csrf.js';
import {bad,json} from './http.js';
import {PUBLIC_FIELDS,wantsPublication,validPublicFields} from '../../../shared/publicProjection.js';
import {slugify,uniqueSlug} from './publicPageStore.js';

export async function reservePublicSlug({env,request,orgId}) {
  const gate=await requireOrgRole({env,request,orgId,minRole:'admin'});if(!gate.ok)return gate.resp;
  if(request.method!=='POST')return bad(405,'METHOD_NOT_ALLOWED');
  const csrf=requireCookieCsrf(request);if(csrf)return csrf;
  const body=await request.json().catch(()=>null);
  if(!body||Object.keys(body).some(k=>k!=='slug')||!slugify(body.slug))return bad(400,'BAD_SLUG');
  if(!env.BF_PUBLIC)return bad(503,'PUBLIC_STORAGE_UNAVAILABLE');
  const slug=await uniqueSlug(env,slugify(body.slug),orgId);
  await env.BF_PUBLIC.put(`slug:${slug}`,orgId);
  return json({ok:true,slug});
}

export async function ensurePublicationSchema(db) {
  await db.prepare('CREATE TABLE IF NOT EXISTS org_public_projections(org_id TEXT NOT NULL,kind TEXT NOT NULL,id TEXT NOT NULL,source_revision INTEGER NOT NULL,payload TEXT NOT NULL,updated_at INTEGER NOT NULL,PRIMARY KEY(org_id,kind,id))').run();
}
export async function publishPrivateCopy({env,request,orgId}) {
  const gate=await requireOrgRole({env,request,orgId,minRole:'admin'});
  if(!gate.ok)return gate.resp;
  if(request.method!=='POST')return bad(405,'METHOD_NOT_ALLOWED');
  const csrf=requireCookieCsrf(request);if(csrf)return csrf;
  const body=await request.json().catch(()=>null);
  if(!body||Object.keys(body).some(k=>!['kind','id','revision','public'].includes(k))||!PUBLIC_FIELDS[body.kind]||!Number.isSafeInteger(body.revision)||body.revision<1)return bad(400,'INVALID_PUBLICATION');
  const projection=body.public;
  if(projection!==null&&(!validPublicFields(body.kind,projection)||!wantsPublication(body.kind,projection)))return bad(400,'ONLY_SELECTED_PUBLIC_FIELDS_ALLOWED');
  if(JSON.stringify(projection).length>256*1024)return bad(413,'PUBLICATION_TOO_LARGE');
  const db=getDb(env);await ensurePublicationSchema(db);
  // Revision guard is inside the same transaction as publishing/unpublishing.
  // The server never opens the encrypted source or derives fields from it.
  await db.prepare('CREATE TABLE IF NOT EXISTS org_private_assertions(org_id TEXT PRIMARY KEY,valid INTEGER CHECK(valid=1))').run();
  const statements=[db.prepare('INSERT OR REPLACE INTO org_private_assertions(org_id,valid) VALUES(?,(SELECT COUNT(*) FROM org_private_records WHERE org_id=? AND kind=? AND id=? AND revision=?))').bind(orgId,orgId,body.kind,body.id,body.revision)];
  if(projection===null)statements.push(db.prepare('DELETE FROM org_public_projections WHERE org_id=? AND kind=? AND id=?').bind(orgId,body.kind,body.id));
  else statements.push(db.prepare('INSERT INTO org_public_projections(org_id,kind,id,source_revision,payload,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(org_id,kind,id) DO UPDATE SET source_revision=excluded.source_revision,payload=excluded.payload,updated_at=excluded.updated_at').bind(orgId,body.kind,body.id,body.revision,JSON.stringify(projection),Date.now()));
  statements.push(db.prepare('DELETE FROM org_private_assertions WHERE org_id=?').bind(orgId));
  try {await db.batch(statements);}catch(e){if(/CHECK constraint failed/i.test(String(e.message)))return bad(409,'PRIVATE_REVISION_CONFLICT');throw e;}
  return json({ok:true,published:projection!==null});
}

export async function publicPrivateResponse({env,request,orgId}) {
  const db=getDb(env);await ensurePublicationSchema(db);
  const cfg=await db.prepare("SELECT payload FROM org_public_projections WHERE org_id=? AND kind='public/config' AND id=?").bind(orgId,orgId).first();
  if(!cfg)return bad(404,'NOT_PUBLIC');
  const config=JSON.parse(cfg.payload);
  if(!config.enabled)return bad(404,'NOT_PUBLIC');
  const path=new URL(request.url).pathname;
  if(decodeURIComponent(path.split('/')[3])!==config.slug)return bad(404,'NOT_FOUND');
  const tail=path.split('/').slice(4).join('/');
  if(request.method==='POST'||tail==='submission-key')return publicSubmission({env,request,orgId,tail,config});
  if(request.method!=='GET')return bad(405,'METHOD_NOT_ALLOWED');
  if(!tail)return json({ok:true,orgId,private_mode:true,public:config});
  const responseKey={needs:'needs',meetings:'meetings',inventory:'items',events:'events',witness:'items'}[tail];
  if(!responseKey)return bad(404,'NOT_FOUND');
  if((tail==='needs'&&config.show_needs===false)||(tail==='meetings'&&config.show_meetings===false))return json({ok:true,[responseKey]:[]});
  const rows=(await db.prepare('SELECT id,payload FROM org_public_projections WHERE org_id=? AND kind=? ORDER BY updated_at DESC').bind(orgId,tail).all()).results||[];
  return json({ok:true,[responseKey]:rows.map(row=>({...JSON.parse(row.payload),id:row.id}))});
}
