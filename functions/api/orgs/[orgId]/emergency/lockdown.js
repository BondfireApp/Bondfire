import { requireOrgRole } from '../../../_lib/auth.js';
import { transitionEmergency } from '../../../_lib/emergencyTransition.js';
import { bad, ok } from '../../../_lib/http.js';

export async function onRequestPost({ env, request, params }) {
  const orgId = String(params?.orgId || '');
  const gate = await requireOrgRole({ env, request, orgId, minRole: 'admin', bypassWriteLockdown: true });
  if (!gate.ok) return gate.resp;
  const body = await request.json().catch(() => null);
  const enabled = typeof body?.enabled === 'boolean' ? body.enabled : body?.locked;
  if (typeof enabled !== 'boolean') return bad(400, 'INVALID_LOCKDOWN_STATE');
  if (body.rotateKeys) return bad(400, 'RECOVERABLE_LOCKDOWN_PRESERVES_KEYS');
  const result = await transitionEmergency({ env, orgId, userId: gate.user.sub, from: ['normal', 'lockdown'],
    stage: enabled ? 'lockdown' : 'normal', summary: enabled ? 'Recoverable organization lockdown enabled' : 'Organization lockdown cleared' });
  return result.ok ? ok(result) : result.resp;
}
