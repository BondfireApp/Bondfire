import {makeSubmissionRecipient} from '../../shared/privateSubmission.js';
import {KEY_SCOPES} from '../../shared/privateKeyScopes.js';
import {toB64} from './zk.js';
import { deviceKeyId } from '../../shared/privateContent.js';
import { api } from '../utils/api.js';
import { ensureDeviceKeypair, randomOrgKey, wrapForMember, cacheOrgKey, wrapOrgKeyForRecovery } from './zk.js';
import { encryptPrivate } from './privateCrypto.js';
import { cacheOrgName } from './orgIdentity.js';

// Keep private inputs on the device. Recovery and module selection commit with
// the organization, so a failed backup cannot leave an unrecoverable new org.
export async function createEncryptedOrg({name, passphrase, confirmation, modules}) {
  const clearName=String(name || '').trim();
  if(!clearName || passphrase.length < 20 || passphrase !== confirmation)
    throw new Error('Enter a name and matching recovery passphrases of at least 20 characters.');
  const device=await ensureDeviceKeypair(), key=randomOrgKey(), id=crypto.randomUUID();
  const scopeKeys=[],recipient=await makeSubmissionRecipient();
  for(const scope of KEY_SCOPES) {
    const scoped=scope==='viewer'?key:randomOrgKey();
    const {salt,iv,ct}=await wrapOrgKeyForRecovery(scoped,passphrase);
    scopeKeys.push({scope,check:await encryptPrivate(scoped,{scope,epoch:1},id,'scope-check/'+scope,id),archive:await encryptPrivate(scoped,{keys:{},...(scope==='admin'?{submissions:{1:recipient.privateKey}}:{}),...(scope==='viewer'?{legacy:toB64(key)}:{})},id,'scope-archive/'+scope,id),wrapped_key:await wrapForMember(scoped,device.pubJwk),recovery:{salt,iv,ct}});
  }
  const writingKey=key.slice();writingKey.epoch=1;
  const ciphertext=await encryptPrivate(writingKey,{name:clearName},id,'organization',id);
  const keyCheck=await encryptPrivate(key,{check:'bondfire-private-mode'},id,'key-check',id);
  const wrappedKey=await wrapForMember(key,device.pubJwk);
  const {salt,iv,ct}=await wrapOrgKeyForRecovery(key,passphrase);
  const result=await api('/api/orgs/create',{method:'POST',body:JSON.stringify({
    private_mode:true,id,ciphertext,keyCheck,wrappedKey,scopeKeys,submissionPublicKey:recipient.publicKey,
    device_id:await deviceKeyId(device.pubJwk),recovery:{salt,iv,ct},
    ...(modules===undefined?{}:{enabled_modules:modules}),
  })});
  cacheOrgKey(id,key);
  cacheOrgName(id,clearName);
  if(result?.org) result.org={...result.org,name:clearName};
  return result;
}
