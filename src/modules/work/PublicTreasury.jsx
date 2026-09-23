import React, { useEffect, useState, useId, useRef } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { formatMoney } from './money.js';
import { transactionEffect } from '../../../shared/workModel.js';
import './work.css';

// Preserve old links while making the Organization Page the canonical destination.
export default function PublicTreasury() {
  const { slug } = useParams();
  return <Navigate replace to={`/p/${encodeURIComponent(slug)}?section=treasury`} />;
}
export function PublicTreasurySection({ slug }) {
  const [state, setState] = useState(null);
  useEffect(() => {
    if (!slug) return undefined;
    let alive = true, loading = false;
    const controller = new AbortController();
    setState(null);
    async function refresh() {
      if (loading) return;
      loading = true;
      try {
        const response = await fetch(`/api/p/${encodeURIComponent(slug)}/treasury`, { credentials: 'omit', cache: 'no-store', signal: controller.signal });
        if (response.status === 404) { if (alive) setState(null); return; }
        if (!response.ok) throw new Error('Ledger unavailable');
        const result = await response.json();
        if (alive) setState(result);
      } catch { if (alive) setState(current => current ? { ...current, stale: true } : null); }
      finally { loading = false; }
    }
    refresh();
    const timer = setInterval(refresh, 30000);
    window.addEventListener('focus', refresh);
    return () => { alive = false; controller.abort(); clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [slug]);
  const visible = !!state;
  useEffect(() => {
    if (visible && (window.location.hash.includes('section=treasury') || window.location.search.includes('section=treasury') || window.location.pathname.replace(/\/$/, '') === '/treasury')) document.getElementById('financial-transparency')?.scrollIntoView?.({ block: 'start' });
  }, [visible]);
  if (!state?.public) return null;
  return <div className="work-page" id="financial-transparency">{state.stale && <p role="status">Unable to refresh the ledger. The last loaded figures are shown.</p>}<TreasuryPublicView data={state.public} updatedAt={state.updatedAt} /></div>;
}
function transactionStatus(tx) {
  if (tx.status === 'void') return 'Voided — retained in ledger';
  if (tx.status === 'draft') return 'Draft — not in balance';
  if (tx.approvalRequired && tx.approval !== 'approved') return tx.approval === 'rejected' ? 'Rejected — not in balance' : 'Awaiting approval';
  if (tx.type === 'reimbursement' && tx.reimbursementState !== 'paid') return `Reimbursement ${tx.reimbursementState} — unpaid`;
  return 'Posted';
}
export function BalanceGraph({ name, currency, opening, balance, points }) {
  const gradient = useId().replace(/:/g, '');
  const values = [opening, ...points.map(p => p.balance)];
  const low = Math.min(0, ...values), high = Math.max(0, ...values), range = high - low || 1;
  const y = value => 180 - (value - low) / range * 156;
  const dates = points.map(p => Date.parse(p.date + 'T00:00:00Z'));
  const start = dates.length ? dates[0] - 86400000 : 0, end = dates.length ? dates[dates.length - 1] : 1;
  const x = i => i === 0 ? 0 : (dates[i - 1] - start) / Math.max(1, end - start) * 640;
  const line = values.map((value, i) => i ? `H${x(i)}V${y(value)}` : `M0,${y(value)}`).join(' ') + (values.length === 1 ? 'H640' : '');
  const area = `${line}L640,204H0Z`;
  return <figure className="work-balance-chart">
    <svg viewBox="0 0 640 204" role="img" aria-label={`${name} balance history. Opening balance ${formatMoney(opening, currency)}; current balance ${formatMoney(balance, currency)}. Each step is a recorded transaction.`}>
      <defs><linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="currentColor" stopOpacity=".22"/><stop offset="100%" stopColor="currentColor" stopOpacity=".07"/></linearGradient></defs>
      <path d={area} className="work-chart-area" fill={`url(#${gradient})`} />
      <path d={line} className="work-chart-line" />
    </svg>
    <figcaption><span>{points[0]?.date || 'Opening balance'}</span><span>{points[points.length - 1]?.date || 'Today'}</span></figcaption>
  </figure>;
}
function signedAmount(tx) {
  if (tx.type === 'transfer') return `↔ ${formatMoney(tx.amount, tx.currency)}`;
  const negative = ['expense', 'reimbursement'].includes(tx.type) || tx.amount < 0;
  return `${negative ? '−' : '+'}${formatMoney(Math.abs(tx.amount), tx.currency)}`;
}
export function TreasuryPublicView({ data, updatedAt, preview = false }) {
  const [account, setAccount] = useState(''), [month, setMonth] = useState(''), [page, setPage] = useState(0), [showLedger, setShowLedger] = useState(false);
  const ledgerRef = useRef(null);
  const transactions = data.transactions || [], funds = data.funds || [];
  const currencies = [...new Set(funds.map(f => f.currency))];
  const selected = account || `currency:${currencies[0] || 'USD'}`;
  const selectedIndex = selected.startsWith('fund:') ? Number(selected.slice(5)) : null;
  const currency = selectedIndex !== null ? funds[selectedIndex]?.currency || currencies[0] || 'USD' : selected.slice(9);
  const selectedFunds = funds.map((f, i) => ({ ...f, index: i })).filter(f => selectedIndex !== null ? f.index === selectedIndex : f.currency === currency);
  const accountTransactions = transactions.filter(t => selectedFunds.some(f => f.index === t.fund || f.index === t.destinationFund));
  const opening = selectedFunds.reduce((sum, f) => sum + f.startingBalance, 0), balance = selectedFunds.reduce((sum, f) => sum + f.balance, 0);
  let running = opening;
  const points = accountTransactions.map(tx => {
    const internal = { ...tx, amountMinor: tx.amount, fundId: tx.fund, toFundId: tx.destinationFund };
    for (const fund of selectedFunds) running += transactionEffect(internal, fund.index);
    return { date: tx.date, balance: running };
  });
  const recent = accountTransactions.slice().reverse().slice(0, 6);
  const filtered = accountTransactions.filter(t => !month || t.date.startsWith(month)).slice().reverse();
  const months = [...new Set(accountTransactions.map(t => t.date.slice(0, 7)))].sort().reverse();
  const pages = Math.max(1, Math.ceil(filtered.length / 50)), currentPage = Math.min(page, pages - 1), visible = filtered.slice(currentPage * 50, (currentPage + 1) * 50);
  const accountName = selectedIndex !== null ? funds[selectedIndex]?.name : currencies.length > 1 ? `All ${currency} funds` : 'Account balance';
  function openLedger() { setShowLedger(true); requestAnimationFrame(() => ledgerRef.current?.scrollIntoView?.({ block: 'start' })); }
  return <section className="work-public card" aria-label="Financial transparency">
    {preview && <p className="helper">Preview of the complete ledger — turning transparency on publishes all these records and keeps them up to date automatically.</p>}
    <div className="work-transparency-heading"><h2>{data.heading}</h2>{funds.length > 1 && <label className="work-field">Account<select className="input" value={selected} onChange={e => { setAccount(e.target.value); setPage(0); setMonth(''); }}>{currencies.map(c => <option key={c} value={`currency:${c}`}>All {c} funds</option>)}{funds.map((f, i) => <option key={i} value={`fund:${i}`}>{f.name} ({f.currency})</option>)}</select></label>}</div>
    <div className="work-transparency-overview">
      <article className="work-account-card"><div className="work-account-heading"><h3>{accountName}</h3><p className="work-account-balance">{formatMoney(balance, currency)}</p></div><BalanceGraph name={accountName} currency={currency} opening={opening} balance={balance} points={points} /></article>
      <article className="work-recent-card"><div className="work-recent-heading"><h3>Recent transactions</h3><button className="work-text-button" onClick={openLedger}>See all →</button></div>
        {!recent.length && <p className="helper">No transactions recorded yet.</p>}
        <ul className="work-recent-list">{recent.map((tx, i) => <li key={i}><div><strong>{tx.name}</strong><span>{new Date(tx.date + 'T12:00:00Z').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}{transactionStatus(tx) !== 'Posted' ? ` · ${transactionStatus(tx)}` : ''}</span></div><span className={tx.type === 'transfer' ? 'work-amount-neutral' : ['expense', 'reimbursement'].includes(tx.type) || tx.amount < 0 ? 'work-amount-out' : 'work-amount-in'}>{signedAmount(tx)}</span></li>)}</ul>
      </article>
    </div>
    <p className="helper">{data.explanation}</p>{updatedAt && <p className="helper">Last updated {new Date(updatedAt).toLocaleString()}</p>}
    <div ref={ledgerRef} className="work-full-ledger">
    {showLedger && <><div className="work-transparency-heading"><h3>Complete transaction ledger</h3><button className="work-text-button" onClick={() => setShowLedger(false)}>Collapse ledger</button></div>
      {funds.length > 1 && <div className="work-cards">{selectedFunds.map(fund => <article className="card work-summary" key={fund.index}><h3>{fund.name}</h3><p className="work-balance">{formatMoney(fund.balance, fund.currency)}</p><p>Opening {formatMoney(fund.startingBalance, fund.currency)} · Income {formatMoney(fund.income, fund.currency)} · Expenses {formatMoney(fund.expenses, fund.currency)}</p></article>)}</div>}
      <label className="work-field">Transaction period<select className="input" value={month} onChange={e => { setMonth(e.target.value); setPage(0); }}><option value="">All dates</option>{months.map(m => <option key={m}>{m}</option>)}</select></label>
      <p className="helper">{transactions.length} recorded transactions across all funds. {filtered.length} match this view. Graphs show the full history; running balances include earlier entries outside a selected period.</p>
      {!filtered.length && <p>No transactions in this view.</p>}
      {!!filtered.length && <div className="work-table-wrap"><table className="work-ledger"><caption>Latest entries first · amounts and balances use each fund’s currency</caption><thead><tr><th scope="col">Date</th><th scope="col">Transaction</th><th scope="col">Fund</th><th scope="col">Amount</th><th scope="col">Balance after entry</th><th scope="col">Status</th></tr></thead><tbody>{visible.map((tx, i) => <tr key={`${currentPage}:${i}`}>
        <td data-label="Date">{tx.date}</td><td data-label="Transaction"><strong>{tx.name}</strong><div>{tx.type}</div>{tx.changes?.length > 0 && <details><summary>{tx.changes.length} recorded changes</summary><ul>{tx.changes.map((old, j) => <li key={j}>Previously: {old.name} · {old.date} · {formatMoney(old.amount, tx.currency)} · {old.status} · {old.approval}{tx.type === 'reimbursement' ? ` · ${old.reimbursementState}` : ''}. Changed {new Date(old.changedAt).toLocaleString()}.</li>)}</ul></details>}</td>
        <td data-label="Fund">{funds[tx.fund]?.name}{tx.destinationFund !== undefined && <> → {funds[tx.destinationFund]?.name}</>}</td><td data-label="Amount">{signedAmount(tx)}</td><td data-label="Balance">{formatMoney(tx.balance, tx.currency)}{tx.destinationFund !== undefined && <div>Destination: {formatMoney(tx.destinationBalance, tx.currency)}</div>}</td><td data-label="Status">{transactionStatus(tx)}</td>
      </tr>)}</tbody></table></div>}
      {pages > 1 && <nav aria-label="Ledger pages" className="work-actions"><button className="btn" disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>Previous entries</button><span>Page {currentPage + 1} of {pages}</span><button className="btn" disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>Next entries</button></nav>}
    </>}
    </div>
  </section>;
}
