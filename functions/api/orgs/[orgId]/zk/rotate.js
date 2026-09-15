import { ok, bad, readJSON } from '../../../_lib/http.js';
import { requireOrgRole } from '../../../_lib/auth.js';
import { ensureZkSchema, bumpOrgKeyVersion, orgKeyWrappedCapabilities } from '../../../_lib/zkSchema.js';

export async function onRequestPost({ env, request, params }) {
  try {
    const orgId = String(params.orgId);
    const gate = await requireOrgRole({ env, request, orgId, minRole: 'owner' });
    if (!gate.ok) return gate.resp;

    const { db } = await ensureZkSchema(env);
    const caps = await orgKeyWrappedCapabilities(db);

    const newVersion = await bumpOrgKeyVersion(db, orgId);

    // Optionally accept wraps to store immediately after rotation.
    const body = await readJSON(request);
    const wraps = Array.isArray(body?.wraps) ? body.wraps : null;
    const now = Date.now();

    if (wraps?.length) {
      for (const w of wraps) {
        const userId = String(w?.user_id || '');
        const wrappedKey = w?.wrapped_key;
        if (!userId || !wrappedKey) continue;

        if (caps.hasKeyVersion && caps.hasWrappedAt) {
          await db.prepare(
            'INSERT OR REPLACE INTO org_key_wrapped (org_id, user_id, key_version, wrapped_key, wrapped_at) VALUES (?, ?, ?, ?, ?)'
          ).bind(orgId, userId, newVersion, String(wrappedKey), now).run();
        } else if (caps.hasKeyVersion) {
          await db.prepare(
            'INSERT OR REPLACE INTO org_key_wrapped (org_id, user_id, key_version, wrapped_key) VALUES (?, ?, ?, ?)'
          ).bind(orgId, userId, newVersion, String(wrappedKey)).run();
        } else {
          // legacy schema: overwrite the single stored key
          await db.prepare(
            'INSERT OR REPLACE INTO org_key_wrapped (org_id, user_id, wrapped_key) VALUES (?, ?, ?)'
          ).bind(orgId, userId, String(wrappedKey)).run();
        }
      }
    }

    return ok({
      org_id: orgId,
      key_version: caps.hasKeyVersion ? newVersion : 1,
      compat: { no_key_version_column: !caps.hasKeyVersion },
    });
  } catch (e) {
    return bad(500, 'INTERNAL', { detail: e?.message || String(e) });
  }
}
