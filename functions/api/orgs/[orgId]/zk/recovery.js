import { validRecoveryPayload } from '../../../_lib/wrappedKeyValidation.js';
import { ok, bad, readJSON } from "../../../_lib/http.js";
import { requireOrgRole } from "../../../_lib/auth.js";
import { ensureZkSchema } from "../../../_lib/zkSchema.js";

async function getRecoveryTableCaps(db) {
  const info = await db.prepare("PRAGMA table_info(org_key_recovery)").all();
  const names = new Set((info?.results || []).map((c) => c.name));
  return {
    hasRecoveryPayload: names.has("recovery_payload"),
    hasWrappedKey: names.has("wrapped_key"),
    hasSalt: names.has("salt"),
    hasKdf: names.has("kdf"),
    hasUpdatedAt: names.has("updated_at"),
  };
}

function parseMaybeJSON(v) {
  if (!v) return null;
  if (typeof v !== "string") return v;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
}

// 🔥 Always normalize to { salt, iv, ct }
function normalizePayload(raw) {
  if (!raw) return null;

  const obj = typeof raw === "string" ? parseMaybeJSON(raw) : raw;
  if (!obj || typeof obj !== "object") return null;

  // If nested under payload, unwrap it
  const p = obj.payload ?? obj;

  if (
    typeof p.salt === "string" &&
    typeof p.iv === "string" &&
    typeof p.ct === "string"
  ) {
    return {
      salt: p.salt,
      iv: p.iv,
      ct: p.ct,
    };
  }

  return null;
}

export async function onRequestGet(ctx) {
  try {
    const { env, request, params } = ctx;
    const orgId = String(params.orgId);

    const gate = await requireOrgRole({ env, request, orgId, minRole: "member", bypassWriteLockdown: true });
    if (!gate.ok) return gate.resp;

    const userId = String(gate.user.sub);
    const { db } = await ensureZkSchema(env);
    const caps = await getRecoveryTableCaps(db);

    let row;

    if (caps.hasRecoveryPayload) {
      row = await db
        .prepare(
          `SELECT recovery_payload, updated_at
           FROM org_key_recovery
           WHERE org_id = ? AND user_id = ?`
        )
        .bind(orgId, userId)
        .first();
    } else {
      row = await db
        .prepare(
          `SELECT wrapped_key, updated_at
           FROM org_key_recovery
           WHERE org_id = ? AND user_id = ?`
        )
        .bind(orgId, userId)
        .first();
    }

    if (!row) {
      return ok({ has_recovery: false, updated_at: null, payload: null });
    }

    const raw =
      row.recovery_payload ??
      row.wrapped_key ??
      null;

    const payload = normalizePayload(raw);

    if (!payload) {
      return ok({ has_recovery: false, updated_at: null, payload: null });
    }

    return ok({
      has_recovery: true,
      updated_at: row.updated_at ?? null,
      payload,
    });
  } catch (e) {
    return bad(500, e?.message || String(e));
  }
}

export async function onRequestPost(ctx) {
  try {
    const { env, request, params } = ctx;
    const orgId = String(params.orgId);

    const gate = await requireOrgRole({ env, request, orgId, minRole: "member", bypassWriteLockdown: true });
    if (!gate.ok) return gate.resp;

    const userId = String(gate.user.sub);
    const { db } = await ensureZkSchema(env);
    const caps = await getRecoveryTableCaps(db);

    const body = await readJSON(request);
    const payload = normalizePayload(body?.payload ?? body);

    if (!validRecoveryPayload(payload)) {
      return bad(400, "INVALID_RECOVERY_PAYLOAD");
    }

    const payloadText = JSON.stringify(payload);
    const now = Date.now();

    if (caps.hasRecoveryPayload) {
      await db
        .prepare(
          `INSERT INTO org_key_recovery (org_id, user_id, recovery_payload, updated_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(org_id, user_id) DO UPDATE SET
             recovery_payload = excluded.recovery_payload,
             updated_at = excluded.updated_at`
        )
        .bind(orgId, userId, payloadText, now)
        .run();
      } else {
        await db
          .prepare(
            `INSERT INTO org_key_recovery (org_id, user_id, wrapped_key, salt, kdf, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(org_id, user_id) DO UPDATE SET
              wrapped_key = excluded.wrapped_key,
              salt = excluded.salt,
              kdf = excluded.kdf,
              updated_at = excluded.updated_at`
          )
          .bind(
            orgId,
            userId,
            payloadText,
            "",   // satisfy NOT NULL salt
            "",   // satisfy NOT NULL kdf
            now
          )
          .run();
      }

    return ok({ has_recovery: true, updated_at: now, payload });
  } catch (e) {
    return bad(500, e?.message || String(e));
  }
}

export async function onRequestDelete(ctx) {
  try {
    const { env, request, params } = ctx;
    const orgId = String(params.orgId);

    const gate = await requireOrgRole({ env, request, orgId, minRole: "member", bypassWriteLockdown: true });
    if (!gate.ok) return gate.resp;

    const userId = String(gate.user.sub);
    const { db } = await ensureZkSchema(env);

    await db
      .prepare(
        `DELETE FROM org_key_recovery WHERE org_id = ? AND user_id = ?`
      )
      .bind(orgId, userId)
      .run();

    return ok({ has_recovery: false, updated_at: null, payload: null });
  } catch (e) {
    return bad(500, e?.message || String(e));
  }
}