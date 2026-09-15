function bytes(s) {
  if(typeof s!=='string'||!/^[A-Za-z0-9_+/-]+={0,2}$/.test(s)) return 0;
  try{return atob(s.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-s.length%4)%4)).length;}catch{return 0;}
}
export function validPublicKey(p) {
  return p && (p.ext===undefined||typeof p.ext==='boolean') && (p.key_ops===undefined||(Array.isArray(p.key_ops)&&p.key_ops.length===0)) && p.kty==='EC' && p.crv==='P-256' && bytes(p.x)===32 && bytes(p.y)===32 && Object.keys(p).every(k=>['kty','crv','x','y','ext','key_ops'].includes(k));
}
export function validRecoveryPayload(p) {return p && bytes(p.salt)===16 && bytes(p.iv)===12 && bytes(p.ct)===48;}
export function validWrappedKey(value) {
  try {
    const b=JSON.parse(value),p=b.sender_pub;
    return Object.keys(b).every(k=>['v','sender_pub','salt','iv','ct','kid','recipient_kid'].includes(k)) && b.v===1 && validPublicKey(p) && bytes(b.salt)===16 && bytes(b.iv)===12 && bytes(b.ct)===48;
  } catch{return false;}
}
