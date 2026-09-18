// Anonymous submissions use a fresh ephemeral ECDH sender for every message.
import {contentContext,isCiphertext} from './privateContent.js';
const decode=s=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-s.length%4)%4)),c=>c.charCodeAt(0));
const encode=b=>btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
async function derive(privateKey,publicJwk,salt,context) {
 const publicKey=await crypto.subtle.importKey('jwk',publicJwk,{name:'ECDH',namedCurve:'P-256'},false,[]);
 const bits=await crypto.subtle.deriveBits({name:'ECDH',public:publicKey},privateKey,256);
 const base=await crypto.subtle.importKey('raw',bits,'HKDF',false,['deriveKey']);
 return crypto.subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt,info:new TextEncoder().encode(context)},base,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
export async function makeSubmissionRecipient() {
 const pair=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']);
 return {publicKey:await crypto.subtle.exportKey('jwk',pair.publicKey),privateKey:await crypto.subtle.exportKey('jwk',pair.privateKey)};
}
export async function sealSubmission(recipient,type,content) {
 const id=crypto.randomUUID(),salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12));
 const pair=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']);
 const aad=contentContext(recipient.orgId,'submission/'+type,id);
 const key=await derive(pair.privateKey,recipient.publicKey,salt,JSON.stringify([aad,recipient.epoch]));
 const ct=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(aad)},key,new TextEncoder().encode(JSON.stringify(content)));
 return {id,epoch:recipient.epoch,sender_pub:await crypto.subtle.exportKey('jwk',pair.publicKey),salt:encode(salt),ciphertext:JSON.stringify({v:2,alg:'A256GCM',aad,iv:encode(iv),ct:encode(ct)})};
}
export async function openSubmission(orgId,row,privateJwk) {
 const aad=contentContext(orgId,'submission/'+row.type,row.id);
 if(!isCiphertext(row.ciphertext,aad))throw new Error('Invalid encrypted submission.');
 const privateKey=await crypto.subtle.importKey('jwk',privateJwk,{name:'ECDH',namedCurve:'P-256'},false,['deriveBits']);
 const key=await derive(privateKey,typeof row.sender_pub==='string'?JSON.parse(row.sender_pub):row.sender_pub,decode(row.salt),JSON.stringify([aad,row.epoch]));
 const c=JSON.parse(row.ciphertext);
 const clear=await crypto.subtle.decrypt({name:'AES-GCM',iv:decode(c.iv),additionalData:new TextEncoder().encode(aad)},key,decode(c.ct));
 return JSON.parse(new TextDecoder().decode(clear));
}
