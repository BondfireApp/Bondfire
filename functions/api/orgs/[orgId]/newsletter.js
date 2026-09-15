import { ok, err } from "../../_lib/http.js";
import { requireOrgRole, getUserIdFromRequest } from "../../_lib/auth.js";
import { getDB } from "../../_bf.js";



// D1 tables expected:
// - newsletter_settings(org_id TEXT PRIMARY KEY, enabled INTEGER, list_address TEXT, blurb TEXT, updated_at INTEGER)

export async function onRequest(ctx) {
  const { params, env, request } = ctx;

  const db = getDB(env);
  if (!db) return err(500, "DB_NOT_CONFIGURED");

  const orgId = String(params?.orgId || "").trim();
  if (!orgId) return err(400, "BAD_ORG_ID");

  const method = (request.method || "GET").toUpperCase();

  // Reads are for members, writes for admins/owners.
  if (method === "GET") {
    const auth = await requireOrgRole({ env, request, orgId: orgId, minRole: "member" });
    if (!auth.ok) return auth.resp;

    const r = await db.prepare(
      "SELECT enabled, list_address, blurb FROM newsletter_settings WHERE org_id = ? LIMIT 1"
    )
      .bind(orgId)
      .first();

    return ok({
      newsletter: {
        enabled: !!(r?.enabled ?? 0),
        list_address: r?.list_address || "",
        blurb: r?.blurb || "",
      },
    });
  }

  if (method === "PUT") {
    const auth = await requireOrgRole({ env, request, orgId: orgId, minRole: "admin" });
    if (!auth.ok) return auth.resp;

    const body = await request.json().catch(() => ({}));
    const enabled = !!body.enabled;
    const list_address = String(body.list_address || "").trim();
    const blurb = String(body.blurb || "").trim();
    const updated_at = Date.now();
    const updated_by = getUserIdFromRequest(request) || "";

    // Keep schema minimal. If your table doesn’t have updated_by, this harmlessly fails.
    // We only require the core fields.
    await db.prepare(
      "INSERT INTO newsletter_settings (org_id, enabled, list_address, blurb, updated_at) VALUES (?, ?, ?, ?, ?) " +
        "ON CONFLICT(org_id) DO UPDATE SET enabled = excluded.enabled, list_address = excluded.list_address, blurb = excluded.blurb, updated_at = excluded.updated_at"
    )
      .bind(orgId, enabled ? 1 : 0, list_address, blurb, updated_at)
      .run();

    return ok({
      newsletter: { enabled, list_address, blurb },
      updated_by,
    });
  }

  return err(405, "METHOD_NOT_ALLOWED");
}