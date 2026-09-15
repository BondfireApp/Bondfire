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
async function ensureInventoryParsTable(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS inventory_pars (org_id TEXT NOT NULL, inventory_id TEXT NOT NULL, par REAL, updated_at INTEGER, PRIMARY KEY (org_id, inventory_id))`).run();
}
async function setPar(db, orgId, id, raw) {
  if (raw === undefined) return;
  const par = raw === null || raw === "" ? null : Number(raw);
  if (Number.isFinite(par) && par > 0) {
    await db.prepare(`INSERT INTO inventory_pars (org_id,inventory_id,par,updated_at) VALUES (?,?,?,?) ON CONFLICT(org_id,inventory_id) DO UPDATE SET par=excluded.par,updated_at=excluded.updated_at`).bind(orgId,id,par,now()).run();
  } else {
    await db.prepare(`DELETE FROM inventory_pars WHERE org_id=? AND inventory_id=?`).bind(orgId,id).run();
  }
}

export async function onRequestGet({ env, request, params }) {
  const orgId=params.orgId;
  const a=await requireOrgRole({env,request,orgId,minRole:"viewer"});
  if(!a.ok) return a.resp;
  await ensureInventoryParsTable(env.BF_DB);
  const res=await env.BF_DB.prepare(`SELECT i.id,i.name,i.qty,i.unit,i.category,i.location,i.notes,i.encrypted_notes,i.encrypted_blob,i.key_version,i.is_public,i.created_at,i.updated_at,ip.par FROM inventory i LEFT JOIN inventory_pars ip ON ip.org_id=i.org_id AND ip.inventory_id=i.id WHERE i.org_id=? ORDER BY i.created_at DESC`).bind(orgId).all();
  return json({ok:true,inventory:res.results||[]});
}

export async function onRequestPost({ env, request, params }) {
  const orgId=params.orgId;
  const a=await requireOrgRole({env,request,orgId,minRole:"member"});
  if(!a.ok) return a.resp;
  await ensureInventoryParsTable(env.BF_DB);
  const body=await request.json().catch(()=>({}));
  const isPublic=body.is_public?1:0;
  const ciphertext=String(body.encrypted_blob||"").trim();
  if(!isPublic && !ciphertext) return bad(400,"CIPHERTEXT_REQUIRED");
  const clearName=String(body.name||"").trim();
  if(isPublic && !clearName) return bad(400,"MISSING_NAME");
  const id=uuid(), t=now();
  const qty=Number.isFinite(Number(body.qty))?Number(body.qty):0;
  const keyVersion=ciphertext?await getOrgCryptoKeyVersion(env.BF_DB,orgId):null;
  await env.BF_DB.prepare(`INSERT INTO inventory (id,org_id,name,qty,unit,category,location,notes,encrypted_notes,encrypted_blob,key_version,is_public,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
    id,orgId,isPublic?clearName:"__encrypted__",qty,String(body.unit||""),isPublic?String(body.category||""):"",isPublic?String(body.location||""):"",isPublic?String(body.notes||""):"",null,ciphertext||null,keyVersion,isPublic,t,t
  ).run();
  await setPar(env.BF_DB,orgId,id,body.par);
  logActivity(env,{orgId,kind:"inventory.created",message:isPublic?`inventory added: ${clearName}`:"encrypted inventory item added",actorUserId:a?.user?.sub||null}).catch(()=>{});
  const item=await env.BF_DB.prepare(`SELECT i.*,ip.par FROM inventory i LEFT JOIN inventory_pars ip ON ip.org_id=i.org_id AND ip.inventory_id=i.id WHERE i.id=? AND i.org_id=?`).bind(id,orgId).first();
  return json({ok:true,id,item:item||null});
}

export async function onRequestPut({ env, request, params }) {
  const orgId=params.orgId;
  const a=await requireOrgRole({env,request,orgId,minRole:"member"});
  if(!a.ok) return a.resp;
  await ensureInventoryParsTable(env.BF_DB);
  const body=await request.json().catch(()=>({}));
  const id=String(body.id||"").trim();
  if(!id) return bad(400,"MISSING_ID");
  const existing=await env.BF_DB.prepare(`SELECT * FROM inventory WHERE id=? AND org_id=?`).bind(id,orgId).first();
  if(!existing) return bad(404,"NOT_FOUND");
  const isPublic=body.is_public===undefined?Number(existing.is_public||0):(body.is_public?1:0);
  const ciphertext=String(body.encrypted_blob||existing.encrypted_blob||"").trim();
  if(!isPublic && !ciphertext) return bad(400,"CIPHERTEXT_REQUIRED");
  const qty=body.qty===undefined?existing.qty:(Number.isFinite(Number(body.qty))?Number(body.qty):existing.qty);
  const unit=body.unit===undefined?existing.unit:String(body.unit||"");
  const name=isPublic?(body.name===undefined?existing.name:String(body.name||"").trim()):"__encrypted__";
  const category=isPublic?(body.category===undefined?existing.category:String(body.category||"")):"";
  const location=isPublic?(body.location===undefined?existing.location:String(body.location||"")):"";
  const notes=isPublic?(body.notes===undefined?existing.notes:String(body.notes||"")):"";
  const keyVersion=body.encrypted_blob?await getOrgCryptoKeyVersion(env.BF_DB,orgId):null;
  await env.BF_DB.prepare(`UPDATE inventory SET name=?,qty=?,unit=?,category=?,location=?,notes=?,encrypted_notes=NULL,encrypted_blob=?,key_version=COALESCE(?,key_version),is_public=?,updated_at=? WHERE id=? AND org_id=?`).bind(name,qty,unit,category,location,notes,ciphertext||null,keyVersion,isPublic,now(),id,orgId).run();
  await setPar(env.BF_DB,orgId,id,body.par);
  logActivity(env,{orgId,kind:"inventory.updated",message:isPublic?`inventory updated: ${id}`:"encrypted inventory updated",actorUserId:a?.user?.sub||null}).catch(()=>{});
  const item=await env.BF_DB.prepare(`SELECT i.*,ip.par FROM inventory i LEFT JOIN inventory_pars ip ON ip.org_id=i.org_id AND ip.inventory_id=i.id WHERE i.id=? AND i.org_id=?`).bind(id,orgId).first();
  return json({ok:true,item:item||null});
}

export async function onRequestDelete({ env, request, params }) {
  const orgId=params.orgId;
  const a=await requireOrgRole({env,request,orgId,minRole:"admin"});
  if(!a.ok) return a.resp;
  const id=new URL(request.url).searchParams.get("id");
  if(!id) return bad(400,"MISSING_ID");
  await ensureInventoryParsTable(env.BF_DB);
  await env.BF_DB.prepare("DELETE FROM inventory_pars WHERE org_id=? AND inventory_id=?").bind(orgId,id).run();
  await env.BF_DB.prepare("DELETE FROM inventory WHERE id=? AND org_id=?").bind(id,orgId).run();
  logActivity(env,{orgId,kind:"inventory.deleted",message:`inventory removed: ${id}`,actorUserId:a?.user?.sub||a?.user?.id||null}).catch(()=>{});
  return json({ok:true});
}
