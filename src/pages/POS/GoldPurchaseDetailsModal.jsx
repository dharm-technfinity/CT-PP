import { useEffect, useState } from 'react';
import { fmtINR, parseApiError } from '../../lib/format.js';
import { useToast } from '../../hooks/useToast.jsx';
import { fetchGoldPurchaseInvoice, cancelGoldPurchaseInvoice } from '../../lib/api.js';

// Opened from a Gold Purchase settlement chip on the bill. Shows the Purchase Invoice behind it
// so the cashier can check what was bought in, and offers the two ways off the bill:
//  - Remove from bill: only the chip goes; the Purchase Invoice stays submitted and can be added
//    back from the Gold Purchase dialog's Pending Gold Purchases list.
//  - Cancel Purchase Invoice: for a wrong entry — ERPNext reverses its stock and accounting, so
//    it leaves no effect at all, and the chip goes with it.
// readOnly (a submitted invoice being viewed) shows the details only.
export default function GoldPurchaseDetailsModal({ name, readOnly = false, onClose, onRemove, onCancelled }) {
  const { showToast } = useToast();
  const [doc, setDoc] = useState(null);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    if (!name) return undefined;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const d = await fetchGoldPurchaseInvoice(name);
        if (!cancelled) setDoc(d);
      } catch (e) {
        if (!cancelled) showToast(parseApiError(e), 'error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [name, showToast]);

  if (!name) return null;

  const isCancelled = Number(doc?.docstatus) === 2;

  async function handleCancel() {
    if (!window.confirm(
      `Cancel Purchase Invoice ${name}?\n\n` +
      'Its stock receipt and accounting entries will be reversed, and it will be removed from this bill.',
    )) return;
    setCancelling(true);
    try {
      await cancelGoldPurchaseInvoice(name);
      showToast(`Purchase Invoice ${name} cancelled`, 'success');
      onCancelled?.(name);
    } catch (e) {
      showToast(`Could not cancel ${name}: ${parseApiError(e)}`, 'error');
    } finally {
      setCancelling(false);
    }
  }

  return <><div className="cd-idialog-overlay" onClick={onClose} role="presentation" /><div className="cd-idialog wide operations-dialog gold-dialog" role="dialog" aria-modal="true">
    <div className="cd-idialog-header"><span className="cd-idialog-title">Gold Purchase · {name}</span><button className="cd-idialog-close" onClick={onClose}>×</button></div>
    <div className="cd-idialog-body">
      {loading ? (
        <div className="cd-ac-empty">Loading Purchase Invoice…</div>
      ) : !doc ? (
        <div className="cd-ac-empty">Purchase Invoice {name} could not be loaded</div>
      ) : <>
        <div className="cd-gold-details-grid">
          <div><span>Status</span><strong>{doc.status || (isCancelled ? 'Cancelled' : '')}</strong></div>
          <div><span>Bill No</span><strong>{doc.bill_no || '—'}</strong></div>
          <div><span>Date</span><strong>{doc.posting_date}</strong></div>
          <div><span>Supplier</span><strong>{doc.supplier_name || doc.supplier}</strong></div>
          <div><span>Warehouse</span><strong>{doc.set_warehouse || doc.items?.[0]?.warehouse || '—'}</strong></div>
          <div><span>Grand Total</span><strong>{fmtINR(doc.grand_total)}</strong></div>
        </div>
        <div className="cd-gold-right">
        <table className="cd-gold-table">
          <thead><tr><th>Item Code</th><th>Gross Wt</th><th>Net Wt</th><th>Diamond Value</th><th>Rate</th><th>Amount</th></tr></thead>
          <tbody>
            {(doc.items || []).map((r) => (
              <tr key={r.name}>
                <td>{r.item_code}</td>
                <td>{r.custom_gross_weight ? Number(r.custom_gross_weight).toFixed(3) : '—'}</td>
                <td>{Number(r.custom_net_weight || r.qty || 0).toFixed(3)}</td>
                <td>{r.custom_diamond_value ? fmtINR(r.custom_diamond_value) : '—'}</td>
                <td>{fmtINR(r.rate)}</td>
                <td>{fmtINR(r.amount)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr><td colSpan={5}>Total</td><td>{fmtINR(doc.grand_total)}</td></tr></tfoot>
        </table>
        </div>
        {isCancelled && !readOnly && <div className="cd-hint">This Purchase Invoice is already cancelled — remove it from the bill.</div>}
      </>}
    </div>
    <div className="cd-idialog-footer">
      <button className="cd-btn cd-btn-secondary" onClick={onClose}>Close</button>
      {!readOnly && <>
        <button className="cd-btn cd-btn-secondary" disabled={cancelling} onClick={() => onRemove?.(name)}>Remove from bill</button>
        <button className="cd-btn cd-btn-danger" disabled={loading || !doc || isCancelled || cancelling} onClick={handleCancel}>{cancelling ? 'Cancelling…' : 'Cancel Purchase Invoice'}</button>
      </>}
    </div>
  </div></>;
}
