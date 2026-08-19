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

export function round2(n) {
  return Math.round(parseFloat(n || 0) * 100) / 100;
}

export function parseApiError(err) {
  if (!err) return 'Something went wrong';
  const msg = err.message || String(err);
  return msg.split('\n')[0].slice(0, 300);
}
