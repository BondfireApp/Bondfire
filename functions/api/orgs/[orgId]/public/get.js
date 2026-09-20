import { getPublicCfg } from "../../../_lib/publicPageStore.js";
import { projectOrganizationPageConfig, normalizeConnectedPublication } from "../../../_lib/publicSurface.js";
import { bad, ok } from "../../../_lib/http.js";
import { requireOrgRole } from "../../../_lib/auth.js";
import { legacyPageFromConfig, normalizePublicPage, pageHasBlocks } from "../../../../../shared/publicPageModel.js";

export async function onRequestGet({ env, request, params }) {
  const orgId = String(params?.orgId || "").trim();
  if (!orgId) return bad(400, "MISSING_ORG_ID");

  const auth = await requireOrgRole({ env, request, orgId, minRole: "viewer" });
  if (!auth.ok) return auth.resp;

  const cfg = await getPublicCfg(env, orgId);
  const projected = projectOrganizationPageConfig(cfg || {});
  const draftPage = cfg?.draft_page || (pageHasBlocks(cfg?.page) ? cfg.page : legacyPageFromConfig(projected));
  const publishedPage = pageHasBlocks(cfg?.page) ? normalizePublicPage(cfg.page) : null;

  return ok({
    public: {
      ...projected,
      connected_publication: normalizeConnectedPublication(cfg?.connected_publication),
    },
    draft_page: normalizePublicPage(draftPage),
    published_page: publishedPage,
  });
}
