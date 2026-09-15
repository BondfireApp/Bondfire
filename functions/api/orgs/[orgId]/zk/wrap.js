import { validWrappedKey } from '../../../_lib/wrappedKeyValidation.js';
import { ok, bad, readJSON } from '../../../_lib/http.js';
import { requireOrgRole } from '../../../_lib/auth.js';
import { ensureZkSchema, ensureOrgCryptoRow, orgKeyWrappedCapabilities } from '../../../_lib/zkSchema.js';

function extractKidFromWrappedKey(wrappedKeyStr) {
  try {
    const w = JSON.parse(String(wrappedKeyStr || ""));
    return String(w?.recipient_kid || w?.kid || "");
  } catch {
    return "";
  }
}

function normalizeWraps(body, fallbackUserId) {
  if (Array.isArray(body?.wraps)) {
    return body.wraps
      .map((w) => ({ user_id: String(w?.user_id || ''), wrapped_key: w?.wrapped_key }))
      .filter((w) => w.user_id && w.wrapped_key);
  }
  // single
  const uid = String(body?.user_id || fallbackUserId || '');
  const wk = body?.wrapped_key;
  if (!uid || !wk) return [];
  return [{ user_id: uid, wrapped_key: wk }];
}

export async function onRequestPost({ env, request, params }) {
  try {
    const orgId = String(params.orgId);
    // Only admin+ can write other users' wraps
    const gate = await requireOrgRole({ env, request, orgId, minRole: 'admin' });
    if (!gate.ok) return gate.resp;

    const body = await readJSON(request);
    const { db } = await ensureZkSchema(env);
    const caps = await orgKeyWrappedCapabilities(db);

    const version = await ensureOrgCryptoRow(db, orgId);
    const keyVersion = Number(body?.key_version || version || 1);

    const wraps = normalizeWraps(body, gate.user.sub);
    if (!wraps.length) return bad(400, 'MISSING_WRAPS');

    for (const w of wraps) {
      if (!validWrappedKey(String(w.wrapped_key))) return bad(400, 'INVALID_WRAPPED_KEY');
      const member = await db.prepare('SELECT role FROM org_memberships WHERE org_id=? AND user_id=?').bind(orgId,w.user_id).first();
      if (!member) return bad(400,'KEY_RECIPIENT_NOT_MEMBER');
    }
    const now = Date.now();
    let stored = 0;

    for (const w of wraps) {
      const kid = caps.hasKid ? (extractKidFromWrappedKey(w.wrapped_key) || null) : null;

      // If schema lacks key_version, we can only store one wrap per user.
      if (caps.hasKeyVersion && caps.hasWrappedAt && caps.hasKid) {
        await db.prepare(
          'INSERT OR REPLACE INTO org_key_wrapped (org_id, user_id, key_version, wrapped_key, wrapped_at, kid) VALUES (?, ?, ?, ?, ?, ?)'
        ).bind(orgId, w.user_id, keyVersion, String(w.wrapped_key), now, kid).run();
      } else if (caps.hasKeyVersion && caps.hasWrappedAt) {
        await db.prepare(
          'INSERT OR REPLACE INTO org_key_wrapped (org_id, user_id, key_version, wrapped_key, wrapped_at) VALUES (?, ?, ?, ?, ?)'
        ).bind(orgId, w.user_id, keyVersion, String(w.wrapped_key), now).run();
      } else if (caps.hasKeyVersion && caps.hasKid) {
        await db.prepare(
          'INSERT OR REPLACE INTO org_key_wrapped (org_id, user_id, key_version, wrapped_key, kid) VALUES (?, ?, ?, ?, ?)'
        ).bind(orgId, w.user_id, keyVersion, String(w.wrapped_key), kid).run();
      } else if (caps.hasKeyVersion) {
        await db.prepare(
          'INSERT OR REPLACE INTO org_key_wrapped (org_id, user_id, key_version, wrapped_key) VALUES (?, ?, ?, ?)'
        ).bind(orgId, w.user_id, keyVersion, String(w.wrapped_key)).run();
      } else if (caps.hasKid) {
        await db.prepare(
          'INSERT OR REPLACE INTO org_key_wrapped (org_id, user_id, wrapped_key, kid) VALUES (?, ?, ?, ?)'
        ).bind(orgId, w.user_id, String(w.wrapped_key), kid).run();
      } else {
        await db.prepare(
          'INSERT OR REPLACE INTO org_key_wrapped (org_id, user_id, wrapped_key) VALUES (?, ?, ?)'
        ).bind(orgId, w.user_id, String(w.wrapped_key)).run();
      }
      stored++;
    }

    return ok({
      org_id: orgId,
      stored,
      key_version: caps.hasKeyVersion ? keyVersion : 1,
      compat: { no_key_version_column: !caps.hasKeyVersion },
    });
  } catch (e) {
    return bad(500, 'INTERNAL', { detail: e?.message || String(e) });
  }
}
