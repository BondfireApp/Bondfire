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

    const anyWrap = await db.prepare(
      'SELECT 1 as ok FROM org_key_wrapped WHERE org_id = ? LIMIT 1'
    ).bind(orgId).first();

    return ok({
      org_id: orgId,
      enabled: !!anyWrap,
      key_version: version,
      compat: { no_key_version_column: !caps.hasKeyVersion },
    });
  } catch (e) {
    return bad(500, 'INTERNAL', { detail: e?.message || String(e) });
  }
}
