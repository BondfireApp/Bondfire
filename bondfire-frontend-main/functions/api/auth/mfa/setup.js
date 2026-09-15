import { ok, err, requireMethod, now } from "../../_lib/http.js";
import { getDb, requireUser } from "../../_lib/auth.js";
import { randomBase32, aesGcmEncrypt } from "../../_lib/crypto.js";

export async function onRequest(context) {
  const { request, env } = context;
  const m = requireMethod(request, "POST");
  if (m) return m;

  try {
    const u = await requireUser({ env, request });
    if (!u.ok) return u.resp;

    const db = getDb(env);
    if (!db) return err(500, "NO_DB_BINDING");

    const encKey = env.MFA_ENC_KEY || env.JWT_SECRET;
    if (!encKey) return err(500, "MFA_KEY_MISSING");

    // 20 bytes -> base32 secret typically used for TOTP
    const secret = randomBase32(20);
    const encObj = await aesGcmEncrypt(secret, encKey);
    const encStr = JSON.stringify(encObj);

    const ts = now();
    await db
      .prepare(
        `INSERT INTO user_mfa (user_id, totp_secret_encrypted, mfa_enabled, created_at)
         VALUES (?, ?, 0, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           totp_secret_encrypted = excluded.totp_secret_encrypted,
           mfa_enabled = 0`
      )
      .bind(u.user.sub, encStr, ts)
      .run();

    const issuer = env.TOTP_ISSUER || "Bondfire";
    const label = u.user.email || u.user.sub;
    const otpauth = `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(
      label
    )}?secret=${encodeURIComponent(secret)}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;

    return ok({ secret, otpauth });
  } catch (e) {
    console.error("mfa/setup error", e);
    return err(500, "MFA_SETUP_FAILED", { detail: String(e?.message || e) });
  }
}
