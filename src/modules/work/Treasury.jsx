import React, { useMemo, useState } from 'react';
import { api } from '../../utils/api.js';
import { treasuryTotals, transactionEffect, buildTreasuryProjection, canWork, moneyMinor } from '../../../shared/workModel.js';
import { Field, Select } from './WorkRecordForm.jsx';
import { TreasuryPublicView } from './PublicTreasury.jsx';

export function formatMoney(minor, currency = 'USD') {
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(Number(minor || 0) / 100); }
  catch { return `${(Number(minor || 0) / 100).toFixed(2)} ${currency}`; }
}
const DEFAULT_COLUMNS = ['date', 'title', 'type', 'fund', 'amount', 'category', 'status'];
export default function Treasury({ session, all, type, setType, onSelect, busy, run, onInlineEdit }) {
  const [query, setQuery] = useState(''), [fundId, setFundId] = useState(''), [period, setPeriod] = useState(''), [groupId, setGroupId] = useState(''), [view, setView] = useState('active');
  const [sort, setSort] = useState('date'), [descending, setDescending] = useState(true), [columns, setColumns] = useState(DEFAULT_COLUMNS), [publishOpen, setPublishOpen] = useState(false);
  const funds = (all.funds || []).filter(f => !f.locked), transactions = (all.transactions || []).filter(t => !t.locked);
  const totals = useMemo(() => treasuryTotals(funds, transactions), [all.funds, all.transactions]);
  const filter = row => (view === 'archived' ? row.archived : !row.archived) && (!query || [row.title, row.category, row.description, ...(row.labels || [])].join(' ').toLowerCase().includes(query.toLowerCase())) && (!groupId || (row.ancestors || row.parents).some(p => p.type === 'groups' && p.id === groupId));
  const filtered = (type === 'funds' ? totals : transactions).filter(row => filter(row) && (type === 'funds' || ((!fundId || row.fundId === fundId || row.toFundId === fundId) && (!period || row.date?.startsWith(period)) && (view !== 'reimbursements' || (row.type === 'reimbursement' && row.reimbursementState !== 'paid')) && (view !== 'recurring' || (row.recurrence && row.recurrence !== 'none'))))).sort((a, b) => { const av = sort === 'amount' ? a.amountMinor : a[sort] || '', bv = sort === 'amount' ? b.amountMinor : b[sort] || ''; return (typeof av === 'number' ? av - bv : String(av).localeCompare(String(bv))) * (descending ? -1 : 1); });
  const months = [...new Set(transactions.map(t => t.date?.slice(0, 7)).filter(Boolean))].sort().reverse();
  const grouped = {};
  if (type === 'transactions') for (const tx of filtered) {
    const fund = funds.find(f => f.id === tx.fundId), currency = fund?.currency || 'USD';
    const delta = transactionEffect(tx, tx.fundId);
    if (tx.type !== 'transfer') {
      const group = grouped[currency] ||= { income: 0, expenses: 0, categories: {} };
      if (delta > 0) group.income += delta;
      if (delta < 0) { group.expenses -= delta; const key = tx.category || 'Uncategorized'; group.categories[key] = (group.categories[key] || 0) - delta; }
    }
  }
  const visible = column => columns.includes(column);
  return <section className="work-treasury">
    <div className="work-actions"><button className={type === 'funds' ? 'btn-red' : 'btn'} onClick={() => setType('funds')}>Funds</button><button className={type === 'transactions' ? 'btn-red' : 'btn'} onClick={() => setType('transactions')}>Transactions</button>{canWork(session.context.role, session.context.permissions.treasury, 'publish') && <button className="btn" onClick={() => setPublishOpen(!publishOpen)}>Public transparency</button>}</div>
    {publishOpen && <TransparencyEditor key={session.orgId} session={session} all={all} totals={totals} busy={busy} run={run} />}
    <div className="work-filters"><Field label="Search Treasury" value={query} onChange={e => setQuery(e.target.value)} /><Select label="View" value={view} onChange={setView} options={[{ value: 'active', label: 'Active' }, { value: 'archived', label: 'Archived' }, ...(type === 'transactions' ? [{ value: 'reimbursements', label: 'Outstanding reimbursements' }, { value: 'recurring', label: 'Recurring records' }] : [])]} />
      {type === 'transactions' && <><Select label="Fund" value={fundId} onChange={setFundId} options={[{ value: '', label: 'All funds' }, ...funds.map(f => ({ value: f.id, label: f.title }))]} /><Select label="Month" value={period} onChange={setPeriod} options={[{ value: '', label: 'All dates' }, ...months]} /></>}
      <Select label="Working Group" value={groupId} onChange={setGroupId} options={[{ value: '', label: 'All groups' }, ...(all.groups || []).filter(r => !r.locked).map(g => ({ value: g.id, label: g.title }))]} />
    </div>
    <p className="helper">Totals include only records you can access. Each fund keeps its own currency. This workspace is not a formal accounting or tax system.</p>
    {type === 'funds' ? <div className="work-cards">{filtered.map(fund => <button key={fund.id} className="card work-record-card" onClick={() => onSelect(fund)}><strong>{fund.title}</strong><span className="work-balance">{formatMoney(fund.balance, fund.currency)}</span><span>In {formatMoney(fund.inflow, fund.currency)} · Out {formatMoney(fund.outflow, fund.currency)}</span><span>Outstanding reimbursements {formatMoney(fund.outstanding, fund.currency)}</span>{fund.budgetMinor != null && <span>Budget {formatMoney(fund.budgetMinor, fund.currency)} · Remaining {formatMoney(fund.remainingBudget, fund.currency)}</span>}{fund.targetMinor > 0 && <span>Target {formatMoney(fund.targetMinor, fund.currency)} <progress aria-label="Fund target" value={Math.max(0, fund.balance)} max={fund.targetMinor} /></span>}</button>)}</div> : <>
      <div className="work-cards">{Object.entries(grouped).map(([currency, total]) => <div key={currency} className="card work-summary"><strong>{currency} · filtered activity</strong><p>Income {formatMoney(total.income, currency)} · Expenses {formatMoney(total.expenses, currency)}</p><details><summary>Spending by category</summary><ul>{Object.entries(total.categories).map(([category, value]) => <li key={category}>{category}: {formatMoney(value, currency)}</li>)}</ul></details></div>)}</div>
      <details className="work-column-controls"><summary>Columns and sorting</summary><div className="work-actions">{['date', 'title', 'type', 'fund', 'amount', 'category', 'status', 'payee', 'approval', 'recurrence'].map(c => <label key={c}><input type="checkbox" checked={visible(c)} onChange={e => setColumns(e.target.checked ? [...columns, c] : columns.filter(x => x !== c))} />{c}</label>)}</div><Select label="Sort by" value={sort} onChange={setSort} options={['date', 'title', 'amount', 'category', 'type']} /><button className="btn" onClick={() => setDescending(!descending)}>{descending ? 'Descending' : 'Ascending'}</button></details>
      <div className="work-table-wrap"><table className="work-ledger"><caption>Financial records — select a title for details, receipts and approval</caption><thead><tr>{columns.map(c => <th key={c} scope="col">{c}</th>)}</tr></thead><tbody>{filtered.map(tx => <tr key={tx.id}>{columns.map(c => <td key={c} data-label={c}>{c === 'title' ? <button className="work-text-button" onClick={() => onSelect(tx)}>{tx.title}</button> : c === 'fund' ? <>{funds.find(f => f.id === tx.fundId)?.title || 'Unavailable'}{tx.type === 'transfer' && <> → {funds.find(f => f.id === tx.toFundId)?.title || 'Unavailable'}</>}</> : c === 'amount' ? <InlineCell value={tx.amountMinor} format={n => formatMoney(n, funds.find(f => f.id === tx.fundId)?.currency)} editable={tx.permissions.edit && !busy} label={`Amount for ${tx.title}`} onSave={value => { const amountMinor = moneyMinor(value); if (tx.type !== 'adjustment' && amountMinor <= 0) throw new Error('Amount must be positive.'); return onInlineEdit(tx, { amountMinor }); }} inputValue={(tx.amountMinor / 100).toFixed(2)} /> : ['category', 'payee'].includes(c) ? <InlineCell value={tx[c] || ''} editable={tx.permissions.edit && !busy} label={`${c} for ${tx.title}`} onSave={value => onInlineEdit(tx, { [c]: value })} /> : c === 'approval' ? tx.approvalRequired ? tx.approval : 'not required' : String(tx[c] || '—')}</td>)}</tr>)}</tbody></table></div>
    </>}
    {!filtered.length && <section className="card work-empty"><h2>{type === 'funds' ? 'Name your first fund' : 'No matching transactions'}</h2><p>{type === 'funds' ? 'Choose names that make sense to your group. A starting balance is optional.' : 'Create a fund first, then record income, spending, contributions or a transfer.'}</p></section>}
    {[...(all.funds || []), ...(all.transactions || [])].some(r => r.locked) && <p role="status" className="helper">Some permitted records need a device key. Totals exclude them until their device access is refreshed.</p>}
  </section>;
}
function InlineCell({ value, inputValue, format = String, editable, label, onSave }) {
  const [editing, setEditing] = useState(false), [draft, setDraft] = useState(''), [error, setError] = useState(''), [saving, setSaving] = useState(false);
  if (!editing) return editable ? <button className="work-text-button" aria-label={`Edit ${label}`} onClick={() => { setDraft(inputValue ?? String(value)); setError(''); setEditing(true); }}>{format(value) || 'Add'}</button> : <span>{format(value) || '—'}</span>;
  return <form onSubmit={async e => { e.preventDefault(); setSaving(true); try { await onSave(draft); setEditing(false); } catch (e) { setError(e.message); } finally { setSaving(false); } }}><input className="input" aria-label={label} value={draft} onChange={e => setDraft(e.target.value)} autoFocus /><div className="work-actions"><button className="btn" disabled={saving}>Save</button><button className="btn" type="button" disabled={saving} onClick={() => setEditing(false)}>Cancel</button></div>{error && <span role="alert">{error}</span>}</form>;
}
function TransparencyEditor({ session, all, totals, busy, run }) {
  const [heading, setHeading] = useState('Our funds'), [introduction, setIntroduction] = useState(''), [selections, setSelections] = useState({ funds: {}, transactions: {} }), [preview, setPreview] = useState(null), [published, setPublished] = useState(null), [error, setError] = useState(''), [slug, setSlug] = useState('');
  const base = `/api/orgs/${encodeURIComponent(session.orgId)}/work/publication`;
  React.useEffect(() => { let alive = true; Promise.all([api(base), api(`/api/orgs/${encodeURIComponent(session.orgId)}/public/get`)]).then(([result, site]) => { if (alive) { setPublished(result.public); setSlug(site.public?.slug || site.config?.slug || site.slug || ''); } }).catch(e => alive && setError(e.message)); return () => { alive = false; }; }, [base, session.orgId]);
  function select(kind, id, field, checked) { setPreview(null); setSelections(s => ({ ...s, [kind]: { ...s[kind], [id]: { ...s[kind][id], [field]: checked } } })); }
  const transactions = (all.transactions || []).filter(t => !t.locked && !t.archived && t.status !== 'void');
  return <section className="card work-editor"><h2>Public Treasury transparency</h2><p>{published ? 'A selected snapshot is public. Editing private records does not change it. Preview and publish again when you want to update it.' : 'Off. No Treasury information is public.'}</p><p className="helper">Select every field deliberately. Internal notes, receipts, identities, reimbursements and linked records are excluded. Transaction descriptions use only the separate public-description field.</p>
    <Field label="Page heading" value={heading} onChange={e => { setHeading(e.target.value); setPreview(null); }} /><Field label="Introduction"><textarea className="textarea" value={introduction} onChange={e => { setIntroduction(e.target.value); setPreview(null); }} /></Field>
    <h3>Funds</h3>{totals.map(f => <fieldset key={f.id}><legend>{f.title}</legend><div className="work-actions">{[['publish', 'Publish fund name'], ['balance', 'Balance'], ['budget', 'Budget'], ['totals', 'Income and expense totals']].map(([key, label]) => <label key={key}><input type="checkbox" checked={!!selections.funds[f.id]?.[key]} onChange={e => select('funds', f.id, key, e.target.checked)} />{label}</label>)}</div></fieldset>)}
    <details><summary>Select individual transactions</summary>{transactions.map(t => <fieldset key={t.id}><legend>{t.date} · {t.title}</legend><div className="work-actions">{[['publish', 'Publish date, type and amount'], ['description', 'Public description'], ['category', 'Category']].map(([key, label]) => <label key={key}><input type="checkbox" checked={!!selections.transactions[t.id]?.[key]} onChange={e => select('transactions', t.id, key, e.target.checked)} />{label}</label>)}</div></fieldset>)}</details>
    {error && <p role="alert" className="error">{error}</p>}
    <div className="work-actions"><button className="btn" disabled={busy} onClick={() => setPreview(buildTreasuryProjection({ heading, introduction, funds: totals, transactions, selections }))}>Preview selected information</button>{published && <button className="btn" disabled={busy} onClick={() => { if (window.confirm('Remove the public Treasury snapshot?')) run(() => api(base, { method: 'DELETE' }), 'Public Treasury page removed.').then(() => setPublished(null)).catch(e => setError(e.message)); }}>Unpublish</button>}</div>
    {preview && <><TreasuryPublicView data={preview} preview /><button className="btn-red" disabled={busy} onClick={() => {
      const sources = [...totals.map(r => ({ type: 'funds', id: r.id, revision: r.revision })), ...transactions.map(r => ({ type: 'transactions', id: r.id, revision: r.revision }))];
      run(() => api(base, { method: 'PUT', body: JSON.stringify({ public: preview, sources }) }), 'Selected Treasury snapshot published.').then(() => setPublished(preview)).catch(e => setError(e.message));
    }}>Publish this preview</button></>}
    {published && slug && <p><a href={`#/p/${encodeURIComponent(slug)}/treasury`} target="_blank" rel="noreferrer">Open public transparency page</a></p>}
  </section>;
}
