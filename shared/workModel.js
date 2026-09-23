// Shared workflow vocabulary and exact, integer-minor-unit financial arithmetic.
export const WORK_MODULES = {
  tasks: 'tasks', groups: 'working-groups', decisions: 'decisions', cases: 'cases',
  funds: 'treasury', transactions: 'treasury',
  'case-settings': 'cases', 'treasury-settings': 'treasury',
};
export const WORK_LABELS = { tasks: 'Tasks', groups: 'Working Groups', decisions: 'Decisions', cases: 'Cases', funds: 'Funds', transactions: 'Transactions' };
export const WORK_ROLES = ['viewer', 'member', 'admin', 'owner'];
export const rank = role => WORK_ROLES.indexOf(role);
export const PARTS = ['content', 'assignment', 'state', 'approval', 'source'];
export const partKind = (type, part) => `work/${type}${part === 'content' ? '' : ':' + part}`;
export const defaultPermissions = module => {
  const financial = module === 'treasury', sensitive = financial || module === 'cases';
  return { view: sensitive ? 'admin' : 'viewer', create: sensitive ? 'admin' : 'member', edit: sensitive ? 'admin' : 'member', assign: 'admin', close: sensitive ? 'admin' : 'member', approve: 'admin', publish: 'admin', settings: 'admin' };
};
export function canWork(role, permission, action) { return rank(role) >= rank(permission[action] || 'owner'); }
export const DECISION_STATUSES = ['proposed', 'under discussion', 'adopted', 'rejected', 'withdrawn', 'superseded'];
export const DECISION_METHODS = ['consensus', 'modified consensus', 'consent', 'majority vote', 'supermajority', 'organizer/admin decision', 'informal agreement', 'external decision / record only', 'custom'];
export function moneyMinor(value) {
  const s = String(value ?? '').trim();
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(s)) throw new Error('Use an amount with at most two decimal places.');
  const negative = s.startsWith('-');
  const [whole, fraction = ''] = s.replace(/^-/, '').split('.');
  const n = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(n) || n > 100_000_000_000) throw new Error('Amount is outside the supported range.');
  return negative ? -n : n;
}
export function checkedAdd(a, b) {
  const n = a + b;
  if (!Number.isSafeInteger(n)) throw new Error('Financial total exceeds the supported range.');
  return n;
}
export function transactionEffect(tx, fundId) {
  // Archiving hides a row without rewriting financial history. Void is explicit.
  if (tx.status === 'void' || tx.status === 'draft' || (tx.approvalRequired && tx.approval !== 'approved')) return 0;
  if (tx.type === 'reimbursement' && tx.reimbursementState !== 'paid') return 0;
  const n = tx.amountMinor;
  if (!Number.isSafeInteger(n)) throw new Error('A transaction has an invalid amount.');
  if (tx.type === 'transfer') return tx.fundId === fundId ? -n : tx.toFundId === fundId ? n : 0;
  if (tx.fundId !== fundId) return 0;
  return ['expense', 'reimbursement'].includes(tx.type) ? -n : n;
}
export function treasuryTotals(funds, transactions) {
  return funds.map(fund => {
    let balance = Number(fund.startingMinor || 0), inflow = 0, outflow = 0, outstanding = 0, income = 0, expenses = 0;
    if (!Number.isSafeInteger(balance)) throw new Error('Invalid starting balance.');
    for (const tx of transactions) {
      const delta = transactionEffect(tx, fund.id);
      balance = checkedAdd(balance, delta);
      if (delta > 0) inflow = checkedAdd(inflow, delta);
      if (delta < 0) outflow = checkedAdd(outflow, -delta);
      if (tx.type !== 'transfer') {
        if (delta > 0) income = checkedAdd(income, delta);
        if (delta < 0) expenses = checkedAdd(expenses, -delta);
      }
      if (tx.fundId === fund.id && tx.type === 'reimbursement' && tx.status !== 'void' && tx.reimbursementState !== 'paid' && tx.approval !== 'rejected') outstanding = checkedAdd(outstanding, tx.amountMinor);
    }
    return { ...fund, balance, inflow, outflow, income, expenses, outstanding, remainingBudget: fund.budgetMinor == null ? null : fund.budgetMinor - expenses };
  });
}
export function validateTransaction(tx, funds) {
  if (!['income', 'expense', 'reimbursement', 'transfer', 'contribution', 'adjustment'].includes(tx.type)) throw new Error('Choose a transaction type.');
  if (!Number.isSafeInteger(tx.amountMinor) || (tx.type !== 'adjustment' && tx.amountMinor <= 0)) throw new Error('Enter a positive amount; use Adjustment for a signed correction.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tx.date || '')) throw new Error('Choose a transaction date.');
  const from = funds.find(f => f.id === tx.fundId);
  if (!from || from.archived) throw new Error('Choose an active fund.');
  if (tx.type === 'transfer') {
    const to = funds.find(f => f.id === tx.toFundId);
    if (!to || to.archived || to.id === from.id) throw new Error('Choose a different active destination fund.');
    if ((from.currency || 'USD') !== (to.currency || 'USD')) throw new Error('Transfers require funds with the same currency.');
  }
  return tx;
}
export function nextDueDate(date, recurrence) {
  if (!date || !recurrence || recurrence === 'none') return '';
  const d = new Date(date + 'T12:00:00Z');
  if (!Number.isFinite(d.getTime())) return '';
  if (recurrence === 'monthly') {
    const day = d.getUTCDate(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + 1);
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate(); d.setUTCDate(Math.min(day, last));
  } else d.setUTCDate(d.getUTCDate() + (recurrence === 'weekly' ? 7 : recurrence === 'yearly' ? 365 : 1));
  return d.toISOString().slice(0, 10);
}
// Only explicit public selections enter this object. Never spread a private record here.
export function buildTreasuryProjection({ heading, introduction, funds, transactions, selections }) {
  const totals = treasuryTotals(funds, transactions);
  return {
    heading: String(heading || 'Treasury'), introduction: String(introduction || ''),
    explanation: 'This is a selected snapshot published by the organization. It may exclude private funds and transactions and is not an audited account.',
    funds: totals.filter(f => selections.funds?.[f.id]?.publish).map(f => {
      const s = selections.funds[f.id];
      return { name: f.title, currency: f.currency || 'USD', ...(s.balance ? { balance: f.balance } : {}), ...(s.budget ? { budget: f.budgetMinor ?? 0 } : {}), ...(s.totals ? { income: f.income, expenses: f.expenses } : {}) };
    }),
    transactions: transactions.filter(t => selections.transactions?.[t.id]?.publish && !t.archived && t.status !== 'void').map(t => {
      const s = selections.transactions[t.id], fund = funds.find(f => f.id === t.fundId);
      return { date: t.date, type: t.type, amount: t.amountMinor, currency: fund?.currency || 'USD', ...(s.description ? { description: String(t.publicDescription || '') } : {}), ...(s.category ? { category: String(t.category || '') } : {}) };
    }),
  };
}
export function validTreasuryProjection(p) {
  const exact = (o, keys) => o && typeof o === 'object' && !Array.isArray(o) && Object.keys(o).every(k => keys.includes(k));
  const text = v => typeof v === 'string' && v.length <= 5000;
  const amount = v => Number.isSafeInteger(v) && Math.abs(v) <= Number.MAX_SAFE_INTEGER;
  return exact(p, ['heading', 'introduction', 'explanation', 'funds', 'transactions']) && text(p.heading) && text(p.introduction) && text(p.explanation)
    && Array.isArray(p.funds) && p.funds.length <= 1000 && p.funds.every(f => exact(f, ['name', 'currency', 'balance', 'budget', 'income', 'expenses']) && text(f.name) && /^[A-Z]{3}$/.test(f.currency) && ['balance', 'budget', 'income', 'expenses'].every(k => f[k] === undefined || amount(f[k])))
    && Array.isArray(p.transactions) && p.transactions.length <= 2000 && p.transactions.every(t => exact(t, ['date', 'type', 'amount', 'currency', 'description', 'category']) && /^\d{4}-\d{2}-\d{2}$/.test(t.date) && ['income', 'expense', 'reimbursement', 'transfer', 'contribution', 'adjustment'].includes(t.type) && amount(t.amount) && /^[A-Z]{3}$/.test(t.currency) && ['description', 'category'].every(k => t[k] === undefined || text(t[k])));
}
