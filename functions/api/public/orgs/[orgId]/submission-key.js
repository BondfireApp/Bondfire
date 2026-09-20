import { bad } from "../../../_lib/http.js";
import { getPublicCfg } from "../../../_lib/publicPageStore.js";
import { getPrivateMode } from "../../../_lib/privateStore.js";
import { publicSubmission } from "../../../_lib/privateSubmissions.js";

export async function onRequestGet({ env, request, params }) {
  const orgId = String(params?.orgId || "").trim();
  if (!orgId) return bad(400, "MISSING_ORG_ID");

  const config = await getPublicCfg(env, orgId);
  if (!config?.enabled) return bad(404, "NOT_PUBLIC");

  const mode = await getPrivateMode(env, orgId);
  if (!mode) return bad(409, "ENCRYPTED_SUBMISSIONS_NOT_READY");

  return publicSubmission({
    env,
    request,
    orgId,
    tail: "submission-key",
    config,
  });
}
