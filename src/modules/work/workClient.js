import { api } from '../../utils/api.js';
import { encryptPrivate, decryptPrivate, loadPrivateKey } from '../../lib/privateCrypto.js';
import { randomOrgKey, wrapForMember, unwrapOrgKey, ensureDeviceKeypair, decryptWithOrgKey, getCachedOrgKey } from '../../lib/zk.js';
import { deviceKeyId } from '../../../shared/privateContent.js';
import { WORK_MODULES, PARTS, partKind, canWork } from '../../../shared/workModel.js';

import { publicTreasuryRecord, validPublicTreasuryRecord } from '../../../shared/treasuryTransparency.js';

const base = orgId => `/api/orgs/${encodeURIComponent(orgId)}/work`;
export async function openWorkSession(orgId) {
  const [context, status, device] = await Promise.all([api(base(orgId) + '/context'), api(`/api/orgs/${encodeURIComponent(orgId)}/privacy`), ensureDeviceKeypair({ register: false })]);
  const key = await loadPrivateKey(orgId, status, api);
  return { orgId, context, key, deviceId: await deviceKeyId(device.pubJwk) };
}
export async function readWork(session, type) {
  if (!session.context.enabled.includes(WORK_MODULES[type]) || !canWork(session.context.role, session.context.permissions[WORK_MODULES[type]], 'view')) return [];
  const result = await api(`${base(session.orgId)}/${type}?deviceId=${session.deviceId}`);
  return Promise.all(result.records.map(async row => {
    if (!row.wrappedKey) return { ...row, locked: true, title: 'Device access needed', archived: false };
    const itemKey = await unwrapOrgKey(row.wrappedKey), parts = {};
    for (const [part, ciphertext] of Object.entries(row.parts)) {
      const outer = await decryptPrivate(session.key, ciphertext, session.orgId, partKind(type, part), row.id);
      if (outer?.format !== 'bondfire-work-item-v1' || typeof outer.ciphertext !== 'string') throw new Error('Invalid workflow encryption envelope.');
      parts[part] = await decryptPrivate(itemKey, outer.ciphertext, session.orgId, partKind(type, part), row.id);
    }
    const content = { ...(parts.content || {}), groupId: row.parents.find(p => p.type === 'groups')?.id || '' }, state = parts.state || {}, assignment = parts.assignment || {}, approval = parts.approval || {};
    // Permission-controlled fields come only from their own encrypted fragment.
    return { ...content, ...row, recordType: row.type, type: content.type || row.type, itemKey, clearParts: parts, status: state.status || (type === 'decisions' ? 'proposed' : type === 'transactions' ? 'posted' : 'open'), archived: !!state.archived, completedAt: state.completedAt || null, outcome: state.outcome || '', decidedDate: state.decidedDate || '', reimbursementState: state.reimbursementState || 'requested', assignees: Array.isArray(assignment.assignees) ? assignment.assignees : [], approval: approval.value || 'pending', approvalNote: approval.note || '', original: parts.source || null };
  }));
}
export async function readAllWork(session) {
  const entries = await Promise.all(Object.keys(WORK_MODULES).map(async type => [type, await readWork(session, type)]));
  const all = Object.fromEntries(entries);
  function ancestors(record, seen = new Set()) {
    const result = [];
    for (const ref of record.parents || []) {
      const marker = `${ref.type}:${ref.id}`;
      if (seen.has(marker)) continue;
      seen.add(marker); result.push(ref);
      const parent = all[ref.type]?.find(r => r.id === ref.id && !r.locked);
      if (parent) result.push(...ancestors(parent, seen));
    }
    return result;
  }
  for (const rows of Object.values(all)) for (const record of rows) record.ancestors = ancestors(record);
  return all;
}
function accessFor(context, all, type, grants, parents, userId, role, seen = new Set()) {
  if (!canWork(role, context.permissions[WORK_MODULES[type]], 'view') || (grants.length && !grants.includes(userId))) return false;
  return parents.every(ref => {
    const marker = `${ref.type}:${ref.id}`;
    if (seen.has(marker)) return false;
    const record = all[ref.type]?.find(r => r.id === ref.id);
    return record && accessFor(context, all, ref.type, record.grants, record.parents, userId, role, new Set([...seen, marker]));
  });
}
export async function saveWork(session, all, type, record, { action = 'edit', parts, grants, parents, source } = {}) {
  if (session.key.rotationRequired) throw new Error('Membership changed. Rotate organization keys in Security before saving.');
  const creating = !record?.revision, id = record?.id || crypto.randomUUID();
  if (creating) action = 'create';
  const accessChange = creating || action === 'access';
  const itemKey = accessChange ? randomOrgKey() : record.itemKey;
  if (!itemKey) throw new Error('Open this record on an approved device before changing it.');
  const body = { id, action, revision: record?.revision || 0, parts: {} };
  if (accessChange) {
    body.grants = grants ?? record?.grants ?? [];
    body.parents = parents ?? record?.parents ?? [];
    const eligible = session.context.roster.filter(m => m.device_id && accessFor(session.context, all, type, body.grants, body.parents, m.user_id, m.role));
    if (!eligible.some(m => m.user_id === session.context.userId && m.device_id === session.deviceId)) throw new Error('Register this device in Security before creating encrypted records.');
    body.wraps = await Promise.all(eligible.map(async m => ({ userId: m.user_id, deviceId: m.device_id, wrappedKey: await wrapForMember(itemKey, typeof m.public_key === 'string' ? JSON.parse(m.public_key) : m.public_key) })));
  }
  if (source && creating) body.source = source;
  const clear = action === 'access' ? record.clearParts : parts;
  for (const [part, value] of Object.entries(clear || {})) {
    if (!PARTS.includes(part)) throw new Error('Unknown record section.');
    const inner = await encryptPrivate(itemKey, value, session.orgId, partKind(type, part), id);
    body.parts[part] = await encryptPrivate(session.key, { format: 'bondfire-work-item-v1', ciphertext: inner }, session.orgId, partKind(type, part), id);
  }
  if (session.context.transparency?.enabled && ['funds', 'transactions'].includes(type)) {
    const merged = { ...(record?.clearParts || {}), ...(clear || {}) };
    const current = { ...merged.content, ...merged.state, approval: action === 'edit' || creating ? 'pending' : merged.approval?.value || 'pending' };
    body.public = publicTreasuryRecord(type, current);
    if (!validPublicTreasuryRecord(type, body.public)) throw new Error('Add a short public transaction name without personal information before saving.');
  }
  return api(`${base(session.orgId)}/${type}${creating ? '' : '/' + encodeURIComponent(id)}`, { method: creating ? 'POST' : 'PUT', body: JSON.stringify(body) });
}
export async function workMemberNames(orgId) {
  try {
    const data = await api(`/api/orgs/${encodeURIComponent(orgId)}/members`), key = getCachedOrgKey(orgId);
    return await Promise.all((data.members || []).map(async member => {
      let name = member.is_self ? 'You' : '';
      if (key && member.encrypted_blob) { try { const profile = JSON.parse(await decryptWithOrgKey(key, member.encrypted_blob)); name = profile.displayName || profile.display_name || profile.name || profile.username || name; } catch {} }
      return { id: member.userId, label: name || `Member ${member.userId.slice(0, 8)}`, role: member.role };
    }));
  } catch { return []; }
}
export async function promoteSubmission(session, all, item) {
  const existing = all.cases?.find(c => c.source?.id === item.id && c.source?.type === item.type);
  if (existing) return { id: existing.id };
  // Preserve the original sealed submission in place and include its full opened data,
  // including future attachment fields, in the restricted Case source section.
  const { openSubmission } = await import('../../../shared/privateSubmission.js');
  const submissions = await api(`/api/orgs/${encodeURIComponent(session.orgId)}/privacy/submissions`);
  const original = submissions.submissions.find(s => s.id === item.id && s.type === item.type);
  if (!original) throw new Error('The original submission is no longer available.');
  const privateKey = session.key.scopes?.admin?.submissions?.[original.epoch];
  if (!privateKey) throw new Error('Restore administrator encryption keys in Security to open this submission.');
  const opened = await openSubmission(session.orgId, original, privateKey);
  return saveWork(session, all, 'cases', null, {
    grants: [session.context.userId], parents: [], source: { type: item.type, id: item.id },
    parts: { content: { title: item.title || 'Public intake follow-up', description: item.details || '', caseType: '', priority: 'normal', labels: [], links: [], timeline: [] }, state: { status: 'open', archived: false }, assignment: { assignees: [session.context.userId] }, source: { submittedAt: original.created_at, data: opened } },
  });
}

export function completePublicLedger(all) {
  return ['funds', 'transactions'].flatMap(type => (all[type] || []).map(record => {
    if (record.locked) throw new Error('Open every Treasury record on this device before enabling transparency. No record can be left out.');
    const safe = publicTreasuryRecord(type, record);
    if (!validPublicTreasuryRecord(type, safe)) throw new Error(`Add a public transaction name for “${record.title}” before enabling transparency.`);
    return { type, id: record.id, revision: record.revision, public: safe };
  }));
}
