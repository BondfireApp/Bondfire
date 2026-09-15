import { ok, err, requireMethod, now, uuid, readJSON } from "../../_lib/http.js";
import { getDb, requireUser } from "../../_lib/auth.js";
import { aesGcmDecrypt, totpVerify, sha256Hex } from "../../_lib/crypto.js";

function makeRecoveryCode() {
  // 10 bytes -> 20 hex chars, format XXXXX-XXXXX-XXXXX (15) too long
  // We'll do 8+4: XXXX-XXXX-XXXX (12) for usability.
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}`.toUpperCase();
}

async function hashRecovery(code, pepper) {
  // Pepper so leaked DB hashes are less useful.
  return sha256Hex(`${code}|${pepper}`);
}

export async function onRequest(context) {
  const { request, env } = context;
  const m = requireMethod(request, "POST");
  if (m) return m;

  try {
    const u = await requireUser({ env, request });
    if (!u.ok) return u.resp;

    const db = getDb(env);
    if (!db) return err(500, "NO_DB_BINDING");

    const body = await readJSON(request);
    const code = String(body.code || body.totp || "").trim();
    if (!code) return err(400, "MFA_CODE_REQUIRED");

    const row = await db
      .prepare("SELECT totp_secret_encrypted, mfa_enabled FROM user_mfa WHERE user_id = ?")
      .bind(u.user.sub)
      .first();

    if (!row?.totp_secret_encrypted) return err(400, "MFA_NOT_SETUP");

    const encKey = env.MFA_ENC_KEY || env.JWT_SECRET;
    if (!encKey) return err(500, "MFA_KEY_MISSING");

    // Support both stringified JSON (new) and plain object-ish (older).
    let encObj = null;
    try {
      encObj = typeof row.totp_secret_encrypted === "string"
        ? JSON.parse(row.totp_secret_encrypted)
        : row.totp_secret_encrypted;
    } catch {
      return err(400, "MFA_SECRET_CORRUPT");
    }

    let secret;
    try {
      secret = await aesGcmDecrypt(encObj, encKey);
    } catch (e) {
      console.error("mfa/confirm decrypt failed", e);
      return err(400, "MFA_SECRET_DECRYPT_FAILED");
    }

    const okTotp = await totpVerify(secret, code, { window: 1 });
    if (!okTotp) return err(400, "INVALID_MFA_CODE");

    // Enable MFA and create fresh recovery codes.
    const ts = now();
    const pepper = env.RECOVERY_PEPPER || env.JWT_SECRET || "pepper";

    // wipe existing recovery codes then insert new
    await db.prepare("DELETE FROM user_mfa_recovery_codes WHERE user_id = ?").bind(u.user.sub).run();

    const recovery = [];
    for (let i = 0; i < 10; i++) {
      const rc = makeRecoveryCode();
      recovery.push(rc);
      const code_hash = await hashRecovery(rc, pepper);
      await db
        .prepare(
          "INSERT INTO user_mfa_recovery_codes (id, user_id, code_hash, used, created_at) VALUES (?, ?, ?, 0, ?)"
        )
        .bind(uuid(), u.user.sub, code_hash, ts)
        .run();
    }

    await db
      .prepare(
        "UPDATE user_mfa SET mfa_enabled = 1 WHERE user_id = ?"
      )
      .bind(u.user.sub)
      .run();

    return ok({ enabled: true, recovery_codes: recovery });
  } catch (e) {
    console.error("mfa/confirm error", e);
    return err(500, "MFA_CONFIRM_FAILED", { detail: String(e?.message || e) });
  }
}
