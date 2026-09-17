import { api } from '../utils/api.js';
import { KEY_SCOPES, canReadScope } from '../../shared/privateKeyScopes.js';
import { deviceKeyId } from '../../shared/privateContent.js';
import { makeSubmissionRecipient } from '../../shared/privateSubmission.js';
import { encryptPrivate } from './privateCrypto.js';
import { cacheOrgName } from './orgIdentity.js';
import {
  cacheOrgKey,
  ensureDeviceKeypair,
  randomOrgKey,
  toB64,
  wrapForMember,
  wrapOrgKeyForRecovery,
} from './zk.js';

const RESET_CONFIRMATION = 'RESET ENCRYPTION';

function parsePublicKey(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch { return null; }
  }
  return value;
}

function recoveryPayload(payload) {
  const { salt, iv, ct } = payload || {};
  return { salt, iv, ct };
}

export async function fetchPrivateEncryptionResetInventory(orgId) {
  return api(`/api/orgs/${encodeURIComponent(orgId)}/privacy/reset`, { method: 'GET' });
}

export async function resetPrivateEncryption({ orgId, name, passphrase }) {
  const clearName = String(name || '').trim();
  if (!clearName) throw new Error('Enter the organization name to keep after the reset.');
  if (String(passphrase || '').length < 20) throw new Error('Use a new recovery passphrase of at least 20 characters.');

  const device = await ensureDeviceKeypair();
  const currentDeviceId = await deviceKeyId(device.pubJwk);
  const keyState = await api(`/api/orgs/${encodeURIComponent(orgId)}/privacy/keys?device_id=${encodeURIComponent(currentDeviceId)}`);
  if (!Array.isArray(keyState?.roster) || !keyState.roster.length) throw new Error('The organization device roster is unavailable.');

  const roster = keyState.roster
    .filter((row) => row?.device_id && row?.public_key)
    .map((row) => ({ ...row, publicJwk: parsePublicKey(row.public_key) }))
    .filter((row) => row.publicJwk);
  if (!roster.length) throw new Error('No registered organization devices are available for the new keys.');
  if (!roster.some((row) => String(row.device_id) === currentDeviceId)) throw new Error('This browser must be registered before encryption can be reset.');

  const rootKey = randomOrgKey();
  const recipient = await makeSubmissionRecipient();
  const scopeKeys = [];

  for (const scope of KEY_SCOPES) {
    const scopedKey = scope === 'viewer' ? rootKey : randomOrgKey();
    const archive = {
      keys: {},
      ...(scope === 'admin' ? { submissions: { 1: recipient.privateKey } } : {}),
      ...(scope === 'viewer' ? { legacy: toB64(rootKey) } : {}),
    };
    const check = await encryptPrivate(scopedKey, { scope, epoch: 1 }, orgId, `scope-check/${scope}`, orgId);
    const sealedArchive = await encryptPrivate(scopedKey, archive, orgId, `scope-archive/${scope}`, orgId);
    const wraps = [];
    for (const row of roster.filter((entry) => canReadScope(entry.role, scope))) {
      wraps.push({
        user_id: row.user_id,
        device_id: row.device_id,
        wrapped_key: await wrapForMember(scopedKey, row.publicJwk),
      });
    }
    scopeKeys.push({
      scope,
      check,
      archive: sealedArchive,
      wraps,
      recovery: recoveryPayload(await wrapOrgKeyForRecovery(scopedKey, passphrase)),
    });
  }

  const rootForWrites = rootKey.slice();
  rootForWrites.epoch = 1;
  const ciphertext = await encryptPrivate(rootForWrites, { name: clearName }, orgId, 'organization', orgId);
  const keyCheck = await encryptPrivate(rootKey, { check: 'bondfire-private-mode' }, orgId, 'key-check', orgId);
  const wrappedKey = await wrapForMember(rootKey, device.pubJwk);
  const recovery = recoveryPayload(await wrapOrgKeyForRecovery(rootKey, passphrase));
  const deviceWraps = [];
  for (const row of roster) {
    deviceWraps.push({
      user_id: row.user_id,
      device_id: row.device_id,
      wrapped_key: await wrapForMember(rootKey, row.publicJwk),
    });
  }

  const result = await api(`/api/orgs/${encodeURIComponent(orgId)}/privacy/reset`, {
    method: 'POST',
    body: JSON.stringify({
      confirmation: RESET_CONFIRMATION,
      ciphertext,
      keyCheck,
      wrappedKey,
      device_id: currentDeviceId,
      deviceWraps,
      recovery,
      scopeKeys,
      submissionPublicKey: recipient.publicKey,
    }),
  });

  cacheOrgKey(orgId, rootKey);
  cacheOrgName(orgId, clearName);
  window.dispatchEvent(new Event('bf-private-mode-changed'));
  return result;
}
