import { bad } from "../../../../../_lib/http.js";
import { requireOrgRole } from "../../../../../_lib/auth.js";
import { getFileRecord, loadFileBlob, bytesFromDataUrl, getDriveBucket } from "../../../../../_lib/drive.js";

function buildHeaders({ file, size, asDownload }) {
  const headers = new Headers({
    "content-type": file.encrypted ? "application/octet-stream" : (file.mime || "application/octet-stream"),
    "cache-control": "private, max-age=60",
    "accept-ranges": "bytes",
    "content-disposition": `${asDownload ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(file.encrypted ? 'encrypted.bin' : (file.name || 'download'))}`,
  });
  if (Number.isFinite(size) && size >= 0) headers.set("content-length", String(size));
  return headers;
}

export async function onRequestGet({ env, request, params }) {
  const orgId = params.orgId;
  const fileId = params.id;
  const auth = await requireOrgRole({ env, request, orgId, minRole: "viewer" });
  if (!auth.ok) return auth.resp;
  const file = await getFileRecord(env, orgId, fileId, { includeData: false });
  if (!file) return bad(404, "NOT_FOUND");
  const url = new URL(request.url);
  const asDownload = url.searchParams.get("download") === "1";
  const bucket = getDriveBucket(env);

  if (bucket && file.storageKey) {
    try {
      const obj = await bucket.get(file.storageKey);
      if (obj) return new Response(obj.body, { status: 200, headers: buildHeaders({ file, size: Number(obj.size || file.size || 0), asDownload }) });
    } catch {}
  }

  const blob = await loadFileBlob(env, orgId, fileId, file.storageKey, file.mime, file.name, file.encrypted);
  if (file.encrypted) {
    const bytes = new TextEncoder().encode(String(blob?.encryptedPayload || ""));
    return new Response(bytes, { status: 200, headers: buildHeaders({ file, size: bytes.byteLength || 0, asDownload }) });
  }
  if (!blob?.dataUrl) return bad(404, "FILE_BLOB_MISSING");
  const payload = bytesFromDataUrl(blob.dataUrl);
  if (!payload) return bad(500, "INVALID_FILE_DATA");
  return new Response(payload.bytes, { status: 200, headers: buildHeaders({ file, size: payload.bytes.byteLength || 0, asDownload }) });
}
