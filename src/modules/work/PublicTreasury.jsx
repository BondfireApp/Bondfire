import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { formatMoney } from './Treasury.jsx';
import './work.css';

export default function PublicTreasury({ slug: providedSlug }) {
  const params = useParams(), slug = providedSlug || params.slug;
  const [state, setState] = useState({ loading: true });
  useEffect(() => {
    let alive = true; setState({ loading: true });
    fetch(`/api/p/${encodeURIComponent(slug)}/treasury`, { credentials: 'omit', cache: 'no-store' }).then(async r => { if (!r.ok) throw new Error('This Treasury page is not published.'); return r.json(); }).then(result => alive && setState({ ...result, loading: false })).catch(e => alive && setState({ loading: false, error: e.message }));
    return () => { alive = false; };
  }, [slug]);
  if (state.loading) return <main className="work-page">Loading published Treasury…</main>;
  if (state.error) return <main className="work-page"><h1>Treasury</h1><p>{state.error}</p></main>;
  return <main className="work-page"><TreasuryPublicView data={state.public} updatedAt={state.updatedAt} /></main>;
}
export function TreasuryPublicView({ data, updatedAt, preview = false }) {
  const [month, setMonth] = useState('');
  const transactions = (data.transactions || []).filter(t => !month || t.date.startsWith(month));
  const months = [...new Set((data.transactions || []).map(t => t.date.slice(0, 7)))].sort().reverse();
  const groups = {};
  for (const tx of transactions) {
    if (tx.type === 'transfer') continue;
    const bucket = groups[tx.currency] ||= { income: 0, expenses: 0, categories: {} };
    const isExpense = ['expense', 'reimbursement'].includes(tx.type) || tx.amount < 0;
    bucket[isExpense ? 'expenses' : 'income'] += Math.abs(tx.amount);
    if (isExpense && tx.category) bucket.categories[tx.category] = (bucket.categories[tx.category] || 0) + Math.abs(tx.amount);
  }
  return <section className="work-public card">
    {preview && <p className="helper">Preview — only the information below will be published</p>}
    <h1>{data.heading}</h1><p className="work-prose">{data.introduction}</p><p className="helper">{data.explanation}</p>{updatedAt && <p className="helper">Snapshot published {new Date(updatedAt).toLocaleString()}</p>}
    <div className="work-cards">{(data.funds || []).map((fund, i) => <article className="card work-summary" key={i}><h2>{fund.name}</h2>{fund.balance !== undefined && <p className="work-balance">{formatMoney(fund.balance, fund.currency)}</p>}{fund.budget !== undefined && <p>Budget {formatMoney(fund.budget, fund.currency)}</p>}{fund.income !== undefined && <p>Income {formatMoney(fund.income, fund.currency)} · Expenses {formatMoney(fund.expenses, fund.currency)}</p>}</article>)}</div>
    {data.transactions?.length > 0 && <><label className="work-field">Published transaction period<select className="input" value={month} onChange={e => setMonth(e.target.value)}><option value="">All dates</option>{months.map(m => <option key={m}>{m}</option>)}</select></label><p className="helper">These charts summarize the selected public transactions only; fund balances may include additional private activity.</p>
      <div className="work-cards">{Object.entries(groups).map(([currency, totals]) => <article className="card work-summary" key={currency}><h2>{currency} activity</h2><p>Income {formatMoney(totals.income, currency)}</p><meter min="0" max={Math.max(1, totals.income, totals.expenses)} value={totals.income} aria-label={`Income ${currency}`} /><p>Expenses {formatMoney(totals.expenses, currency)}</p><meter min="0" max={Math.max(1, totals.income, totals.expenses)} value={totals.expenses} aria-label={`Expenses ${currency}`} />{Object.entries(totals.categories).map(([name, amount]) => <p key={name}>{name}: {formatMoney(amount, currency)}</p>)}</article>)}</div>
      <h2>Published transactions</h2><div className="work-cards">{transactions.slice().sort((a, b) => b.date.localeCompare(a.date)).map((tx, i) => <article className="card work-summary" key={i}><p>{tx.date} · {tx.type}</p><strong>{formatMoney(tx.amount, tx.currency)}</strong>{tx.description && <p className="work-prose">{tx.description}</p>}{tx.category && <span>{tx.category}</span>}</article>)}</div>
    </>}
  </section>;
}
