import { requireOrgRole } from "../../_lib/auth.js";
import { bad, ok } from "../../_lib/http.js";

export async function onRequestGet({ env, request, params }) {
  const slug = String(params?.slug || "").trim();
  if (!slug) return bad(400, "MISSING_SLUG");

  const orgId = await env.BF_PUBLIC.get("slug:" + slug);
  if (!orgId) return bad(404, "NOT_FOUND");

  const auth = await requireOrgRole({ env, request, orgId, minRole: "admin" });
  if (!auth.ok) return auth.resp;

  return ok({ allowed: true, orgId, role: auth.role });
}
