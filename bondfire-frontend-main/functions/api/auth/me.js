import { json } from "../_lib/http.js";
import { requireUser } from "../_lib/auth.js";
import { runAppMigrations } from '../_lib/migrations.js'

export async function onRequestGet({ env, request }) {
  const u = await requireUser({ env, request });
  if (!u.ok) return u.resp;

  // Attach a couple server-truth flags while minimizing routine profile exposure.
  const row = await env.BF_DB.prepare(
    "SELECT public_key, zk_enabled FROM users WHERE id = ?"
  ).bind(String(u.user.sub)).first();

  const mfa = await env.BF_DB.prepare(
    "SELECT mfa_enabled FROM user_mfa WHERE user_id = ?"
  ).bind(String(u.user.sub)).first();

  const { email, name, ...safeUser } = u.user || {};

  return json({
    ok: true,
    user: {
      ...safeUser,
      has_public_key: !!(row && row.public_key),
      zk_enabled: row ? Number(row.zk_enabled || 0) : 0,
      mfa_enabled: mfa ? Number(mfa.mfa_enabled || 0) : 0,
    },
  });
}