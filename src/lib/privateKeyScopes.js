import {makeSubmissionRecipient} from '../../shared/privateSubmission.js';
import {KEY_SCOPES,canReadScope} from '../../shared/privateKeyScopes.js';
import {deviceKeyId} from '../../shared/privateContent.js';
import {encryptPrivate,decryptPrivate} from './privateCrypto.js';
import {ensureDeviceKeypair,unwrapOrgKey,wrapForMember,randomOrgKey,fromB64,toB64,wrapOrgKeyForRecovery,unwrapOrgKeyFromRecovery} from './zk.js';

export async function loadScopedKeys(orgId,transport,passphrase) {
  const device=await ensureDeviceKeypair();
  const info=await transport(`/api/orgs/${encodeURIComponent(orgId)}/privacy/keys?device_id=${await deviceKeyId(device.pubJwk)}`);
  if(!info.epoch)return {info,key:null};
  const scopes={};let legacy;
  for(const row of info.keys) {
    let key;
    if(passphrase&&row.recovery)key=await unwrapOrgKeyFromRecovery(JSON.parse(row.recovery),passphrase);
    else if(row.wrapped_key)key=await unwrapOrgKey(row.wrapped_key);
    else if(row.recovery)throw new Error('This browser does not have the current scoped keys. Open Settings → Security → Role-based encryption keys and choose Restore keys on this device.');
    else throw new Error('This browser does not have the current scoped keys. An owner must provision this device in Security.');
    const check=await decryptPrivate(key,row.key_check,orgId,'scope-check/'+row.scope,orgId);
    if(check.scope!==row.scope||check.epoch!==info.epoch)throw new Error('Scoped key verification failed.');
    const archive=await decryptPrivate(key,row.archive,orgId,'scope-archive/'+row.scope,orgId);
    key.history=Object.fromEntries(Object.entries(archive.keys||{}).map(([epoch,bytes])=>[epoch,fromB64(bytes)]));
    key.epoch=info.epoch;key.submissions=archive.submissions||{};
    if(row.scope==='viewer'&&archive.legacy)legacy=fromB64(archive.legacy);
    scopes[row.scope]=key;
  }
  if(!scopes.viewer)throw new Error('Missing organization reading key.');
  const root=scopes.viewer;
  root.scopes=scopes;root.legacy=legacy;root.rotationRequired=info.rotationRequired;
  return {info,key:root};
}

export async function rotateScopedKeys(orgId,legacyKey,passphrase,transport) {
  if(String(passphrase||'').length<20)throw new Error('Use a recovery passphrase of at least 20 characters.');
  const {info,key:old}=await loadScopedKeys(orgId,transport);
  if(!info.roster)throw new Error('Only an owner can rotate organization keys.');
  const epoch=info.epoch+1,keys=[],recipient=await makeSubmissionRecipient();
  for(const scope of KEY_SCOPES) {
    const key=randomOrgKey(),previous=old?.scopes[scope];
    const history=Object.fromEntries(Object.entries(previous?.history||{}).map(([version,bytes])=>[version,toB64(bytes)]));
    if(previous)history[previous.epoch]=toB64(previous);
    const archive={keys:history,...(scope==='admin'?{submissions:{...(previous?.submissions||{}),[epoch]:recipient.privateKey}}:{}),...(scope==='viewer'?{legacy:toB64(old?.legacy||legacyKey)}:{})};
    const check=await encryptPrivate(key,{scope,epoch},orgId,'scope-check/'+scope,orgId);
    const sealed=await encryptPrivate(key,archive,orgId,'scope-archive/'+scope,orgId);
    const wraps=[];
    for(const recipient of info.roster.filter(r=>r.device_id&&canReadScope(r.role,scope)))wraps.push({user_id:recipient.user_id,device_id:recipient.device_id,wrapped_key:await wrapForMember(key,JSON.parse(recipient.public_key))});
    const {salt,iv,ct}=await wrapOrgKeyForRecovery(key,passphrase);
    keys.push({scope,check,archive:sealed,wraps,recovery:{salt,iv,ct}});
  }
  await transport(`/api/orgs/${encodeURIComponent(orgId)}/privacy/keys`,{method:'POST',body:JSON.stringify({epoch,rosterRevision:info.rosterRevision,keys,submissionPublicKey:recipient.publicKey})});
  window.dispatchEvent(new Event('bf-private-mode-changed'));
}

export async function saveScopedRecovery(orgId,passphrase,transport,{restore=false}={}) {
  if(String(passphrase||'').length<20)throw new Error('Use a recovery passphrase of at least 20 characters.');
  const {info,key}=await loadScopedKeys(orgId,transport,restore?passphrase:undefined);
  if(!key)throw new Error('Role-based keys have not been enabled.');
  const device=await ensureDeviceKeypair(),keys=[];
  for(const [scope,raw] of Object.entries(key.scopes)) {
    const {salt,iv,ct}=await wrapOrgKeyForRecovery(raw,passphrase);
    keys.push({scope,wrapped_key:await wrapForMember(raw,device.pubJwk),recovery:{salt,iv,ct}});
  }
  await transport(`/api/orgs/${encodeURIComponent(orgId)}/privacy/keys/device`,{method:'POST',body:JSON.stringify({epoch:info.epoch,device_id:await deviceKeyId(device.pubJwk),keys})});
}
