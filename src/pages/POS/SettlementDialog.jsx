import { useState } from 'react';
import { fmtINR, round2 } from '../../lib/format.js';
import SettlementLabel from './SettlementLabel.jsx';
import SettlementForm from './SettlementForm.jsx';

// Jewellery Scheme first — it's the default for a new bill's first row.
const OPTIONS = [
  { type: 'kitty', label: 'Jewellery Scheme' },
  { type: 'gold', label: 'Gold Purchase' },
  { type: 'return', label: 'Sales Return' },
];

let nextRowId = 1;

// The Settlement button's dialog — laid out like the Pay dialog's payment modes: each row picks
// a settlement type and selects that type's existing records right there (creating a Gold
// Purchase / Sales Return is the job of their own buttons); "+ Add Settlement" adds another
// row. A row turns into a line under "Applied to this bill" (with its ×) once it's settled.
// allowedTypes: the types this user's role may use. disabledReasons: type -> why it can't be
// picked on this bill right now (e.g. batch items).
export default function SettlementDialog({
  allowedTypes,
  disabledReasons = {},
  customer,
  settlements,
  balancePayable,
  draftInvoiceName,
  heldSettlementNumbers,
  onSettle,
  onRemove,
  onOpenSettlement,
  onClose,
}) {
  const options = OPTIONS.filter((o) => allowedTypes.includes(o.type));
  // A type can only be open in one row at a time (it can still be added again once that row is done).
  const freeType = (rows) => options.find((o) => !disabledReasons[o.type] && !rows.some((r) => r.type === o.type))?.type;
  const [rows, setRows] = useState(() => {
    const type = settlements.length ? null : freeType([]);
    return type ? [{ id: nextRowId++, type }] : [];
  });
  const canAdd = Boolean(freeType(rows));
  const total = round2(settlements.reduce((s, x) => s + (Number(x.amount) || 0), 0));

  function addRow() {
    const type = freeType(rows);
    if (type) setRows((prev) => [...prev, { id: nextRowId++, type }]);
  }
  function changeType(id, type) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, type } : r)));
  }
  function removeRow(id) {
    setRows((prev) => prev.filter((r) => r.id !== id));
  }
  function settleRow(id, entries) {
    if (onSettle(entries)) removeRow(id);
  }

  return <>
    <div className="cd-idialog-overlay" onClick={onClose} role="presentation" />
    <div className="cd-idialog settlement-dialog" role="dialog" aria-modal="true">
      <div className="cd-idialog-header">
        <span className="cd-idialog-title">Settlement · {customer?.customer_name || customer?.name}</span>
        <button type="button" className="cd-idialog-close" onClick={onClose}>×</button>
      </div>
      <div className="cd-idialog-body">
        {settlements.length > 0 && (
          <div className="cd-settlement-list">
            <label className="cd-label">Applied to this bill</label>
            {settlements.map((s) => (
              <div key={s.number}>
                <span><SettlementLabel settlement={s} onOpen={onOpenSettlement} /></span>
                <span className="cd-settlement-amount">
                  <strong>-{fmtINR(s.amount)}</strong>
                  {s.creditTotal > s.amount + 0.009 && <span className="cd-settlement-of">of {fmtINR(s.creditTotal)}</span>}
                  <button type="button" className="cd-settled-scheme-remove" onClick={() => onRemove(s)} aria-label={`Remove ${s.number}`}>×</button>
                </span>
              </div>
            ))}
          </div>
        )}

        <label className="cd-label">Settlements</label>
        {!rows.length && <div className="cd-hint" style={{ marginBottom: 10 }}>Use "+ Add Settlement" to settle with a Jewellery Scheme, Gold Purchase or Sales Return.</div>}
        {rows.map((row) => (
          <div className="cd-payment-entry" key={row.id}>
            <div className="cd-settlement-row-head">
              <select className="cd-select" value={row.type} onChange={(e) => changeType(row.id, e.target.value)}>
                {options.map((o) => (
                  <option
                    key={o.type}
                    value={o.type}
                    disabled={Boolean(disabledReasons[o.type]) || rows.some((r) => r.id !== row.id && r.type === o.type)}
                  >
                    {o.label}{disabledReasons[o.type] ? ` — ${disabledReasons[o.type]}` : ''}
                  </option>
                ))}
              </select>
              <button type="button" className="cd-del-btn" onClick={() => removeRow(row.id)} aria-label="Remove row">×</button>
            </div>
            <SettlementForm
              key={`${row.id}-${row.type}`}
              type={row.type}
              customer={customer}
              settlements={settlements}
              draftInvoiceName={draftInvoiceName}
              heldSettlementNumbers={heldSettlementNumbers}
              maxAmount={balancePayable}
              onSettle={(entries) => settleRow(row.id, entries)}
            />
          </div>
        ))}
        <button type="button" className="cd-btn cd-btn-secondary" disabled={!canAdd} onClick={addRow}>+ Add Settlement</button>

        <div className="cd-payment-status-grid">
          <div><span>Settlement Credit</span><strong>{fmtINR(total)}</strong></div>
          <div><span>Balance Payable</span><strong>{fmtINR(balancePayable)}</strong></div>
        </div>
      </div>
      <div className="cd-idialog-footer">
        <button type="button" className="cd-btn cd-btn-primary" onClick={onClose}>Done</button>
      </div>
    </div>
  </>;
}
