import { json, bad } from "../../_lib/http.js";
import { aesGcmDecrypt, totpVerify, sha256Hex } from "../../_lib/crypto.js";
import { rateLimit } from "../../_lib/rateLimit.js";
import { issueAccessToken, randomToken, cookieHeadersForAuth } from "../../_lib/session.js";
import { runAppMigrations } from '../../_lib/migrations.js'

function normalizeRecovery(code) {
  return String(code || "").trim().toUpperCase();
}

async function hashRecovery(code, pepper) {
  // Must match mfa/confirm hashing scheme.
  return sha256Hex(`${code}|${pepper}`);
}

export async function onRequestPost({ env, request }) {
  const ip = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "";
  const body = await request.json().catch(() => ({}));

  const challengeId = String(body.challenge_id || "").trim();
  const code = String(body.code || body.totp || "").trim();
  const recoveryCode = normalizeRecovery(body.recovery_code || body.recovery || "");

  if (!challengeId) return bad(400, "MISSING_CHALLENGE");

  const rl = await rateLimit({ env, key: `mfa:${ip}:${challengeId}`, limit: 12, windowSec: 600 });
  if (!rl.ok) return bad(429, "RATE_LIMIT", { retry_after: rl.retry_after });

  const ch = await env.BF_DB
    .prepare("SELECT id, user_id, expires_at, verified FROM login_mfa_challenges WHERE id = ?")
    .bind(challengeId)
    .first();

  if (!ch) return bad(401, "INVALID_CHALLENGE");
  if (Number(ch.verified) === 1) return bad(401, "CHALLENGE_USED");
  if (Number(ch.expires_at) < Date.now()) return bad(401, "CHALLENGE_EXPIRED");

  const mfa = await env.BF_DB
    .prepare("SELECT totp_secret_encrypted, mfa_enabled FROM user_mfa WHERE user_id = ?")
    .bind(ch.user_id)
    .first();

  if (!mfa || Number(mfa.mfa_enabled) !== 1) return bad(401, "MFA_NOT_ENABLED");

  let ok = false;

  // Recovery code path
  if (recoveryCode) {
    const pepper = env.RECOVERY_PEPPER || env.JWT_SECRET || "pepper";
    const h = await hashRecovery(recoveryCode, pepper);
    const row = await env.BF_DB
      .prepare("SELECT id, used FROM user_mfa_recovery_codes WHERE user_id = ? AND code_hash = ?")
      .bind(ch.user_id, h)
      .first();

    if (row && Number(row.used) === 0) {
      await env.BF_DB
        .prepare("UPDATE user_mfa_recovery_codes SET used = 1 WHERE id = ?")
        .bind(row.id)
        .run();
      ok = true;
    }
  }

  // TOTP path
  if (!ok) {
    if (!code) return bad(400, "MISSING_CODE");

    const encKey = env.MFA_ENC_KEY || env.JWT_SECRET;
    if (!encKey) return bad(500, "MFA_KEY_MISSING");

    let encObj = null;
    try {
      encObj = typeof mfa.totp_secret_encrypted === "string"
        ? JSON.parse(mfa.totp_secret_encrypted)
        : mfa.totp_secret_encrypted;
    } catch {
      return bad(400, "MFA_SECRET_CORRUPT");
    }

    let secret;
    try {
      secret = await aesGcmDecrypt(encObj, encKey);
    } catch (e) {
      console.error("auth/login/mfa decrypt failed", e);
      return bad(400, "MFA_SECRET_DECRYPT_FAILED");
    }

    ok = await totpVerify(secret, code, { window: 1, step: 30, digits: 6 });
  }

  if (!ok) return bad(401, "INVALID_MFA");

  await env.BF_DB
    .prepare("UPDATE login_mfa_challenges SET verified = 1 WHERE id = ?")
    .bind(challengeId)
    .run();

  const user = await env.BF_DB
    .prepare("SELECT id, email, name FROM users WHERE id = ?")
    .bind(ch.user_id)
    .first();

  if (!user) return bad(401, "INVALID_LOGIN");

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