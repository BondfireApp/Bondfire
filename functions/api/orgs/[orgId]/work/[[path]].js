import { workEndpoint } from '../../../_lib/workStore.js';
export async function onRequest({ env, request, params }) {
  return workEndpoint({ env, request, orgId: params.orgId, path: Array.isArray(params.path) ? params.path.join('/') : params.path || '' });
}
