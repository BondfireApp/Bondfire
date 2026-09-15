import { ok, getCookie } from "../_lib/http.js";
import { sha256Hex, clearAuthCookieHeaders } from "../_lib/session.js";
import { logAuthAudit } from "../_lib/audit.js";


export async function onRequestPost({ env, request }) {
  const action = "POST /api/auth/logout";
  const rt = getCookie(request, "bf_rt");
  const auditUserId = null;
  const auditOrgId = null;
  try {
    if (rt && env?.BF_DB) {
      const h = await sha256Hex(rt);
      await env.BF_DB.prepare("DELETE FROM refresh_tokens WHERE token_hash = ?").bind(h).run();
    }
  } catch (e) {
    await logAuthAudit(env, {
      eventType: "auth.logout",
      action,
      userId: auditUserId,
      orgId: auditOrgId,
      outcome: "error",
    });
    throw e;
  }

  const isProd = (env?.ENV || env?.NODE_ENV || "").toLowerCase() === "production";
  const resp = ok({});
  for (const c of clearAuthCookieHeaders({ isProd })) resp.headers.append("set-cookie", c);

  await logAuthAudit(env, {
    eventType: "auth.logout",
    action,
    userId: auditUserId,
    orgId: auditOrgId,
    outcome: "success",
  });

  return resp;
}