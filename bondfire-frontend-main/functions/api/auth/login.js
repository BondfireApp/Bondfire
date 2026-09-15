import { json, bad } from "../_lib/http.js";
import { rateLimit } from "../_lib/rateLimit.js";
import { issueAccessToken, randomToken, sha256Hex, cookieHeadersForAuth } from "../_lib/session.js";
import { runAppMigrations } from '../_lib/migrations.js'

function fromB64(s) {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function verifyPass(pass, stored) {
  const raw = fromB64(stored);
  const salt = raw.slice(0, 16);
  const expected = raw.slice(16);

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pass),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
    key,
    256
  );
  const got = new Uint8Array(bits);

  if (got.length !== expected.length) return false;
  for (let i = 0; i < got.length; i++) if (got[i] !== expected[i]) return false;
  return true;
}

export async function onRequestPost({ env, request }) {
  // Rate limit by IP + email (best-effort; if rate_limits table isn't present it's a no-op).
  const ip = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "";

  const body = await request.json().catch(() => ({}));
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");

  const rl = await rateLimit({ env, key: `login:${ip}:${email}`, limit: 12, windowSec: 600 });
  if (!rl.ok) return bad(429, "RATE_LIMIT", { retry_after: rl.retry_after });

  const user = await env.BF_DB.prepare(
    "SELECT id, email, name, password_hash FROM users WHERE email = ?"
  ).bind(email).first();

  if (!user) return bad(401, "INVALID_LOGIN");

  const ok = await verifyPass(password, user.password_hash);
  if (!ok) return bad(401, "INVALID_LOGIN");

  // MFA gate
  const mfa = await env.BF_DB.prepare(
    "SELECT mfa_enabled FROM user_mfa WHERE user_id = ?"
  ).bind(user.id).first();

  if (mfa && Number(mfa.mfa_enabled) === 1) {
    const challengeId = crypto.randomUUID();
    const expiresAt = Date.now() + 5 * 60 * 1000;
    await env.BF_DB.prepare(
      "INSERT INTO login_mfa_challenges (id, user_id, expires_at, verified) VALUES (?, ?, ?, 0)"
    ).bind(challengeId, user.id, expiresAt).run();

    return json({
      ok: true,
      mfa_required: true,
      challenge_id: challengeId,
      user: { id: user.id, email: user.email, name: user.name },
    });
  }

  // Cookie-based sessions (HttpOnly). Access token is short-lived.
  const accessToken = await issueAccessToken(env, user, 60 * 15);
  const refreshToken = randomToken(32);
  const refreshHash = await sha256Hex(refreshToken);
  const expiresAt = Date.now() + 1000 * 60 * 60 * 24 * 30;

  await env.BF_DB.prepare(
    "INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)"
  ).bind(crypto.randomUUID(), user.id, refreshHash, expiresAt).run();

  const isProd = (env?.ENV || env?.NODE_ENV || "").toLowerCase() === "production";
  const setCookies = cookieHeadersForAuth({ accessToken, refreshToken, isProd });

  const resp = json({ ok: true, user: { id: user.id, email: user.email, name: user.name } });
  for (const c of setCookies) resp.headers.append("set-cookie", c);
  return resp;
}