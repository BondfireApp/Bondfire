import { privateEncryptionReset } from '../../../_lib/privateReset.js';

export function onRequest({ env, request, params }) {
  return privateEncryptionReset({ env, request, orgId: String(params?.orgId || '') });
}
