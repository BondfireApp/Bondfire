import { isDemoMode } from '../demo/demoMode.js';
import React from 'react';
import { Link, Navigate, useLocation, useParams } from 'react-router-dom';
import { api } from '../utils/api.js';
import { loadOrgIdentity } from '../lib/orgIdentity.js';
import Settings from '../pages/Settings.jsx';

export default function PrivateOrgBoundary({children}) {
  const {orgId}=useParams(),location=useLocation();
  const [state,setState]=React.useState(null),[error,setError]=React.useState('');

  React.useEffect(()=>{
    if(isDemoMode()){setState({state:"off",orgId,rotationRequired:false});return;}
    let live=true;
    const refresh=async()=>{
      try {
        const privacy=await api(`/api/orgs/${encodeURIComponent(orgId)}/privacy`);
        let rotationRequired=false;
        if(privacy?.state==='enabled') {
          try {
            const keys=await api(`/api/orgs/${encodeURIComponent(orgId)}/privacy/keys?device_id=`);
            rotationRequired=!!keys?.rotationRequired;
          } catch {}
          try { await loadOrgIdentity(orgId); } catch {}
        }
        if(!live)return;
        setState({...privacy,orgId,rotationRequired});
        setError('');
      } catch(e) {
        if(live)setError(e.message);
      }
    };
    refresh();
    window.addEventListener('bf-private-mode-changed',refresh);
    window.addEventListener('bf-auth-changed',refresh);
    return()=>{
      live=false;
      window.removeEventListener('bf-private-mode-changed',refresh);
      window.removeEventListener('bf-auth-changed',refresh);
    };
  },[orgId]);

  if(error)return <p role="alert">Cannot verify organization privacy settings: {error}</p>;
  if(!state||state.orgId!==orgId)return <p>Checking organization privacy…</p>;
  if(state.state==='off')return children;

  const prefix=`/org/${encodeURIComponent(orgId)}`;
  const tail=location.pathname.slice(prefix.length).replace(/^\//,'');
  const maintenanceBanner=state.rotationRequired ? (
    <div role="alert" style={{margin:'12px auto',maxWidth:1100,padding:'12px 14px',border:'1px solid #d97706',borderRadius:10,background:'rgba(120,53,15,.22)',color:'#fde68a'}}>
      <div style={{fontWeight:800,marginBottom:4}}>Encrypted writes are paused for this organization.</div>
      <div style={{marginBottom:8}}>Membership or role changed, so Bondfire requires one owner key rotation before any private module can save again. This is organization-wide, not a problem with the module you are using.</div>
      {state.role==='owner'
        ? <Link className="btn" to={prefix+'/settings?tab=security'}>Rotate encryption keys</Link>
        : <div>An organization owner needs to rotate the encryption keys in Settings → Security.</div>}
    </div>
  ) : null;
  const withMaintenance=(node)=><>{maintenanceBanner}{node}</>;

  if(tail==='settings') {
    const tab=new URLSearchParams(location.search).get('tab');
    if(!['security','members','profile','invites','pledges','public','public-inbox','newsletter'].includes(tab))return <Navigate to={prefix+'/settings?tab=security'} replace/>;
    return withMaintenance(<Settings privateMode/>);
  }
  if(state.state==='migrating')return <Navigate to={prefix+'/settings?tab=security'} replace/>;
  if(!tail||tail==='overview')return withMaintenance(children);
  if(tail==='intake')return <Navigate to={prefix+'/settings?tab=public-inbox'} replace/>;
  if(tail==='pledges')return <Navigate to={prefix+'/settings?tab=pledges'} replace/>;
  if(/^(public|build|needs|inventory|people|meetings|events|drive|witness|chat|chat-module|studio|colophon|tasks|working-groups|decisions|cases|treasury)(\/|$)/.test(tail))return withMaintenance(children);
  return withMaintenance(<main style={{padding:24}}><h2>Unavailable in member-only mode</h2><p>This feature has not been connected to member-only encrypted storage. It cannot send or process readable organization content here.</p><Link to={prefix}>Return to private organization</Link></main>);
}
