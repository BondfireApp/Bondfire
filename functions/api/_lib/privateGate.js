import { getDb, requireOrgRole } from './auth.js';
import { bad, json } from './http.js';
import { getPrivateMode, privateRecords, storedRecord } from './privateStore.js';
import { privateProtocol } from './privateProtocol.js';
import { privateRoute } from '../../../shared/privateContent.js';
import { privateStudio } from './privateStudio.js';
import {publicPrivateResponse} from './privatePublication.js';
import { isOrgModuleEnabled } from './orgModules.js';
import { decorateDriveRecord } from './driveShares.js';

function isMembershipCiphertext(value) {
  if (typeof value !== 'string' || value.length < 24 || value.length > 1024 * 1024) return false;
  try {
    const parsed = JSON.parse(value);
    if (!parsed || parsed.v !== 1) return false;
    if (typeof parsed.iv !== 'string' || typeof parsed.ct !== 'string') return false;
    if (!/^[A-Za-z0-9_-]+$/.test(parsed.iv) || !/^[A-Za-z0-9_-]+$/.test(parsed.ct)) return false;
    if (parsed.iv.length !== 16 || parsed.ct.length < 16) return false;
    return Object.keys(parsed).every((key) => ['v', 'iv', 'ct'].includes(key));
  } catch {
    return false;
  }
}

// A deny-by-default route boundary is essential: new or old modules cannot
// silently bypass private storage by choosing another endpoint.
export async function privateRequestGate({env,request}) {
  const url=new URL(request.url), path=url.pathname;
  if(/^\/api\/orgs\/(create|index)\/?$/.test(path)) return null;
  const m=path.match(/^\/api\/orgs\/([^/]+)(?:\/(.*))?$/);
  if(!m) {
    const page=path.match(/^\/api\/(p|public)\/([^/]+)/);
    const form=path.match(/^\/api\/public\/forms\/([^/]+)/);
    if(form) return null;
    let orgId='';
    if(page&&env.BF_PUBLIC) orgId=await env.BF_PUBLIC.get(`slug:${decodeURIComponent(page[2])}`);
    if(orgId&&await getPrivateMode(env,orgId)) {
      // The Organization Page config is deliberately public and authoritative in BF_PUBLIC.
      // Private module content still flows through explicit public projections below.
      if(page?.[1]==='public' && /^\/api\/public\/[^/]+\/?$/.test(path)) return null;
      return publicPrivateResponse({env,request,orgId});
    }
    return null;
  }
  const orgId=decodeURIComponent(m[1]),route=(m[2]||'').replace(/\/+$/,'');
  if(route==='privacy'||route.startsWith('privacy/')) return privateProtocol({env,request,orgId,path:route.slice(8)});
  const mode=await getPrivateMode(env,orgId);
  if(!mode) return null;
  if(route==='newsletter/subscribe') return bad(404,'NOT_FOUND');
  // Newsletter delivery identity is intentionally server-readable operational
  // metadata because it is exposed in outgoing email headers. Private newsletter
  // content, subscriber data, and private settings remain encrypted.
  if(route==='newsletter/delivery') return null;
  if(/^emergency(?:\/|$)/.test(route)) return null;
  if(route==='crypto' && request.method==='GET') return null;
  if(route==='crypto' && request.method==='POST') {
    const b=await request.clone().json().catch(()=>({}));
    if(Object.keys(b).some(k=>k!=='wrapped_keys') || !Array.isArray(b.wrapped_keys) || b.wrapped_keys.some(w=>Object.keys(w).some(k=>!['user_id','wrapped_key','kid','device_id'].includes(k)))) return bad(409,'PRIVATE_KEY_REPLACEMENT_FORBIDDEN');
    return null;
  }
  if(/^zk\/(recovery|wrapped|status)$/.test(route)) return null;
  if(route==='members') {
    if(request.method==='GET' && !url.searchParams.has('plaintext')) return null;
    if(request.method==='DELETE') return null;
    if(request.method==='PUT') {
      const b=await request.clone().json().catch(()=>({}));
      const keys=Object.keys(b);
      const roleOnly=keys.length>0 && keys.every(k=>['userId','role'].includes(k));
      if(roleOnly) return null;

      const encryptedProfile=keys.length>0 && keys.every(k=>['userId','encrypted_blob','key_version'].includes(k));
      const validVersion=b.key_version===undefined || (Number.isInteger(Number(b.key_version)) && Number(b.key_version) > 0);
      if(encryptedProfile && b.userId && isMembershipCiphertext(b.encrypted_blob) && validVersion) return null;
    }
    return bad(409,'PRIVATE_MEMBERSHIP_FIELDS_FORBIDDEN');
  }
  if(route==='invites') {
    if(request.method==='GET') return null;
    const b=await request.clone().json().catch(()=>({}));
    if(Object.keys(b).every(k=>['code','role','maxUses','max_uses','expiresInDays'].includes(k))) return null;
    return bad(400,'PLAINTEXT_FIELDS_FORBIDDEN');
  }
  if(route==='modules') return null;
  // REC management is metadata-only and role-gated by its own handlers. The server never sees recovery phrases or recording plaintext.
  if(/^rec\/(claim|archive)$/.test(route)) return null;
  if(mode.state==='migrating') return bad(409,'PRIVATE_MIGRATION_IN_PROGRESS');
  if(route==='drive/shares'||route==='drive/forms-public') return null;
  // These endpoints only manage intentionally public configuration/hostnames.
  // Their own handlers still enforce org roles and write lockdown.
  if((route==='public/get'&&request.method==='GET')||(route==='public/save'&&request.method==='POST')||route==='public/publication'||route==='public/domains') return null;
  if((route==='colophon'||route.startsWith('colophon/')) && !(await isOrgModuleEnabled(env,orgId,'publishing-colophon'))) return bad(403,'MODULE_DISABLED',{moduleId:'publishing-colophon'});
  if(request.method!=='GET') {
    const db=getDb(env),table=await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='org_private_key_state'").first();
    if(table) {
      const keys=await db.prepare('SELECT epoch,roster_revision,rotated_revision FROM org_private_key_state WHERE org_id=?').bind(orgId).first();
      if(keys?.epoch&&keys.roster_revision!==keys.rotated_revision)return bad(409,'PRIVATE_KEY_ROTATION_REQUIRED');
    }
  }

  if(route==='studio/state')return privateStudio({env,request,orgId});
  if(/^studio\/(docs|blocks)(\/|$)/.test(route)&&request.method!=='GET')return bad(409,'USE_ATOMIC_STUDIO_STATE');
  if(route==='drive' && request.method==='GET') {
    const gate=await requireOrgRole({env,request,orgId,minRole:'viewer'}); if(!gate.ok) return gate.resp;
    const rows=await getDb(env).prepare("SELECT * FROM org_private_records WHERE org_id=? AND kind LIKE 'drive/%' ORDER BY created_at").bind(orgId).all();
    const data={ok:true,folders:[],notes:[],files:[],templates:[]};
    for(const row of rows.results||[]) {
      const kind=row.kind;
      const stored=storedRecord(row);
      if(['drive/folders','drive/notes','drive/files'].includes(kind)) {
        const decorated=await decorateDriveRecord(getDb(env),orgId,kind,stored,gate.user.sub);
        if(decorated) data[kind.slice(6)]?.push(decorated);
      } else data[kind.slice(6)]?.push(stored);
    }
    return json(data);
  }
  if(route==='organization' && request.method==='GET') {
    const gate=await requireOrgRole({env,request,orgId,minRole:'viewer'}); if(!gate.ok) return gate.resp;
    const row=await getDb(env).prepare("SELECT * FROM org_private_records WHERE org_id=? AND kind='organization' AND id=?").bind(orgId,orgId).first();
    return json({ok:true,organization:storedRecord(row)});
  }
  const match=privateRoute(path+url.search);
  if(match) return privateRecords({env,request,...match});
  return bad(409,'UNAVAILABLE_IN_PRIVATE_MODE',{message:'This feature processes readable content on the server and is unavailable in member-only encrypted mode.'});
}
