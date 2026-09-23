import assert from 'node:assert/strict';
import {createDeviceApprovalRequest,approveScopedDevice,loadScopedKeys} from '../src/lib/privateKeyScopes.js';
import {wrapForMember} from '../src/lib/zk.js';
import {encryptPrivate} from '../src/lib/privateCrypto.js';
import {deviceKeyId} from '../shared/privateContent.js';
async function device(){const kp=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']);return {pubJwk:await crypto.subtle.exportKey('jwk',kp.publicKey),privJwk:await crypto.subtle.exportKey('jwk',kp.privateKey)};}
const trusted=await device(),phone=await device();let current=phone;
globalThis.window={location:{origin:'https://test',hash:'',pathname:'/'}};
globalThis.document={cookie:''};
globalThis.fetch=async()=>Response.json({ok:true});
globalThis.localStorage={getItem:()=>null,setItem:()=>{}};
globalThis.indexedDB={open(){const request={};queueMicrotask(()=>{request.result={transaction(){return {objectStore(){return {get(){const read={};queueMicrotask(()=>{read.result=current;read.onsuccess();});return read;}};}};}};request.onsuccess();});return request;}};
const orgId='test-org',raw=crypto.getRandomValues(new Uint8Array(32));
const row={scope:'viewer',key_check:await encryptPrivate(raw,{scope:'viewer',epoch:1},orgId,'scope-check/viewer',orgId),archive:await encryptPrivate(raw,{keys:{}},orgId,'scope-archive/viewer',orgId)};
const wraps=new Map([[await deviceKeyId(trusted.pubJwk),await wrapForMember(raw,trusted.pubJwk)]]);
let writes=0;
async function transport(path,options){if(options){writes++;const b=JSON.parse(options.body);assert.equal(b.epoch,1);assert.equal(b.keys[0].recovery,undefined);wraps.set(b.device_id,b.keys[0].wrapped_key);return {ok:true};}return {userId:'same-account',epoch:1,keys:[{...row,wrapped_key:wraps.get(new URL(path,'https://test').searchParams.get('device_id'))}]};}
const request=await createDeviceApprovalRequest(orgId,transport);
assert(!JSON.parse(request).publicKey.d);
await assert.rejects(loadScopedKeys(orgId,transport));
current=trusted;
for(const changed of [{orgId:'other-org'},{userId:'other-account'},{expires:Date.now()-1},{deviceId:'tampered'}])await assert.rejects(approveScopedDevice(orgId,JSON.stringify({...JSON.parse(request),...changed}),transport));
assert.equal(writes,0);
await approveScopedDevice(orgId,request,transport);
assert.equal(writes,1);
current=phone;
const result=await loadScopedKeys(orgId,transport);
assert.deepEqual(Array.from(result.key),Array.from(raw),'approved phone must decrypt the original key');
console.log('PASS: device approval encrypts for the target browser, rejects wrong account/org/expiry/device, and preserves recovery');
