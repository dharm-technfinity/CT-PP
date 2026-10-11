import { useEffect, useState } from 'react';
import { fmtINR, parseApiError } from '../../lib/format.js';
import { useDebounce } from '../../hooks/useDebounce.js';
import { useToast } from '../../hooks/useToast.jsx';
import {
  searchCustomers,
  fetchCustomerInvoices,
  createSalesReturn,
  createGoldPurchaseInvoice,
  fetchWarehouses,
  fetchGoldPurchaseItemGroups,
} from '../../lib/api.js';
import ItemVariantPicker from './ItemVariantPicker.jsx';

const TITLES = { gold: 'Gold Purchase Voucher', return: 'Sales Return / Credit Note' };

// The Gold Purchase / Sales Return buttons: they only *create* the record (a Purchase Invoice or
// a Credit Note) and show its number. Putting it on a bill is done separately, from the
// Settlement button's Gold Purchase / Sales Return rows (SettlementForm.jsx).
export default function CreateSettlementRecordModal({ type, customer, onClose, onCreated }) {
  const { showToast } = useToast();
  const [opCustomer, setOpCustomer] = useState(customer || null);
  const [customerQuery, setCustomerQuery] = useState('');
  const [customerResults, setCustomerResults] = useState([]);
  const [customerSearching, setCustomerSearching] = useState(false);
  const [showCustomerList, setShowCustomerList] = useState(false);
  const debouncedCustomerQuery = useDebounce(customerQuery, 300);
  const [submitting, setSubmitting] = useState(false);
  // { name, against? } of the record just created — the dialog then only shows its number.
  const [created, setCreated] = useState(null);

  // Sales Return
  const [customerInvoices, setCustomerInvoices] = useState([]);
  const [invoicesLoading, setInvoicesLoading] = useState(false);
  const [number, setNumber] = useState('');
  const [amount, setAmount] = useState('');

  // Gold Purchase — item selection + Qty/Rate/Amount entry all happen inside the item picker
  // dialog itself (ItemVariantPicker, opened via itemPickerOpen); this just holds what's been
  // staged so far and Create Purchase Invoice sends every staged row as one invoice's items.
  const [goldRows, setGoldRows] = useState([]);
  const [itemPickerOpen, setItemPickerOpen] = useState(false);
  const [goldItemGroups, setGoldItemGroups] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [goldWarehouse, setGoldWarehouse] = useState('');
  const goldRowsTotal = Math.round(goldRows.reduce((s, r) => s + (r.amount || 0), 0) * 100) / 100;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setCustomerSearching(true);
      try {
        const rows = await searchCustomers(debouncedCustomerQuery);
        if (!cancelled) setCustomerResults(rows);
      } catch (e) {
        if (!cancelled) showToast(parseApiError(e), 'error');
      } finally {
        if (!cancelled) setCustomerSearching(false);
      }
    })();
    return () => { cancelled = true; };
  }, [debouncedCustomerQuery, showToast]);

  useEffect(() => {
    if (type !== 'return' || !opCustomer?.name) return undefined;
    let cancelled = false;
    (async () => {
      setInvoicesLoading(true);
      try {
        const rows = await fetchCustomerInvoices(opCustomer.name);
        if (!cancelled) setCustomerInvoices(rows);
      } catch (e) {
        if (!cancelled) showToast(parseApiError(e), 'error');
      } finally {
        if (!cancelled) setInvoicesLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [type, opCustomer, showToast]);

  useEffect(() => {
    if (type !== 'gold') return undefined;
    let cancelled = false;
    (async () => {
      const [whs, groups] = await Promise.all([fetchWarehouses(), fetchGoldPurchaseItemGroups()]);
      if (cancelled) return;
      setWarehouses(whs);
      setGoldItemGroups(groups);
    })();
    return () => { cancelled = true; };
  }, [type]);

  function selectCustomer(c) {
    setOpCustomer(c);
    setCustomerQuery('');
    setShowCustomerList(false);
    setNumber('');
    setAmount('');
    setCustomerInvoices([]);
  }
  function selectInvoice(invName) {
    setNumber(invName);
    const inv = customerInvoices.find((i) => i.name === invName);
    setAmount(inv ? String(inv.grand_total) : '');
  }
  function removeGoldRow(idx) {
    setGoldRows(rows => rows.filter((_, i) => i !== idx));
  }
  // From the item picker dialog — it already collects Qty/Rate/Amount/UOM itself (matching
  // Purchase Receipt's own Make BOM dialog), so this pushes the row straight in; the picker
  // stays open for the next item.
  function addGoldRowFromPicker(item, { uom, qty: q, rate: r, amount: amt, gross_wt, net_wt, diamond_value }) {
    setGoldRows(rows => [...rows, {
      item_code: item.item_code,
      item_name: item.item_name,
      qty: q,
      rate: r,
      amount: amt,
      gross_wt,
      net_wt,
      diamond_value,
      has_serial_no: item.has_serial_no,
      has_batch_no: item.has_batch_no,
      stock_uom: uom || item.stock_uom,
      gst_hsn_code: item.gst_hsn_code,
    }]);
  }

  async function handleCreateReturn() {
    if (!number) return;
    setSubmitting(true);
    try {
      const name = await createSalesReturn(number);
      setCreated({ name, against: number });
      onCreated?.();
    } catch (e) {
      showToast(parseApiError(e), 'error');
    } finally {
      setSubmitting(false);
    }
  }
  async function handleCreateGoldPurchase() {
    if (!opCustomer?.name) { showToast('Select a customer first', 'error'); return; }
    if (!goldRows.length) { showToast('Add at least one item', 'error'); return; }
    if (!goldWarehouse) { showToast('Select a warehouse to receive the gold into', 'error'); return; }
    setSubmitting(true);
    try {
      const name = await createGoldPurchaseInvoice({
        customer: opCustomer.name,
        items: goldRows,
        warehouse: goldWarehouse,
      });
      setCreated({ name });
      onCreated?.();
    } catch (e) {
      showToast(parseApiError(e), 'error');
    } finally {
      setSubmitting(false);
    }
  }

  if (!type) return null;
  const recordLabel = type === 'gold' ? 'Purchase Invoice' : 'Credit Note';
  return <><div className="cd-idialog-overlay" onClick={onClose} role="presentation" /><div className={`cd-idialog wide operations-dialog${type === 'gold' && !created ? ' gold-dialog' : ''}`} role="dialog" aria-modal="true">
    <div className="cd-idialog-header"><span className="cd-idialog-title">{TITLES[type]}</span><button className="cd-idialog-close" onClick={onClose}>×</button></div>
    <div className="cd-idialog-body">
      {created ? (
        <div className="cd-success-banner">
          <h3>{recordLabel} created</h3>
          <p className="cd-created-record">{created.name}</p>
          <p>
            {type === 'gold' ? 'Gold Purchase' : `Sales Return against ${created.against}`} for {opCustomer?.customer_name || opCustomer?.name}.
            {' '}Add it to a bill from <strong>Settlement → {type === 'gold' ? 'Gold Purchase' : 'Sales Return'}</strong>.
          </p>
        </div>
      ) : <>
        <div className="cd-field">
          <label className="cd-label">Customer</label>
          <div className="cd-ac">
            <input
              className="cd-input"
              placeholder="Search by name or mobile…"
              value={showCustomerList ? customerQuery : (opCustomer?.customer_name || opCustomer?.name || customerQuery)}
              onChange={(e) => { setCustomerQuery(e.target.value); setShowCustomerList(true); }}
              onFocus={() => { setCustomerQuery(''); setShowCustomerList(true); }}
              onBlur={() => setTimeout(() => setShowCustomerList(false), 150)}
            />
            {showCustomerList && (
              <div className="cd-ac-list">
                {customerSearching && <div className="cd-ac-empty">Searching…</div>}
                {!customerSearching && !customerQuery.trim() && customerResults.length > 0 && (
                  <div className="cd-ac-hint">Recent customers</div>
                )}
                {!customerSearching && customerResults.length === 0 && (
                  <div className="cd-ac-empty">No customer found</div>
                )}
                {customerResults.map((c) => (
                  <div key={c.name} className="cd-ac-item" onMouseDown={() => selectCustomer(c)} role="button" tabIndex={0}>
                    <div className="main">{c.customer_name || c.name}</div>
                    <div className="sub">{c.mobile_no || '—'}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        {type === 'gold' && <>
          <div className="cd-gold-split">
            <button type="button" className="cd-btn cd-btn-secondary cd-gold-add-btn" onClick={() => setItemPickerOpen(true)}>
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
              Add Item
            </button>
            <div className="cd-gold-right">
              <table className="cd-gold-table">
                <thead><tr><th>Item Code</th><th>Gross Wt</th><th>Net Wt</th><th>Diamond Value</th><th>Rate</th><th>Amount</th><th></th></tr></thead>
                <tbody>
                  {!goldRows.length && <tr><td colSpan={7} className="cd-ac-empty">No items added yet</td></tr>}
                  {goldRows.map((r, i) => (
                    <tr key={i}>
                      <td>{r.item_code}</td>
                      <td>{r.gross_wt ? Number(r.gross_wt).toFixed(3) : '—'}</td>
                      <td>{r.net_wt ? Number(r.net_wt).toFixed(3) : '—'}</td>
                      <td>{r.diamond_value ? fmtINR(r.diamond_value) : '—'}</td>
                      <td>{fmtINR(r.rate)}</td>
                      <td>{fmtINR(r.amount)}</td>
                      <td><button type="button" className="cd-gold-row-remove" title="Remove" onClick={() => removeGoldRow(i)}>×</button></td>
                    </tr>
                  ))}
                </tbody>
                {goldRows.length > 0 && (
                  <tfoot><tr><td colSpan={5}>Total</td><td colSpan={2}>{fmtINR(goldRowsTotal)}</td></tr></tfoot>
                )}
              </table>
            </div>
          </div>
          <div className="cd-field">
            <label className="cd-label">Receiving Warehouse</label>
            <select className="cd-select" value={goldWarehouse} onChange={e => setGoldWarehouse(e.target.value)}>
              <option value="">Select warehouse…</option>
              {warehouses.map((w) => <option key={w} value={w}>{w}</option>)}
            </select>
            <div className="cd-hint">The Gold Purchase is received into stock here — since it comes in from a customer, it never has a serial/batch of its own; one gets created automatically for each item that needs it.</div>
          </div>
          {goldRowsTotal > 0 && <div className="cd-remaining ok">Purchase value: {fmtINR(goldRowsTotal)}</div>}
        </>}
        {type === 'return' && <>
          <div className="cd-field">
            <label className="cd-label">Previous invoice for selected customer</label>
            <select className="cd-select" value={number} onChange={e => selectInvoice(e.target.value)} disabled={!opCustomer?.name || invoicesLoading}>
              <option value="">{!opCustomer?.name ? 'Select a customer first' : invoicesLoading ? 'Loading invoices…' : customerInvoices.length ? 'Select invoice' : 'No submitted invoices found'}</option>
              {customerInvoices.map((inv) => (
                <option key={inv.name} value={inv.name}>{inv.name} · {inv.posting_date} · {fmtINR(inv.grand_total)}</option>
              ))}
            </select>
          </div>
          <div className="cd-field">
            <label className="cd-label">Credit Note / Return Amount</label>
            <input className="cd-input" type="number" min="0" value={amount} readOnly />
            <div className="cd-hint">Full return of the selected invoice — partial item returns aren't supported here yet.</div>
          </div>
        </>}
      </>}
    </div>
    <div className="cd-idialog-footer">
      {created ? (
        <button className="cd-btn cd-btn-primary" onClick={onClose}>OK</button>
      ) : <>
        <button className="cd-btn cd-btn-secondary" onClick={onClose}>Cancel</button>
        {type === 'return' && <button className="cd-btn cd-btn-primary" disabled={!number || submitting} onClick={handleCreateReturn}>{submitting ? 'Creating…' : 'Create Credit Note'}</button>}
        {type === 'gold' && <button className="cd-btn cd-btn-primary" disabled={!goldRows.length || !goldWarehouse || submitting} onClick={handleCreateGoldPurchase}>{submitting ? 'Creating…' : 'Create Purchase Invoice'}</button>}
      </>}
    </div>
  </div>
  <ItemVariantPicker
    key={itemPickerOpen ? 'ivp-open' : 'ivp-closed'}
    open={itemPickerOpen}
    onClose={() => setItemPickerOpen(false)}
    onAdd={addGoldRowFromPicker}
    fixedItemGroups={goldItemGroups}
  />
  </>;
}
