import { bad, json } from "../../../_lib/http.js";
import { getDb, requireOrgRole } from "../../../_lib/auth.js";
import { requireCookieCsrf } from "../../../_lib/csrf.js";
import { recBridge, recBridgeError } from "../../../_lib/recBridge.js";

export async function onRequestPost({ env, request, params }) {
  const orgId = String(params.orgId || "");
  const auth = await requireOrgRole({ env, request, orgId, minRole: "member" });
  if (!auth.ok) return auth.resp;
  const csrf = requireCookieCsrf(request);
  if (csrf) return csrf;

  const body = await request.json().catch(() => ({}));
  const archiveId = String(body.archiveId || "").trim();
  const witnessId = String(body.witnessId || "").trim();
  const managementToken = String(body.managementToken || "").trim();
  if (!archiveId || !witnessId || !managementToken) return bad(400, "MISSING_REC_CLAIM_FIELDS");

  const row = await getDb(env).prepare(
    "SELECT id FROM org_private_records WHERE org_id=? AND kind='witness' AND id=? LIMIT 1"
  ).bind(orgId, witnessId).first();
  if (!row) return bad(404, "WITNESS_NOT_FOUND");

  try {
    const result = await recBridge(env, "/api/integrations/bondfire/claim", "POST", {
      archiveId,
      orgId,
      witnessId,
      ownerUserId: String(auth?.user?.sub || ""),
      managementToken,
    });
    return json({ ok: true, recordingId: result.recordingId || archiveId });
  } catch (error) {
    return recBridgeError(error, "REC_CLAIM_FAILED");
  }
}
