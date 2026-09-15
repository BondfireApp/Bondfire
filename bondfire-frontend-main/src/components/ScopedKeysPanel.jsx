import React from 'react';
import {api} from '../utils/api.js';
import {loadPrivateKey} from '../lib/privateCrypto.js';
import {rotateScopedKeys,saveScopedRecovery} from '../lib/privateKeyScopes.js';
export default function ScopedKeysPanel({orgId}) {
  const [state,setState]=React.useState(null),[pass,setPass]=React.useState(''),[again,setAgain]=React.useState(''),[busy,setBusy]=React.useState(false),[error,setError]=React.useState('');
  const refresh=async()=>{
    const privacy=await api(`/api/orgs/${encodeURIComponent(orgId)}/privacy`);
    if(privacy.state!=='enabled'){setState(null);return;}
    const info=await api(`/api/orgs/${encodeURIComponent(orgId)}/privacy/keys`);setState({...info,privacy});
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
  async function recovery(restore) {
    setBusy(true);setError('');
    try {
      if(pass!==again)throw new Error('Recovery passphrases must match.');
      await saveScopedRecovery(orgId,pass,api,{restore});setPass('');setAgain('');await refresh();
    }catch(e){setError(e.message);}finally{setBusy(false);}
  }
  if(!state)return error?<p role="alert">{error}</p>:null;
  return <section className="card" style={{padding:16,marginTop:16}}>
    <h2>Role-based encryption keys</h2>
    <p>{state.epoch?`Key version ${state.epoch}.`:'Separate reading, member, and administrator keys have not been enabled yet.'} {state.rotationRequired?'Membership or devices changed. Rotate keys before saving more private content.':''}</p>
    {<form onSubmit={rotate} style={{display:'grid',gap:8}}>
      <p>Rotation protects future writes and keeps older content readable for authorized members. People cannot lose knowledge of content they already decrypted. Save the new recovery passphrase; this replaces the scoped recovery backups.</p>
      <label>Recovery passphrase<input type="password" autoComplete="new-password" minLength={20} required value={pass} onChange={e=>setPass(e.target.value)} disabled={busy}/></label>
      <label>Confirm passphrase<input type="password" autoComplete="new-password" required value={again} onChange={e=>setAgain(e.target.value)} disabled={busy}/></label>
      {state.privacy.role==='owner'&&<button disabled={busy}>{busy?'Updating keys…':state.epoch?'Rotate encryption keys':'Enable role-based keys'}</button>}
      {!!state.epoch&&<><button type="button" disabled={busy} onClick={()=>recovery(false)}>Save my recovery backup</button><button type="button" disabled={busy} onClick={()=>recovery(true)}>Restore keys on this device</button></>}
    </form>}
    {error&&<p role="alert">{error}</p>}
  </section>;
}
