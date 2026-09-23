import {getDb,requireUser,requireOrgRole} from './auth.js';
import {json,bad} from './http.js';
import {requireCookieCsrf} from './csrf.js';
import {validPublicKey} from './wrappedKeyValidation.js';
import {deviceKeyId} from './deviceKeys.js';

export async function ensureDeviceApprovals(db) {
  await db.prepare('CREATE TABLE IF NOT EXISTS private_device_approvals(id TEXT PRIMARY KEY,org_id TEXT NOT NULL,user_id TEXT NOT NULL,device_id TEXT NOT NULL,public_key TEXT NOT NULL,label TEXT NOT NULL,epoch INTEGER NOT NULL,status TEXT NOT NULL,expires_at INTEGER NOT NULL)').run();
}
export async function deviceApprovals({env,request,orgId}) {
  const gate=orgId?await requireOrgRole({env,request,orgId,minRole:'viewer'}):await requireUser({env,request});
  if(!gate.ok)return gate.resp;
  const db=getDb(env);await ensureDeviceApprovals(db);
  const now=Date.now(),userId=gate.user.sub;
  await db.prepare('DELETE FROM private_device_approvals WHERE expires_at<?').bind(now-86400000).run();
  if(request.method==='GET') {
    const id=new URL(request.url).searchParams.get('id');
    if(orgId&&id){
      const row=await db.prepare('SELECT * FROM private_device_approvals WHERE id=? AND user_id=? AND org_id=?').bind(id,userId,orgId).first();
      if(!row)return bad(404,'REQUEST_NOT_FOUND');
      return json({ok:true,request:{...row,status:row.status==='pending'&&row.expires_at<=now?'expired':row.status}});
    }
    const rows=(await db.prepare("SELECT a.* FROM private_device_approvals a JOIN org_memberships m ON m.org_id=a.org_id AND m.user_id=a.user_id WHERE a.user_id=? AND a.status='pending' AND a.expires_at>? ORDER BY a.expires_at LIMIT 10").bind(userId,now).all()).results||[];
    return json({ok:true,requests:rows});
  }
  if(request.method!=='POST'||!orgId)return bad(405,'METHOD_NOT_ALLOWED');
  const csrf=requireCookieCsrf(request);if(csrf)return csrf;
  const b=await request.json().catch(()=>null);
  if(b?.action==='deny'){
    await db.prepare("UPDATE private_device_approvals SET status='denied' WHERE id=? AND org_id=? AND user_id=? AND status='pending'").bind(String(b.id||''),orgId,userId).run();
    return json({ok:true});
  }
  if(b?.action!=='request'||!validPublicKey(b.publicKey))return bad(400,'INVALID_DEVICE_REQUEST');
  const state=await db.prepare('SELECT epoch FROM org_private_key_state WHERE org_id=?').bind(orgId).first();
  if(!state?.epoch)return bad(409,'SCOPED_KEYS_REQUIRED');
  const deviceId=await deviceKeyId(b.publicKey);
  const existing=await db.prepare("SELECT * FROM private_device_approvals WHERE org_id=? AND user_id=? AND device_id=? AND status='pending' AND expires_at>?").bind(orgId,userId,deviceId,now).first();
  if(existing)return json({ok:true,request:existing});
  const count=await db.prepare("SELECT COUNT(*) AS n FROM private_device_approvals WHERE user_id=? AND status='pending' AND expires_at>?").bind(userId,now).first();
  if(count.n>=5)return bad(429,'TOO_MANY_DEVICE_REQUESTS');
  const row={id:crypto.randomUUID(),org_id:orgId,user_id:userId,device_id:deviceId,public_key:JSON.stringify(b.publicKey),label:String(b.label||'New browser').slice(0,80),epoch:state.epoch,status:'pending',expires_at:now+15*60*1000};
  await db.prepare('INSERT INTO private_device_approvals VALUES(?,?,?,?,?,?,?,?,?)').bind(row.id,orgId,userId,deviceId,row.public_key,row.label,row.epoch,row.status,row.expires_at).run();
  return json({ok:true,request:row});
}
