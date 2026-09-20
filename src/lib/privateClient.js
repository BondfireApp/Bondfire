import {openSubmission} from '../../shared/privateSubmission.js';
import { decryptWithOrgKey } from './zk.js';
import { PRIVATE_CONTENT, privateRoute } from '../../shared/privateContent.js';
import { encryptPrivate, decryptPrivate, loadPrivateKey } from './privateCrypto.js';
import {PUBLIC_FIELDS,selectPublicFields,wantsPublication} from '../../shared/publicProjection.js';
import { resolveDriveShareKey } from './driveSharing.js';

const DRIVE_SHARE_KINDS=new Set(['drive/folders','drive/notes','drive/files']);
const PUBLIC_INBOX_SUBMISSION_TYPES=new Set(['intake','rsvp']);

function isPublicInboxSubmission(row) {
  return PUBLIC_INBOX_SUBMISSION_TYPES.has(String(row?.type||'').trim().toLowerCase());
}

function recArchiveId(record) {
  const direct=String(record?.rec_archive_id||'').trim();
  if(direct)return direct;
  const tags=Array.isArray(record?.tags)?record.tags:[];
  const tag=tags.find(item=>String(item||'').startsWith('archive:'));
  return tag?String(tag).slice(8):'';
}
function enrichRecWitness(record,role) {
  if(!record)return record;
  const archiveId=recArchiveId(record);
  return {...record,rec_archive_id:archiveId,can_manage_rec:['admin','owner'].includes(role),legacy_rec:Boolean(archiveId&&!record.rec_managed)};
}

function parseBody(body) {
  if(body==null) return {};
  if(typeof body==='string') return JSON.parse(body);
  if(typeof body==='object'&&!(body instanceof Blob)&&!(body instanceof FormData)) return body;
  throw new Error('Unsupported encrypted request body.');
}
export function normalizePrivateRecord(kind,row) {
  const clear={...row};
  if(kind.startsWith('drive/')) {
    if(clear.parent_id!==undefined) clear.parentId=clear.parent_id;
    if(kind==='drive/notes'||kind==='drive/templates') { clear.body=clear.body??clear.content??''; if(typeof clear.tags==='string') clear.tags=clear.tags.split(',').filter(Boolean); }
  }
  if(kind==='chat/messages') {clear.roomId=clear.roomId??clear.room_id;clear.authorLabel=clear.authorLabel??clear.author_label??'';}
  if(kind==='events'||kind==='witness') {try {clear.tags=clear.tags??JSON.parse(clear.tags_json||'[]');}catch{clear.tags=[];}}
  if(kind==='pledges') {
    clear.type=clear.type??clear.title??'';clear.amount=clear.amount??clear.qty??'';clear.note=clear.note??clear.description??'';
    clear.pledger_name=clear.pledger_name??'';clear.pledger_email=clear.pledger_email??'';
  }
  return clear;
}
export async function decodeLegacyRecord(key,kind,row,{normalize=true}={}) {
  key=key.legacy||key;
  let clear={...row};
  const legacy={};
  const unified=row.encrypted_blob||row.encryptedBlob;
  if(unified) {
    const value=JSON.parse(await decryptWithOrgKey(key,unified));
    if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Unsupported legacy encrypted record. Original data was preserved.');
    clear={...clear,...value};legacy.encrypted_blob=unified;
  }
  for(const [field,target]of [['encrypted_description','description'],['encrypted_notes','notes']]) {
    if(!row[field])continue;
    const text=await decryptWithOrgKey(key,row[field]);
    let value=text;
    let parsedObject=null;
    try {const parsed=JSON.parse(text);if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed))parsedObject=parsed;else value=parsed;}catch{}
    if(!unified) {
      if(parsedObject)clear={...clear,...parsedObject};
      else clear[target]=value;
    }
    legacy[field]=row[field];
  }
  for(const [field,value]of Object.entries(clear)) {
    if(typeof value==='string'&&value.startsWith('bfzk1:'))clear[field]=await decryptWithOrgKey(key,value.slice(6));
  }
  if(Object.keys(legacy).length)clear._legacyEncryptedFields=legacy;
  return normalize?normalizePrivateRecord(kind,clear):clear;
}
async function reveal(key,orgId,kind,row,transport,hydrate=false) {
  if(!row) return row;
  if(!row.ciphertext) throw new Error('Private storage returned an unencrypted record.');
  const outer=await decryptPrivate(key,row.ciphertext,orgId,kind,row.id);
  let clear=outer,contentKey=key;
  if(DRIVE_SHARE_KINDS.has(kind)&&outer?.__driveShared?.ciphertext) {
    let share=await resolveDriveShareKey(orgId,kind,row.id,transport,{parentId:row.parentId??null});
    if(!share?.key) share=await resolveDriveShareKey(orgId,kind,row.id,transport,{preferPending:true,parentId:row.parentId??null});
    if(!share?.key) throw new Error('This shared Drive item cannot be opened on this device because its item key is missing.');
    try {
      clear=await decryptPrivate(share.key,outer.__driveShared.ciphertext,orgId,kind,row.id);
      contentKey=share.key;
    } catch(error) {
      const pending=await resolveDriveShareKey(orgId,kind,row.id,transport,{preferPending:true,parentId:row.parentId??null});
      if(!pending?.key||pending.key===share.key) throw error;
      clear=await decryptPrivate(pending.key,outer.__driveShared.ciphertext,orgId,kind,row.id);
      contentKey=pending.key;
    }
  }
  clear=normalizePrivateRecord(kind,clear);
  const result={...clear,id:row.id,revision:row.revision,deleting:!!row.deleting,createdBy:row.createdBy||null,createdAt:clear.createdAt??row.createdAt,updatedAt:row.updatedAt,
    created_at:clear.created_at??row.created_at,updated_at:row.updated_at,encrypted:true,
    sharePermission:row.sharePermission||'',shareRestricted:!!row.shareRestricted,shareOwnerUserId:row.shareOwnerUserId||null,
    shareRootKind:row.shareRootKind||null,shareRootId:row.shareRootId||null,shareInherited:!!row.shareInherited};
  const contract=PRIVATE_CONTENT[kind];
  if(contract?.parent) result[contract.parent]=row.parentId||null;
  // Public URLs are never synthesized for private files. Binary previews are
  // populated only after authenticated ciphertext retrieval and local decryption.
  if(kind==='drive/files') {
    delete result.storage_key;delete result.storageKey;
    result.url='';result.downloadUrl='';result.previewUrl='';
    if(hydrate&&result.payloadId) {
      const payload=await transport(`/api/orgs/${encodeURIComponent(orgId)}/privacy/blob/${result.payloadId}`);
      const bytes=await decryptPrivate(contentKey,payload.ciphertext,orgId,'drive/blob',result.payloadId,true);
      const blob=new Blob([bytes],{type:result.mime||'application/octet-stream'});
      result.dataUrl=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(blob);});
      if(String(result.mime||'').startsWith('text/')||/\.(bfform|bfsheet|json|md|csv)$/i.test(result.name||'')) result.textContent=new TextDecoder().decode(bytes);
    }
  }
  return result;
}
async function deletePayload(orgId,payloadId,fileId,transport) {
  if(!payloadId)return;
  await transport(`/api/orgs/${encodeURIComponent(orgId)}/privacy/blob/${payloadId}`,{method:'DELETE',body:JSON.stringify({fileId})});
}
async function uploadPayload(key,orgId,bytes,transport,fileId,parentId) {
  const payloadId=crypto.randomUUID();
  const ciphertext=await encryptPrivate(key,bytes,orgId,'drive/blob',payloadId);
  try {
    await transport(`/api/orgs/${encodeURIComponent(orgId)}/privacy/blob/${payloadId}`,{method:'POST',body:JSON.stringify({ciphertext,fileId,parentId:parentId??null})});
    const check=await transport(`/api/orgs/${encodeURIComponent(orgId)}/privacy/blob/${payloadId}`);
    if(check.ciphertext!==ciphertext) throw new Error('Encrypted upload verification failed.');
    return payloadId;
  } catch(error) {
    try {await deletePayload(orgId,payloadId,fileId,transport);} catch {}
    throw error;
  }
}
export { uploadPayload };
export async function dispatchPrivate(path,opts,transport) {
  const baseTransport=transport;
  const inheritedSignal=opts?.signal;
  transport=(nextPath,nextOpts={})=>baseTransport(nextPath,inheritedSignal&&!nextOpts.signal?{...nextOpts,signal:inheritedSignal}:nextOpts);
  const url=new URL(path,window.location.origin);
  const m=url.pathname.match(/^\/api\/orgs\/([^/]+)\/(.*)$/);
  if(!m||['create','index'].includes(m[1])) return null;
  const orgId=decodeURIComponent(m[1]), tail=m[2];
  if(/^(privacy|crypto|zk|emergency|members|modules|invites|drive\/shares)(\/|$)/.test(tail)||tail==='drive/forms-public') return null;
  const status=await transport(`/api/orgs/${encodeURIComponent(orgId)}/privacy`);
  if(status.state==='off') return null;
  if(status.state!=='enabled') throw new Error('Finish the encrypted-data conversion in Settings → Security before editing this organization.');
  // Organization Page configuration and domain/publication identity are intentionally public.
  // Newsletter delivery identity/sending are operational routes: sender identity is
  // exposed in outgoing mail headers and send is an explicit admin action. Their
  // server handlers remain authoritative while subscriber/content storage stays encrypted.
  // Let these role-protected server endpoints pass through for private orgs.
  if([
    'public/get',
    'public/save',
    'public/publication',
    'public/domains',
    'newsletter/delivery',
    'newsletter/send',
  ].includes(tail)) return null;
  const key=await loadPrivateKey(orgId,status,transport);
  const method=String(opts.method||'GET').toUpperCase();
  if(method!=='GET'&&key.rotationRequired)throw new Error('Membership or devices changed. An owner must rotate encryption keys in Security before saving.');
  async function submissions() {
    if(!key.scopes?.admin)return [];
    const data=await transport(`/api/orgs/${encodeURIComponent(orgId)}/privacy/submissions`);
    return Promise.all(data.submissions.map(async row=>{
      const privateJwk=key.scopes.admin.submissions?.[row.epoch];
      if(!privateJwk)throw new Error('The submission decryption key is missing. Restore administrator keys in Security.');
      const opened=await openSubmission(orgId,row,privateJwk);
      if(!opened||typeof opened!=='object'||Array.isArray(opened))throw new Error('Invalid submission content.');
      const clear={};
      for(const field of ['name','email','contact','details','extra','source_kind','status','meeting_id','need_id','pledger_name','pledger_email','amount','unit','note'])if(['string','number','boolean'].includes(typeof opened[field]))clear[field]=String(opened[field]);
      if(typeof opened.type==='string')clear.pledge_type=opened.type;

      return {...clear,id:row.id,type:row.type,created_at:row.created_at,review_status:'new',admin_note:''};
    }));
  }
  if(tail==='dashboard'&&method==='GET') {
    const data={};
    const loadKind=async(kind)=>{
      const raw=await transport(`/api/orgs/${encodeURIComponent(orgId)}/${kind}`);
      const rows=raw[PRIVATE_CONTENT[kind].list]||[];
      return Promise.all(rows.map(row=>reveal(key,orgId,kind,row,transport)));
    };
    const admin=['admin','owner'].includes(status.role);
    const submissionPromise=admin?submissions():Promise.resolve([]);
    const [peopleRows,inventoryRows,needsRows,meetingRows,pledgeRows,subscriberRows,inboxRows]=await Promise.all([
      loadKind('people'),
      loadKind('inventory'),
      loadKind('needs'),
      loadKind('meetings'),
      status.role==='viewer'?Promise.resolve([]):loadKind('pledges'),
      admin?(async()=>{
        const [stored,incoming]=await Promise.all([
          transport(`/api/orgs/${encodeURIComponent(orgId)}/newsletter/subscribers`),
          submissionPromise,
        ]);
        const rows=await Promise.all((stored.subscribers||[]).map(row=>reveal(key,orgId,'newsletter/subscribers',row,transport)));
        const newsletters=incoming.filter(row=>row.type==='newsletter');
        return [...rows,...newsletters.filter(row=>!rows.some(existing=>existing.id===row.id))];
      })():Promise.resolve([]),
      admin?(async()=>{
        const [originals,stored]=await Promise.all([
          submissionPromise,
          transport(`/api/orgs/${encodeURIComponent(orgId)}/intake/reviews`),
        ]);
        const reviews=await Promise.all((stored.items||[]).map(row=>reveal(key,orgId,'intake/reviews',row,transport)));
        const inboxOriginals=originals.filter(isPublicInboxSubmission);
        const overlays=new Map(reviews.map(row=>[row.id,row]));
        const items=inboxOriginals.map(row=>({...row,...overlays.get(row.id),title:row.source_kind||row.type,contact:row.contact||row.email||row.pledger_email||'',name:row.name||row.pledger_name||'',details:row.details||row.note||row.status||'',id:row.id}));
        for(const row of reviews)if(!inboxOriginals.some(original=>original.id===row.id))items.push(row);
        return items;
      })():Promise.resolve([]),
    ]);
    Object.assign(data,{people:peopleRows,inventory:inventoryRows,needs:needsRows,meetings:meetingRows,pledges:pledgeRows,subscribers:subscriberRows,publicInbox:inboxRows});
    const upcoming=data.meetings.filter(row=>Number(row.starts_at)>=Date.now()).sort((a,b)=>Number(a.starts_at)-Number(b.starts_at));
    data.counts={people:data.people.length,inventory:data.inventory.length,needs:data.needs.length,needsOpen:data.needs.filter(row=>row.status==='open').length,meetingsUpcoming:upcoming.length,pledges:data.pledges.length,pledgesActive:data.pledges.filter(row=>!['fulfilled','cancelled'].includes(row.status)).length,subscribers:data.subscribers.length,publicInbox:data.publicInbox.filter(row=>!['closed','done','archived','rejected'].includes(row.review_status)).length};
    return {handled:true,data:{ok:true,private_mode:true,role:status.role,...data,nextMeeting:upcoming[0]||null}};
  }
  if(tail==='public/inbox') {
    if(!['admin','owner'].includes(status.role))throw new Error('Administrator access is required for the public inbox.');
    if(method!=='GET') {
      const body=parseBody(opts.body),target=`/api/orgs/${encodeURIComponent(orgId)}/intake/reviews/${encodeURIComponent(body.id)}`;
      let exists=false;try{await transport(target);exists=true;}catch(e){if(e.status!==404)throw e;}
      await dispatchPrivate(target,{method:exists?'PUT':'POST',body:JSON.stringify(body)},transport);
    }
    const originals=(await submissions()).filter(isPublicInboxSubmission);
    const reviews=(await dispatchPrivate(`/api/orgs/${encodeURIComponent(orgId)}/intake/reviews`,{},transport)).data.items;
    const overlays=new Map(reviews.map(row=>[row.id,row]));
    const items=originals.map(row=>({...row,...overlays.get(row.id),title:row.source_kind||row.type,contact:row.contact||row.email||row.pledger_email||'',name:row.name||row.pledger_name||'',details:row.details||row.note||row.status||'',id:row.id}));
    for(const row of reviews)if(!originals.some(original=>original.id===row.id))items.push(row);
    return {handled:true,data:{ok:true,items}};
  }
  if(tail==='newsletter') {
    const target=`/api/orgs/${encodeURIComponent(orgId)}/newsletter/settings/${encodeURIComponent(orgId)}`;
    if(method==='GET') {
      try{return await dispatchPrivate(target,{},transport);}catch(e){if(e.status===404)return {handled:true,data:{ok:true,newsletter:{enabled:false,list_address:'',blurb:''}}};throw e;}
    }
    let exists=false;try{await transport(target);exists=true;}catch(e){if(e.status!==404)throw e;}
    return dispatchPrivate(target,{method:exists?'PUT':'POST',body:opts.body},transport);
  }
  if(tail==='newsletter/subscribers'&&method==='GET') {
    if(!['admin','owner'].includes(status.role))throw new Error('Administrator access is required for subscribers.');
    const stored=await transport(path,opts);
    const rows=await Promise.all((stored.subscribers||[]).map(row=>reveal(key,orgId,'newsletter/subscribers',row,transport)));
    const incoming=(await submissions()).filter(row=>row.type==='newsletter');
    return {handled:true,data:{ok:true,subscribers:[...rows,...incoming.filter(row=>!rows.some(existing=>existing.id===row.id))]}};
  }
  if(tail==='public/generate'&&method==='POST') {
    const result=await transport(`/api/orgs/${encodeURIComponent(orgId)}/privacy/public-slug`,{method:'POST',body:JSON.stringify({slug:crypto.randomUUID()})});
    return {handled:true,data:{ok:true,public:{slug:result.slug}}};
  }
  if(tail==='links/search'&&method==='GET') {
    const query=(url.searchParams.get('q')||'').trim().toLowerCase();
    if(!query)return {handled:true,data:{ok:true,items:[],results:[]}};
    // Never put a private search term in an HTTP URL or server log.
    const collections=await Promise.all(['events','witness'].map(async kind=>{
      const data=await transport(`/api/orgs/${encodeURIComponent(orgId)}/${kind}`);
      return {kind,rows:await Promise.all((data[PRIVATE_CONTENT[kind].list]||[]).map(row=>reveal(key,orgId,kind,row,transport)))};
    }));
    const items=collections.flatMap(({kind,rows})=>rows.filter(row=>
      [row.title,row.description,row.location,row.summary,JSON.stringify(row.tags||[])].some(v=>String(v||'').toLowerCase().includes(query))
    ).sort((a,b)=>Number(b.starts_at||b.updated_at||0)-Number(a.starts_at||a.updated_at||0)).slice(0,25).map(row=>({
      type:kind==='events'?'event':'witness',id:row.id,title:row.title||(kind==='events'?'Untitled event':'Untitled witness record'),
      subtitle:kind==='events'?[row.starts_at||'Date pending',row.location].filter(Boolean).join(' • '):row.summary||row.happened_at||'Witness record',
      href:`/org/${encodeURIComponent(orgId)}/${kind==='events'?'events/'+encodeURIComponent(row.id):'witness'}`,tags:row.tags||[],
    })));
    return {handled:true,data:{ok:true,items,results:items}};
  }
  if(tail==='studio/state') {
    if(method==='GET') {
      const data=await transport(path,opts);
      return {handled:true,data:{...data,private_mode:true,
        docs:await Promise.all(data.docs.map(row=>reveal(key,orgId,'studio/docs',row,transport))),
        blocks:await Promise.all(data.blocks.map(row=>reveal(key,orgId,'studio/blocks',row,transport)))}};
    }
    if(method!=='POST')throw new Error('Unsupported Studio operation.');
    const body=parseBody(opts.body),sealed={revision:body.revision,docs:[],blocks:[]};
    for(const type of ['docs','blocks']) {
      if(!Array.isArray(body[type]))throw new Error('Studio must save both document collections.');
      for(const row of body[type]) {
        const clear=await decodeLegacyRecord(key,'studio/'+type,row);
        for(const field of ['encrypted_blob','encryptedBlob','_legacyEncryptedFields'])delete clear[field];
        sealed[type].push({id:row.id,ciphertext:await encryptPrivate(key,clear,orgId,'studio/'+type,row.id)});
      }
    }
    return {handled:true,data:await transport(path,{method:'POST',body:JSON.stringify(sealed)})};
  }
  if(tail==='organization'&&method==='GET') {
    const data=await transport(path,opts);
    return {handled:true,data:{...data,organization:await reveal(key,orgId,'organization',data.organization,transport)}};
  }
  if(tail==='drive'&&method==='GET') {
    const data=await transport(path,opts),next={...data};
    for(const type of ['folders','notes','files','templates']) next[type]=await Promise.all((data[type]||[]).map(row=>reveal(key,orgId,`drive/${type}`,row,transport)));
    return {handled:true,data:next};
  }
  if(tail==='drive/import') {
    const data=parseBody(opts.body);
    for(const type of ['folders','notes','files','templates']) for(const row of data[type]||[]) await dispatchPrivate(`/api/orgs/${encodeURIComponent(orgId)}/drive/${type}`,{method:'POST',body:JSON.stringify(row)},transport);
    return {handled:true,data:{ok:true}};
  }
  const route=privateRoute(path);
  if(!route) throw new Error('This feature is unavailable in member-only encrypted mode because it processes readable content on a server.');
  const {kind}=route,contract=PRIVATE_CONTENT[kind];
  let data;
  if(method==='GET') data=await transport(path,opts);
  else {
    let clear,uploadBytes=null;
    if(opts.body instanceof Blob) {
      if(kind!=='drive/files') throw new Error('Binary uploads must use encrypted Drive.');
      const headers=new Headers(opts.headers||{});
      clear={name:opts.body.name||headers.get('x-drive-name')||'file',mime:opts.body.type||headers.get('x-drive-mime')||'application/octet-stream',size:opts.body.size,parentId:headers.get('x-drive-parent-id')||null};
      clear.id=route.id||crypto.randomUUID();
      uploadBytes=new Uint8Array(await opts.body.arrayBuffer());
    } else {
      clear=parseBody(opts.body);
      if(kind==='drive/files'&&(clear.textContent!==undefined||clear.dataUrl!==undefined)) {
        if(clear.dataUrl) {
          const u=String(clear.dataUrl);if(!u.startsWith('data:')) throw new Error('File data must be local.');
          uploadBytes=new Uint8Array(await (await fetch(u)).arrayBuffer());
        } else uploadBytes=new TextEncoder().encode(String(clear.textContent||''));
        clear.id=route.id||clear.id||crypto.randomUUID();
        delete clear.dataUrl;delete clear.textContent;
      }
    }
    let recManagementToken='';
    if(kind==='witness'&&method==='POST') {
      recManagementToken=String(clear.rec_management_token||'').trim();
      delete clear.rec_management_token;
      if(recManagementToken&&recArchiveId(clear)) clear.rec_managed=true;
    }
    const id=route.id||clear.id||crypto.randomUUID();
    let previous=null;
    if(method!=='POST') {
      const currentBase=`/api/orgs/${encodeURIComponent(orgId)}/${kind}/${encodeURIComponent(id)}`;
      const currentPath=route.url.searchParams.get('__bf_colophon_storage')==='1'
        ? `${currentBase}?__bf_colophon_storage=1`
        : currentBase;
      const current=await transport(currentPath);
      previous=await reveal(key,orgId,kind,current[contract.one],transport);
    }
    let driveShareForWrite=null;
    if(DRIVE_SHARE_KINDS.has(kind)) {
      const desiredParent=Object.prototype.hasOwnProperty.call(clear,'parentId')
        ? (clear.parentId||null)
        : (previous?.parentId??null);
      driveShareForWrite=await resolveDriveShareKey(orgId,kind,id,transport,{preferPending:true,parentId:desiredParent});
    }
    let uploadedPayloadId=null;
    if(kind==='drive/files'&&uploadBytes) {
      const payloadKey=driveShareForWrite?.key||key;
      const desiredParent=Object.prototype.hasOwnProperty.call(clear,'parentId')?(clear.parentId||null):(previous?.parentId??null);
      uploadedPayloadId=await uploadPayload(payloadKey,orgId,uploadBytes,transport,id,desiredParent);
      clear.payloadId=uploadedPayloadId;
      clear.size=uploadBytes.length;
    }
    if(method==='DELETE') {
      if(kind==='witness') {
        const archiveId=recArchiveId(previous);
        if(archiveId) await transport(`/api/orgs/${encodeURIComponent(orgId)}/rec/archive`,{method:'DELETE',body:JSON.stringify({archiveId,witnessId:id,legacy:!previous.rec_managed})});
      }
      data=await transport(path,{method,body:JSON.stringify({id,revision:previous.revision})});
    } else {
      let combined;
      try {
        // Older screens already encrypted selected fields and replaced their visible
        // values with placeholders. Open those fields before constructing the new
        // authoritative envelope; dropping them would permanently lose the edit.
        // Do not fill defaults on a partial patch: absent fields must stay absent.
        const decoded=await decodeLegacyRecord(key,kind,clear,{normalize:false});
        combined={...(previous||{}),...decoded};
        if(PUBLIC_FIELDS[kind]&&(wantsPublication(kind,combined)||wantsPublication(kind,previous||{}))&&!['admin','owner'].includes(status.role))throw new Error('An administrator must publish or change a published record.');
        // Content is authoritative inside the envelope. IDs and revisions are checked
        // independently; never merge decrypted content over these protocol fields.
        for(const k of ['ciphertext','encrypted_blob','encryptedBlob','revision','encrypted','previewUrl','downloadUrl','url','storage_key','storageKey','sharePermission','shareRestricted','shareOwnerUserId','shareRootKind','shareRootId','shareInherited','createdBy']) delete combined[k];
        let sealedContent=combined;
        if(DRIVE_SHARE_KINDS.has(kind)&&driveShareForWrite?.key) {
          const inner=await encryptPrivate(driveShareForWrite.key,combined,orgId,kind,id);
          sealedContent={__driveShared:{v:1,version:Number(driveShareForWrite.version||0),ciphertext:inner}};
        }
        const ciphertext=await encryptPrivate(key,sealedContent,orgId,kind,id);
        data=await transport(path,{method,body:JSON.stringify({id,ciphertext,revision:previous?.revision||0,...(contract.parent?{parentId:combined[contract.parent]||null}:{})})});
        if(kind==='witness'&&method==='POST'&&recManagementToken) {
          const archiveId=recArchiveId(combined);
          if(!archiveId) throw new Error('REC archive ID is missing from the encrypted witness record.');
          await transport(`/api/orgs/${encodeURIComponent(orgId)}/rec/claim`,{method:'POST',body:JSON.stringify({archiveId,witnessId:id,managementToken:recManagementToken})});
        }
      } catch(error) {
        if(uploadedPayloadId)try {await deletePayload(orgId,uploadedPayloadId,id,transport);} catch {}
        throw error;
      }
      if(uploadedPayloadId&&previous?.payloadId&&previous.payloadId!==uploadedPayloadId) {
        try {await deletePayload(orgId,previous.payloadId,id,transport);} catch {}
      }
      if(PUBLIC_FIELDS[kind]&&['admin','owner'].includes(status.role)) {
        try {await transport(`/api/orgs/${encodeURIComponent(orgId)}/privacy/publish`,{method:'POST',body:JSON.stringify({kind,id,revision:data[contract.one].revision,public:wantsPublication(kind,combined)?selectPublicFields(kind,combined):null})});}
        catch(e){throw new Error('The encrypted record was saved, but updating its public copy failed. Retry the save to finish publishing or unpublishing. '+e.message);}
      }
    }
  }
  const next={...data,private_mode:true};
  if(data[contract.one]) next[contract.one]=await reveal(key,orgId,kind,data[contract.one],transport,kind==='drive/files'&&!!route.id&&method==='GET');
  if(Array.isArray(data[contract.list])) next[contract.list]=await Promise.all(data[contract.list].map(row=>reveal(key,orgId,kind,row,transport)));
  if(kind==='witness') {
    if(next[contract.one]) next[contract.one]=enrichRecWitness(next[contract.one],status.role);
    if(Array.isArray(next[contract.list])) next[contract.list]=next[contract.list].map(row=>enrichRecWitness(row,status.role));
    next.records=next.items;
  }
  return {handled:true,data:next};
}
