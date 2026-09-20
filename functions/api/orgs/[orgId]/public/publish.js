import { requireOrgRole } from "../../../_lib/auth.js";
import { enforceOrgWriteLockdown } from "../../../_lib/orgLockdown.js";
import { bad, ok } from "../../../_lib/http.js";
import { getPublicCfg, setPublicCfg } from "../../../_lib/publicPageStore.js";
import { legacyPageFromConfig, normalizePublicPage, pageHasBlocks } from "../../../../../shared/publicPageModel.js";

export async function onRequestPost({ env, request, params }) {
  const orgId = String(params?.orgId || "").trim();
  if (!orgId) return bad(400, "MISSING_ORG_ID");

  const auth = await requireOrgRole({ env, request, orgId, minRole: "admin" });
  if (!auth.ok) return auth.resp;

  const lockdown = await enforceOrgWriteLockdown({ env, orgId });
  if (!lockdown.ok) return lockdown.resp;

  const current = await getPublicCfg(env, orgId);
  const draft = pageHasBlocks(current?.draft_page)
    ? normalizePublicPage(current.draft_page)
    : legacyPageFromConfig(current || {});

  if (!pageHasBlocks(draft)) return bad(400, "PUBLIC_PAGE_DRAFT_EMPTY");

  const next = {
    ...current,
    page: draft,
    public_page_published_at: Date.now(),
  };
  await setPublicCfg(env, orgId, next);

  return ok({ published_page: draft, published_at: next.public_page_published_at });
}
