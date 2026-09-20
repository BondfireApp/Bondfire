import { bad } from "../../../../_lib/http.js";
import { getPublicCfg } from "../../../../_lib/publicPageStore.js";
import { getPrivateMode } from "../../../../_lib/privateStore.js";
import { publicSubmission } from "../../../../_lib/privateSubmissions.js";
import { onRequest as plainSubscribe } from "../../../../orgs/[orgId]/newsletter/subscribe.js";

export async function onRequestPost(context) {
  const { env, request, params } = context;
  const orgId = String(params?.orgId || "").trim();
  if (!orgId) return bad(400, "MISSING_ORG_ID");

  const config = await getPublicCfg(env, orgId);
  if (!config?.enabled || !config?.newsletter_enabled) {
    return bad(404, "NEWSLETTER_SIGNUP_DISABLED");
  }

  const mode = await getPrivateMode(env, orgId);
  if (mode) {
    return publicSubmission({
      env,
      request,
      orgId,
      tail: "newsletter/subscribe",
      config,
    });
  }

  return plainSubscribe({
    ...context,
    params: { ...(params || {}), orgId },
  });
}
