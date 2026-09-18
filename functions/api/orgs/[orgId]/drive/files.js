import { bad } from "../../../_lib/http.js";
import { requireOrgRole } from "../../../_lib/auth.js";
import { ensureDriveSchema, getDb, getDriveBucket, normalizeNullableId, created, json, now, uuid, saveFileBlob, getFileRecord, isEditableTextMime, dataUrlFromBytes, textFromBytes } from "../../../_lib/drive.js";

export async function onRequestGet({ env, request, params }) {
  const orgId = params.orgId;
  const auth = await requireOrgRole({ env, request, orgId, minRole: "viewer" });
  if (!auth.ok) return auth.resp;
  await ensureDriveSchema(env);
  const res = await getDb(env).prepare(`SELECT id, parent_id, name, mime, size, storage_key, encrypted, encrypted_blob, created_at, updated_at FROM drive_files WHERE org_id = ? ORDER BY LOWER(name) ASC`).bind(orgId).all();
  return json({ ok: true, files: (res.results || []).map((row) => ({ id: row.id, parentId: row.parent_id || null, name: row.encrypted_blob ? "encrypted file" : row.name || "file", mime: row.encrypted_blob ? "application/octet-stream" : row.mime || "application/octet-stream", size: Number(row.size || 0), encrypted: Number(row.encrypted || 0) === 1, encryptedBlob: row.encrypted_blob || "", storageKey: row.storage_key || null, createdAt: Number(row.created_at || 0), updatedAt: Number(row.updated_at || 0) })) });
}

export async function onRequestPost({ env, request, params }) {
  const orgId = params.orgId;
  const auth = await requireOrgRole({ env, request, orgId, minRole: "member" });
  if (!auth.ok) return auth.resp;
  await ensureDriveSchema(env);

  const contentType = String(request.headers.get("content-type") || "").toLowerCase();
  const db = getDb(env);
  const id = uuid();
  const t = now();
  const bucket = getDriveBucket(env);

  const persistBinaryUpload = async ({ name, mime, parentId, bytes, encrypted = false, encryptedBlob = "" }) => {
    const storageKey = `${orgId}/drive/files/${id}`;
    const size = Number(bytes?.byteLength || 0);

    if (bucket && storageKey) {
      try { await bucket.put(storageKey, bytes, { httpMetadata: { contentType: encrypted ? "application/octet-stream" : (mime || "application/octet-stream") } }); } catch (error) { return bad(500, "FILE_STORAGE_FAILED", { detail: String(error?.message || error || "Bucket write failed") }); }
    } else if (encrypted) {
      await saveFileBlob(env, { orgId, fileId: id, storageKey, mime: mime || "application/octet-stream", encryptedPayload: new TextDecoder().decode(bytes), encrypted: true });
    } else {
      const tooLargeForInline = size > 4 * 1024 * 1024 && !isEditableTextMime(mime, name);
      if (tooLargeForInline) return bad(500, "FILE_STORAGE_FAILED", { detail: "Drive bucket unavailable for large binary upload" });
      const dataUrl = dataUrlFromBytes(bytes, mime || "application/octet-stream");
      const textContent = isEditableTextMime(mime, name) ? textFromBytes(bytes) : "";
      await saveFileBlob(env, { orgId, fileId: id, storageKey, mime, dataUrl, textContent, encrypted: false });
    }

    await db.prepare(`INSERT INTO drive_files (id, org_id, parent_id, name, mime, size, storage_key, encrypted, encrypted_blob, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(id, orgId, parentId, encrypted ? "encrypted file" : name, encrypted ? "application/octet-stream" : mime, size, storageKey, encrypted ? 1 : 0, encryptedBlob || null, t, t).run();
    const createdFile = await getFileRecord(env, orgId, id, { includeData: false });
    return created("file", createdFile || { id, parentId, name, mime, size, storageKey, encrypted, encryptedBlob, createdAt: t, updatedAt: t });
  };

  const headerName = String(request.headers.get("x-drive-name") || "").trim();
  if (headerName) {
    const encrypted = String(request.headers.get("x-drive-encrypted") || "") === "1";
    const encryptedBlob = String(request.headers.get("x-drive-encrypted-blob") || "");
    const name = encrypted ? "encrypted file" : (headerName || "file");
    const mime = encrypted ? "application/octet-stream" : String(request.headers.get("x-drive-mime") || contentType || "application/octet-stream");
    const parentId = normalizeNullableId(request.headers.get("x-drive-parent-id"));
    const bytes = new Uint8Array(await request.arrayBuffer());
    return persistBinaryUpload({ name, mime, parentId, bytes, encrypted, encryptedBlob });
  }

  const body = await request.json().catch(() => ({}));
  const encrypted = Number(body.encrypted || 0) === 1 || !!body.encryptedPayload;
  const storageKey = `${orgId}/drive/files/${id}`;
  const file = { id, parentId: normalizeNullableId(body.parentId), name: encrypted ? "encrypted file" : String(body.name || "file").trim() || "file", mime: encrypted ? "application/octet-stream" : String(body.mime || "application/octet-stream"), size: Number(body.size || 0), storageKey, encrypted, encryptedBlob: String(body.encryptedBlob || ""), createdAt: t, updatedAt: t };
  await db.prepare(`INSERT INTO drive_files (id, org_id, parent_id, name, mime, size, storage_key, encrypted, encrypted_blob, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(id, orgId, file.parentId, file.name, file.mime, file.size, storageKey, encrypted ? 1 : 0, file.encryptedBlob || null, t, t).run();
  if (encrypted) {
    await saveFileBlob(env, { orgId, fileId: id, storageKey, mime: "application/octet-stream", encryptedPayload: String(body.encryptedPayload || ""), encrypted: true });
  } else {
    await saveFileBlob(env, { orgId, fileId: id, storageKey, mime: file.mime, dataUrl: String(body.dataUrl || ""), textContent: String(body.textContent || ""), encrypted: false });
  }
  const createdFile = await getFileRecord(env, orgId, id, { includeData: false });
  return created("file", createdFile || file);
}
