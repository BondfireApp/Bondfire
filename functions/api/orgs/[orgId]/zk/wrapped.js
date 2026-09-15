import { ok, bad } from '../../../_lib/http.js';
import { requireOrgRole } from '../../../_lib/auth.js';
import { ensureZkSchema, ensureOrgCryptoRow, orgKeyWrappedCapabilities } from '../../../_lib/zkSchema.js';

export async function onRequestGet({ env, request, params }) {
  try {
    const orgId = String(params.orgId);
    const gate = await requireOrgRole({ env, request, orgId, minRole: 'member' });
    if (!gate.ok) return gate.resp;

    const { db } = await ensureZkSchema(env);
    const version = await ensureOrgCryptoRow(db, orgId);
    const caps = await orgKeyWrappedCapabilities(db);

    let row;
    if (caps.hasKeyVersion) {
      row = await db.prepare(
        'SELECT wrapped_key, key_version FROM org_key_wrapped WHERE org_id = ? AND user_id = ? ORDER BY key_version DESC LIMIT 1'
      ).bind(orgId, String(gate.user.sub)).first();
    } else {
      row = await db.prepare(
        'SELECT wrapped_key FROM org_key_wrapped WHERE org_id = ? AND user_id = ?'
      ).bind(orgId, String(gate.user.sub)).first();
    }

    return ok({
      org_id: orgId,
      key_version: row?.key_version ? Number(row.key_version) : version,
      wrapped_key: row?.wrapped_key || null,
      compat: { no_key_version_column: !caps.hasKeyVersion },
    });
  } catch (e) {
    return bad(500, 'INTERNAL', { detail: e?.message || String(e) });
  }
}
