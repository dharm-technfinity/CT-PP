import { useEffect, useState } from 'react';
import { fetchSalesPersons } from '../../lib/api.js';
import { fmtINR, round2 } from '../../lib/format.js';
import { redistributeSalesTeam as redistribute } from './posCalculations.js';

// Shared row-editor used both by the per-bill Sales Team dialog (context bar) and the Shift
// Start dialog (shift-level default team, seeded into every new bill during that shift).
// Amount only makes sense once there's a bill total to split — omitted via showAmount=false
// at Shift Start, where no cart exists yet.
export default function SalesTeamTable({ rows, onChange, showAmount = true, grandTotal = 0 }) {
  const [salesPersons, setSalesPersons] = useState([]);
  const [openRow, setOpenRow] = useState(null);
  const [query, setQuery] = useState('');

  useEffect(() => { fetchSalesPersons().then(setSalesPersons).catch(() => setSalesPersons([])); }, []);

  const totalPct = round2(rows.reduce((s, r) => s + (Number(r.percentage) || 0), 0));

  function update(i, patch) {
    onChange(rows.map((r, x) => (x === i ? { ...r, ...patch } : r)));
  }
  function addRow() {
    onChange(redistribute([...rows, { salesPerson: '', percentage: 0 }]));
  }
  function removeRow(i) {
    onChange(redistribute(rows.filter((_, x) => x !== i)));
  }
  // Contribution % defaults to the person's own commission_rate (set on their Sales Person
  // record) the moment they're picked — still manually editable afterward. A person with no
  // commission_rate configured keeps whatever the row already had (the even-split default).
  function selectPerson(i, person) {
    update(i, {
      salesPerson: person.name,
      ...(person.commissionRate > 0 ? { percentage: person.commissionRate } : {}),
    });
    setOpenRow(null);
    setQuery('');
  }

  return (
    <div className="cd-sales-team-table">
      <div className={`cd-sales-team-row cd-sales-team-head${showAmount ? '' : ' no-amount'}`}>
        <span>#</span>
        <span>Sales Person</span>
        <span>Contribution %</span>
        {showAmount && <span>Amount</span>}
        <span></span>
      </div>
      {rows.map((row, i) => {
        const results = salesPersons
          .filter((p) => p.name.toLowerCase().includes(query.trim().toLowerCase()))
          .slice(0, 20);
        return (
          <div className={`cd-sales-team-row${showAmount ? '' : ' no-amount'}`} key={i}>
            <span>{i + 1}</span>
            <div className="cd-ac">
              <input
                className="cd-input"
                autoComplete="off"
                placeholder="Search sales person…"
                value={openRow === i ? query : row.salesPerson}
                onChange={(e) => { setQuery(e.target.value); setOpenRow(i); }}
                onFocus={() => { setQuery(''); setOpenRow(i); }}
                onBlur={() => setTimeout(() => setOpenRow((o) => (o === i ? null : o)), 150)}
              />
              {openRow === i && (
                <div className="cd-ac-list">
                  {results.length === 0 && <div className="cd-ac-empty">No sales person found</div>}
                  {results.map((p) => (
                    <div key={p.name} className="cd-ac-item" onMouseDown={() => selectPerson(i, p)} role="button" tabIndex={0}>
                      <div className="main">{p.name}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <input
              className="cd-input"
              type="number"
              min="0"
              max="100"
              value={row.percentage}
              onChange={(e) => update(i, { percentage: e.target.value })}
            />
            {showAmount && (
              <span className="cd-sales-team-amount">
                {fmtINR(round2(((Number(row.percentage) || 0) / 100) * (grandTotal || 0)))}
              </span>
            )}
            {rows.length > 1
              ? <button type="button" className="cd-del-btn" onClick={() => removeRow(i)}>×</button>
              : <span />}
          </div>
        );
      })}
      <button type="button" className="cd-btn cd-btn-secondary" onClick={addRow}>+ Add Sales Person</button>
      <div className="cd-sales-team-total">
        <span>Total</span>
        <strong className={totalPct !== 100 ? 'cd-sales-team-total-warn' : ''}>{totalPct}%</strong>
      </div>
    </div>
  );
}
