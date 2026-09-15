import { json, now, uuid } from "../../../_lib/http.js";
import { requireOrgRole } from "../../../_lib/auth.js";
import { ensureDriveSchema, getDb, normalizeNullableId, parseTags, saveFileBlob } from "../../../_lib/drive.js";

export async function onRequestPost({ env, request, params }) {
  const orgId = params.orgId;
  const auth = await requireOrgRole({ env, request, orgId, minRole: "member" });
  if (!auth.ok) return auth.resp;

  await ensureDriveSchema(env);
  const db = getDb(env);
  const body = await request.json().catch(() => ({}));
  const t = now();

  const folders = Array.isArray(body.folders) ? body.folders : [];
  const notes = Array.isArray(body.notes) ? body.notes : [];
  const files = Array.isArray(body.files) ? body.files : [];
  const templates = Array.isArray(body.templates) ? body.templates : [];

  for (const folder of folders) {
    const id = String(folder?.id || uuid());
    await db.prepare(
      `INSERT INTO drive_folders (id, org_id, parent_id, name, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id)
       DO UPDATE SET parent_id = excluded.parent_id, name = excluded.name, updated_at = excluded.updated_at`
    ).bind(id, orgId, normalizeNullableId(folder?.parentId), String(folder?.name || "untitled folder"), Number(folder?.createdAt || t), Number(folder?.updatedAt || t)).run();
  }

  for (const note of notes) {
    const id = String(note?.id || uuid());
    await db.prepare(
      `INSERT INTO drive_notes (id, org_id, parent_id, title, content, tags, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id)
       DO UPDATE SET parent_id = excluded.parent_id, title = excluded.title, content = excluded.content, tags = excluded.tags, updated_at = excluded.updated_at`
    ).bind(id, orgId, normalizeNullableId(note?.parentId), String(note?.title || "untitled"), String(note?.body || note?.content || ""), parseTags(note?.tags).join(","), Number(note?.createdAt || t), Number(note?.updatedAt || t)).run();
  }

  for (const template of templates) {
    const id = String(template?.id || uuid());
    await db.prepare(
      `INSERT INTO drive_templates (id, org_id, name, title, content, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id)
       DO UPDATE SET name = excluded.name, title = excluded.title, content = excluded.content, updated_at = excluded.updated_at`
    ).bind(id, orgId, String(template?.name || "template"), String(template?.title || "untitled"), String(template?.body || template?.content || ""), Number(template?.createdAt || t), Number(template?.updatedAt || t)).run();
  }

  for (const file of files) {
    const id = String(file?.id || uuid());
    const storageKey = `${orgId}/drive/files/${id}/${encodeURIComponent(String(file?.name || "file"))}`;
    await db.prepare(
      `INSERT INTO drive_files (id, org_id, parent_id, name, mime, size, storage_key, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id)
       DO UPDATE SET parent_id = excluded.parent_id, name = excluded.name, mime = excluded.mime, size = excluded.size, storage_key = excluded.storage_key, updated_at = excluded.updated_at`
    ).bind(id, orgId, normalizeNullableId(file?.parentId), String(file?.name || "file"), String(file?.mime || "application/octet-stream"), Number(file?.size || 0), storageKey, Number(file?.createdAt || t), Number(file?.updatedAt || t)).run();
    if (file?.dataUrl) {
      await saveFileBlob(env, {
        orgId,
        fileId: id,
        storageKey,
        mime: String(file?.mime || "application/octet-stream"),
        dataUrl: String(file.dataUrl),
        textContent: String(file?.textContent || ""),
      });
    }
  }

  return json({ ok: true, imported: { folders: folders.length, notes: notes.length, files: files.length, templates: templates.length } });
}
