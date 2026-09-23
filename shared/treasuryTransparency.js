import { checkedAdd, transactionEffect, treasuryTotals } from './workModel.js';

const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(k => keys.includes(k));
const name = v => typeof v === 'string' && v.trim().length > 0 && v.length <= 250;
const amount = v => Number.isSafeInteger(v) && Math.abs(v) <= 100_000_000_000;
export const FINANCIAL_TYPES = ['funds', 'transactions'];

// Explicit allowlist: never copy private descriptions, identities, categories,
// attachments, notes, assignments, case links or access restrictions into this object.
export function publicTreasuryRecord(type, record) {
  if (type === 'funds') return { name: String(record.title || '').trim(), currency: record.currency || 'USD', startingMinor: record.startingMinor || 0 };
  return {
    name: String(record.publicDescription || '').trim(), date: record.date, type: record.type,
    amountMinor: record.amountMinor, fundId: record.fundId,
    ...(record.type === 'transfer' ? { toFundId: record.toFundId } : {}),
    status: record.status || 'posted', reimbursementState: record.reimbursementState || 'requested',
    approval: record.approval || 'pending',
  };
}
export function validPublicTreasuryRecord(type, record) {
  if (type === 'funds') return exact(record, ['name', 'currency', 'startingMinor']) && name(record.name) && /^[A-Z]{3}$/.test(record.currency) && amount(record.startingMinor);
  return type === 'transactions' && exact(record, ['name', 'date', 'type', 'amountMinor', 'fundId', 'toFundId', 'status', 'reimbursementState', 'approval'])
    && name(record.name) && /^\d{4}-\d{2}-\d{2}$/.test(record.date) && !Number.isNaN(Date.parse(record.date)) && new Date(record.date).toISOString().slice(0, 10) === record.date
    && ['income', 'expense', 'contribution', 'adjustment', 'transfer', 'reimbursement'].includes(record.type)
    && amount(record.amountMinor) && (record.type === 'adjustment' || record.amountMinor > 0)
    && typeof record.fundId === 'string' && record.fundId.length > 0 && record.fundId.length <= 160
    && (record.type === 'transfer' ? typeof record.toFundId === 'string' && record.toFundId.length > 0 && record.toFundId !== record.fundId : record.toFundId === undefined)
    && ['posted', 'open', 'draft', 'void'].includes(record.status)
    && ['requested', 'processing', 'approved', 'paid', 'rejected'].includes(record.reimbursementState)
    && ['pending', 'approved', 'rejected'].includes(record.approval);
}
export function validateLedgerRelations(funds, transactions) {
  for (const tx of transactions) {
    const from = funds.find(f => f.id === tx.fundId), to = funds.find(f => f.id === tx.toFundId);
    if (!from || (tx.type === 'transfer' && (!to || from.currency !== to.currency || from.id === to.id))) throw new Error('Every transaction must reference a published fund in the same currency.');
  }
}

// Internal record IDs are replaced with array positions in the public response.
// All rows, including archived, pending and voided rows, participate in the ledger.
export function buildTreasuryLedger(funds, transactions) {
  validateLedgerRelations(funds, transactions);
  const orderedFunds = funds.slice().sort((a, b) => a.id.localeCompare(b.id));
  const ordered = transactions.slice().sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const totals = treasuryTotals(orderedFunds, ordered);
  const balances = new Map(orderedFunds.map(f => [f.id, f.startingMinor]));
  const publicTransactions = ordered.map(tx => {
    const fund = orderedFunds.findIndex(f => f.id === tx.fundId), destinationFund = orderedFunds.findIndex(f => f.id === tx.toFundId);
    balances.set(tx.fundId, checkedAdd(balances.get(tx.fundId), transactionEffect(tx, tx.fundId)));
    if (destinationFund >= 0) balances.set(tx.toFundId, checkedAdd(balances.get(tx.toFundId), transactionEffect(tx, tx.toFundId)));
    return {
      name: tx.name, date: tx.date, type: tx.type, amount: tx.amountMinor, currency: orderedFunds[fund].currency,
      fund, balance: balances.get(tx.fundId), status: tx.status,
      approvalRequired: !!tx.approvalRequired, approval: tx.approval, reimbursementState: tx.reimbursementState,
      ...(destinationFund >= 0 ? { destinationFund, destinationBalance: balances.get(tx.toFundId) } : {}),
      changes: (tx.history || []).map(h => ({ name: h.name, date: h.date, amount: h.amountMinor, status: h.status, approval: h.approval, reimbursementState: h.reimbursementState, changedAt: h.changedAt })),
    };
  });
  return {
    version: 2, heading: 'Financial transparency',
    explanation: 'Every recorded Treasury transaction is included. Personal details, internal notes and attachments stay private. Pending, unpaid and voided entries are shown without affecting the balance.',
    funds: totals.map(f => ({ name: f.name, currency: f.currency, startingBalance: f.startingMinor, balance: f.balance, income: f.income, expenses: f.expenses })),
    transactions: publicTransactions,
  };
}
