import { ok, bad } from "../_lib/http.js";
import { getDb, requireUser } from "../_lib/auth.js";
import { logAuthAudit } from "../_lib/audit.js";

export async function onRequestPost({ env, request }) {
  const action = "POST /api/auth/logout_all";
  const auth = await requireUser({ env, request });
  if (!auth.ok) {
    await logAuthAudit(env, {
      eventType: "auth.logout_all",
      action,
      outcome: "denied",
    });
    return auth.resp;
  }
  const userId = auth.user?.sub;
  const orgId = auth.user?.org_id || auth.user?.orgId || null;
  if (!userId) {
    await logAuthAudit(env, {
      eventType: "auth.logout_all",
      action,
      orgId,
      outcome: "denied",
    });
    return bad(401, "UNAUTHORIZED");
  }

  const db = getDb(env);
  try {
    await db.prepare("DELETE FROM refresh_tokens WHERE user_id = ?").bind(userId).run();
  } catch (e) {
    await logAuthAudit(env, {
      eventType: "auth.logout_all",
      action,
      userId,
      orgId,
      outcome: "error",
    });
    throw e;
  }

  const headers = new Headers();
  headers.append("set-cookie", "bf_at=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Lax");
  headers.append("set-cookie", "bf_rt=; Max-Age=0; Path=/api/auth; Secure; HttpOnly; SameSite=Strict");

  await logAuthAudit(env, {
    eventType: "auth.logout_all",
    action,
    userId,
    orgId,
    outcome: "success",
  });

  return ok({}, { headers });
}
