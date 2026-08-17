import { fmtINR } from '../../lib/format.js';

export default function DaySummary({ summary, loading }) {
  if (loading) {
    return (
      <div className="cd-day-summary">
        <span>Day summary loading…</span>
      </div>
    );
  }

  if (!summary) {
    return (
      <div className="cd-day-summary">
        <span>No sales data for today</span>
      </div>
    );
  }

  const modes = Object.entries(summary.modeBreakup || {});

  return (
    <div className="cd-day-summary">
      <span>
        Today&apos;s sales: <strong>{fmtINR(summary.totalSales)}</strong>
      </span>
      <span>
        Invoices: <strong>{summary.invoiceCount}</strong>
      </span>
      {modes.length > 0 && (
        <span>
          Collections:{' '}
          {modes.map(([mode, amt], i) => (
            <span key={mode}>
              {i > 0 && ' · '}
              <strong>{mode}</strong> {fmtINR(amt)}
            </span>
          ))}
        </span>
      )}
    </div>
  );
}
