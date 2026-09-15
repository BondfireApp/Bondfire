import { requireOrgRole } from '../../../_lib/auth.js';
import { ensureEmergencySchema } from '../../../_lib/emergency.js';
import { getOrgDestructionPreview } from '../../../_lib/destruction.js';
import { bad, ok } from '../../../_lib/http.js';

export async function onRequestGet({ env, request, params }) {
  const orgId = String(params?.orgId || '');
  const gate = await requireOrgRole({ env, request, orgId, minRole: 'viewer', bypassWriteLockdown: true });
  if (!gate.ok) return gate.resp;
  const state = await ensureEmergencySchema(env);
  if (!state.ok) return state.resp;
  const row = await state.db.prepare('SELECT stage, isolated, isolated_at, updated_at FROM emergency_protocol_state WHERE org_id = ?').bind(orgId).first();
  const lockdown = await state.db.prepare('SELECT lockdown_enabled FROM org_emergency_state WHERE org_id = ?').bind(orgId).first();
  const stage = String(row?.stage || (lockdown?.lockdown_enabled ? 'lockdown' : 'normal'));
  const owner = gate.role === 'owner';
  let preview = null;
  if (owner && (new URL(request.url).searchParams.get('preview') === '1' || ['prepared', 'destroying'].includes(stage))) {
    preview = await getOrgDestructionPreview({ db: state.db, orgId });
    if (!preview) return bad(404, 'ORG_NOT_FOUND');
  }
  return ok({ protocol: { stage, isolated: !!row?.isolated, isolatedAt: row?.isolated_at || null, updatedAt: row?.updated_at || null },
    permissions: { canLockdown: owner || gate.role === 'admin', canDestroy: owner }, preview }, { headers: { 'cache-control': 'no-store' } });
}
