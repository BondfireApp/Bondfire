import React from 'react';
import {api} from '../utils/api.js';
import {loadPrivateKey} from '../lib/privateCrypto.js';
import {rotateScopedKeys,saveScopedRecovery} from '../lib/privateKeyScopes.js';
import {ensureDeviceKeypair} from '../lib/zk.js';
import {deviceKeyId} from '../../shared/privateContent.js';

export default function ScopedKeysPanel({orgId}) {
  const [state,setState]=React.useState(null);
  const [pass,setPass]=React.useState('');
  const [again,setAgain]=React.useState('');
  const [restorePass,setRestorePass]=React.useState('');
  const [busy,setBusy]=React.useState(false);
  const [error,setError]=React.useState('');

  const refresh=async()=>{
    const privacy=await api(`/api/orgs/${encodeURIComponent(orgId)}/privacy`);
    if(privacy.state!=='enabled'){setState(null);return;}
    const device=await ensureDeviceKeypair();
    const id=await deviceKeyId(device.pubJwk);
    const info=await api(`/api/orgs/${encodeURIComponent(orgId)}/privacy/keys?device_id=${encodeURIComponent(id)}`);
    setState({...info,privacy,deviceId:id});
  };

  React.useEffect(()=>{refresh().catch(e=>setError(e.message));},[orgId]);

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

  if(!state)return error?<p role="alert">{error}</p>:null;
  const readableKeys=Array.isArray(state.keys)?state.keys:[];
  const missingCurrentDevice=!!state.epoch&&readableKeys.some(row=>!row.wrapped_key);
  const recoveryAvailable=readableKeys.length>0&&readableKeys.every(row=>!!row.recovery);

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
