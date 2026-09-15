import { bad } from "../../../_lib/http.js";
import { getOrgIdBySlug } from "../../../_lib/publicPageStore.js";
import { onRequest as orgSubscribe } from "../../../orgs/[orgId]/newsletter/subscribe.js";

export async function onRequestPost(context) {
  const slug = context?.params?.slug ? String(context.params.slug) : "";
  if (!slug) return bad(400, "Missing slug");

  const orgId = await getOrgIdBySlug(context.env, slug);
  if (!orgId) return bad(404, "Not found");

  const ctx2 = { ...context, params: { ...(context.params || {}), orgId } };
  return orgSubscribe(ctx2);
}
