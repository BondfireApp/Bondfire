export const KEY_SCOPES = ['viewer', 'member', 'admin'];
export const roleRank = role => ({viewer:0, member:1, admin:2, owner:3}[role] ?? -1);
export const canReadScope = (role, scope) => KEY_SCOPES.includes(scope) && roleRank(role) >= roleRank(scope);
export function contentScope(kind) {
  if(kind==='public/config'||kind.startsWith('intake/')||kind.startsWith('newsletter/'))return 'admin';
  if(kind==='pledges')return 'member';
  return 'viewer';
}
export const scopedContext = (context, scope, epoch) => JSON.stringify([context,scope,epoch]);
