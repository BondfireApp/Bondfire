import { destroyAccountData } from '../_lib/destruction.js';
import { requireSensitiveAction } from '../_lib/sensitiveAction.js';
import { bad, ok, readJSON } from '../_lib/http.js';
import { clearAuthCookieHeaders } from '../_lib/session.js';

const CONFIRMATION = 'DELETE MY ACCOUNT';

export async function onRequestPost({ env, request }) {
  const body = await readJSON(request);
  const fresh = await requireSensitiveAction({
    env,
    request,
    password: body?.password,
    mfaCode: body?.mfaCode,
  });
  if (!fresh.ok) return fresh.resp;

  if (String(body?.confirmation || '') !== CONFIRMATION) {
    return bad(400, 'CONFIRMATION_MISMATCH', { confirmationPhrase: CONFIRMATION });
  }
  if (body?.acknowledgeHistoricalLimit !== true) {
    return bad(400, 'HISTORICAL_ERASURE_ACK_REQUIRED');
  }

  const userId = fresh.user?.sub || fresh.user?.userId || fresh.user?.id || null;
  if (!userId) return bad(401, 'UNAUTHORIZED');

  const result = await destroyAccountData({ db: fresh.db, userId });
  if (!result.ok) {
    return bad(409, 'SOLE_OWNED_ORGS_REMAIN', { orgs: result.blockers });
  }

  const isProd = (env?.ENV || env?.NODE_ENV || '').toLowerCase() === 'production';
  const response = ok({
    destroyed: true,
    erasure: {
      activeAccountDataDeleted: true,
      fullHistoricalGuarantee: false,
      limitation: 'Legacy plaintext may still exist in provider-managed historical backups outside Bondfire control.',
    },
  });
  for (const cookie of clearAuthCookieHeaders({ isProd })) response.headers.append('set-cookie', cookie);
  return response;
}
