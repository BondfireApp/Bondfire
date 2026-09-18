import { bad } from "../../../../_lib/http.js";
import { requireOrgRole } from "../../../../_lib/auth.js";
import { ensureDriveSchema, getDb, normalizeNullableId, json, now } from "../../../../_lib/drive.js";

export async function onRequestGet({ env, request, params }) {
  const orgId=params.orgId,noteId=params.id;
  const auth=await requireOrgRole({env,request,orgId,minRole:"viewer"});
  if(!auth.ok) return auth.resp;
  await ensureDriveSchema(env);
  const row=await getDb(env).prepare(`SELECT id,parent_id,title,content,tags,encrypted_blob,created_at,updated_at FROM drive_notes WHERE org_id=? AND id=?`).bind(orgId,noteId).first();
  if(!row) return bad(404,"NOT_FOUND");
  return json({ok:true,note:{id:row.id,parentId:row.parent_id||null,title:row.encrypted_blob?"encrypted note":row.title||"untitled",body:row.encrypted_blob?"":row.content||"",tags:[],encryptedBlob:row.encrypted_blob||"",createdAt:Number(row.created_at||0),updatedAt:Number(row.updated_at||0)}});
}

export async function onRequestPatch({ env, request, params }) {
  const orgId=params.orgId,noteId=params.id;
  const auth=await requireOrgRole({env,request,orgId,minRole:"member"});
  if(!auth.ok) return auth.resp;
  await ensureDriveSchema(env);
  const body=await request.json().catch(()=>({}));
  const db=getDb(env);
  const existing=await db.prepare(`SELECT * FROM drive_notes WHERE org_id=? AND id=?`).bind(orgId,noteId).first();
  if(!existing) return bad(404,"NOT_FOUND");
  const encryptedBlob=String(body.encryptedBlob||existing.encrypted_blob||"").trim();
  if(!encryptedBlob) return bad(400,"CIPHERTEXT_REQUIRED");
  const parentId=Object.prototype.hasOwnProperty.call(body,"parentId")?normalizeNullableId(body.parentId):existing.parent_id||null;
  await db.prepare(`UPDATE drive_notes SET parent_id=?,title='encrypted note',content='',tags='',encrypted_blob=?,updated_at=? WHERE org_id=? AND id=?`).bind(parentId,encryptedBlob,now(),orgId,noteId).run();
  const row=await db.prepare(`SELECT id,parent_id,encrypted_blob,created_at,updated_at FROM drive_notes WHERE org_id=? AND id=?`).bind(orgId,noteId).first();
  return json({ok:true,note:{id:row.id,parentId:row.parent_id||null,title:"encrypted note",body:"",tags:[],encryptedBlob:row.encrypted_blob||"",createdAt:Number(row.created_at||0),updatedAt:Number(row.updated_at||0)}});
}

export async function onRequestDelete({ env, request, params }) {
  const orgId=params.orgId,noteId=params.id;
  const auth=await requireOrgRole({env,request,orgId,minRole:"member"});
  if(!auth.ok) return auth.resp;
  await ensureDriveSchema(env);
  await getDb(env).prepare(`DELETE FROM drive_notes WHERE org_id=? AND id=?`).bind(orgId,noteId).run();
  return json({ok:true,deleted:true,id:noteId});
}
