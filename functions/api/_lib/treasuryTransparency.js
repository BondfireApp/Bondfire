import { bad, json } from './http.js';
import { buildTreasuryLedger, validPublicTreasuryRecord, validateLedgerRelations } from '../../../shared/treasuryTransparency.js';

const CONFIG = 'work/treasury-config';
const kind = type => `work/treasury-${type}`;
export async function treasuryTransparencyState(db, orgId) {
  const row = await db.prepare('SELECT source_revision,payload,updated_at FROM org_public_projections WHERE org_id=? AND kind=? AND id=?').bind(orgId, CONFIG, 'settings').first();
  const data = row ? JSON.parse(row.payload) : {};
  return { enabled: data.enabled === true, version: row?.source_revision || 0, updatedAt: row?.updated_at || null };
}
export function assertTransparency(db, orgId, version) {
  return db.prepare('INSERT OR REPLACE INTO org_work_assertions VALUES(?,?,(SELECT CASE WHEN COALESCE((SELECT source_revision FROM org_public_projections WHERE org_id=? AND kind=? AND id=?),0)=? THEN 1 ELSE 0 END))').bind(orgId, 'treasury-config', orgId, CONFIG, 'settings', version);
}
async function rows(db, orgId) {
  const result = await db.prepare('SELECT kind,id,payload,source_revision FROM org_public_projections WHERE org_id=? AND kind IN (?,?)').bind(orgId, kind('funds'), kind('transactions')).all();
  return (result.results || []).map(r => ({ type: r.kind === kind('funds') ? 'funds' : 'transactions', id: r.id, revision: r.source_revision, ...JSON.parse(r.payload) }));
}
export async function readTreasuryLedger(db, orgId) {
  const records = await rows(db, orgId);
  return buildTreasuryLedger(records.filter(r => r.type === 'funds').map(r => ({ ...r.public, id: r.id })), records.filter(r => r.type === 'transactions').map(r => ({ ...r.public, id: r.id, approvalRequired: r.approvalRequired, history: r.history || [] })));
}
function upsert(db, orgId, type, id, revision, payload, at) {
  return db.prepare('INSERT INTO org_public_projections VALUES(?,?,?,?,?,?) ON CONFLICT(org_id,kind,id) DO UPDATE SET source_revision=excluded.source_revision,payload=excluded.payload,updated_at=excluded.updated_at').bind(orgId, kind(type), id, revision, JSON.stringify(payload), at);
}
const exact = (o, keys) => o && typeof o === 'object' && !Array.isArray(o) && Object.keys(o).every(k => keys.includes(k));
export async function toggleTreasuryTransparency({ db, orgId, request, context, userId, role, access, assertRevision, runBatch }) {
  const state = context.transparency;
  if (request.method === 'GET') return json({ ok: true, ...state });
  if (!['PUT', 'DELETE'].includes(request.method)) return bad(405, 'METHOD_NOT_ALLOWED');
  const body = await request.json().catch(() => null);
  if (!exact(body, ['version', 'records']) || body.version !== state.version) return bad(409, 'PRIVATE_REVISION_CONFLICT');
  const enabled = request.method === 'PUT', at = Date.now();
  const statements = [assertTransparency(db, orgId, state.version)];
  // Retain the history of already-public entries when the organization switches off.
  // The public reader is gated by the configuration, including while disabled.
  const previous = enabled ? await rows(db, orgId) : [];
  statements.push(db.prepare("DELETE FROM org_public_projections WHERE org_id=? AND kind IN ('work/treasury','work/treasury-config')").bind(orgId));
  if (enabled) {
    if (state.enabled) return bad(409, 'TRANSPARENCY_ALREADY_ENABLED');
    const policies = [...context.policies.values()].filter(p => ['funds', 'transactions'].includes(p.type));
    if (!Array.isArray(body.records) || body.records.length !== policies.length) return bad(400, 'COMPLETE_LEDGER_REQUIRED');
    statements.push(db.prepare("DELETE FROM org_public_projections WHERE org_id=? AND kind IN ('work/treasury-funds','work/treasury-transactions')").bind(orgId));
    const seen = new Set(), funds = [], transactions = [];
    for (const r of body.records) {
      if (!exact(r, ['type', 'id', 'revision', 'public']) || !['funds', 'transactions'].includes(r.type) || !validPublicTreasuryRecord(r.type, r.public)) return bad(400, 'SAFE_PUBLIC_FIELDS_REQUIRED');
      const key = `${r.type}:${r.id}`, p = context.policies.get(key);
      if (seen.has(key) || !p || !access(context, p, userId, role) || p.revision !== r.revision) return bad(409, 'COMPLETE_LEDGER_REQUIRED');
      seen.add(key);
      const record = { ...r.public, id: r.id };
      if (r.type === 'funds') funds.push(record); else transactions.push(record);
      statements.push(assertRevision(db, orgId, r.type, r.id, r.revision));
      const old = previous.find(old => old.type === r.type && old.id === r.id);
      const history = old?.history || [];
      if (r.type === 'transactions' && old && Object.keys(r.public).some(k => r.public[k] !== old.public[k])) history.push({ ...old.public, changedAt: at });
      statements.push(upsert(db, orgId, r.type, r.id, r.revision, { public: r.public, approvalRequired: !!p.approval_required, history }, at));
    }
    try { validateLedgerRelations(funds, transactions); } catch { return bad(400, 'INVALID_LEDGER_RELATION'); }
    statements.push(db.prepare("INSERT OR REPLACE INTO org_work_assertions VALUES(?,?,(SELECT CASE WHEN COUNT(*)=? THEN 1 ELSE 0 END FROM org_private_records WHERE org_id=? AND kind IN ('work/funds','work/transactions')))").bind(orgId, 'treasury-count', policies.length, orgId));
  } else if (body.records !== undefined) return bad(400, 'INVALID_REQUEST');
  statements.push(db.prepare('INSERT INTO org_public_projections VALUES(?,?,?,?,?,?)').bind(orgId, CONFIG, 'settings', state.version + 1, JSON.stringify({ enabled }), at));
  statements.push(db.prepare('DELETE FROM org_work_assertions WHERE org_id=?').bind(orgId));
  return runBatch(db, statements, { ok: true, enabled, version: state.version + 1 });
}

// Called before every financial write. Safe public updates and ciphertext commit together.
export async function prepareTreasuryPublicWrite({ db, orgId, type, id, action, revision, body, context, approvalRequired, parents }) {
  const statements = [assertTransparency(db, orgId, context.transparency.version)];
  if (!context.transparency.enabled) {
    if (body.public !== undefined) return { error: bad(409, 'TRANSPARENCY_CHANGED') };
    return { statements };
  }
  if (!validPublicTreasuryRecord(type, body.public)) return { error: bad(400, 'SAFE_PUBLIC_FIELDS_REQUIRED') };
  const all = await rows(db, orgId), old = all.find(r => r.type === type && r.id === id);
  if (action !== 'create' && !old) return { error: bad(409, 'COMPLETE_LEDGER_REQUIRED') };
  const next = body.public;
  if (old) {
    const allowed = type === 'funds' ? (action === 'edit' ? ['name'] : [])
      : action === 'edit' ? ['name', 'date', 'amountMinor'] : action === 'state' ? ['status', 'reimbursementState'] : action === 'approval' ? ['approval'] : [];
    for (const k of new Set([...Object.keys(old.public), ...Object.keys(next)])) {
      if (old.public[k] !== next[k] && !allowed.includes(k) && !(type === 'transactions' && action === 'edit' && k === 'approval' && next.approval === 'pending')) return { error: bad(400, 'PUBLIC_LEDGER_FIELD_LOCKED') };
    }
  }
  if (type === 'transactions') {
    if (action === 'create' && !body.parts.state && (next.status !== 'posted' || next.reimbursementState !== 'requested')) return { error: bad(403, 'INSUFFICIENT_ROLE') };
    if (action === 'create' && next.approval !== 'pending') return { error: bad(403, 'INSUFFICIENT_ROLE') };
    if (action === 'edit' && next.approval !== 'pending') return { error: bad(400, 'APPROVAL_RESET_REQUIRED') };
    if (![next.fundId, ...(next.type === 'transfer' ? [next.toFundId] : [])].every(fundId => parents.some(p => p.type === 'funds' && p.id === fundId))) return { error: bad(400, 'INVALID_LEDGER_RELATION') };
    try { validateLedgerRelations(all.filter(r => r.type === 'funds').map(r => ({ ...r.public, id: r.id })), [next]); } catch { return { error: bad(400, 'INVALID_LEDGER_RELATION') }; }
  }
  const history = old?.history || [], at = Date.now();
  if (type === 'transactions' && old && Object.keys(next).some(k => next[k] !== old.public[k])) history.push({ ...old.public, changedAt: at });
  statements.push(upsert(db, orgId, type, id, revision, { public: next, approvalRequired, history }, at));
  statements.push(db.prepare('UPDATE org_public_projections SET updated_at=? WHERE org_id=? AND kind=? AND id=?').bind(at, orgId, CONFIG, 'settings'));
  return { statements };
}
