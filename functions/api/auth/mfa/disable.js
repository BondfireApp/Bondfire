import { bad, ok, readJSON } from "../../_lib/http.js";
import { getDb, requireUser } from "../../_lib/auth.js";
import { aesGcmDecrypt, totpVerify } from "../../_lib/crypto.js";
import { logAuthAudit } from "../../_lib/audit.js";

/**
 * POST /api/auth/mfa/disable
 * Body: { code: "123456" }  (TOTP code)
 *
 * Disables MFA for the current user after verifying a valid TOTP code.
 * Also deletes recovery codes and pending MFA challenges.
 */
export async function onRequestPost({ request, env }) {
  const action = "POST /api/auth/mfa/disable";
  let auditUserId = null;
  let auditOrgId = null;

  try {
    const u = await requireUser({ env, request });
    if (!u.ok) {
      await logAuthAudit(env, {
        eventType: "auth.mfa_disable",
        action,
        outcome: "denied",
      });
      return u.resp;
    }

    const db = getDb(env);
    if (!db) {
      await logAuthAudit(env, {
        eventType: "auth.mfa_disable",
        action,
        outcome: "error",
      });
      return bad(500, "DB_NOT_CONFIGURED");
    }

    const body = await readJSON(request);
    const codeRaw = (body?.code ?? "").toString();
    const code = codeRaw.replace(/\s+/g, "");
    if (!/^\d{6}$/.test(code)) {
      await logAuthAudit(env, {
        eventType: "auth.mfa_disable",
        action,
        outcome: "denied",
      });
      return bad(400, "INVALID_MFA_CODE");
    }

    const userId = u.user?.sub || u.user?.id;
    auditUserId = userId || null;
    auditOrgId = u.user?.org_id || u.user?.orgId || null;
    if (!userId) {
      await logAuthAudit(env, {
        eventType: "auth.mfa_disable",
        action,
        orgId: auditOrgId,
        outcome: "denied",
      });
      return bad(500, "USER_ID_MISSING");
    }

    const row = await db
      .prepare("SELECT totp_secret_encrypted, mfa_enabled FROM user_mfa WHERE user_id = ?")
      .bind(userId)
      .first();

    if (!row || !row.mfa_enabled) {
      await logAuthAudit(env, {
        eventType: "auth.mfa_disable",
        action,
        userId: auditUserId,
        orgId: auditOrgId,
        outcome: "denied",
      });
      return bad(400, "MFA_NOT_ENABLED");
    }

    // Stored value might be a JSON string (recommended) or already-parsed object (older/broken states).
    let enc = row.totp_secret_encrypted;
    if (!enc) {
      await logAuthAudit(env, {
        eventType: "auth.mfa_disable",
        action,
        userId: auditUserId,
        orgId: auditOrgId,
        outcome: "error",
      });
      return bad(400, "MFA_SECRET_MISSING");
    }

    if (typeof enc === "string") {
      try {
        enc = JSON.parse(enc);
      } catch {
        // If it's not JSON, it's corrupt.
        await logAuthAudit(env, {
          eventType: "auth.mfa_disable",
          action,
          userId: auditUserId,
          orgId: auditOrgId,
          outcome: "error",
        });
        return bad(400, "MFA_SECRET_CORRUPT");
      }
    }

    const encKey = env.MFA_ENC_KEY || env.JWT_SECRET;
    if (!encKey) {
      await logAuthAudit(env, {
        eventType: "auth.mfa_disable",
        action,
        userId: auditUserId,
        orgId: auditOrgId,
        outcome: "error",
      });
      return bad(500, "MFA_KEY_MISSING");
    }

    let secretB32;
    try {
      secretB32 = await aesGcmDecrypt(enc, encKey);
    } catch (e) {
      await logAuthAudit(env, {
        eventType: "auth.mfa_disable",
        action,
        userId: auditUserId,
        orgId: auditOrgId,
        outcome: "error",
      });
      return bad(400, "MFA_SECRET_DECRYPT_FAILED");
    }

    const valid = await totpVerify(secretB32, code, { window: 1 });
    if (!valid) {
      await logAuthAudit(env, {
        eventType: "auth.mfa_disable",
        action,
        userId: auditUserId,
        orgId: auditOrgId,
        outcome: "denied",
      });
      return bad(400, "INVALID_MFA_CODE");
    }

    // Disable MFA and clear related rows.
    await db
      .prepare("UPDATE user_mfa SET mfa_enabled = 0, totp_secret_encrypted = NULL WHERE user_id = ?")
      .bind(userId)
      .run();

    await db
      .prepare("DELETE FROM user_mfa_recovery_codes WHERE user_id = ?")
      .bind(userId)
      .run();

    await db
      .prepare("DELETE FROM login_mfa_challenges WHERE user_id = ?")
      .bind(userId)
      .run();

    await logAuthAudit(env, {
      eventType: "auth.mfa_disable",
      action,
      userId: auditUserId,
      orgId: auditOrgId,
      outcome: "success",
    });

    return ok({ mfa_enabled: false });
  } catch (e) {
    await logAuthAudit(env, {
      eventType: "auth.mfa_disable",
      action,
      userId: auditUserId,
      orgId: auditOrgId,
      outcome: "error",
    });
    // Avoid Cloudflare HTML 500 pages. Return structured error for debugging.
    return bad(500, "MFA_DISABLE_FAILED", { message: e?.message || String(e) });
  }
}
