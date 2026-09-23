import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../utils/api.js';
import { canWork } from '../../../shared/workModel.js';
import { openWorkSession, readAllWork, promoteSubmission } from './workClient.js';
import './work.css';

const route = (orgId, type, id) => `/org/${encodeURIComponent(orgId)}/${type}?${new URLSearchParams({ record: id })}`;
export function PromoteToCase({ orgId, item }) {
  const [enabled, setEnabled] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [caseId, setCaseId] = useState('');
  useEffect(() => { let alive = true; api(`/api/orgs/${encodeURIComponent(orgId)}/modules`).then(r => alive && setEnabled(r.enabled_modules?.includes('cases'))).catch(() => {}); return () => { alive = false; }; }, [orgId]);
  if (!enabled || !['intake', 'rsvp'].includes(item.type)) return null;
  return <div>{caseId ? <Link to={route(orgId, 'cases', caseId)}>Open Case</Link> : <button className="btn" disabled={busy} onClick={async () => {
    setBusy(true); setError('');
    try { const session = await openWorkSession(orgId), all = await readAllWork(session), result = await promoteSubmission(session, all, item); setCaseId(result.id); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }}>{busy ? 'Creating encrypted Case…' : 'Promote to Case'}</button>}{error && <p role="alert" className="error">{error}</p>}</div>;
}
export function WorkFromRecord({ orgId, type, id }) {
  const [enabled, setEnabled] = useState([]);
  useEffect(() => { let alive = true; api(`/api/orgs/${encodeURIComponent(orgId)}/modules`).then(r => alive && setEnabled(r.enabled_modules || [])).catch(() => {}); return () => { alive = false; }; }, [orgId]);
  return <div className="work-actions">{['tasks', ...(type === 'meetings' ? ['decisions'] : [])].filter(target => enabled.includes(target)).map(target => <Link className="btn" key={target} to={`/org/${encodeURIComponent(orgId)}/${target}?${new URLSearchParams({ new: '1', fromType: type, fromId: id })}`}>Create {target === 'tasks' ? 'Task' : 'Decision'}</Link>)}</div>;
}
export function WorkDashboard({ orgId, enabledModules }) {
  const [data, setData] = useState(null), [error, setError] = useState('');
  const enabled = ['tasks', 'cases', 'decisions', 'treasury'].filter(module => enabledModules?.has(module)).join(',');
  useEffect(() => {
    let alive = true; setData(null); setError('');
    if (!enabled) return () => { alive = false; };
    (async () => { try { const session = await openWorkSession(orgId), records = await readAllWork(session); if (alive) setData({ session, records }); } catch { if (alive) setError('Workflow summaries could not be loaded. Open a module or refresh to retry.'); } })();
    return () => { alive = false; };
  }, [orgId, enabled]);
  if (!enabled) return null;
  if (error) return <p className="helper">{error}</p>;
  if (!data) return null;
  const { session, records } = data, today = new Date().toISOString().slice(0, 10), soon = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const blocks = [
    ['tasks', 'Tasks due soon', (records.tasks || []).filter(r => r.dueDate && r.dueDate <= soon && r.status !== 'completed')],
    ['cases', 'Cases needing attention', (records.cases || []).filter(r => !['closed', 'resolved'].includes(r.status) && (r.priority === 'urgent' || r.priority === 'high' || (r.dueDate && r.dueDate <= soon)))],
    ['decisions', 'Decisions awaiting action or review', (records.decisions || []).filter(r => ['proposed', 'under discussion'].includes(r.status) || (r.reviewDate && r.reviewDate <= today))],
    ['treasury', 'Reimbursements awaiting processing', (records.transactions || []).filter(r => r.type === 'reimbursement' && r.reimbursementState !== 'paid' && r.status !== 'void')],
  ].filter(([module]) => enabledModules.has(module) && canWork(session.context.role, session.context.permissions[module], 'view')).map(([module, title, rows]) => [module, title, rows.filter(r => !r.locked && !r.archived)]).filter(([, , rows]) => rows.length);
  if (!blocks.length) return null;
  return <div className="work-dashboard">{blocks.map(([module, title, rows]) => <section className="card" key={module}><h3>{title}</h3><ul>{rows.slice(0, 5).map(r => <li key={r.id}><Link to={module === 'treasury' ? `/org/${orgId}/treasury?type=transactions&record=${encodeURIComponent(r.id)}` : route(orgId, module, r.id)}>{r.title}</Link>{r.dueDate && <span> · {r.dueDate}</span>}</li>)}</ul>{rows.length > 5 && <p className="helper">{rows.length - 5} more</p>}</section>)}</div>;
}
export function TreasuryPublicLink({ slug }) {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => { let alive = true; fetch(`/api/p/${encodeURIComponent(slug)}/treasury`, { credentials: 'omit', cache: 'no-store' }).then(r => alive && setEnabled(r.ok)).catch(() => {}); return () => { alive = false; }; }, [slug]);
  if (!enabled) return null;
  const customPath = !window.location.hash.startsWith('#/');
  return <div className="work-page"><a href={customPath ? '/treasury' : `#/p/${encodeURIComponent(slug)}/treasury`}>Financial transparency</a></div>;
}
