import { json } from "../../../_lib/http.js";
import { requireOrgRole } from "../../../_lib/auth.js";
import { listDriveTree } from "../../../_lib/drive.js";

export async function onRequestGet({ env, request, params }) {
  const orgId = params.orgId;
  const auth = await requireOrgRole({ env, request, orgId, minRole: "viewer" });
  if (!auth.ok) return auth.resp;
  const tree = await listDriveTree(env, orgId);
  return json({ ok: true, ...tree });
}
