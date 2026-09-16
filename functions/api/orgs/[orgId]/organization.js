import { bad, ok } from "../../_lib/http.js";
import { getDb, requireOrgRole } from "../../_lib/auth.js";

export async function onRequestGet({ env, request, params }) {
  const orgId = String(params?.orgId || "").trim();
  if (!orgId) return bad(400, "MISSING_ORG_ID");

  const auth = await requireOrgRole({ env, request, orgId, minRole: "viewer" });
  if (!auth.ok) return auth.resp;

  const db = getDb(env);
  if (!db) return bad(500, "NO_DB_BINDING");

  const row = await db.prepare(
    `SELECT id, org_id, ciphertext, revision, created_at, updated_at
       FROM org_private_records
      WHERE org_id = ? AND kind = 'organization' AND id = ?
      LIMIT 1`
  ).bind(orgId, orgId).first();

  if (!row) return bad(404, "ORGANIZATION_IDENTITY_NOT_FOUND");
  return ok({ organization: row });
}
