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
  const [deviceRequest,setDeviceRequest]=React.useState('');
  const [deviceMessage,setDeviceMessage]=React.useState('');
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
    const device=await ensureDeviceKeypair({register:false});
    const id=await deviceKeyId(device.pubJwk);
    const info=await api(`/api/orgs/${encodeURIComponent(orgId)}/privacy/keys?device_id=${encodeURIComponent(id)}`);
    setState({...info,privacy,deviceId:id});
  };

  React.useEffect(()=>{
    setResetName(readCachedOrgName(orgId));
    setResetOpen(false);
    setResetInventory(null);
    setDeviceRequest('');setDeviceMessage('');
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

  async function requestDevice() {
    setBusy(true);setError('');setDeviceMessage('');
    try{
      const device=await ensureDeviceKeypair({register:false});
      const label=/Android/i.test(navigator.userAgent)?'Android browser':/iPhone|iPad/i.test(navigator.userAgent)?'iPhone or iPad browser':'Another browser';
      const result=await api(`/api/orgs/${encodeURIComponent(orgId)}/privacy/keys/approvals`,{method:'POST',body:JSON.stringify({action:'request',publicKey:device.pubJwk,label})});
      setDeviceRequest(result.request);
    }catch(e){setError(e.message);}finally{setBusy(false);}
  }

  React.useEffect(()=>{
    if(!deviceRequest?.id)return;
    let stopped=false,timer;
    async function poll(){
      try{
        const result=await api(`/api/orgs/${encodeURIComponent(orgId)}/privacy/keys/approvals?id=${encodeURIComponent(deviceRequest.id)}`);
        if(stopped)return;
        if(result.request.status==='approved'){
          await loadPrivateKey(orgId,state.privacy,api);
          if(stopped)return;
          setDeviceRequest('');await refresh();window.dispatchEvent(new Event('bf-private-mode-changed'));
          setDeviceMessage('Approved. This browser is unlocked. You can return to Drive.');return;
        }
        if(['denied','expired'].includes(result.request.status)){
          setDeviceMessage(result.request.status==='denied'?'Request denied. You can send a new request.':'Request expired. Send a new request when your working device is available.');setDeviceRequest('');return;
        }
      }catch(e){if(!stopped)setError(e.message);}
      if(!stopped)timer=setTimeout(poll,3000);
    }
    poll();return()=>{stopped=true;clearTimeout(timer);};
  },[deviceRequest?.id,orgId]);

  async function checkApproval() {
    setBusy(true);setError('');
    try{
      await loadPrivateKey(orgId,state.privacy,api);
      await refresh();window.dispatchEvent(new Event('bf-private-mode-changed'));
      setDeviceMessage('This browser is ready. You can return to Drive.');
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
      window.dispatchEvent(new Event('bf-private-mode-changed'));
      window.location.reload();
    }catch(e){setError(e.message);}finally{setBusy(false);}
  }

  if(!state)return error?<p role="alert">{error}</p>:null;
  const readableKeys=Array.isArray(state.keys)?state.keys:[];
  const missingCurrentDevice=!!state.epoch&&readableKeys.some(row=>!row.wrapped_key);
  const recoveryAvailable=readableKeys.length>0&&readableKeys.every(row=>!!row.recovery);
  const canReset=state.privacy.role==='owner'&&missingCurrentDevice;

  return <section className="card" style={{padding:16,marginTop:16}} aria-labelledby="scoped-keys-title">
    <h2 id="scoped-keys-title" style={{marginTop:0}}>Encryption keys & recovery</h2>
    <p>These are the organization’s current private-content keys. Bondfire separates access into three scopes so members receive only the keys their role can use.</p>
    <ul>
      <li><strong>Reader key:</strong> ordinary private organization content.</li>
      <li><strong>Member key:</strong> member-level protected content in addition to reader access.</li>
      <li><strong>Administrator key:</strong> admin-only material such as private intake, newsletter settings, and private publication configuration.</li>
    </ul>
    <p><strong>{state.epoch?`Key version ${state.epoch}.`:'Role-based keys have not been enabled yet.'}</strong> {state.rotationRequired?'Membership or role changed. An owner must rotate keys before new private writes can continue.':''}</p>

    {missingCurrentDevice&&<div role="alert" style={{padding:12,border:'1px solid #d97706',borderRadius:8,marginBottom:12}}>
      <strong>This browser does not have the current organization keys.</strong>
      <p>Signing in through Sabot connects your account. A new browser also needs approval to open encrypted content.</p>
      <h3>Don’t have your recovery passphrase?</h3>
      <p>Send an approval request to your working device. Keep Bondfire open there, signed in to the same account. An Approve / Deny prompt will appear automatically; you do not need to open Security settings.</p>
      <button className="btn" type="button" disabled={busy||!!deviceRequest} onClick={requestDevice}>{deviceRequest?'Request sent':'Send approval request'}</button>
      {deviceRequest&&<div role="status" style={{marginTop:12}}>
        <p>Waiting for your other device. Match this code before approving: <strong>{deviceRequest.id.slice(0,8).toUpperCase()}</strong>.</p>
        <p>This phone will unlock automatically after approval. The request expires after 15 minutes. If the other device is closed or offline, open Bondfire there to receive it.</p>
        <button className="btn" type="button" disabled={busy} onClick={checkApproval}>Check now</button>
      </div>}
      <p>If no other browser has access, you will need the recovery passphrase. Signing in alone cannot decrypt these files.</p>
      <p style={{marginBottom:8}}>If you know the recovery passphrase, restore the existing keys to this browser. This does not rotate or replace them.</p>
      {recoveryAvailable?<>
        <label style={{display:'grid',gap:6,maxWidth:520}}>Recovery passphrase<input className="input" type="password" autoComplete="current-password" minLength={20} value={restorePass} onChange={e=>setRestorePass(e.target.value)} disabled={busy}/></label>
        <button className="btn-red" type="button" disabled={busy||restorePass.length<20} onClick={restoreCurrentDevice} style={{marginTop:8}}>{busy?'Restoring keys…':'Restore keys on this device'}</button>
      </>:<p>No recovery copy is available for this account. Use device approval from another browser where this account can open Drive.</p>}
      {canReset&&<div style={{marginTop:12,paddingTop:12,borderTop:'1px solid rgba(217,119,6,.45)'}}>
        <p style={{margin:'0 0 8px'}}><strong>Lost the recovery passphrase?</strong> For a new single-member organization whose encrypted private records can be discarded, reset creates fresh keys without deleting the organization, modules, membership, domains, or published public copies.</p>
        {!resetOpen?<button className="btn" type="button" disabled={busy} onClick={openReset}>{busy?'Checking reset safety…':'Reset encryption…'}</button>:null}
      </div>}
    </div>}

    {resetOpen&&canReset&&<div style={{padding:14,border:'1px solid #b91c1c',borderRadius:8,marginBottom:14}}>
      <h3 style={{marginTop:0}}>Reset encryption</h3>
      <p><strong>This is destructive.</strong> It creates fresh organization keys and permanently discards the encrypted private records protected by the inaccessible keys. It does not delete the organization.</p>
      <p>Preserved: organization ID, membership, enabled modules, custom domains, and already-published public copies.</p>
      <p>
        Encrypted records to discard: <strong>{Number(resetInventory?.recordCount||0)}</strong>
        {Array.isArray(resetInventory?.records)&&resetInventory.records.length?` (${resetInventory.records.map(row=>`${row.kind}: ${row.count}`).join(', ')})`:''}.
        {' '}Encrypted file blobs: <strong>{Number(resetInventory?.blobCount||0)}</strong>. Members: <strong>{Number(resetInventory?.memberCount||0)}</strong>.
      </p>
      {resetInventory?.memberCount!==1?<p role="alert">Reset is blocked because this organization does not have exactly one member.</p>:null}
      {resetInventory?.blobCount?<p role="alert">Reset is blocked because encrypted file blobs exist. Use a key-holding device or owner recovery instead.</p>:null}
      <div style={{display:'grid',gap:8,maxWidth:560}}>
        <label>Organization name<input className="input" value={resetName} onChange={e=>setResetName(e.target.value)} disabled={busy}/></label>
        <label>New recovery passphrase<input className="input" type="password" autoComplete="new-password" minLength={20} value={resetPass} onChange={e=>setResetPass(e.target.value)} disabled={busy}/></label>
        <label>Confirm new recovery passphrase<input className="input" type="password" autoComplete="new-password" minLength={20} value={resetAgain} onChange={e=>setResetAgain(e.target.value)} disabled={busy}/></label>
        <label>Type <strong>RESET ENCRYPTION</strong><input className="input" value={resetConfirmation} onChange={e=>setResetConfirmation(e.target.value)} disabled={busy}/></label>
      </div>
      <div style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:10}}>
        <button className="btn-red" type="button" disabled={busy||resetInventory?.memberCount!==1||!!resetInventory?.blobCount||resetPass.length<20||resetPass!==resetAgain||resetConfirmation!=='RESET ENCRYPTION'||!resetName.trim()} onClick={performReset}>{busy?'Resetting encryption…':'Reset encryption and create new keys'}</button>
        <button className="btn" type="button" disabled={busy} onClick={()=>{setResetOpen(false);setResetPass('');setResetAgain('');setResetConfirmation('');}}>Cancel</button>
      </div>
    </div>}

    {!missingCurrentDevice&&!!state.epoch&&<p>Requests from your other devices appear automatically while Bondfire is open. Choose Approve only when you recognize the request and its matching code.</p>}
    {deviceMessage&&<p role="status">{deviceMessage}</p>}
    {!missingCurrentDevice&&<form onSubmit={rotate} style={{display:'grid',gap:8}}>
      <h3 style={{marginBottom:0}}>Key maintenance</h3>
      <p style={{marginTop:0}}>Rotation creates new keys for future writes and retains encrypted key history so authorized members can still read older records. Saving a recovery backup keeps the current keys but protects a recovery copy with the passphrase you choose.</p>
      <label>New recovery passphrase<input className="input" type="password" autoComplete="new-password" minLength={20} required value={pass} onChange={e=>setPass(e.target.value)} disabled={busy}/></label>
      <label>Confirm passphrase<input className="input" type="password" autoComplete="new-password" minLength={20} required value={again} onChange={e=>setAgain(e.target.value)} disabled={busy}/></label>
      <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
        {state.privacy.role==='owner'&&<button className="btn-red" disabled={busy}>{busy?'Updating keys…':state.epoch?'Rotate encryption keys':'Enable role-based keys'}</button>}
        {!!state.epoch&&<button className="btn" type="button" disabled={busy||pass.length<20||pass!==again} onClick={saveRecovery}>Save my recovery backup</button>}
      </div>
    </form>}
    {error&&<p role="alert">{error}</p>}
  </section>;
}
