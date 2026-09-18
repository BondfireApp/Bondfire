import { requireOrgRole } from "../../../_lib/auth.js";
import { ensureDriveSchema, getDb, normalizeNullableId, created, json, now, uuid } from "../../../_lib/drive.js";

export async function onRequestGet({ env, request, params }) {
  const orgId = params.orgId;
  const auth = await requireOrgRole({ env, request, orgId, minRole: "viewer" });
  if (!auth.ok) return auth.resp;
  await ensureDriveSchema(env);
  const res = await getDb(env).prepare(`SELECT id, parent_id, name, encrypted_blob, created_at, updated_at FROM drive_folders WHERE org_id = ? ORDER BY LOWER(name) ASC`).bind(orgId).all();
  return json({ ok: true, folders: (res.results || []).map((row) => ({ id: row.id, parentId: row.parent_id || null, name: row.encrypted_blob ? "encrypted folder" : row.name, encryptedBlob: row.encrypted_blob || "", createdAt: Number(row.created_at || 0), updatedAt: Number(row.updated_at || 0) })) });
}

export async function onRequestPost({ env, request, params }) {
  const orgId = params.orgId;
  const auth = await requireOrgRole({ env, request, orgId, minRole: "member" });
  if (!auth.ok) return auth.resp;
  await ensureDriveSchema(env);
  const body = await request.json().catch(() => ({}));
  const id = uuid();
  const t = now();
  const folder = { id, parentId: normalizeNullableId(body.parentId), name: String(body.name || "untitled folder").trim() || "untitled folder", encryptedBlob: String(body.encryptedBlob || ""), createdAt: t, updatedAt: t };
  await getDb(env).prepare(`INSERT INTO drive_folders (id, org_id, parent_id, name, encrypted_blob, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(id, orgId, folder.parentId, folder.encryptedBlob ? "encrypted folder" : folder.name, folder.encryptedBlob || null, t, t).run();
  return created("folder", folder);
}
