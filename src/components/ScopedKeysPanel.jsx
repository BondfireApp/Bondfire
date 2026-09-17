import React from 'react';
import {api} from '../utils/api.js';
import {loadPrivateKey} from '../lib/privateCrypto.js';
import {rotateScopedKeys,saveScopedRecovery} from '../lib/privateKeyScopes.js';
import {ensureDeviceKeypair} from '../lib/zk.js';
import {deviceKeyId} from '../../shared/privateContent.js';
import {readCachedOrgName} from '../lib/orgIdentity.js';
import {fetchPrivateEncryptionResetInventory,resetPrivateEncryption} from '../lib/privateEncryptionReset.js';

export default function ScopedKeysPanel({orgId}) {
  const [state,setState]=React.useState(null);
  const [pass,setPass]=React.useState('');
  const [again,setAgain]=React.useState('');
  const [restorePass,setRestorePass]=React.useState('');
  const [busy,setBusy]=React.useState(false);
  const [error,setError]=React.useState('');
  const [resetOpen,setResetOpen]=React.useState(false);
  const [resetInventory,setResetInventory]=React.useState(null);
  const [resetName,setResetName]=React.useState(()=>readCachedOrgName(orgId));
  const [resetPass,setResetPass]=React.useState('');
  const [resetAgain,setResetAgain]=React.useState('');
  const [resetConfirmation,setResetConfirmation]=React.useState('');

  const refresh=async()=>{
    const privacy=await api(`/api/orgs/${encodeURIComponent(orgId)}/privacy`);
    if(privacy.state!=='enabled'){setState(null);return;}
    const device=await ensureDeviceKeypair();
    const id=await deviceKeyId(device.pubJwk);
    const info=await api(`/api/orgs/${encodeURIComponent(orgId)}/privacy/keys?device_id=${encodeURIComponent(id)}`);
    setState({...info,privacy,deviceId:id});
  };

  React.useEffect(()=>{
    setResetName(readCachedOrgName(orgId));
    setResetOpen(false);
    setResetInventory(null);
    refresh().catch(e=>setError(e.message));
  },[orgId]);

  async function rotate(e) {
    e.preventDefault();setBusy(true);setError('');
    try {
      if(pass!==again||pass.length<20)throw new Error('Enter matching recovery passphrases of at least 20 characters.');
      const key=await loadPrivateKey(orgId,state.privacy,api);
      await rotateScopedKeys(orgId,key.legacy||key,pass,api);
      setPass('');setAgain('');await refresh();
    }catch(e){setError(e.message);}finally{setBusy(false);}
  }

  async function saveRecovery() {
    setBusy(true);setError('');
    try {
      if(pass!==again||pass.length<20)throw new Error('Enter matching recovery passphrases of at least 20 characters.');
      await saveScopedRecovery(orgId,pass,api,{restore:false});
      setPass('');setAgain('');await refresh();
    }catch(e){setError(e.message);}finally{setBusy(false);}
  }

  async function restoreCurrentDevice() {
    setBusy(true);setError('');
    try {
      if(restorePass.length<20)throw new Error('Enter the recovery passphrase used for this organization.');
      await saveScopedRecovery(orgId,restorePass,api,{restore:true});
      setRestorePass('');await refresh();
      window.dispatchEvent(new Event('bf-private-mode-changed'));
    }catch(e){setError(e.message);}finally{setBusy(false);}
  }

  async function openReset() {
    setBusy(true);setError('');
    try {
      const result=await fetchPrivateEncryptionResetInventory(orgId);
      setResetInventory(result?.inventory||null);
      setResetName(readCachedOrgName(orgId)||resetName);
      setResetOpen(true);
    }catch(e){setError(e.message);}finally{setBusy(false);}
  }

  async function performReset() {
    setBusy(true);setError('');
    try {
      if(!resetName.trim())throw new Error('Enter the organization name to keep.');
      if(resetPass!==resetAgain||resetPass.length<20)throw new Error('Enter matching new recovery passphrases of at least 20 characters.');
      if(resetConfirmation!=='RESET ENCRYPTION')throw new Error('Type RESET ENCRYPTION exactly to confirm.');
      if(resetInventory?.memberCount!==1)throw new Error('Encryption reset is only available for a single-member organization.');
      if(resetInventory?.blobCount)throw new Error('This organization has encrypted files. Restore the old keys from another device instead of resetting.');
      const ok=window.confirm(`Reset encryption for ${resetName.trim()}? This permanently discards ${Number(resetInventory?.recordCount||0)} encrypted private record(s). The organization ID, membership, modules, domains, and already-published public copies stay in place.`);
      if(!ok)return;
      await resetPrivateEncryption({orgId,name:resetName,passphrase:resetPass});
      setResetPass('');setResetAgain('');setResetConfirmation('');setResetOpen(false);setResetInventory(null);
      await refresh();
      window.location.reload();
    }catch(e){setError(e.message);}finally{setBusy(false);}
  }

  if(!state)return error?<p role="alert">{error}</p>:null;
  const readableKeys=Array.isArray(state.keys)?state.keys:[];
  const missingCurrentDevice=!!state.epoch&&readableKeys.some(row=>!row.wrapped_key);
  const recoveryAvailable=readableKeys.length>0&&readableKeys.every(row=>!!row.recovery);
  const canReset=state.privacy.role==='owner'&&missingCurrentDevice;

  return <section className="card" style={{padding:16,marginTop:16}}>
    <h2>Role-based encryption keys</h2>
    <p>{state.epoch?`Key version ${state.epoch}.`:'Separate reading, member, and administrator keys have not been enabled yet.'} {state.rotationRequired?'Membership or devices changed. Rotate keys before saving more private content.':''}</p>

    {missingCurrentDevice&&<div role="alert" style={{padding:12,border:'1px solid #d97706',borderRadius:8,marginBottom:12}}>
      <strong>This browser is not provisioned for the current scoped keys.</strong>
      <p style={{marginBottom:8}}>Restore the existing keys with the recovery passphrase. This does not rotate or replace the organization keys.</p>
      {recoveryAvailable?<>
        <label style={{display:'grid',gap:6,maxWidth:520}}>Recovery passphrase<input type="password" autoComplete="current-password" minLength={20} value={restorePass} onChange={e=>setRestorePass(e.target.value)} disabled={busy}/></label>
        <button type="button" disabled={busy||restorePass.length<20} onClick={restoreCurrentDevice} style={{marginTop:8}}>{busy?'Restoring keys…':'Restore keys on this device'}</button>
      </>:<p>No recovery copy is available for this account. A key-holding owner must provision this device.</p>}
      {canReset&&<div style={{marginTop:12,paddingTop:12,borderTop:'1px solid rgba(217,119,6,.45)'}}>
        <p style={{margin:'0 0 8px'}}><strong>Lost the recovery passphrase?</strong> If this is a new single-member organization and you do not need its encrypted private records, you can replace the inaccessible encryption state without deleting the organization.</p>
        {!resetOpen?<button type="button" disabled={busy} onClick={openReset}>{busy?'Checking reset safety…':'Reset encryption…'}</button>:null}
      </div>}
    </div>}

    {resetOpen&&canReset&&<div style={{padding:14,border:'1px solid #b91c1c',borderRadius:8,marginBottom:14}}>
      <h3 style={{marginTop:0}}>Reset encryption</h3>
      <p><strong>This is destructive.</strong> It creates fresh organization keys and permanently discards the encrypted private records that the lost keys protected. It does not delete the organization.</p>
      <p>Preserved: organization ID, membership, enabled modules, custom domains, and already-published public copies.</p>
      <p>
        Encrypted records to discard: <strong>{Number(resetInventory?.recordCount||0)}</strong>
        {Array.isArray(resetInventory?.records)&&resetInventory.records.length?` (${resetInventory.records.map(row=>`${row.kind}: ${row.count}`).join(', ')})`:''}.
        {' '}Encrypted file blobs: <strong>{Number(resetInventory?.blobCount||0)}</strong>. Members: <strong>{Number(resetInventory?.memberCount||0)}</strong>.
      </p>
      {resetInventory?.memberCount!==1?<p role="alert">Reset is blocked because this organization has more than one member.</p>:null}
      {resetInventory?.blobCount?<p role="alert">Reset is blocked because encrypted file blobs exist. Use a key-holding device or owner recovery instead.</p>:null}
      <div style={{display:'grid',gap:8,maxWidth:560}}>
        <label>Organization name<input value={resetName} onChange={e=>setResetName(e.target.value)} disabled={busy}/></label>
        <label>New recovery passphrase<input type="password" autoComplete="new-password" minLength={20} value={resetPass} onChange={e=>setResetPass(e.target.value)} disabled={busy}/></label>
        <label>Confirm new recovery passphrase<input type="password" autoComplete="new-password" minLength={20} value={resetAgain} onChange={e=>setResetAgain(e.target.value)} disabled={busy}/></label>
        <label>Type <strong>RESET ENCRYPTION</strong><input value={resetConfirmation} onChange={e=>setResetConfirmation(e.target.value)} disabled={busy}/></label>
      </div>
      <div style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:10}}>
        <button type="button" disabled={busy||resetInventory?.memberCount!==1||!!resetInventory?.blobCount||resetPass.length<20||resetPass!==resetAgain||resetConfirmation!=='RESET ENCRYPTION'||!resetName.trim()} onClick={performReset}>{busy?'Resetting encryption…':'Reset encryption and create new keys'}</button>
        <button type="button" disabled={busy} onClick={()=>{setResetOpen(false);setResetPass('');setResetAgain('');setResetConfirmation('');}}>Cancel</button>
      </div>
    </div>}

    <form onSubmit={rotate} style={{display:'grid',gap:8}}>
      <p>Rotation protects future writes and keeps older content readable for authorized members. People cannot lose knowledge of content they already decrypted. Save the new recovery passphrase; this replaces the scoped recovery backups.</p>
      <label>Recovery passphrase<input type="password" autoComplete="new-password" minLength={20} required value={pass} onChange={e=>setPass(e.target.value)} disabled={busy}/></label>
      <label>Confirm passphrase<input type="password" autoComplete="new-password" minLength={20} required value={again} onChange={e=>setAgain(e.target.value)} disabled={busy}/></label>
      {state.privacy.role==='owner'&&<button disabled={busy}>{busy?'Updating keys…':state.epoch?'Rotate encryption keys':'Enable role-based keys'}</button>}
      {!!state.epoch&&!missingCurrentDevice&&<button type="button" disabled={busy} onClick={saveRecovery}>Save my recovery backup</button>}
    </form>
    {error&&<p role="alert">{error}</p>}
  </section>;
}
