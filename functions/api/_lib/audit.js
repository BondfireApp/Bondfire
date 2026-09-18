import { now } from "./http.js";

/**
 * Best-effort auth/security audit logging.
 * Never blocks the main request flow.
 */
export async function logAuthAudit(env, {
  eventType,
  action,
  userId = null,
  orgId = null,
  outcome,
}) {
  try {
    const entry = {
      eventType: String(eventType || "auth.audit"),
      timestamp: now(),
      action: String(action || "unknown"),
      outcome: String(outcome || "unknown"),
    };

    if (userId != null && userId !== "") entry.userId = String(userId);
    if (orgId != null && orgId !== "") entry.orgId = String(orgId);

    console.info("AUTH_AUDIT", entry);
  } catch (e) {
    // Best-effort only.
    console.warn("AUTH_AUDIT_LOG_FAIL", e?.message || e);
  }
}
