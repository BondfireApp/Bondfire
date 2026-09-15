import { now, uuid } from "./http.js";

/**
 * Best-effort activity logging. Never blocks the main request.
 *
 * Expected D1 schema:
 *   CREATE TABLE activity (
 *     id TEXT PRIMARY KEY,
 *     org_id TEXT NOT NULL,
 *     kind TEXT NOT NULL,
 *     message TEXT NOT NULL,
 *     actor_user_id TEXT,
 *     created_at INTEGER NOT NULL
 *   );
 */
export async function logActivity(env, { orgId, kind, message, actorUserId = null }) {
  try {
    if (!env?.BF_DB) return;
    if (!orgId || !kind || !message) return;

    await env.BF_DB.prepare(
      "INSERT INTO activity (id, org_id, kind, message, actor_user_id, created_at) VALUES (?,?,?,?,?,?)"
    )
      .bind(uuid(), orgId, String(kind), String(message), actorUserId, now())
      .run();
  } catch (e) {
    // swallow forever. activity must never break core flows.
    console.warn("ACTIVITY_LOG_FAIL", e?.message || e);
  }
}
