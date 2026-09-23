import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../../utils/api.js';
import { WORK_MODULES, WORK_LABELS, DECISION_STATUSES, canWork, nextDueDate } from '../../../shared/workModel.js';
import { openWorkSession, readAllWork, saveWork, workMemberNames } from './workClient.js';
import WorkRecordForm, { Field, Select, MembersPicker } from './WorkRecordForm.jsx';
import Treasury from './Treasury.jsx';
import WorkSettings from './WorkSettings.jsx';
import './work.css';

export const WORK_HELP = {
  tasks: 'Create a task, add a checklist and due date, then assign the work. My tasks and Due soon narrow the list. Complete a recurring task to create the next occurrence. Link a Case, Decision, Meeting, Event or document to keep its context.',
  groups: 'A Working Group is part of this organization. Add members and coordinators, then link work or create it from this page. Restricted visibility also applies to workflow records linked to the group. Existing Drive documents keep their own sharing rules.',
  decisions: 'Record the question and the method your group uses. Update the outcome when the decision is made. Adopted decisions can create implementation Tasks; their completion appears here. Use a review date and supersession links to keep the register useful.',
  cases: 'Handle ordinary submissions in Public Inbox. Promote only those needing continuing work. Cases preserve the original submission, distinguish internal notes from recorded external communications, and support follow-up Tasks. Submitting a public form never grants access here.',
  treasury: 'Create and name your own funds, then record income, expenses, reimbursements or transfers. Amounts use two decimal places. Pending approvals, unpaid reimbursements, drafts and void records do not affect balances. Public transparency is off until an administrator previews and publishes selected information.',
};
export const workLink = (orgId, type, id) => `/org/${encodeURIComponent(orgId)}/${['funds', 'transactions'].includes(type) ? 'treasury' : type === 'groups' ? 'working-groups' : type}?${new URLSearchParams({ type, record: id })}`;
const formatDate = value => value ? new Date(value).toLocaleString() : '';

export default function WorkPage({ page }) {
  const { orgId } = useParams();
  const [search, setSearch] = useSearchParams();
  const type = page === 'treasury' ? (search.get('type') === 'funds' ? 'funds' : 'transactions') : page === 'working-groups' ? 'groups' : page;
  const [session, setSession] = useState(null), [all, setAll] = useState({}), [members, setMembers] = useState([]), [catalog, setCatalog] = useState({});
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [editor, setEditor] = useState(null), [settingsOpen, setSettingsOpen] = useState(false), [accessOpen, setAccessOpen] = useState(false);
  const [query, setQuery] = useState(''), [view, setView] = useState('open'), [groupFilter, setGroupFilter] = useState(''), [linkedFilter, setLinkedFilter] = useState('');
  const generation = useRef(0);
  const load = useCallback(async () => {
    const seq = ++generation.current;
    setLoading(true); setError('');
    try {
      const s = await openWorkSession(orgId);
      const [records, names] = await Promise.all([readAllWork(s), workMemberNames(orgId)]);
      const config = await api(`/api/orgs/${encodeURIComponent(orgId)}/modules`);
      const external = {};
      const sources = [['meetings', 'meetings', 'meetings'], ['events', 'events', 'events'], ['people', 'people', 'people'], ['needs', 'needs', 'needs'], ['drive', 'drive', null]];
      await Promise.all(sources.map(async ([module, route, key]) => {
        if (!config.enabled_modules?.includes(module)) return;
        try {
          const data = await api(`/api/orgs/${encodeURIComponent(orgId)}/${route}`);
          if (key) external[route] = data[key] || [];
          else for (const k of ['folders', 'files', 'notes']) external[`drive/${k}`] = data[k] || [];
        } catch { /* An inaccessible source contributes no names or counts. */ }
      }));
      if (seq !== generation.current) return;
      setSession(s); setAll(records); setMembers(names.length ? names : [{ id: s.context.userId, label: 'You', role: s.context.role }]);
      setCatalog({ ...external, ...Object.fromEntries(Object.entries(records).filter(([key]) => !key.endsWith('-settings')).map(([key, rows]) => [key, rows.filter(r => !r.locked)])) });
    } catch (e) { if (seq === generation.current) { setError(friendlyError(e)); setSession(null); setAll({}); setCatalog({}); } }
    finally { if (seq === generation.current) setLoading(false); }
  }, [orgId]);
  useEffect(() => { setSession(null); setAll({}); setEditor(null); load(); return () => { generation.current++; }; }, [load]);
  useEffect(() => { setEditor(null); setAccessOpen(false); setQuery(''); setView('open'); }, [page]);
  useEffect(() => { const refresh = () => load(); window.addEventListener('bf:modules_changed', refresh); return () => window.removeEventListener('bf:modules_changed', refresh); }, [load]);
  const permission = session?.context.permissions[WORK_MODULES[type]];
  const can = action => session && canWork(session.context.role, permission, action);
  const selected = (all[type] || []).find(r => r.id === search.get('record'));
  const names = id => members.find(m => m.id === id)?.label || `Member ${String(id).slice(0, 8)}`;
  const caseSettings = (all['case-settings'] || []).find(r => r.id === 'settings' && !r.locked) || {};

  async function run(fn, message = 'Saved.') {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try { const result = await fn(); setNotice(message); await load(); return result; }
    catch (e) { setError(friendlyError(e)); throw e; }
    finally { setBusy(false); }
  }
  const safely = fn => { fn().catch(() => {}); };
  async function save(data, access) {
    const initial = editor || {};
    await run(async () => {
      const parts = { content: data };
      if (!initial.revision) {
        if (can('close')) parts.state = { status: type === 'decisions' ? 'proposed' : type === 'transactions' ? 'posted' : 'open', archived: false };
        if (initial.assignees && can('assign')) parts.assignment = { assignees: initial.assignees };
      }
      const result = await saveWork(session, all, type, initial, { parts, ...(!initial.revision ? access : {}) });
      setEditor(null); setSearch({ type, record: result.id });
    });
  }
  async function updatePart(record, part, value) {
    await run(() => saveWork(session, all, type, record, { action: part, parts: { [part]: value } }));
  }
  async function completeTask(record) {
    await run(async () => {
      await saveWork(session, all, 'tasks', record, { action: 'state', parts: { state: { ...record.clearParts.state, status: 'completed', completedAt: Date.now() } } });
      const dueDate = nextDueDate(record.dueDate, record.recurrence);
      if (dueDate && can('create')) {
        const id = `${record.id.split(':repeat:')[0]}:repeat:${dueDate}`;
        const parts = { content: { ...record.clearParts.content, dueDate, checklist: (record.checklist || []).map(i => ({ ...i, done: false })) }, state: { status: 'open', archived: false } };
        if (can('assign')) parts.assignment = record.clearParts.assignment || { assignees: [] };
        try { await saveWork(session, all, 'tasks', { id }, { grants: record.grants, parents: record.parents, parts }); }
        catch (e) { if (e.code !== 'PRIVATE_REVISION_CONFLICT') throw new Error(`Task completed, but its next occurrence could not be created. ${e.message}`); }
      }
    }, 'Task completed.');
  }
  function newRelated(targetType, source) {
    const params = new URLSearchParams({ fromType: type, fromId: source.id, new: '1' });
    window.location.hash = workLink(orgId, targetType, '').split('?')[0] + '?' + params;
  }
  useEffect(() => {
    if (!session || search.get('new') !== '1') return;
    const sourceType = search.get('fromType'), sourceId = search.get('fromId');
    const source = all[sourceType]?.find(r => r.id === sourceId && !r.locked);
    if (source) setEditor({ title: '', parents: [{ type: sourceType, id: sourceId }], grants: source.grants, links: [{ type: sourceType, id: sourceId }], groupId: sourceType === 'groups' ? sourceId : source.groupId || '' });
    else if (catalog[sourceType]?.some(r => r.id === sourceId)) setEditor({ title: '', links: [{ type: sourceType, id: sourceId }] });
    setSearch({ type });
  }, [session, search, all, catalog, type, setSearch]);

  const today = new Date().toISOString().slice(0, 10), soon = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const rows = (all[type] || []).filter(r => {
    if (r.locked) return view !== 'archived';
    if (view === 'archived' ? !r.archived : r.archived) return false;
    if (view === 'completed' && !['completed', 'closed', 'resolved'].includes(r.status)) return false;
    if (view === 'open' && ['completed', 'closed', 'resolved', 'void'].includes(r.status)) return false;
    if (view === 'mine' && !r.assignees.includes(session?.context.userId)) return false;
    if (view === 'soon' && (!r.dueDate || r.dueDate < today || r.dueDate > soon || ['completed', 'closed'].includes(r.status))) return false;
    if (view === 'overdue' && (!r.dueDate || r.dueDate >= today || ['completed', 'closed'].includes(r.status))) return false;
    if (linkedFilter && ![...(r.parents || []), ...(r.links || [])].some(ref => `${ref.type}:${ref.id}` === linkedFilter)) return false;
    if (groupFilter && !(r.ancestors || r.parents).some(p => p.type === 'groups' && p.id === groupFilter)) return false;
    return [r.title, r.description, r.caseType, r.outcome, ...(r.labels || [])].join(' ').toLowerCase().includes(query.toLowerCase());
  });
  const title = page === 'treasury' ? 'Treasury' : WORK_LABELS[type];
  return <main className="work-page">
    <div className="work-heading"><div><h1>{title}</h1><p className="helper">{type === 'tasks' ? 'Keep track of the work and who is doing it.' : type === 'groups' ? 'Organize activity within your organization.' : type === 'decisions' ? 'What was decided, how, and what happened next.' : type === 'cases' ? 'Keep requests, follow-up and outcomes together.' : 'Collective funds and financial records.'}</p></div>
      <div className="work-actions"><button className="btn" disabled={busy || loading} onClick={load}>Refresh</button>{can('settings') && <button className="btn" onClick={() => setSettingsOpen(!settingsOpen)}>Module settings</button>}{can('create') && <button className="btn-red" onClick={() => { setEditor({}); setSearch({ type }); }}>New {type === 'groups' ? 'Working Group' : type === 'funds' ? 'fund' : type === 'transactions' ? 'transaction' : type.replace(/s$/, '')}</button>}</div>
    </div>
    <details className="card work-help"><summary>Help with {title}</summary><p>{WORK_HELP[page === 'working-groups' ? 'groups' : page]}</p><p>Changes are encrypted before saving. Refresh to see other members’ updates. A conflict preserves your unsaved form so you can compare it with the refreshed record. Offline changes stay in this open form until a save succeeds.</p></details>
    {error && <p role="alert" className="card error work-notice">{error}</p>}{notice && <p role="status" className="helper">{notice}</p>}
    {loading && !session && <p role="status">Opening encrypted workspace…</p>}
    {session && !can('view') && <p className="card work-notice">Your organization role does not have access to this module.</p>}
    {session && can('view') && <>
      {settingsOpen && <WorkSettings session={session} all={all} module={WORK_MODULES[type]} busy={busy} run={run} onClose={() => setSettingsOpen(false)} />}
      {page === 'treasury' && <Treasury session={session} all={all} rows={rows} type={type} setType={v => { setEditor(null); setSearch({ type: v }); }} onSelect={r => setSearch({ type, record: r.id })} busy={busy} run={run} onInlineEdit={async (r, patch) => { await run(() => saveWork(session, all, 'transactions', r, { parts: { content: { ...r.clearParts.content, ...patch } } })); }} />}
      {editor && <WorkRecordForm key={`${type}:${editor.id || 'new'}`} type={type} initial={editor} all={all} members={members} catalog={catalog} settings={caseSettings} me={session.context.userId} busy={busy} onSave={save} onCancel={() => setEditor(null)} />}
      {!editor && !selected && page !== 'treasury' && <>
        <div className="work-filters"><Field label="Search" value={query} onChange={e => setQuery(e.target.value)} placeholder={type === 'decisions' ? 'Did we ever decide this?' : 'Search records'} />
          <Select label="View" value={view} onChange={setView} options={[{ value: 'open', label: 'All open' }, { value: 'all', label: 'All active records' }, { value: 'mine', label: 'My assignments' }, { value: 'soon', label: 'Due within 7 days' }, { value: 'overdue', label: 'Overdue' }, { value: 'completed', label: 'Completed / closed' }, { value: 'archived', label: 'Archived' }]} />
          {type !== 'groups' && <Select label="Working Group" value={groupFilter} onChange={setGroupFilter} options={[{ value: '', label: 'All groups' }, ...(all.groups || []).filter(r => !r.locked).map(r => ({ value: r.id, label: r.title }))]} />}
          <Select label="Linked record" value={linkedFilter} onChange={setLinkedFilter} options={[{ value: '', label: 'Any linked record' }, ...Object.entries(catalog).flatMap(([kind, records]) => records.filter(r => !r.locked).map(r => ({ value: `${kind}:${r.id}`, label: `${r.title || r.name || 'Untitled'} (${kind})` })))]} />
        </div>
        <div className="work-cards">{rows.map(row => <button key={row.id} className="card work-record-card" onClick={() => setSearch({ type, record: row.id })}><strong>{row.title}</strong><span>{row.locked ? 'Open on a device with access to manage device keys.' : `${row.status}${row.dueDate ? ' · Due ' + row.dueDate : ''}${row.priority ? ' · ' + row.priority : ''}`}</span>{!row.locked && <span className="helper">{row.description?.slice(0, 180)}</span>}</button>)}</div>
        {!rows.length && <section className="card work-empty"><h2>{query || view !== 'open' ? 'No matching records' : `No ${title.toLowerCase()} yet`}</h2><p>{type === 'cases' ? 'Create a Case here or promote a submission from Public Inbox when it needs continuing work.' : 'Create your first record when there is work to track. You can add links and details as it develops.'}</p></section>}
      </>}
      {search.get('record') && !selected && !loading && <p className="card work-notice">This record is unavailable. It may have been removed or your access changed.</p>}
      {selected && !editor && <section className="card work-detail">
        <button className="btn" onClick={() => { setSearch({ type }); setAccessOpen(false); }}>Back to {title}</button>
        <h2>{selected.title}</h2>
        {selected.locked ? <p>This device does not yet have the record key. Open the record on a device that can read it and choose “Refresh device access” after approving this device in Security.</p> : <>
          <p className="helper">{type === 'cases' ? `Case ${selected.id.slice(0, 8).toUpperCase()} · ` : ''}{selected.status} · Created {formatDate(selected.createdAt)} · Updated {formatDate(selected.updatedAt)}</p>
          <p className="work-prose">{selected.description}</p>
          <div className="work-actions">{selected.permissions.edit && <button className="btn" onClick={() => setEditor(selected)}>Edit details</button>}{selected.canManageAccess && <button className="btn" onClick={() => setAccessOpen(!accessOpen)}>Manage access and relationships</button>}{selected.canManageAccess && <button className="btn" disabled={busy} onClick={() => safely(() => run(() => saveWork(session, all, type, selected, { action: 'access' }), 'Device access refreshed.'))}>Refresh device access</button>}{selected.permissions.close && <button className="btn" disabled={busy} onClick={() => { if (window.confirm(selected.archived ? 'Restore this record?' : 'Archive this record? You can restore it from the Archived view.')) safely(() => updatePart(selected, 'state', { ...selected.clearParts.state, archived: !selected.archived })); }}>{selected.archived ? 'Restore' : 'Archive'}</button>}</div>
          {accessOpen && <AccessEditor record={selected} type={type} all={all} catalog={catalog} members={members} me={session.context.userId} busy={busy} onSave={async access => { await run(() => saveWork(session, all, type, selected, { action: 'access', ...access })); setAccessOpen(false); }} />}
          {selected.permissions.assign && <AssignmentEditor key={`${selected.id}:${selected.revision}`} record={selected} members={members} busy={busy} onSave={ids => updatePart(selected, 'assignment', { assignees: ids })} />}
          {!selected.permissions.assign && <p>Assigned: {selected.assignees.map(names).join(', ') || 'Unassigned'}</p>}
          {selected.permissions.close && <StateEditor key={`state:${selected.id}:${selected.revision}`} type={type} record={selected} caseSettings={caseSettings} busy={busy} onSave={value => type === 'tasks' && value.status === 'completed' && selected.status !== 'completed' ? completeTask({ ...selected, clearParts: { ...selected.clearParts, state: value } }) : updatePart(selected, 'state', value)} />}
          {type === 'tasks' && <div><h3>Checklist</h3>{(selected.checklist || []).map((item, index) => <label className="work-check" key={index}><input type="checkbox" checked={item.done} disabled={busy || !selected.permissions.edit} onChange={() => safely(() => run(() => saveWork(session, all, type, selected, { parts: { content: { ...selected.clearParts.content, checklist: selected.checklist.map((c, i) => i === index ? { ...c, done: !c.done } : c) } } })))} />{item.text}</label>)}</div>}
          {type === 'groups' && <><h3>Members</h3><p>{(selected.members || []).map(names).join(', ') || 'No roster added yet.'}</p><p>Coordinators: {(selected.coordinators || []).map(names).join(', ') || 'None'}</p></>}
          {type === 'decisions' && <><h3>Proposal</h3><p className="work-prose">{selected.proposal}</p><p>Method: {selected.method === 'custom' ? selected.customMethod : selected.method}</p>{['origin', 'proposedDate', 'decidedDate', 'outcome', 'amendments', 'objections', 'notes', 'reviewDate'].map(k => selected[k] ? <p className="work-prose" key={k}><strong>{({ proposedDate: 'Proposed', decidedDate: 'Decided', reviewDate: 'Review date' })[k] || k}: </strong>{selected[k]}</p> : null)}{selected.supersedes && <LinkedRecord orgId={orgId} refValue={{ type: 'decisions', id: selected.supersedes }} catalog={catalog} />}{(all.decisions || []).filter(d => !d.locked && d.supersedes === selected.id).map(d => <p key={d.id}>Superseded by <Link to={workLink(orgId, 'decisions', d.id)}>{d.title}</Link></p>)}</>}
          {type === 'cases' && <><p>Type: {selected.caseType || 'Not specified'} · {selected.importantDates}</p><h3>Internal notes</h3><p className="work-prose">{selected.notes || 'No internal notes.'}</p><h3>Resolution / outcome</h3><p className="work-prose">{selected.outcome || 'Not recorded.'}</p>{selected.original && <details><summary>Original submission — preserved</summary><OriginalSubmission original={selected.original} /></details>}</>}
          {['tasks', 'cases', 'decisions'].includes(type) && <Timeline record={selected} type={type} busy={busy} names={names} onAdd={entry => run(() => saveWork(session, all, type, selected, { parts: { content: { ...selected.clearParts.content, timeline: [...(selected.timeline || []), { ...entry, at: Date.now(), by: session.context.userId }] } } }))} />}
          {type === 'transactions' && <><p>Approval: {selected.approvalRequired ? selected.approval : 'Not required'}{selected.approvalNote ? ' · ' + selected.approvalNote : ''}</p>{selected.permissions.approve && selected.approvalRequired && <div className="work-actions"><button className="btn" disabled={busy} onClick={() => safely(() => updatePart(selected, 'approval', { value: 'approved' }))}>Approve</button><button className="btn" disabled={busy} onClick={() => safely(() => updatePart(selected, 'approval', { value: 'rejected' }))}>Reject</button></div>}<p className="work-prose">{selected.notes}</p></>}
          <Relationships orgId={orgId} type={type} record={selected} all={all} catalog={catalog} onCreate={newRelated} context={session.context} />
          <details><summary>Change history</summary><ul>{selected.history.map(h => <li key={h.revision}>{formatDate(h.at)} · {h.action} · {names(h.actor_id)}</li>)}</ul></details>
        </>}
      </section>}
    </>}
  </main>;
}

function friendlyError(e) {
  const messages = { PRIVATE_REVISION_CONFLICT: 'This record changed elsewhere. Your form is still open; refresh and compare before saving.', PRIVATE_MODE_NOT_READY: 'Enable encrypted storage in Settings → Security before using these modules.', MODULE_DISABLED: 'This module is disabled. Enable it in Build.', KEY_RECIPIENT_MISSING: 'Device access changed. Refresh this page before saving.', NOT_FOUND: 'The record or a linked record is unavailable.', INSUFFICIENT_ROLE: 'Your role does not allow that action.' };
  return messages[e.code || e.message] || e.message || 'The change could not be saved. Check your connection and try again.';
}
function AssignmentEditor({ record, members, busy, onSave }) {
  const [ids, setIds] = useState(record.assignees || []);
  return <details><summary>Assignments</summary><MembersPicker label="Assigned organizers / members" members={members} value={ids} onChange={setIds} /><button className="btn" disabled={busy} onClick={() => onSave(ids).catch(() => {})}>Save assignments</button></details>;
}
function StateEditor({ type, record, caseSettings, busy, onSave }) {
  const [value, setValue] = useState(record.clearParts.state || {});
  const options = type === 'decisions' ? DECISION_STATUSES : type === 'tasks' ? ['open', 'in progress', 'blocked', 'completed'] : type === 'cases' ? [...new Set(['open', 'closed', ...(caseSettings.caseStatuses || [])])] : type === 'transactions' ? ['posted', 'draft', 'void'] : ['open', 'paused', 'closed'];
  return <details><summary>Status and outcome: {record.status}</summary><div className="work-form-grid"><Select label="Status" value={value.status || record.status} onChange={v => setValue({ ...value, status: v, ...(v === 'adopted' ? { decidedDate: value.decidedDate || new Date().toISOString().slice(0, 10) } : {}) })} options={[...new Set([...options, record.status])]} />{type === 'transactions' && record.type === 'reimbursement' && <Select label="Reimbursement" value={value.reimbursementState || 'requested'} onChange={v => setValue({ ...value, reimbursementState: v })} options={['requested', 'processing', 'paid']} />}{type === 'decisions' && <Field label="Decided date" type="date" value={value.decidedDate || ''} onChange={e => setValue({ ...value, decidedDate: e.target.value })} />}</div>{['decisions', 'cases'].includes(type) && <Field label="Outcome / resolution"><textarea className="textarea" value={value.outcome || ''} onChange={e => setValue({ ...value, outcome: e.target.value })} /></Field>}<button className="btn" disabled={busy} onClick={() => onSave(value).catch(() => {})}>Save status</button></details>;
}
function Timeline({ record, type, busy, onAdd, names }) {
  const [text, setText] = useState(''), [audience, setAudience] = useState('internal');
  return <section><h3>Updates / timeline</h3><ul className="work-timeline">{(record.timeline || []).map((e, i) => <li key={i}><strong>{e.audience === 'external' ? 'External communication (recorded)' : 'Internal update'}</strong><span className="helper"> · {formatDate(e.at)} · {names(e.by)}</span><p className="work-prose">{e.text}</p></li>)}</ul>{record.permissions.edit && <form onSubmit={e => { e.preventDefault(); onAdd({ text: text.trim(), audience }).then(() => setText('')).catch(() => {}); }}><Field label="Add update"><textarea required className="textarea" value={text} onChange={e => setText(e.target.value)} /></Field>{type === 'cases' && <Select label="Activity" value={audience} onChange={setAudience} options={[{ value: 'internal', label: 'Internal note' }, { value: 'external', label: 'Record an external communication' }]} />}<p className="helper">Recording an external communication does not send a message.</p><button className="btn" disabled={busy || !text.trim()}>Add update</button></form>}</section>;
}
export function LinkedRecord({ orgId, refValue, catalog }) {
  const { type, id } = refValue, row = catalog[type]?.find(r => r.id === id && !r.locked);
  if (!row) return <span className="helper">Linked record unavailable</span>;
  const to = WORK_MODULES[type] ? workLink(orgId, type, id) : type.startsWith('drive/') ? `/org/${orgId}/drive?item=${encodeURIComponent(type + ':' + id)}` : ['meetings', 'events'].includes(type) ? `/org/${orgId}/${type}/${encodeURIComponent(id)}` : `/org/${orgId}/${type}`;
  return <Link to={to}>{row.title || row.name || 'Untitled'}</Link>;
}
function Relationships({ orgId, type, record, all, catalog, onCreate, context }) {
  const related = Object.entries(all).filter(([kind]) => !kind.endsWith('-settings')).flatMap(([kind, rows]) => rows.filter(r => !r.locked && r.id !== record.id && (r.ancestors || r.parents).some(p => p.type === type && p.id === record.id)).map(r => ({ ...r, kind })));
  const ownLinks = [...(record.parents || []), ...(record.links || [])].filter((ref, index, arr) => arr.findIndex(p => p.type === ref.type && p.id === ref.id) === index);
  const tasks = related.filter(r => r.kind === 'tasks' && !r.archived), completed = tasks.filter(r => r.status === 'completed').length;
  return <section><h3>Related work</h3>{type === 'decisions' && <p>Implementation: {completed} / {tasks.length} Tasks complete <progress value={completed} max={Math.max(1, tasks.length)} aria-label="Implementation progress" /></p>}
    <ul>{ownLinks.map(ref => <li key={`${ref.type}:${ref.id}`}><LinkedRecord orgId={orgId} refValue={ref} catalog={catalog} /></li>)}{related.map(r => <li key={`${r.kind}:${r.id}`}><Link to={workLink(orgId, r.kind, r.id)}>{r.title}</Link> · {r.status}</li>)}</ul>
    <div className="work-actions">{['tasks', ...(type === 'groups' ? ['decisions', 'cases', 'funds'] : [])].filter(target => target !== type && context.enabled.includes(WORK_MODULES[target]) && canWork(context.role, context.permissions[WORK_MODULES[target]], 'create') && (type !== 'decisions' || record.status === 'adopted')).map(target => <button className="btn" key={target} onClick={() => onCreate(target, record)}>Create {target === 'tasks' ? 'Task' : target === 'funds' ? 'fund' : target.replace(/s$/, '')}</button>)}</div>
  </section>;
}
function OriginalSubmission({ original }) {
  return <div><p>Submitted {formatDate(original.submittedAt)}</p><dl>{Object.entries(original.data || {}).map(([key, value]) => <React.Fragment key={key}><dt>{key.replaceAll('_', ' ')}</dt><dd className="work-prose">{typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value ?? '')}</dd></React.Fragment>)}</dl></div>;
}
function AccessEditor({ record, type, all, catalog, members, me, busy, onSave }) {
  const [restricted, setRestricted] = useState(!!record.grants.length), [grants, setGrants] = useState(record.grants.length ? record.grants : [me]), [parents, setParents] = useState(record.parents), [target, setTarget] = useState('groups'), [id, setId] = useState(''), [error, setError] = useState('');
  return <fieldset><legend>Access and linked workflow records</legend><p className="helper">Each selected parent adds its access restrictions. Removing a parent may broaden access. Encrypted record keys are replaced on save.</p><label><input type="checkbox" checked={restricted} onChange={e => setRestricted(e.target.checked)} /> Selected members only</label>{restricted && <MembersPicker members={members} value={grants} onChange={setGrants} />}
    <ul>{parents.map((p, i) => <li key={`${p.type}:${p.id}`}>{catalog[p.type]?.find(r => r.id === p.id)?.title || 'Linked record unavailable'} <button className="btn" disabled={type === 'transactions' && p.type === 'funds'} onClick={() => setParents(parents.filter((_, j) => i !== j))}>Remove parent</button></li>)}</ul>
    <div className="work-actions"><Select label="Parent type" value={target} onChange={v => { setTarget(v); setId(''); }} options={Object.keys(all).filter(k => !k.endsWith('-settings'))} /><Select label="Parent" value={id} onChange={setId} options={[{ value: '', label: 'Choose record' }, ...(all[target] || []).filter(r => !r.locked && !(target === type && r.id === record.id)).map(r => ({ value: r.id, label: r.title }))]} /><button className="btn" disabled={!id} onClick={() => { if (!parents.some(p => p.type === target && p.id === id)) setParents([...parents, { type: target, id }]); }}>Add parent</button></div>
    {error && <p role="alert">{error}</p>}<button className="btn-red" disabled={busy} onClick={() => { if (restricted && !grants.includes(me)) { setError('Keep yourself selected.'); return; } if (window.confirm('Save these access changes and replace the record encryption key?')) onSave({ grants: restricted ? grants : [], parents }).catch(e => setError(e.message)); }}>Save access</button>
  </fieldset>;
}
