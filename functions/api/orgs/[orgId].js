import { bad } from '../_lib/http.js';
import { requireOrgRole } from '../_lib/auth.js';

export async function onRequestDelete({ env, request, params }) {
  const orgId = params?.orgId;
  if (!orgId) return bad(400, 'MISSING_ORG_ID');
  const auth = await requireOrgRole({ env, request, orgId, minRole: 'owner', bypassWriteLockdown: true });
  if (!auth.ok) return auth.resp;
  return bad(409, 'EMERGENCY_PROTOCOL_REQUIRED');
}
