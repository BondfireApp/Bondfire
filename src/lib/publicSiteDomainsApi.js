import { api } from "../utils/api.js";

function resolveOrgId(value) {
  const direct = String(value || '').trim();
  if (direct) return direct;
  if (typeof window === 'undefined') return '';
  const match = String(window.location?.hash || '').match(/#\/org\/([^/]+)/i);
  return match ? decodeURIComponent(match[1]) : '';
}

function apiUrl(orgId, surface = 'organization') {
  const id = resolveOrgId(orgId);
  if (!id) throw new Error('Missing organization id');
  return `/api/orgs/${encodeURIComponent(id)}/public/domains?surface=${encodeURIComponent(surface || 'organization')}`;
}

export async function fetchPublicSiteDomainState(orgId, surface = 'organization') {
  const data = await api(apiUrl(orgId, surface), { method: 'GET' });
  return { state: data?.state || null };
}

export async function savePublicSiteDomainState(orgId, payload, surface = 'organization') {
  const data = await api(apiUrl(orgId, surface), {
    method: 'PUT',
    body: JSON.stringify(payload || {}),
  });
  return { state: data?.state || null };
}
