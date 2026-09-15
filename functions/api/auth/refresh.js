import { bad, ok, getCookie } from "../_lib/http.js";
import { sha256Hex, randomToken, issueAccessToken, cookieHeadersForAuth, clearAuthCookieHeaders } from "../_lib/session.js";
import { runAppMigrations } from '../_lib/migrations.js'

export async function onRequestPost({ env, request }) {
  if (!env?.BF_DB) return bad(500, "BF_DB_MISSING");
  const rt = getCookie(request, "bf_rt");
  if (!rt) return bad(401, "NO_REFRESH");

  const h = await sha256Hex(rt);
  const row = await env.BF_DB.prepare(
    "SELECT id, user_id, expires_at FROM refresh_tokens WHERE token_hash = ?"
  ).bind(h).first();

  if (!row) {
    const resp = bad(401, "INVALID_REFRESH");
    const isProd = (env?.ENV || env?.NODE_ENV || "").toLowerCase() === "production";
    for (const c of clearAuthCookieHeaders({ isProd })) resp.headers.append("set-cookie", c);
    return resp;
  }
  if (Number(row.expires_at) < Date.now()) {
    await env.BF_DB.prepare("DELETE FROM refresh_tokens WHERE id = ?").bind(row.id).run();
    const resp = bad(401, "REFRESH_EXPIRED");
    const isProd = (env?.ENV || env?.NODE_ENV || "").toLowerCase() === "production";
    for (const c of clearAuthCookieHeaders({ isProd })) resp.headers.append("set-cookie", c);
    return resp;
  }

  const user = await env.BF_DB.prepare("SELECT id, email, name FROM users WHERE id = ?")
    .bind(row.user_id)
    .first();
  if (!user) return bad(401, "INVALID_USER");

  // Rotate refresh: delete old token and issue a new one.
  await env.BF_DB.prepare("DELETE FROM refresh_tokens WHERE id = ?").bind(row.id).run();

  const newRt = randomToken(32);
  const newHash = await sha256Hex(newRt);
  const expiresAt = Date.now() + 1000 * 60 * 60 * 24 * 30;
  await env.BF_DB.prepare(
    "INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)"
  ).bind(crypto.randomUUID(), user.id, newHash, expiresAt).run();

  const accessToken = await issueAccessToken(env, user, 60 * 15);
  const isProd = (env?.ENV || env?.NODE_ENV || "").toLowerCase() === "production";
  const setCookies = cookieHeadersForAuth({ accessToken, refreshToken: newRt, isProd });

  const resp = ok({ user: { id: user.id, email: user.email, name: user.name } });
  for (const c of setCookies) resp.headers.append("set-cookie", c);
  return resp;
}