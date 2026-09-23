export function formatMoney(minor, currency = 'USD') {
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(Number(minor || 0) / 100); }
  catch { return `${(Number(minor || 0) / 100).toFixed(2)} ${currency}`; }
}
