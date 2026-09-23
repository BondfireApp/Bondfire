import React from 'react';
import {api} from '../utils/api.js';
import {ensureDeviceKeypair,wrapForMember} from '../lib/zk.js';
import {deviceKeyId} from '../../shared/privateContent.js';
import {loadScopedKeys} from '../lib/privateKeyScopes.js';
import {readCachedOrgName} from '../lib/orgIdentity.js';

export default function DeviceApprovalInbox(){
  const [requests,setRequests]=React.useState([]),[error,setError]=React.useState(''),[busy,setBusy]=React.useState(false);
  React.useEffect(()=>{
    let stopped=false,timer;
    async function poll(){
      try{
        const {requests:rows=[]}=await api('/api/auth/device-approvals');
        if(!rows.length){if(!stopped)setRequests([]);return;}
        const device=await ensureDeviceKeypair({register:false}),id=await deviceKeyId(device.pubJwk),ready=[];
        for(const row of rows){
          if(row.device_id===id)continue;
          try{const {info,key}=await loadScopedKeys(row.org_id,api);if(key&&info.epoch===row.epoch)ready.push(row);}catch{}
        }
        if(!stopped)setRequests(ready);
      }catch{}finally{if(!stopped)timer=setTimeout(poll,8000);}
    }
    poll();return()=>{stopped=true;clearTimeout(timer);};
  },[]);
  async function respond(row,approve){
    setBusy(true);setError('');
    try{
      const base=`/api/orgs/${encodeURIComponent(row.org_id)}/privacy/keys`;
      if(approve){
        const {info,key}=await loadScopedKeys(row.org_id,api);
        if(!key||info.epoch!==row.epoch||info.userId!==row.user_id)throw new Error('This request is no longer valid. Send a new request from the other device.');
        const pub=JSON.parse(row.public_key),keys=[];
        if(await deviceKeyId(pub)!==row.device_id)throw new Error('Invalid device request.');
        for(const [scope,raw] of Object.entries(key.scopes))keys.push({scope,wrapped_key:await wrapForMember(raw,pub)});
        await api(base+'/device',{method:'POST',body:JSON.stringify({approval_id:row.id,epoch:info.epoch,device_id:row.device_id,device_public_key:pub,keys})});
      }else await api(base+'/approvals',{method:'POST',body:JSON.stringify({action:'deny',id:row.id})});
      setRequests(current=>current.filter(item=>item.id!==row.id));
    }catch(e){setError(e.message);}finally{setBusy(false);}
  }
  const row=requests[0];
  if(!row)return null;
  return <section role="dialog" aria-modal="false" aria-labelledby="device-approval-heading" style={{position:'fixed',bottom:16,right:16,width:'min(420px, calc(100vw - 32px))',boxSizing:'border-box',padding:20,background:'#171717',color:'#fff',border:'2px solid #e6a23c',borderRadius:12,zIndex:10000,boxShadow:'0 8px 32px #0008'}}>
    <h2 id="device-approval-heading" style={{marginTop:0}}>Approve your new device?</h2>
    <p><strong>{row.label}</strong> is requesting access to {readCachedOrgName(row.org_id)||'an encrypted organization'} using your account.</p>
    <p>Only approve if you just requested this. Check that both devices show <strong>{row.id.slice(0,8).toUpperCase()}</strong>.</p>
    <div style={{display:'flex',gap:12,flexWrap:'wrap'}}>
      <button className="btn-red" disabled={busy} onClick={()=>respond(row,true)}>Approve</button>
      <button className="btn" disabled={busy} onClick={()=>respond(row,false)}>Deny</button>
    </div>
    {error&&<p role="alert">{error}</p>}
  </section>;
}
