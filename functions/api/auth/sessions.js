import { json, bad } from "../_lib/http.js";
import { getDb, requireUser } from "../_lib/auth.js";

export async function onRequestGet({ env, request }) {
  const auth = await requireUser({ env, request });
  if (!auth.ok) return auth.resp;

  const userId = auth.user?.sub;
  if (!userId) return bad(401, "UNAUTHORIZED");

  const db = getDb(env);
  if (!db || typeof db.prepare !== "function") return bad(500, "NO_DB_BINDING");

  try {
    const rows = await db
      .prepare(
        "SELECT id, expires_at FROM refresh_tokens WHERE user_id = ? ORDER BY expires_at DESC LIMIT 20"
      )
      .bind(userId)
      .all();

    return json({ ok: true, sessions: rows?.results || [] });
  } catch {
    return bad(500, "SESSIONS_ERROR");
  }
}
