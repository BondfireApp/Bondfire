import React, { useState } from 'react';
import { DECISION_METHODS, moneyMinor, validateTransaction } from '../../../shared/workModel.js';

export function Field({ label, children, ...props }) {
  return <label className="work-field"><span>{label}</span>{children || <input className="input" {...props} />}</label>;
}
export function Select({ label, value, onChange, options, ...props }) {
  return <Field label={label}><select className="input" value={value || ''} onChange={e => onChange(e.target.value)} {...props}>{options.map(o => <option key={typeof o === 'string' ? o : o.value} value={typeof o === 'string' ? o : o.value}>{typeof o === 'string' ? o : o.label}</option>)}</select></Field>;
}
export function MembersPicker({ label = 'Members', value = [], onChange, members }) {
  return <fieldset className="work-members"><legend>{label}</legend>{members.map(m => <label key={m.id}><input type="checkbox" checked={value.includes(m.id)} onChange={e => onChange(e.target.checked ? [...value, m.id] : value.filter(id => id !== m.id))} />{m.label}</label>)}{!members.length && <p className="helper">Member profiles are unavailable.</p>}</fieldset>;
}
const listText = value => Array.isArray(value) ? value.join(', ') : value || '';
const list = value => String(value || '').split(',').map(x => x.trim()).filter(Boolean);
const amountInput = n => n == null ? '' : (n / 100).toFixed(2);

export default function WorkRecordForm({ type, initial, all, members, catalog, settings, me, busy, onSave, onCancel }) {
  const [form, setForm] = useState(() => ({
    title: '', description: '', priority: 'normal', dueDate: '', labels: [], links: [], checklist: [], recurrence: 'none', currency: 'USD', type: 'expense', date: new Date().toISOString().slice(0, 10),
    method: 'consensus', proposedDate: new Date().toISOString().slice(0, 10), ...initial?.clearParts?.content, ...(!initial?.revision ? initial || {} : {}),
    labelsText: listText(initial?.labels), checklistText: (initial?.checklist || []).map(i => `${i.done ? '[x]' : '[ ]'} ${i.text}`).join('\n'),
    amount: amountInput(initial?.amountMinor), starting: amountInput(initial?.startingMinor), budget: amountInput(initial?.budgetMinor), target: amountInput(initial?.targetMinor),
  }));
  const [error, setError] = useState('');
  const [relationType, setRelationType] = useState('drive/notes'), [relationId, setRelationId] = useState('');
  const [restricted, setRestricted] = useState(initial?.grants?.length > 0 || type === 'cases');
  const [grants, setGrants] = useState(initial?.grants?.length ? initial.grants : [me]);
  const update = (key, value) => setForm(prev => ({ ...prev, [key]: value }));
  const field = (label, key, props = {}) => <Field label={label} value={form[key] ?? ''} onChange={e => update(key, e.target.value)} {...props} />;
  const area = (label, key, rows = 3) => <Field label={label}><textarea className="textarea" rows={rows} value={form[key] || ''} onChange={e => update(key, e.target.value)} /></Field>;
  const groups = [{ value: '', label: 'No Working Group' }, ...(all.groups || []).filter(r => !r.locked && !r.archived).map(r => ({ value: r.id, label: r.title }))];
  const funds = [{ value: '', label: 'Choose a fund' }, ...(all.funds || []).filter(r => !r.locked && !r.archived).map(r => ({ value: r.id, label: `${r.title} (${r.currency || 'USD'})` }))];
  const links = form.links || [];
  async function submit(e) {
    e.preventDefault(); setError('');
    try {
      const data = { ...form, title: form.title.trim(), labels: list(form.labelsText), links };
      if (!data.title) throw new Error('Give this record a title.');
      if (type === 'tasks' && data.recurrence !== 'none' && !data.dueDate) throw new Error('Set a due date for a recurring task.');
      for (const k of ['labelsText', 'checklistText', 'amount', 'starting', 'target', 'budget']) delete data[k];
      if (type === 'tasks') data.checklist = form.checklistText.split('\n').filter(x => x.trim()).map(text => ({ text: text.replace(/^\s*\[[x ]\]\s*/i, '').trim(), done: /^\s*\[x\]/i.test(text) }));
      if (type === 'funds') {
        data.startingMinor = moneyMinor(form.starting || '0');
        data.budgetMinor = form.budget === '' ? null : moneyMinor(form.budget);
        data.targetMinor = form.target === '' ? null : moneyMinor(form.target);
        data.currency = String(form.currency || 'USD').toUpperCase();
        if (!/^[A-Z]{3}$/.test(data.currency)) throw new Error('Use a three-letter currency code.');
        if (initial?.revision && data.currency !== initial.currency && all.transactions.some(t => t.fundId === initial.id || t.toFundId === initial.id)) throw new Error('Create a separate fund to use a different currency once transactions exist.');
      }
      if (type === 'transactions') { data.amountMinor = moneyMinor(form.amount); validateTransaction(data, all.funds || []); }
      if (restricted && !grants.includes(me)) throw new Error('Keep yourself selected so you can manage access.');
      const parents = [...(initial?.parents || []).filter(p => !['groups', 'funds'].includes(p.type))];
      if (data.groupId) parents.push({ type: 'groups', id: data.groupId });
      if (type === 'transactions') {
        parents.push({ type: 'funds', id: data.fundId });
        if (data.type === 'transfer') parents.push({ type: 'funds', id: data.toFundId });
        if (data.caseId) parents.push({ type: 'cases', id: data.caseId });
      }
      for (const link of links) if (all[link.type] && !parents.some(p => p.type === link.type && p.id === link.id)) parents.push(link);
      await onSave(data, { grants: restricted ? grants : [], parents });
    } catch (e) { setError(e.message); }
  }
  const immutableParents = !!initial?.revision;
  return <form className="card work-editor" onSubmit={submit}>
    <h2>{initial?.revision ? 'Edit' : 'Create'} {type === 'groups' ? 'Working Group' : type === 'transactions' ? 'transaction' : type === 'funds' ? 'fund' : type.replace(/s$/, '')}</h2>
    {error && <p role="alert" className="error">{error}</p>}
    <div className="work-form-grid">
      {field(type === 'funds' || type === 'groups' ? 'Name' : 'Title', 'title', { required: true, maxLength: 250 })}
      {type !== 'groups' && <Select label="Working Group" value={form.groupId} onChange={v => update('groupId', v)} options={groups} disabled={immutableParents} />}
      {['tasks', 'cases'].includes(type) && <Select label="Priority" value={form.priority} onChange={v => update('priority', v)} options={['low', 'normal', 'high', 'urgent']} />}
      {['tasks', 'cases'].includes(type) && field('Due / follow-up date', 'dueDate', { type: 'date' })}
      {field('Labels (comma separated)', 'labelsText', { list: 'work-case-labels' })}<datalist id="work-case-labels">{(settings?.caseLabels || []).map(t => <option key={t} value={t} />)}</datalist>
    </div>
    {area('Description / context', 'description')}
    {type === 'tasks' && <>
      <Select label="Repeat when completed" value={form.recurrence} onChange={v => update('recurrence', v)} options={['none', 'daily', 'weekly', 'monthly', 'yearly']} />
      {area('Checklist — one item per line; [x] marks a completed item', 'checklistText', 5)}
    </>}
    {type === 'groups' && <>
      <MembersPicker members={members} value={form.members || []} onChange={v => update('members', v)} />
      <MembersPicker label="Coordinators / maintainers (organization permissions still apply)" members={members.filter(m => (form.members || []).includes(m.id))} value={form.coordinators || []} onChange={v => update('coordinators', v)} />
    </>}
    {type === 'decisions' && <>
      {area('Proposal / question', 'proposal')}
      <div className="work-form-grid">
        {field('Originating person or group', 'origin')}
        <Select label="Decision method" value={form.method} onChange={v => update('method', v)} options={DECISION_METHODS} />
        {form.method === 'custom' && field('Custom method', 'customMethod')}
        {field('Proposed date', 'proposedDate', { type: 'date' })}
        {field('Review date', 'reviewDate', { type: 'date' })}
      </div>
      {area('Amendments / revisions', 'amendments')}{area('Objections, blocks or abstentions (if used)', 'objections')}{area('Process notes', 'notes')}
      <Select label="Supersedes" value={form.supersedes} onChange={v => update('supersedes', v)} options={[{ value: '', label: 'None' }, ...(all.decisions || []).filter(r => !r.locked && r.id !== initial?.id).map(r => ({ value: r.id, label: r.title }))]} />
    </>}
    {type === 'cases' && <>
      {field('Case type', 'caseType', { list: 'work-case-types' })}<datalist id="work-case-types">{(settings?.caseTypes || []).map(t => <option key={t} value={t} />)}</datalist>
      {field('Important dates / next steps', 'importantDates')}{area('Internal notes', 'notes')}
    </>}
    {type === 'funds' && <div className="work-form-grid">
      {field('Currency code', 'currency', { maxLength: 3, required: true })}{field('Starting balance', 'starting', { inputMode: 'decimal' })}
      {field('Target (optional)', 'target', { inputMode: 'decimal' })}{field('Budget (optional)', 'budget', { inputMode: 'decimal' })}
    </div>}
    {type === 'transactions' && <>
      <div className="work-form-grid">
        <Select label="Type" value={form.type} onChange={v => update('type', v)} options={['income', 'expense', 'reimbursement', 'transfer', 'contribution', 'adjustment']} disabled={immutableParents} />
        {field('Date', 'date', { type: 'date', required: true })}{field('Amount', 'amount', { inputMode: 'decimal', required: true })}
        <Select label="Fund" value={form.fundId} onChange={v => update('fundId', v)} options={funds} disabled={immutableParents} required />
        {form.type === 'transfer' && <Select label="Destination fund" value={form.toFundId} onChange={v => update('toFundId', v)} options={funds} disabled={immutableParents} required />}
        {field('Category', 'category')}{field('Payer / payee (private)', 'payee')}
        <Select label="Person responsible" value={form.responsibleId} onChange={v => update('responsibleId', v)} options={[{ value: '', label: 'Unassigned' }, ...members.map(m => ({ value: m.id, label: m.label }))]} />
        <Select label="Recurring schedule (recorded; no automatic charges)" value={form.recurrence} onChange={v => update('recurrence', v)} options={['none', 'monthly', 'weekly', 'yearly']} />
        <Select label="Related Case" value={form.caseId} onChange={v => update('caseId', v)} options={[{ value: '', label: 'None' }, ...(all.cases || []).filter(r => !r.locked).map(r => ({ value: r.id, label: r.title }))]} disabled={immutableParents} />
      </div>
      {area('Private notes', 'notes')}{area('Public description (published only when explicitly selected)', 'publicDescription')}
    </>}
    <fieldset><legend>Related records / documents</legend>
      <p className="helper">Links keep their original permissions. Linking a private workflow record also restricts access here.</p>
      <div className="work-actions">
        <Select label="Record type" value={relationType} onChange={v => { setRelationType(v); setRelationId(''); }} options={Object.keys(catalog).map(k => ({ value: k, label: k.replace('drive/', 'Drive ') }))}  />
        <Select label="Record" value={relationId} onChange={setRelationId} options={[{ value: '', label: 'Choose a record' }, ...(catalog[relationType] || []).filter(r => r.id !== initial?.id).map(r => ({ value: r.id, label: r.title || r.name || 'Untitled' }))]}  />
        <button className="btn" type="button" disabled={!relationId || (immutableParents && !!all[relationType])} onClick={() => { if (!links.some(l => l.type === relationType && l.id === relationId)) update('links', [...links, { type: relationType, id: relationId }]); }}>Link</button>
      </div>
      <ul>{links.map((ref, i) => <li key={`${ref.type}:${ref.id}`}>{catalog[ref.type]?.find(r => r.id === ref.id)?.title || catalog[ref.type]?.find(r => r.id === ref.id)?.name || 'Linked record'} {(!immutableParents || !all[ref.type]) && <button type="button" className="btn" onClick={() => update('links', links.filter((_, j) => i !== j))}>Remove</button>}</li>)}</ul>
      {immutableParents && <p className="helper">Use “Manage access and relationships” to change links or Working Group after creation.</p>}
    </fieldset>
    {!initial?.revision && <fieldset><legend>Visibility</legend>
      <label><input type="checkbox" checked={restricted} onChange={e => setRestricted(e.target.checked)} /> Restrict to selected Bondfire members</label>
      {restricted && <MembersPicker members={members} value={grants} onChange={setGrants} label="Allowed members" />}
      <p className="helper">Organization roles and linked Working Group / Case restrictions also apply. Public submitters do not receive access.</p>
    </fieldset>}
    <div className="work-actions"><button className="btn-red" disabled={busy} type="submit">{busy ? 'Saving…' : 'Save'}</button><button className="btn" type="button" disabled={busy} onClick={onCancel}>Cancel</button></div>
  </form>;
}
