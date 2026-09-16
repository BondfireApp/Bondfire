import assert from 'node:assert/strict';
import {env,sql,db,call} from './private-storage-regression.mjs';
import {ensureScopedKeys} from '../functions/api/_lib/privateKeyScopes.js';
import {ensurePublicationSchema} from '../functions/api/_lib/privatePublication.js';
import {makeSubmissionRecipient,sealSubmission,openSubmission} from '../shared/privateSubmission.js';
import {onRequest as middleware} from '../functions/api/_middleware.js';
const orgId=sql.prepare('SELECT org_id FROM org_private_mode WHERE state=? LIMIT 1').get('enabled').org_id;
await ensureScopedKeys(db);await ensurePublicationSchema(db);
const recipient=await makeSubmissionRecipient();
sql.prepare('INSERT OR REPLACE INTO org_private_key_state VALUES(?,1,0,0)').run(orgId);
sql.prepare('INSERT OR REPLACE INTO org_private_submission_keys VALUES(?,1,?)').run(orgId,JSON.stringify(recipient.publicKey));
let publicConfig={enabled:true,slug:'forms-test',newsletter_enabled:true,pledges_enabled:true};
env.BF_PUBLIC={get:async key=>key==='slug:forms-test'?orgId:key===`org:${orgId}`?JSON.stringify(publicConfig):null};
async function anonymous(tail,body,expected=200) {
 const request=new Request('https://example.test/api/public/forms-test/'+tail,{method:body?'POST':'GET',headers:{'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 const res=await middleware({env,request,next:async()=>Response.json({legacyReached:true})});const data=await res.json();assert.equal(res.status,expected,JSON.stringify(data));return data;
}
const pub=await anonymous('submission-key');assert.deepEqual(pub.publicKey,recipient.publicKey);assert(!JSON.stringify(pub).includes('privateKey'));
const secret={name:'PRIVATE anonymous name',email:'PRIVATE@example.test',details:'PRIVATE request',note:'PRIVATE note'};
for(const [type,path] of [['intake','intake'],['newsletter','newsletter/subscribe'],['pledges','pledges'],['rsvp','meetings/public-meeting/rsvp']]) {
 await anonymous(path,secret,400);
 const sealed=await sealSubmission(pub,type,secret);assert(!JSON.stringify(sealed).includes('PRIVATE'));
 await anonymous(path,sealed);
 const row=sql.prepare('SELECT * FROM org_private_submissions WHERE org_id=? AND id=?').get(orgId,sealed.id);
 assert.deepEqual(await openSubmission(orgId,row,recipient.privateKey),secret);
 await assert.rejects(openSubmission(orgId,{...row,type:'wrong'},recipient.privateKey));
 await assert.rejects(openSubmission(orgId,{...row,epoch:2},recipient.privateKey));
 await anonymous(path,sealed,409);
}
await call('/api/orgs/'+orgId+'/privacy/submissions',{user:'member'},403);
const read=await call('/api/orgs/'+orgId+'/privacy/submissions');assert.equal(read.submissions.length,4);assert(!JSON.stringify(read).includes('PRIVATE'));
const stale=await sealSubmission(pub,'intake',secret);
sql.prepare('UPDATE org_private_key_state SET roster_revision=roster_revision+1 WHERE org_id=?').run(orgId);
await anonymous('intake',stale,409);await anonymous('submission-key',null,409);
sql.prepare('UPDATE org_private_key_state SET epoch=2,rotated_revision=roster_revision WHERE org_id=?').run(orgId);
const next=await makeSubmissionRecipient();sql.prepare('UPDATE org_private_submission_keys SET epoch=2,public_key=? WHERE org_id=?').run(JSON.stringify(next.publicKey),orgId);
await anonymous('intake',stale,409);
const future=await sealSubmission(await anonymous('submission-key'),'intake',secret);await anonymous('intake',future);
await assert.rejects(openSubmission(orgId,{...future,type:'intake'},recipient.privateKey));
assert.deepEqual(await openSubmission(orgId,{...future,type:'intake'},next.privateKey),secret);
publicConfig={...publicConfig,enabled:false};
await anonymous('intake',await sealSubmission({...pub,epoch:2,publicKey:next.publicKey},'intake',secret),404);
console.log('PASS: anonymous encrypted intake, newsletter, pledges and RSVP; admin-only inbox; plaintext rejection; key rotation; unpublished forms closed');
