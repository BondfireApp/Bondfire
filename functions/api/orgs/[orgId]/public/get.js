import { getPublicCfg } from "../../../_lib/publicPageStore.js";
import { projectOrganizationPageConfig, normalizeConnectedPublication } from "../../../_lib/publicSurface.js";
import { bad, ok } from "../../../_lib/http.js";
import { requireOrgRole } from "../../../_lib/auth.js";

export async function onRequestGet({ env, request, params }) {
  const orgId = String(params?.orgId || "").trim();
  if (!orgId) return bad(400, "MISSING_ORG_ID");

  const auth = await requireOrgRole({ env, request, orgId, minRole: "viewer" });
  if (!auth.ok) return auth.resp;

  const cfg = await getPublicCfg(env, orgId);
  const projected = projectOrganizationPageConfig(cfg || {});

  return ok({
    public: {
      ...projected,
      connected_publication: normalizeConnectedPublication(cfg?.connected_publication),
    },
  });
}
