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
    if(isDemoMode()){setState({state:"off",orgId});return;}
    let live=true;
    const refresh=()=>api(`/api/orgs/${encodeURIComponent(orgId)}/privacy`).then(async s=>{
      if(!live)return;
      setState({...s,orgId});
      setError('');
      if(s?.state==='enabled') {
        try { await loadOrgIdentity(orgId); } catch {}
      }
    }).catch(e=>{if(live)setError(e.message);});
    refresh();window.addEventListener('bf-private-mode-changed',refresh);
    return()=>{live=false;window.removeEventListener('bf-private-mode-changed',refresh);};
  },[orgId]);
  if(error)return <p role="alert">Cannot verify organization privacy settings: {error}</p>;
  if(!state||state.orgId!==orgId)return <p>Checking organization privacy…</p>;
  if(state.state==='off')return children;
  const prefix=`/org/${encodeURIComponent(orgId)}`, tail=location.pathname.slice(prefix.length).replace(/^\//,'');
  if(tail==='settings') {
    const tab=new URLSearchParams(location.search).get('tab');
    if(!['security','members','invites','pledges','public','public-inbox','newsletter'].includes(tab))return <Navigate to={prefix+'/settings?tab=security'} replace/>;
    return <Settings privateMode/>;
  }
  if(state.state==='migrating')return <Navigate to={prefix+'/settings?tab=security'} replace/>;
  if(!tail||tail==='overview')return children;
  if(tail==='intake')return <Navigate to={prefix+'/settings?tab=public-inbox'} replace/>;
  if(tail==='pledges')return <Navigate to={prefix+'/settings?tab=pledges'} replace/>;
  if(/^(public|build|needs|inventory|people|meetings|events|drive|witness|chat|chat-module|studio|colophon)(\/|$)/.test(tail))return children;
  return <main style={{padding:24}}><h2>Unavailable in member-only mode</h2><p>This feature has not been connected to member-only encrypted storage. It cannot send or process readable organization content here.</p><Link to={prefix}>Return to private organization</Link></main>;
}
