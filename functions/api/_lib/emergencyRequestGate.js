import { requireCookieCsrf } from './csrf.js';
import { getDb, requireOrgRole } from './auth.js';
import { bad } from './http.js';
import { enforceOrgWriteLockdown, getOrgIsolationState, isWriteMethod } from './orgLockdown.js';

export async function emergencyRequestGate({ env, request }) {
  const pathname = new URL(request.url).pathname;
  if (/^\/api\/orgs\/(?:create|index)\/?$/.test(pathname)) return null;
  const orgMatch = pathname.match(/^\/api\/orgs\/([^/]+)(?:\/(.*))?$/);
  let orgId = '', publicRoute = false, route = '';
  if (orgMatch) {
    orgId = decodeURIComponent(orgMatch[1]);
    route = (orgMatch[2] || '').replace(/\/+$/, '');
    publicRoute = route === 'newsletter/subscribe';
  } else {
    const form = pathname.match(/^\/api\/public\/forms\/([^/]+)\/?$/);
    const page = pathname.match(/^\/api\/(?:p|public)\/([^/]+)(?:\/|$)/);
    if (form) {
      const db = getDb(env);
      if (!db) return bad(503, 'LOCKDOWN_STATE_UNAVAILABLE');
      const row = await db.prepare('SELECT org_id FROM drive_files WHERE id = ?').bind(decodeURIComponent(form[1])).first();
      orgId = row?.org_id || '';
    } else if (page && env?.BF_PUBLIC) {
      orgId = await env.BF_PUBLIC.get(`slug:${decodeURIComponent(page[1])}`) || '';
    }
    publicRoute = true;
  }
  if (!orgId) return null;
  if (!publicRoute) {
    if (isWriteMethod(request.method)) {
      const csrf = requireCookieCsrf(request);
      if (csrf) return csrf;
    }
    const gate = await requireOrgRole({ env, request, orgId,
      minRole: isWriteMethod(request.method) && !['privacy/keys/device','privacy/keys/approvals'].includes(route) ? 'member' : 'viewer', bypassWriteLockdown: true });
    if (!gate.ok) return gate.resp;
  } else {
    const state = await getOrgIsolationState({ env, orgId });
    if (state.isolated) return bad(403, 'ORG_ISOLATED');
    const existing = await getDb(env).prepare('SELECT id FROM orgs WHERE id = ?').bind(orgId).first();
    if (!existing) return bad(404, 'ORG_NOT_FOUND');
  }
  const emergencyAction = /^emergency\/(lockdown|isolate|prepare|recover|destroy)$/.test(route);
  if (isWriteMethod(request.method) && !emergencyAction) {
    const gate = await enforceOrgWriteLockdown({ env, orgId });
    if (!gate.ok) return gate.resp;
  }
  return null;
}
