import { bad } from "../../../_lib/http.js";
import { getOrgIdBySlug } from "../../../_lib/publicPageStore.js";
import {
  onRequestGet as orgConfirmationGet,
  onRequestPost as orgConfirmationPost,
} from "../../../public/orgs/[orgId]/newsletter/confirmation.js";

async function mappedContext(context) {
  const slug = String(context?.params?.slug || "").trim();
  if (!slug) return { error: bad(400, "MISSING_SLUG") };

  const orgId = await getOrgIdBySlug(context.env, slug);
  if (!orgId) return { error: bad(404, "NOT_FOUND") };

  return {
    context: {
      ...context,
      params: { ...(context.params || {}), orgId },
    },
  };
}

export async function onRequestPost(context) {
  const mapped = await mappedContext(context);
  return mapped.error || orgConfirmationPost(mapped.context);
}

export async function onRequestGet(context) {
  const mapped = await mappedContext(context);
  return mapped.error || orgConfirmationGet(mapped.context);
}
