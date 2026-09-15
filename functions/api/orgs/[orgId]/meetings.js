import { json, bad, now, uuid } from "../../_lib/http.js";
import { requireOrgRole } from "../../_lib/auth.js";
import { logActivity } from "../../_lib/activity.js";

async function getOrgCryptoKeyVersion(db, orgId) {
  try {
    const r = await db.prepare("SELECT key_version FROM org_crypto WHERE org_id = ?").bind(orgId).first();
    return Number(r?.key_version) || 1;
  } catch (e) {
    if (!String(e?.message || "").includes("no such column: key_version")) throw e;
    const r = await db.prepare("SELECT version AS key_version FROM org_crypto WHERE org_id = ?").bind(orgId).first();
    return Number(r?.key_version) || 1;
  }
}
async function ensureSchema(db) {
  try { await db.prepare("ALTER TABLE meetings ADD COLUMN is_public INTEGER NOT NULL DEFAULT 0").run(); } catch {}
  try { await db.prepare("ALTER TABLE meetings ADD COLUMN encrypted_notes TEXT").run(); } catch {}
  try { await db.prepare("ALTER TABLE meetings ADD COLUMN encrypted_blob TEXT").run(); } catch {}
  try { await db.prepare("ALTER TABLE meetings ADD COLUMN key_version INTEGER").run(); } catch {}
}

export async function onRequestGet({ env, request, params }) {
  const orgId=params.orgId;
  const a=await requireOrgRole({env,request,orgId,minRole:"viewer"});
  if(!a.ok) return a.resp;
  await ensureSchema(env.BF_DB);
  const res=await env.BF_DB.prepare(`SELECT id,title,starts_at,ends_at,location,agenda,notes,is_public,encrypted_notes,encrypted_blob,key_version,created_at,updated_at FROM meetings WHERE org_id=? ORDER BY starts_at DESC,created_at DESC`).bind(orgId).all();
  return json({ok:true,meetings:res.results||[]});
}

export async function onRequestPost({ env, request, params }) {
  const orgId=params.orgId;
  const a=await requireOrgRole({env,request,orgId,minRole:"member"});
  if(!a.ok) return a.resp;
  await ensureSchema(env.BF_DB);
  const body=await request.json().catch(()=>({}));
  const isPublic=body.is_public ? 1 : 0;
  const ciphertext=String(body.encrypted_blob||"").trim();
  if(!isPublic && !ciphertext) return bad(400,"CIPHERTEXT_REQUIRED");
  const clearTitle=String(body.title||"").trim();
  if(isPublic && !clearTitle) return bad(400,"MISSING_TITLE");
  const t=now(), id=uuid();
  const startsAt=Number.isFinite(Number(body.starts_at))?Number(body.starts_at):t;
  const endsAt=Number.isFinite(Number(body.ends_at))?Number(body.ends_at):startsAt;
  const keyVersion=ciphertext?await getOrgCryptoKeyVersion(env.BF_DB,orgId):null;
  await env.BF_DB.prepare(`INSERT INTO meetings (id,org_id,title,starts_at,ends_at,location,agenda,notes,is_public,encrypted_notes,encrypted_blob,key_version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
    id,orgId,isPublic?clearTitle:"__encrypted__",startsAt,endsAt,isPublic?String(body.location||""):"",isPublic?String(body.agenda||""):"",isPublic?String(body.notes||""):"",isPublic,null,ciphertext||null,keyVersion,t,t
  ).run();
  logActivity(env,{orgId,kind:"meeting.created",message:isPublic?`meeting created: ${clearTitle}`:"encrypted meeting created",actorUserId:a?.user?.sub||null}).catch(()=>{});
  return json({ok:true,id});
}

export async function onRequestPut({ env, request, params }) {
  const orgId=params.orgId;
  const a=await requireOrgRole({env,request,orgId,minRole:"member"});
  if(!a.ok) return a.resp;
  await ensureSchema(env.BF_DB);
  const body=await request.json().catch(()=>({}));
  const id=String(body.id||"").trim();
  if(!id) return bad(400,"MISSING_ID");
  const existing=await env.BF_DB.prepare(`SELECT * FROM meetings WHERE id=? AND org_id=?`).bind(id,orgId).first();
  if(!existing) return bad(404,"NOT_FOUND");
  const isPublic=body.is_public===undefined?Number(existing.is_public||0):(body.is_public?1:0);
  const ciphertext=String(body.encrypted_blob||existing.encrypted_blob||"").trim();
  if(!isPublic && !ciphertext) return bad(400,"CIPHERTEXT_REQUIRED");
  const startsAt=body.starts_at===undefined?existing.starts_at:(Number.isFinite(Number(body.starts_at))?Number(body.starts_at):existing.starts_at);
  const endsAt=body.ends_at===undefined?existing.ends_at:(Number.isFinite(Number(body.ends_at))?Number(body.ends_at):existing.ends_at);
  const title=isPublic?(body.title===undefined?existing.title:String(body.title||"").trim()):"__encrypted__";
  const location=isPublic?(body.location===undefined?existing.location:String(body.location||"")):"";
  const agenda=isPublic?(body.agenda===undefined?existing.agenda:String(body.agenda||"")):"";
  const notes=isPublic?(body.notes===undefined?existing.notes:String(body.notes||"")):"";
  const keyVersion=body.encrypted_blob?await getOrgCryptoKeyVersion(env.BF_DB,orgId):null;
  await env.BF_DB.prepare(`UPDATE meetings SET title=?,starts_at=?,ends_at=?,location=?,agenda=?,notes=?,is_public=?,encrypted_notes=NULL,encrypted_blob=?,key_version=COALESCE(?,key_version),updated_at=? WHERE id=? AND org_id=?`).bind(title,startsAt,endsAt,location,agenda,notes,isPublic,ciphertext||null,keyVersion,now(),id,orgId).run();
  logActivity(env,{orgId,kind:"meeting.updated",message:isPublic?`meeting updated: ${id}`:"encrypted meeting updated",actorUserId:a?.user?.sub||null}).catch(()=>{});
  return json({ok:true});
}

export async function onRequestDelete({ env, request, params }) {
  const orgId=params.orgId;
  const a=await requireOrgRole({env,request,orgId,minRole:"admin"});
  if(!a.ok) return a.resp;
  const id=new URL(request.url).searchParams.get("id");
  if(!id) return bad(400,"MISSING_ID");
  await env.BF_DB.prepare("DELETE FROM meetings WHERE id=? AND org_id=?").bind(id,orgId).run();
  logActivity(env,{orgId,kind:"meeting.deleted",message:`meeting deleted: ${id}`,actorUserId:a?.user?.sub||a?.user?.id||null}).catch(()=>{});
  return json({ok:true});
}
