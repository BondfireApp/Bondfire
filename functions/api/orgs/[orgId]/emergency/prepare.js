import { requireOrgRole } from '../../../_lib/auth.js';
import { getOrgDestructionPreview } from '../../../_lib/destruction.js';
import { transitionEmergency } from '../../../_lib/emergencyTransition.js';
import { requireSensitiveAction } from '../../../_lib/sensitiveAction.js';
import { bad, ok, readJSON } from '../../../_lib/http.js';

export async function onRequestPost({ env, request, params }) {
  const orgId = String(params?.orgId || '');
  const gate = await requireOrgRole({ env, request, orgId, minRole: 'owner', bypassWriteLockdown: true });
  if (!gate.ok) return gate.resp;
  const body = await readJSON(request);
  const fresh = await requireSensitiveAction({ env, request, password: body?.password, mfaCode: body?.mfaCode });
  if (!fresh.ok) return fresh.resp;
  const preview = await getOrgDestructionPreview({ db: fresh.db, orgId });
  if (!preview) return bad(404, 'ORG_NOT_FOUND');
  // Exact-name confirmation stays at the final destructive action. Requiring a
  // nearly identical phrase here made this deliberate flow needlessly slow.
  if (body?.acknowledgeDestructionReview !== true) return bad(400, 'DESTRUCTION_REVIEW_ACK_REQUIRED');
  const result = await transitionEmergency({ env, orgId, userId: fresh.user.sub, from: ['isolated', 'prepared'],
    stage: 'prepared', summary: 'Organization destruction prepared; no data deleted' });
  return result.ok ? ok({ ...result, preview }) : result.resp;
}
