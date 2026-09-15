import { bad } from "../../../../_lib/http.js";
import { requireOrgRole } from "../../../../_lib/auth.js";
import { ensureDriveSchema, getDb, normalizeNullableId, json, now, getFileRecord, saveFileBlob, deleteFileBlob } from "../../../../_lib/drive.js";

export async function onRequestGet({ env, request, params }) {
  const orgId = params.orgId;
  const fileId = params.id;
  const auth = await requireOrgRole({ env, request, orgId, minRole: "viewer" });
  if (!auth.ok) return auth.resp;
  const existingMeta = await getFileRecord(env, orgId, fileId, { includeData: false });
  const shouldIncludeData = !!(existingMeta && (String(existingMeta.mime || "").startsWith("text/") || String(existingMeta.mime || "") === "application/vnd.bondfire.sheet+json" || String(existingMeta.mime || "") === "application/vnd.bondfire.form+json" || String(existingMeta.mime || "") === "application/vnd.bondfire.zk-file" || /\.(md|markdown|txt|json|js|jsx|ts|tsx|css|html|xml|yaml|yml|csv|bfsheet|bfform)$/i.test(String(existingMeta.name || ""))));
  const file = existingMeta ? await getFileRecord(env, orgId, fileId, { includeData: shouldIncludeData }) : null;
  if (!file) return bad(404, "NOT_FOUND");
  return json({ ok: true, file });
}

export async function onRequestPatch({ env, request, params }) {
  const orgId = params.orgId;
  const fileId = params.id;
  const auth = await requireOrgRole({ env, request, orgId, minRole: "member" });
  if (!auth.ok) return auth.resp;
  await ensureDriveSchema(env);
  const db = getDb(env);
  const existing = await db.prepare(`SELECT id, parent_id, name, mime, size, storage_key, created_at, updated_at FROM drive_files WHERE org_id = ? AND id = ?`).bind(orgId, fileId).first();
  if (!existing) return bad(404, "NOT_FOUND");
  const body = await request.json().catch(() => ({}));
  const nextName = body.name === undefined ? existing.name : String(body.name || "file").trim() || "file";
  const nextMime = body.mime === undefined ? existing.mime : String(body.mime || "application/octet-stream");
  const nextSize = body.size === undefined ? Number(existing.size || 0) : Number(body.size || 0);
  const nextParentId = Object.prototype.hasOwnProperty.call(body, "parentId") ? normalizeNullableId(body.parentId) : existing.parent_id || null;
  await db.prepare(
    `UPDATE drive_files
     SET parent_id = ?,
         name = ?,
         mime = ?,
         size = ?,
         updated_at = ?
     WHERE org_id = ? AND id = ?`
  ).bind(nextParentId, nextName, nextMime, nextSize, now(), orgId, fileId).run();
  if (body.dataUrl !== undefined || body.textContent !== undefined || body.mime !== undefined) {
    await saveFileBlob(env, {
      orgId,
      fileId,
      storageKey: existing.storage_key,
      mime: nextMime,
      dataUrl: body.dataUrl === undefined ? (await getFileRecord(env, orgId, fileId, { includeData: true }))?.dataUrl || "" : String(body.dataUrl || ""),
      textContent: body.textContent === undefined ? (await getFileRecord(env, orgId, fileId, { includeData: true }))?.textContent || "" : String(body.textContent || ""),
    });
  }
  const shouldIncludeData = !!(String(nextMime || "").startsWith("text/") || String(nextMime || "") === "application/vnd.bondfire.sheet+json" || String(nextMime || "") === "application/vnd.bondfire.form+json" || String(nextMime || "") === "application/vnd.bondfire.zk-file" || /\.(md|markdown|txt|json|js|jsx|ts|tsx|css|html|xml|yaml|yml|csv|bfsheet|bfform)$/i.test(String(nextName || "")));
  const file = await getFileRecord(env, orgId, fileId, { includeData: shouldIncludeData });
  return json({ ok: true, file });
}

export async function onRequestDelete({ env, request, params }) {
  const orgId = params.orgId;
  const fileId = params.id;
  const auth = await requireOrgRole({ env, request, orgId, minRole: "member" });
  if (!auth.ok) return auth.resp;
  await ensureDriveSchema(env);
  const db = getDb(env);
  const existing = await db.prepare(`SELECT storage_key FROM drive_files WHERE org_id = ? AND id = ?`).bind(orgId, fileId).first();
  if (!existing) return bad(404, "NOT_FOUND");
  await deleteFileBlob(env, { orgId, fileId, storageKey: existing.storage_key || null });
  await db.prepare(`DELETE FROM drive_files WHERE org_id = ? AND id = ?`).bind(orgId, fileId).run();
  return json({ ok: true, deleted: true, id: fileId });
}
