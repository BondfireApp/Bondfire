import { requireOrgRole } from '../../../_lib/auth.js';
import { transitionEmergency } from '../../../_lib/emergencyTransition.js';
import { requireSensitiveAction } from '../../../_lib/sensitiveAction.js';
import { ok, readJSON } from '../../../_lib/http.js';

export async function onRequestPost({ env, request, params }) {
  const orgId = String(params?.orgId || '');
  const gate = await requireOrgRole({ env, request, orgId, minRole: 'owner', bypassWriteLockdown: true });
  if (!gate.ok) return gate.resp;
  const body = await readJSON(request);
  const fresh = await requireSensitiveAction({ env, request, password: body?.password, mfaCode: body?.mfaCode });
  if (!fresh.ok) return fresh.resp;
  const result = await transitionEmergency({ env, orgId, userId: fresh.user.sub, from: ['lockdown', 'isolated'],
    stage: 'isolated', summary: 'Organization isolated to owner-only access; data and recovery keys preserved' });
  return result.ok ? ok(result) : result.resp;
}
