import React from 'react';
import { useNavigate } from 'react-router-dom';
import { createEncryptedOrg } from '../lib/createEncryptedOrg.js';

export default function CreatePrivateOrg() {
  const navigate=useNavigate(),[open,setOpen]=React.useState(false),[name,setName]=React.useState(''),[pass,setPass]=React.useState(''),[again,setAgain]=React.useState(''),[busy,setBusy]=React.useState(false),[error,setError]=React.useState('');
  async function create(e) {
    e.preventDefault();setBusy(true);setError('');
    try {
      const result=await createEncryptedOrg({name,passphrase:pass,confirmation:again});
      navigate(`/org/${result.org.id}`);
    } catch(e) {setError(e.message);} finally {setBusy(false);}
  }
  if(!open)return <button type="button" onClick={()=>setOpen(true)}>Create a member-only encrypted org</button>;
  return <form onSubmit={create} style={{display:'grid',gap:8,marginTop:12}}>
    <p>The name and content are encrypted on this device before upload. This mode includes private records, Drive, events, and native chat. Public publishing and external integrations are unavailable. Account and membership metadata remain server-visible.</p>
    <label>Organization name<input required value={name} onChange={e=>setName(e.target.value)} disabled={busy}/></label>
    <label>Separate recovery passphrase<input required minLength={20} type="password" autoComplete="new-password" value={pass} onChange={e=>setPass(e.target.value)} disabled={busy}/></label>
    <label>Confirm recovery passphrase<input required type="password" autoComplete="new-password" value={again} onChange={e=>setAgain(e.target.value)} disabled={busy}/></label>
    <p>Keep the recovery passphrase somewhere safe. The server cannot recover it or decrypt your content.</p>
    <button disabled={busy}>{busy?'Creating encrypted organization…':'Create encrypted organization'}</button>
    {error&&<p role="alert">{error}</p>}
  </form>;
}
