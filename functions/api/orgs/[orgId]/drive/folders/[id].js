import { bad } from "../../../../_lib/http.js";
import { requireOrgRole } from "../../../../_lib/auth.js";
import { deleteFileBlob, ensureDriveSchema, getDb, normalizeNullableId, json, now } from "../../../../_lib/drive.js";

export async function onRequestPatch({ env, request, params }) {
  const orgId = params.orgId;
  const folderId = params.id;
  const auth = await requireOrgRole({ env, request, orgId, minRole: "member" });
  if (!auth.ok) return auth.resp;
  await ensureDriveSchema(env);
  const body = await request.json().catch(() => ({}));
  const db = getDb(env);
  const existing = await db.prepare(`SELECT * FROM drive_folders WHERE org_id = ? AND id = ?`).bind(orgId, folderId).first();
  await db.prepare(`UPDATE drive_folders SET parent_id = ?, name = ?, encrypted_blob = ?, updated_at = ? WHERE org_id = ? AND id = ?`).bind(Object.prototype.hasOwnProperty.call(body, "parentId") ? normalizeNullableId(body.parentId) : existing.parent_id || null, body.encryptedBlob !== undefined ? "encrypted folder" : (body.name === undefined ? existing.name : String(body.name || "").trim() || "untitled folder"), body.encryptedBlob === undefined ? existing.encrypted_blob || null : String(body.encryptedBlob || "") || null, now(), orgId, folderId).run();
  const folder = await db.prepare(`SELECT id, parent_id, name, encrypted_blob, created_at, updated_at FROM drive_folders WHERE org_id = ? AND id = ?`).bind(orgId, folderId).first();
  if (!folder) return bad(404, "NOT_FOUND");
  return json({ ok: true, folder: { id: folder.id, parentId: folder.parent_id || null, name: folder.encrypted_blob ? "encrypted folder" : folder.name, encryptedBlob: folder.encrypted_blob || "", createdAt: Number(folder.created_at || 0), updatedAt: Number(folder.updated_at || 0) } });
}

export async function onRequestDelete({ env, request, params }) {
  const orgId = params.orgId;
  const folderId = params.id;
  const auth = await requireOrgRole({ env, request, orgId, minRole: "member" });
  if (!auth.ok) return auth.resp;
  await ensureDriveSchema(env);
  const db = getDb(env);
  const folder = await db.prepare(`SELECT id FROM drive_folders WHERE org_id = ? AND id = ?`).bind(orgId, folderId).first();
  if (!folder) return bad(404, "NOT_FOUND");

  const descendantsRes = await db.prepare(`WITH RECURSIVE subtree(id) AS (SELECT id FROM drive_folders WHERE org_id = ? AND id = ? UNION ALL SELECT f.id FROM drive_folders f JOIN subtree s ON f.parent_id = s.id WHERE f.org_id = ?) SELECT id FROM subtree`).bind(orgId, folderId, orgId).all();
  const folderIds = (descendantsRes.results || []).map((row) => String(row.id || "")).filter(Boolean);
  if (!folderIds.length) return json({ ok: true, deleted: true, id: folderId });
  const placeholders = folderIds.map(() => "?").join(", ");
  const fileRows = await db.prepare(`SELECT id, storage_key FROM drive_files WHERE org_id = ? AND parent_id IN (${placeholders})`).bind(orgId, ...folderIds).all();
  for (const row of (fileRows.results || [])) await deleteFileBlob(env, { orgId, fileId: row.id, storageKey: row.storage_key || null });
  await db.prepare(`DELETE FROM drive_notes WHERE org_id = ? AND parent_id IN (${placeholders})`).bind(orgId, ...folderIds).run();
  await db.prepare(`DELETE FROM drive_files WHERE org_id = ? AND parent_id IN (${placeholders})`).bind(orgId, ...folderIds).run();
  await db.prepare(`DELETE FROM drive_folders WHERE org_id = ? AND id IN (${placeholders})`).bind(orgId, ...folderIds).run();
  return json({ ok: true, deleted: true, id: folderId, deletedFolderIds: folderIds });
}
