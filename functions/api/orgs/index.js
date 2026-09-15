// functions/api/orgs/index.js
// Lists orgs the current user belongs to.
// Must support cookie-session auth (bf_at) as well as legacy Bearer tokens.

import { json, bad } from "../_lib/http.js";
import { getDb, requireUser } from "../_lib/auth.js";

export async function onRequestGet({ env, request }) {
  if (!env.JWT_SECRET) return bad(500, "JWT_SECRET_MISSING");

  const u = await requireUser({ env, request });
  if (!u.ok) return u.resp;

  const userId = u.user?.sub || u.user?.id || u.user?.userId;
  if (!userId) return bad(401, "UNAUTHORIZED");

  const db = getDb(env);
  if (!db) return bad(500, "NO_DB_BINDING");

  const res = await db
    .prepare(
      `SELECT o.id as id, o.name as name, m.role as role
       FROM org_memberships m
       JOIN orgs o ON o.id = m.org_id
       WHERE m.user_id = ?
       ORDER BY o.created_at DESC`
    )
    .bind(String(userId))
    .all();

  return json({ ok: true, orgs: res.results || [] });
}
