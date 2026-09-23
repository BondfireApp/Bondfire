import React, { useMemo, useState } from 'react';
import { api } from '../../utils/api.js';
import { treasuryTotals, transactionEffect, canWork, moneyMinor } from '../../../shared/workModel.js';
import { Field, Select } from './WorkRecordForm.jsx';
import { completePublicLedger } from './workClient.js';
import { buildTreasuryLedger } from '../../../shared/treasuryTransparency.js';
import { TreasuryPublicView } from './PublicTreasury.jsx';

import { formatMoney } from './money.js';

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
    {publishOpen && <TransparencyEditor key={session.orgId} session={session} all={all} busy={busy} run={run} />}
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
function TransparencyEditor({ session, all, busy, run }) {
  const [preview, setPreview] = useState(null), [error, setError] = useState(''), [slug, setSlug] = useState('');
  React.useEffect(() => setPreview(null), [all]);
  const base = `/api/orgs/${encodeURIComponent(session.orgId)}/work/publication`;
  const state = session.context.transparency || { enabled: false, version: 0 };
  React.useEffect(() => { let alive = true; api(`/api/orgs/${encodeURIComponent(session.orgId)}/public/get`).then(site => alive && setSlug(site.public?.slug || site.config?.slug || site.slug || '')).catch(() => {}); return () => { alive = false; }; }, [session.orgId]);
  const unnamed = (all.transactions || []).filter(t => !t.locked && !t.publicDescription?.trim());
  function review() {
    setError('');
    try {
      const records = completePublicLedger(all);
      setPreview(buildTreasuryLedger(records.filter(r => r.type === 'funds').map(r => ({ ...r.public, id: r.id })), records.filter(r => r.type === 'transactions').map(r => ({ ...r.public, id: r.id, approvalRequired: all.transactions.find(t => t.id === r.id).approvalRequired }))));
    } catch (e) { setError(e.message); }
  }
  async function toggle(enabled) {
    setError('');
    try {
      const body = { version: state.version, ...(enabled ? { records: completePublicLedger(all) } : {}) };
      await run(() => api(base, { method: enabled ? 'PUT' : 'DELETE', body: JSON.stringify(body) }), enabled ? 'Transparency is on. Every financial save now updates your Organization Page.' : 'Transparency is off for this organization.');
      setPreview(null);
    } catch (e) { setError(e.message.includes('COMPLETE_LEDGER_REQUIRED') ? 'Every fund and transaction must be included. Use a device and account with access to the complete Treasury, then refresh and try again.' : e.message); }
  }
  return <section className="card work-editor"><h2>Public Treasury transparency</h2>
    <p><strong>{state.enabled ? 'On for this organization' : 'Off for this organization'}</strong></p>
    <p>When on, every fund and transaction appears automatically on your existing Organization Page, with the public transaction name, date, amount, status and running balance. The page includes a balance graph.</p>
    <p className="helper">There are no individual publication switches. Archiving never hides a transaction. Voided entries and corrections remain visible. Payer/payee names, responsible members, private titles, notes, categories, receipts and linked records are withheld. Use public fund and transaction names that do not identify people.</p>
    {!state.enabled && unnamed.length > 0 && <div className="work-notice"><p>Add a public name to these existing transactions before turning transparency on:</p><ul>{unnamed.map(t => <li key={t.id}><a href={`#/org/${encodeURIComponent(session.orgId)}/treasury?type=transactions&record=${encodeURIComponent(t.id)}`}>{t.title}</a></li>)}</ul></div>}
    {error && <p role="alert" className="error">{error}</p>}
    <div className="work-actions">{state.enabled ? <button className="btn" disabled={busy} onClick={() => { if (window.confirm('Turn off the complete public ledger for this organization?')) toggle(false); }}>Turn transparency off</button> : <button className="btn" disabled={busy} onClick={review}>Preview complete ledger</button>}</div>
    {!state.enabled && preview && <><TreasuryPublicView data={preview} preview /><button className="btn-red" disabled={busy} onClick={() => toggle(true)}>Turn transparency on</button></>}
    {state.enabled && slug && <p><a href={`#/p/${encodeURIComponent(slug)}?section=treasury`} target="_blank" rel="noreferrer">View ledger on Organization Page</a></p>}
    {state.enabled && !slug && <p className="helper">Set up and publish your Organization Page to make the ledger visible to visitors.</p>}
  </section>;
}
