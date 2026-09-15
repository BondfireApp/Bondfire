import { deviceKeyId } from '../../shared/privateContent.js';
import React from 'react';
import { api } from '../utils/api.js';
import { encryptPrivate, decryptPrivate, loadPrivateKey } from '../lib/privateCrypto.js';
import { decodeLegacyRecord, uploadPayload } from '../lib/privateClient.js';
import { PRIVATE_CONTENT } from '../../shared/privateContent.js';
import { ensureDeviceKeypair, randomOrgKey, wrapForMember, unwrapOrgKey, cacheOrgKey, getCachedOrgKey, decryptWithOrgKey, wrapOrgKeyForRecovery, saveRecoveryToServer } from '../lib/zk.js';

export default function PrivateStoragePanel({orgId}) {
  const [status,setStatus]=React.useState(null),[busy,setBusy]=React.useState(false),[message,setMessage]=React.useState(''),[passphrase,setPassphrase]=React.useState(''),[confirm,setConfirm]=React.useState('');
  const base=`/api/orgs/${encodeURIComponent(orgId)}/privacy`;
  async function refresh() {
    const s=await api(base); const full=s.role==='owner'?await api(base+'?audit=1'):s;setStatus(full);return full;
  }
  React.useEffect(()=>{refresh().catch(e=>setMessage(e.message));},[orgId]);
  async function prepareKey() {
    const device=await ensureDeviceKeypair();
    const info=await api(`/api/orgs/${encodeURIComponent(orgId)}/crypto?device_id=${await deviceKeyId(device.pubJwk)}`);
    if(info.wrapped_key) {
      try {const key=await unwrapOrgKey(info.wrapped_key);cacheOrgKey(orgId,key);return key;}
      catch { const cached=getCachedOrgKey(orgId);if(cached)return cached;throw new Error('Restore the existing organization key first. Creating another key would lose access to existing encrypted data.'); }
    }
    const members=await api(`/api/orgs/${encodeURIComponent(orgId)}/members`);
    if(info.has_org_key) throw new Error('An administrator must share the existing key with this device before conversion.');
    const key=randomOrgKey(),wraps=[];
    for(const m of members.members||[]) for(const d of m.devices?.length?m.devices:[{public_key:m.public_key}]) {
      if(d.public_key)wraps.push({user_id:m.user_id,wrapped_key:await wrapForMember(key,JSON.parse(d.public_key)),...(d.device_id?{device_id:d.device_id}:{})});
    }
    if(!wraps.some(w=>w.user_id===status.userId)) throw new Error('Register this device key before starting.');
    await api(`/api/orgs/${encodeURIComponent(orgId)}/crypto`,{method:'POST',body:JSON.stringify({wrapped_keys:wraps})});
    cacheOrgKey(orgId,key);return key;
  }
  async function convert() {
    setBusy(true);setMessage('Checking migration requirements…');
    try {
      const current=await refresh();
      if(current.inventory?.blockers?.length) throw new Error('Conversion is blocked by the data listed below. Nothing has been removed.');
      let key;
      if(current.state==='off') {
        if(passphrase.length<20 || passphrase!==confirm) throw new Error('Use a separate recovery passphrase of at least 20 characters and confirm it. Keep it somewhere safe.');
        key=await prepareKey();
        await saveRecoveryToServer(orgId,await wrapOrgKeyForRecovery(key,passphrase));
        const keyCheck=await encryptPrivate(key,{check:'bondfire-private-mode'},orgId,'key-check',orgId);
        await api(base+'/begin',{method:'POST',body:JSON.stringify({keyCheck})});
        setPassphrase('');setConfirm('');
      } else key=await loadPrivateKey(orgId,current,api);
      cacheOrgKey(orgId,key);
      const inventory=(await api(base+'?audit=1')).inventory;
      for(const table of inventory.tables) {
        while(true) {
          const page=await api(base+'/source?kind='+encodeURIComponent(table.kind));
          if(!page.records.length) break;
          for(const {row,sourceHash} of page.records) {
            setMessage(`Encrypting ${table.kind} on this device…`);
            let clear=await decodeLegacyRecord(key,table.kind,row);
            let payloadId;
            if(table.kind==='drive/files') {
              const original=(await api(base+'/source-file?id='+encodeURIComponent(row.id))).file;
              let bytes;
              if(row.encrypted || row.mime==='application/vnd.bondfire.zk-file') {
                const {decryptDriveBytesString}=await import('../lib/driveZk.js');
                const text=original.textContent||await (await fetch(original.dataUrl)).text();
                bytes=await decryptDriveBytesString(orgId,text);
              } else if(original.dataUrl) bytes=new Uint8Array(await (await fetch(original.dataUrl)).arrayBuffer());
              else bytes=new TextEncoder().encode(original.textContent||'');
              payloadId=await uploadPayload(key,orgId,bytes,api,row.id);clear.payloadId=payloadId;
            }
            for(const field of ['encrypted_blob','encrypted_notes','encrypted_description','storage_key','encryptedBlob']) delete clear[field];
            const ciphertext=await encryptPrivate(key,clear,orgId,table.kind,row.id);
            const verified=await decryptPrivate(key,ciphertext,orgId,table.kind,row.id);
            if(JSON.stringify(verified)!==JSON.stringify(clear)) throw new Error('Local encryption verification failed.');
            await api(base+'/record',{method:'POST',body:JSON.stringify({kind:table.kind,id:row.id,sourceHash,ciphertext,...(payloadId?{payloadId}:{})})});
          }
        }
      }
      setMessage('Checking remaining data and removing migrated file originals…');
      await api(base+'/finish',{method:'POST',body:'{}'});
      await refresh();setMessage('Member-only encrypted mode is active. Content is decrypted on authorized member devices.');
      window.dispatchEvent(new Event('bf-private-mode-changed'));
    } catch(e) {setMessage(e.message||'Conversion stopped. Resume here after resolving the error.');await refresh().catch(()=>{});}
    finally {setBusy(false);}
  }
  return <section style={{marginTop:16,padding:16,border:'1px solid #555',borderRadius:12}}>
    <h3>Member-only encrypted organization</h3>
    <p>Encrypt content on member devices before upload. The server stores ciphertext, without the content key. Public pages, public submissions, external chat, and server-side publishing are unavailable in this mode.</p>
    <p>Server-visible metadata still includes accounts, memberships, roles, enabled modules, record identifiers, timestamps, traffic, and ciphertext sizes. This is content privacy, not anonymity. Previously published content and provider backups cannot be recalled by conversion.</p>
    <p><strong>Status: {status?.state==='enabled'?'Encrypted mode active':status?.state==='migrating'?'Conversion incomplete — content writes paused':status?'Not converted':'Checking…'}</strong></p>
    {status?.role==='owner'&&status?.state!=='enabled'?<>
      <p>Conversion preserves supported records, verifies encryption locally, and removes their readable active-storage copies. Keep the existing key and recovery passphrase. Do not close this tab while conversion is running; interrupted work can be resumed.</p>
      {!!status?.inventory?.blockers?.length&&<div role="alert"><p>These records require migration support before conversion can begin:</p><ul>{status.inventory.blockers.map((b,i)=><li key={i}>{b.table}: {b.count} — {b.reason}</li>)}</ul></div>}
      {status?.state==='off'&&<div style={{display:'grid',gap:8,maxWidth:520}}>
        <label>Separate encryption recovery passphrase<input type="password" autoComplete="new-password" value={passphrase} onChange={e=>setPassphrase(e.target.value)} disabled={busy}/></label>
        <label>Confirm recovery passphrase<input type="password" autoComplete="new-password" value={confirm} onChange={e=>setConfirm(e.target.value)} disabled={busy}/></label>
      </div>}
      <button disabled={busy||!!status?.inventory?.blockers?.length} onClick={convert}>{busy?'Encrypting…':status?.state==='migrating'?'Resume encrypted conversion':'Encrypt and switch to member-only mode'}</button>
    </>:null}
    <button disabled={busy} onClick={()=>refresh().catch(e=>setMessage(e.message))}>Refresh privacy status</button>
    {message&&<p role="status">{message}</p>}
  </section>;
}
