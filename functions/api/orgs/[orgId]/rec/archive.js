import { bad, json } from "../../../_lib/http.js";
import { getDb, requireOrgRole } from "../../../_lib/auth.js";
import { requireCookieCsrf } from "../../../_lib/csrf.js";
import { recBridge, recBridgeError } from "../../../_lib/recBridge.js";

const LEGACY_CUTOFF_MS = Date.parse("2026-09-16T17:00:00Z");

export async function onRequestDelete({ env, request, params }) {
  const orgId = String(params.orgId || "");
  const auth = await requireOrgRole({ env, request, orgId, minRole: "admin" });
  if (!auth.ok) return auth.resp;
  const csrf = requireCookieCsrf(request);
  if (csrf) return csrf;

  const body = await request.json().catch(() => ({}));
  const archiveId = String(body.archiveId || "").trim();
  const witnessId = String(body.witnessId || "").trim();
  const requestedLegacy = body.legacy === true;
  if (!archiveId || !witnessId) return bad(400, "MISSING_REC_DELETE_FIELDS");

  const row = await getDb(env).prepare(
    "SELECT id, created_at FROM org_private_records WHERE org_id=? AND kind='witness' AND id=? LIMIT 1"
  ).bind(orgId, witnessId).first();
  if (!row) return bad(404, "WITNESS_NOT_FOUND");

  const legacy = requestedLegacy && Number(row.created_at || 0) < LEGACY_CUTOFF_MS;
  try {
    const result = await recBridge(env, "/api/integrations/bondfire/archive", "DELETE", {
      archiveId,
      orgId,
      witnessId,
      allowLegacy: legacy,
    });
    return json({ ok: true, recordingId: result.recordingId || archiveId, deletedChunks: result.deletedChunks || 0 });
  } catch (error) {
    if (Number(error?.status) === 404) return json({ ok: true, recordingId: archiveId, alreadyDeleted: true });
    return recBridgeError(error, "REC_DELETE_FAILED");
  }
}
