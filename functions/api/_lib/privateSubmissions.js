import {getDb,requireOrgRole} from './auth.js';
import {bad,json} from './http.js';
import {validPublicKey} from './wrappedKeyValidation.js';
import {isCiphertext,contentContext} from '../../../shared/privateContent.js';
export async function ensureSubmissions(db) {
 await db.prepare('CREATE TABLE IF NOT EXISTS org_private_submissions(org_id TEXT NOT NULL,id TEXT NOT NULL,type TEXT NOT NULL,epoch INTEGER NOT NULL,sender_pub TEXT NOT NULL,salt TEXT NOT NULL,ciphertext TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(org_id,id))').run();
}
export async function readPrivateSubmissions({env,request,orgId}) {
 const auth=await requireOrgRole({env,request,orgId,minRole:'admin'});if(!auth.ok)return auth.resp;
 if(request.method!=='GET')return bad(405,'METHOD_NOT_ALLOWED');
 const db=getDb(env);await ensureSubmissions(db);
 return json({ok:true,submissions:(await db.prepare('SELECT * FROM org_private_submissions WHERE org_id=? ORDER BY created_at DESC').bind(orgId).all()).results});
}
export async function publicSubmission({env,request,orgId,tail,config}) {
 const db=getDb(env);
 const exists=await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='org_private_submission_keys'").first();
 if(!exists)return bad(409,'ENCRYPTED_SUBMISSIONS_NOT_READY');
 const recipient=await db.prepare('SELECT k.* FROM org_private_submission_keys k JOIN org_private_key_state s ON s.org_id=k.org_id AND s.epoch=k.epoch AND s.roster_revision=s.rotated_revision WHERE k.org_id=?').bind(orgId).first();
 if(!recipient)return bad(409,'ENCRYPTED_SUBMISSIONS_NOT_READY');
 if(tail==='submission-key'&&request.method==='GET')return json({ok:true,orgId,epoch:recipient.epoch,publicKey:JSON.parse(recipient.public_key)});
 if(request.method!=='POST')return bad(405,'METHOD_NOT_ALLOWED');
 const type=tail==='newsletter/subscribe'?'newsletter':tail==='pledges'?'pledges':tail==='intake'?'intake':/^meetings\/[^/]+\/rsvp$/.test(tail)?'rsvp':null;
 if(!type)return bad(404,'NOT_FOUND');
 if((type==='newsletter'&&!config.newsletter_enabled)||(type==='pledges'&&config.pledges_enabled===false))return bad(404,'NOT_ENABLED');
 const text=await request.text();if(text.length>128*1024)return bad(413,'SUBMISSION_TOO_LARGE');
 let b;try{b=JSON.parse(text);}catch{return bad(400,'INVALID_ENCRYPTED_SUBMISSION');}
 if(!b||Object.keys(b).some(k=>!['id','epoch','sender_pub','salt','ciphertext'].includes(k))||! /^[a-f0-9-]{36}$/.test(b.id)||!validPublicKey(b.sender_pub)||typeof b.salt!=='string'||! /^[A-Za-z0-9_-]{22}$/.test(b.salt)||!isCiphertext(b.ciphertext,contentContext(orgId,'submission/'+type,b.id)))return bad(400,'ENCRYPTED_SUBMISSION_REQUIRED');
 if(b.epoch!==recipient.epoch)return bad(409,'SUBMISSION_KEY_CHANGED');
 await ensureSubmissions(db);
 const result=await db.prepare('INSERT OR IGNORE INTO org_private_submissions SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM org_private_key_state WHERE org_id=? AND epoch=? AND roster_revision=rotated_revision)').bind(orgId,b.id,type,b.epoch,JSON.stringify(b.sender_pub),b.salt,b.ciphertext,Date.now(),orgId,b.epoch).run();
 if(Number(result?.meta?.changes||0)!==1)return bad(409,'SUBMISSION_KEY_CHANGED_OR_DUPLICATE');
 return json({ok:true,id:b.id});
}
