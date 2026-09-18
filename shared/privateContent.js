// The only fields stored outside ciphertext are opaque identifiers and revision metadata.
// This contract is shared by the browser, the private API, and migration checks.
export const PRIVATE_CONTENT = {
  'intake/reviews': {table:'public_inbox',list:'items',one:'item',read:'admin',write:'admin'},
  'newsletter/settings': {table:'newsletter_settings',singleton:true,list:'settings',one:'newsletter',read:'admin',write:'admin'},
  'newsletter/subscribers': {table:'newsletter_subscribers',list:'subscribers',one:'subscriber',read:'admin',write:'admin'},
  'public/config': {table:'org_public_config_drafts',list:'configs',one:'public',read:'admin',write:'admin'},
  activity: { table: 'activity', list: 'activity', one: 'entry' },
  needs: { table: 'needs', list: 'needs', one: 'need' },
  inventory: { table: 'inventory', list: 'inventory', one: 'item' },
  meetings: { table: 'meetings', list: 'meetings', one: 'meeting' },
  people: { table: 'people', list: 'people', one: 'person' },
  pledges: { table: 'pledges', list: 'pledges', one: 'pledge', read: 'member', remove: 'member' },
  events: { table: 'events', list: 'events', one: 'event' },
  witness: { table: 'witness_records', list: 'items', one: 'record' },
  'chat/rooms': { table: 'chat_rooms', list: 'rooms', one: 'room', remove: 'admin' },
  'chat/messages': { table: 'chat_messages', list: 'messages', one: 'message', parent: 'roomId', parentKind: 'chat/rooms', append: true },
  'drive/folders': { table: 'drive_folders', list: 'folders', one: 'folder', parent: 'parentId', parentKind: 'drive/folders', remove: 'member' },
  'drive/notes': { table: 'drive_notes', list: 'notes', one: 'note', parent: 'parentId', parentKind: 'drive/folders', remove: 'member' },
  'drive/files': { table: 'drive_files', list: 'files', one: 'file', parent: 'parentId', parentKind: 'drive/folders', remove: 'member', binary: true },
  'drive/templates': { table: 'drive_templates', list: 'templates', one: 'template', remove: 'member' },
  'studio/docs': { table: 'studio_docs', list: 'docs', one: 'doc' },
  'studio/blocks': { table: 'studio_blocks', list: 'blocks', one: 'block' },
  'colophon/content': { table: 'colophon_content', list: 'items', one: 'item', read: 'viewer', write: 'member', remove: 'admin' },
  'colophon/revisions': { table: 'colophon_revisions', list: 'items', one: 'item', read: 'viewer', write: 'member', remove: 'admin' },
  'colophon/media': { table: 'colophon_media', list: 'items', one: 'item', read: 'viewer', write: 'member', remove: 'admin' },
  'colophon/comments': { table: 'colophon_comments', list: 'items', one: 'item', read: 'viewer', write: 'member', remove: 'admin' },
  'colophon/taxonomy': { table: 'colophon_taxonomy', list: 'items', one: 'item', read: 'viewer', write: 'member', remove: 'admin' },
  'colophon/sources': { table: 'colophon_sources', list: 'items', one: 'item', read: 'viewer', write: 'member', remove: 'admin' },
  'colophon/setup': { table: 'colophon_setup', singleton: true, list: 'items', one: 'item', read: 'viewer', write: 'admin', remove: 'admin' },
  'colophon/config': { table: 'colophon_config', singleton: true, list: 'items', one: 'item', read: 'viewer', write: 'admin', remove: 'admin' },
  'colophon/collections': { table: 'colophon_collections', list: 'items', one: 'item', read: 'viewer', write: 'admin', remove: 'admin' },
  'colophon/publications': { table: 'colophon_publications', list: 'items', one: 'item', read: 'viewer', write: 'admin', remove: 'admin' },
  'colophon/campaigns': { table: 'colophon_campaigns', list: 'items', one: 'item', read: 'viewer', write: 'admin', remove: 'admin' },
  'colophon/campaign-revisions': { table: 'colophon_campaign_revisions', list: 'items', one: 'item', read: 'admin', write: 'admin', remove: 'admin' },
  'colophon/investigations': { table: 'colophon_investigations', list: 'items', one: 'item', read: 'viewer', write: 'admin', remove: 'admin' },
  'colophon/investigation-revisions': { table: 'colophon_investigation_revisions', list: 'items', one: 'item', read: 'admin', write: 'admin', remove: 'admin' },
  'colophon/courses': { table: 'colophon_courses', list: 'items', one: 'item', read: 'viewer', write: 'admin', remove: 'admin' },
  'colophon/translations': { table: 'colophon_translations', list: 'items', one: 'item', read: 'viewer', write: 'admin', remove: 'admin' },
  'colophon/feed-settings': { table: 'colophon_feed_settings', singleton: true, list: 'items', one: 'item', read: 'admin', write: 'admin', remove: 'admin' },
  'colophon/podcast-settings': { table: 'colophon_podcast_settings', singleton: true, list: 'items', one: 'item', read: 'viewer', write: 'admin', remove: 'admin' },
};
export const PRIVATE_KINDS = Object.keys(PRIVATE_CONTENT);
export function privateRoute(path) {
  const u = new URL(path, 'https://bondfire.invalid');
  const m = u.pathname.match(/^\/api\/orgs\/([^/]+)\/(.+?)\/?$/);
  if (!m) return null;
  const orgId = decodeURIComponent(m[1]);
  for (const kind of [...PRIVATE_KINDS].sort((a, b) => b.length - a.length)) {
    if (m[2] === kind || m[2] === kind + '/index') return { orgId, kind, id: u.searchParams.get('id') || '', url: u };
    if (m[2].startsWith(kind + '/')) {
      const tail = m[2].slice(kind.length + 1);
      if (!tail.includes('/')) return { orgId, kind, id: decodeURIComponent(tail), url: u };
    }
  }
  return null;
}
export function contentContext(orgId, kind, id) {
  return JSON.stringify(['bondfire-private-content', 1, orgId, kind, id]);
}
export function isCiphertext(value, context) {
  try {
    const b = typeof value === 'string' ? JSON.parse(value) : value;
    if (!b || ![2,3].includes(b.v) || b.alg !== 'A256GCM' || b.aad !== context) return false;
    if (Object.keys(b).sort().join(',') !== (b.v===3?'aad,alg,ct,epoch,iv,scope,v':'aad,alg,ct,iv,v')) return false;
    if(b.v===3&&(!['viewer','member','admin'].includes(b.scope)||!Number.isSafeInteger(b.epoch)||b.epoch<1))return false;
    const decode = (s) => typeof s === 'string' && /^[A-Za-z0-9_-]+$/.test(s) ? atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - s.length % 4) % 4)) : '';
    return decode(b.iv).length === 12 && decode(b.ct).length >= 16 && b.ct.length <= 48 * 1024 * 1024;
  } catch { return false; }
}

export async function deviceKeyId(jwk) {
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify({crv:jwk.crv,kty:jwk.kty,x:jwk.x,y:jwk.y})));
  return [...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,'0')).join('');
}
