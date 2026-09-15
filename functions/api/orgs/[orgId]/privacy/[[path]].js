import { privateProtocol } from '../../../_lib/privateProtocol.js';
export function onRequest({env,request,params}) {
  return privateProtocol({env,request,orgId:params.orgId,path:Array.isArray(params.path)?params.path.join('/'):String(params.path||'')});
}
