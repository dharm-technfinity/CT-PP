/** Customer name with its ID appended when they differ, so same-name customers can be told apart */
export function customerLabel(c) {
  if (!c) return '';
  const display = c.customer_name || c.name || '';
  return c.name && c.name !== display ? `${display} (${c.name})` : display;
}

/** INR formatting: Rs symbol + Indian digit grouping */
export function fmtINR(n) {
  const val = parseFloat(n || 0);
  return `₹${val.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function fmtWeight(n) {
  const val = parseFloat(n || 0);
  return val.toLocaleString('en-IN', {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  });
}

export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export function formatDateTime(d = new Date()) {
  return d.toLocaleString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

export function fmtTime(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
}

export function fmtDateTime(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

// "2026-10-10" (ERPNext posting_date) -> "10-10-2026". Split as text, not parsed as a Date, so the
// browser's timezone can never shift it to the day before.
export function fmtDate(isoDate) {
  const [y, m, d] = String(isoDate || '').slice(0, 10).split('-');
  return y && m && d ? `${d}-${m}-${y}` : '';
}

export function round2(n) {
  return Math.round(parseFloat(n || 0) * 100) / 100;
}

export function parseApiError(err) {
  if (!err) return 'Something went wrong';
  const msg = err.message || String(err);
  return msg.split('\n')[0].slice(0, 300);
}
