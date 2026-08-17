import { useEffect, useState } from 'react';
import { fmtINR, parseApiError } from '../../lib/format.js';
import { useDebounce } from '../../hooks/useDebounce.js';
import { useToast } from '../../hooks/useToast.jsx';
import {
  searchCustomers,
  fetchCustomerInvoices,
  fetchCustomerSchemeAssignments,
  searchJewellerySchemes,
  createSalesReturn,
  createOldGoldPurchaseInvoice,
  fetchWarehouses,
  fetchGoldPurchaseItemGroups,
} from '../../lib/api.js';
import ItemVariantPicker from './ItemVariantPicker.jsx';

const TITLES = { gold: 'Gold Purchase Voucher', kitty: 'Jewellery Scheme', return: 'Sales Return / Credit Note' };

// e.g. "+ ₹9,900 off Making" — schemes without a bonus month (Bandhan, Nidhi) instead earn a
// flat rupee amount (their mc_percentage_discount % of total EMI paid) earmarked against
// Making Charges — see enrichSchemeAssignmentWithRedeemableValue in api.js.
function componentDiscountLabel(cd) {
  const making = cd?.making;
  const value = parseFloat(making?.value || 0) || 0;
  if (!value) return '';
  const text = making.mode === 'percent' ? `${value}% off Making` : `${fmtINR(value)} off Making`;
  return ` + ${text}`;
}
// Gold Purchase's own Common Party Supplier nets its payable against the customer's
// Debtors automatically once both documents are submitted (see createOldGoldPurchaseInvoice in
// api.js) — this only needs to shrink what the cashier is asked to actually collect right now,
// the same way a redeemed scheme's real advance does, not touch taxable value/GST at all.
function goldSettlementEntry(name, opCustomer, goldValue) {
  return {
    type: 'gold',
    number: name,
    customer: opCustomer,
    amount: goldValue,
    bonusAmount: 0,
    advanceAllocations: [],
    componentDiscounts: {},
  };
}

export default function OperationsModal({ type, customer, settlements = [], onClose, onSettle, onCreated }) {
  const { showToast } = useToast();
  const [amount, setAmount] = useState('');
  const [number, setNumber] = useState('');
  const [opCustomer, setOpCustomer] = useState(customer || null);
  const [customerQuery, setCustomerQuery] = useState('');
  const [customerResults, setCustomerResults] = useState([]);
  const [customerSearching, setCustomerSearching] = useState(false);
  const [showCustomerList, setShowCustomerList] = useState(false);
  const debouncedCustomerQuery = useDebounce(customerQuery, 300);
  const [customerInvoices, setCustomerInvoices] = useState([]);
  const [invoicesLoading, setInvoicesLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Jewellery Scheme — a checklist of the selected customer's own matured schemes, so several
  // can be redeemed onto one bill in a single visit instead of reopening this dialog per scheme.
  const [schemeAssignments, setSchemeAssignments] = useState([]);
  const [schemesLoading, setSchemesLoading] = useState(false);
  const [selectedSchemes, setSelectedSchemes] = useState({});
  const [schemeQuery, setSchemeQuery] = useState('');
  // Jewellery Scheme *type* — a bill can only redeem assignments from one scheme type, so this
  // scopes the checklist below to a single Jewellery Scheme, picked before any assignment.
  const [schemeType, setSchemeType] = useState(null);
  const [schemeTypeQuery, setSchemeTypeQuery] = useState('');
  const [schemeTypeResults, setSchemeTypeResults] = useState([]);
  const [schemeTypeSearching, setSchemeTypeSearching] = useState(false);
  const [showSchemeTypeList, setShowSchemeTypeList] = useState(false);
  const debouncedSchemeTypeQuery = useDebounce(schemeTypeQuery, 300);

  // Gold Purchase — item selection + Qty/Rate/Amount entry all happen inside the item picker
  // dialog itself (ItemVariantPicker, opened via itemPickerOpen); this just holds what's been
  // staged so far and Create Purchase Invoice sends every staged row as one invoice's items.
  const [goldRows, setGoldRows] = useState([]);
  const [itemPickerOpen, setItemPickerOpen] = useState(false);
  const [goldItemGroups, setGoldItemGroups] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [goldWarehouse, setGoldWarehouse] = useState('');
  const goldRowsTotal = Math.round(goldRows.reduce((s, r) => s + (r.amount || 0), 0) * 100) / 100;

  function removeGoldRow(idx) {
    setGoldRows(rows => rows.filter((_, i) => i !== idx));
  }
  // From the item picker dialog — it already collects Qty/Rate/Amount/UOM itself (matching
  // Purchase Receipt's own Make BOM dialog), so this pushes the row straight in without going
  // through the separate entry fields above; the picker stays open for the next item.
  function addGoldRowFromPicker(item, { uom, qty: q, rate: r, amount: amt }) {
    setGoldRows(rows => [...rows, {
      item_code: item.item_code,
      item_name: item.item_name,
      qty: q,
      rate: r,
      amount: amt,
      has_serial_no: item.has_serial_no,
      has_batch_no: item.has_batch_no,
      stock_uom: uom || item.stock_uom,
      gst_hsn_code: item.gst_hsn_code,
    }]);
  }

  useEffect(() => {
    if (!type) return undefined;
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
  }, [type, debouncedCustomerQuery, showToast]);

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
    if (type !== 'kitty' || !opCustomer?.name) return undefined;
    let cancelled = false;
    (async () => {
      setSchemesLoading(true);
      try {
        // Each row already comes back with its real advance (from the Payment Entries that
        // collected it) and bonus-month discount pre-computed — no separate per-row fetch needed.
        const rows = await fetchCustomerSchemeAssignments(opCustomer.name);
        if (!cancelled) setSchemeAssignments(rows);
      } catch (e) {
        if (!cancelled) showToast(parseApiError(e), 'error');
      } finally {
        if (!cancelled) setSchemesLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [type, opCustomer, showToast]);

  useEffect(() => {
    if (type !== 'kitty') return undefined;
    let cancelled = false;
    (async () => {
      setSchemeTypeSearching(true);
      try {
        const rows = await searchJewellerySchemes(debouncedSchemeTypeQuery);
        if (!cancelled) setSchemeTypeResults(rows);
      } catch (e) {
        if (!cancelled) showToast(parseApiError(e), 'error');
      } finally {
        if (!cancelled) setSchemeTypeSearching(false);
      }
    })();
    return () => { cancelled = true; };
  }, [type, debouncedSchemeTypeQuery, showToast]);

  useEffect(() => {
    if (type !== 'gold') return undefined;
    let cancelled = false;
    (async () => {
      const rows = await fetchWarehouses();
      if (!cancelled) setWarehouses(rows);
    })();
    return () => { cancelled = true; };
  }, [type]);

  useEffect(() => {
    if (type !== 'gold') return undefined;
    let cancelled = false;
    (async () => {
      const rows = await fetchGoldPurchaseItemGroups();
      if (!cancelled) setGoldItemGroups(rows);
    })();
    return () => { cancelled = true; };
  }, [type]);

  if (!type) return null;
  // A scheme already sitting in this bill's settlements can't be redeemed again — hide it
  // instead of just disabling it, so re-opening this dialog only ever shows what's left.
  const alreadySettledNames = new Set(settlements.filter((s) => s.type === 'kitty').map((s) => s.number));
  const unsettledSchemes = schemeAssignments.filter((a) => !alreadySettledNames.has(a.name));
  // A bill can only redeem assignments from one Jewellery Scheme type — if this bill already
  // has a kitty settlement on it, that scheme type is locked in (field disabled, pre-filled)
  // so a second, different scheme type can never be added alongside it.
  const kittySettlements = settlements.filter((s) => s.type === 'kitty');
  const lockedSchemeCode = kittySettlements[0]?.scheme || '';
  const lockedSchemeName = kittySettlements[0]?.scheme_name || '';
  const schemeTypeLocked = Boolean(lockedSchemeCode);
  const effectiveSchemeCode = lockedSchemeCode || schemeType?.name || '';
  const effectiveSchemeName = lockedSchemeName || schemeType?.scheme_name || schemeType?.name || '';
  const schemeScopedSchemes = effectiveSchemeCode
    ? unsettledSchemes.filter((a) => a.scheme === effectiveSchemeCode)
    : unsettledSchemes;
  const schemeSearch = schemeQuery.trim().toLowerCase();
  const availableSchemes = schemeSearch
    ? schemeScopedSchemes.filter((a) =>
        [a.name, a.scheme_name, a.scheme].some((v) => String(v || '').toLowerCase().includes(schemeSearch)),
      )
    : schemeScopedSchemes;
  // Totals count against every scoped scheme, not just the ones matching the current search —
  // filtering the list to find one more scheme shouldn't silently drop an already-ticked
  // selection from the total just because it's scrolled out of view.
  const selectedCount = schemeScopedSchemes.filter((a) => selectedSchemes[a.name]).length;
  const selectedTotal = schemeScopedSchemes.reduce((s, a) => s + (selectedSchemes[a.name] ? a.totalRedeemable || 0 : 0), 0);
  function toggleScheme(name) {
    setSelectedSchemes((prev) => ({ ...prev, [name]: !prev[name] }));
  }
  function selectSchemeType(s) {
    setSchemeType(s);
    setSchemeTypeQuery('');
    setShowSchemeTypeList(false);
    setSelectedSchemes({});
  }
  function settle() {
    // amount = the real advance only (what actually reduces the payable balance in the
    // Settlement list) — bonusAmount is kept separate since it's applied as a genuine discount
    // on the invoice's taxable value instead, not subtracted from payable a second time.
    const entries = schemeScopedSchemes
      .filter((a) => selectedSchemes[a.name])
      .map((a) => ({
        type,
        number: a.name,
        customer: opCustomer,
        scheme: a.scheme,
        scheme_name: a.scheme_name,
        amount: a.advanceTotal || 0,
        bonusAmount: a.bonusAmount || 0,
        advanceAllocations: a.advanceAllocations || [],
        componentDiscounts: a.componentDiscounts || {},
      }));
    if (!entries.length) return;
    onSettle(entries);
    setSelectedSchemes({});
  }
  function selectCustomer(c) {
    setOpCustomer(c);
    setCustomerQuery('');
    setShowCustomerList(false);
    setNumber('');
    setAmount('');
    setCustomerInvoices([]);
    setSchemeAssignments([]);
    setSelectedSchemes({});
    setSchemeQuery('');
    setSchemeType(null);
    setSchemeTypeQuery('');
  }
  function selectInvoice(invName) {
    setNumber(invName);
    const inv = customerInvoices.find((i) => i.name === invName);
    setAmount(inv ? String(inv.grand_total) : '');
  }
  async function handleCreateReturn() {
    if (!number) return;
    setSubmitting(true);
    try {
      const name = await createSalesReturn(number);
      showToast(`Credit Note ${name} created against ${number}`, 'success');
      onCreated?.();
      onClose();
    } catch (e) {
      showToast(parseApiError(e), 'error');
    } finally {
      setSubmitting(false);
    }
  }
  async function handleCreateOldGoldVoucher() {
    if (!opCustomer?.name) { showToast('Select a customer first', 'error'); return; }
    if (!goldRows.length) { showToast('Add at least one item', 'error'); return; }
    if (!goldWarehouse) { showToast('Select a warehouse to receive the gold into', 'error'); return; }
    setSubmitting(true);
    try {
      const name = await createOldGoldPurchaseInvoice({
        customer: opCustomer.name,
        items: goldRows,
        warehouse: goldWarehouse,
      });
      showToast(`Purchase Invoice ${name} created for old gold purchase`, 'success');
      onCreated?.();
      onSettle(goldSettlementEntry(name, opCustomer, goldRowsTotal));
    } catch (e) {
      showToast(parseApiError(e), 'error');
    } finally {
      setSubmitting(false);
    }
  }
  return <><div className="cd-idialog-overlay" onClick={onClose} role="presentation" /><div className="cd-idialog wide operations-dialog" role="dialog" aria-modal="true">
    <div className="cd-idialog-header"><span className="cd-idialog-title">{TITLES[type]}</span><button className="cd-idialog-close" onClick={onClose}>×</button></div>
    <div className="cd-idialog-body">
      <div className="cd-operation-type">Receipt type: <strong>{type === 'gold' ? 'Gold Purchase' : type === 'kitty' ? 'Jewellery Scheme Collection / Maturity' : 'Sales Return'}</strong></div>
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
      {type === 'kitty' && (
        <div className="cd-field">
          <label className="cd-label">Jewellery Scheme</label>
          <div className="cd-ac">
            <input
              className="cd-input"
              placeholder="Search scheme name…"
              value={schemeTypeLocked ? effectiveSchemeName : (showSchemeTypeList ? schemeTypeQuery : (schemeType ? (schemeType.scheme_name || schemeType.name) : schemeTypeQuery))}
              disabled={schemeTypeLocked}
              onChange={(e) => { setSchemeTypeQuery(e.target.value); setShowSchemeTypeList(true); }}
              onFocus={() => { setSchemeTypeQuery(''); setShowSchemeTypeList(true); }}
              onBlur={() => setTimeout(() => setShowSchemeTypeList(false), 150)}
            />
            {showSchemeTypeList && !schemeTypeLocked && (
              <div className="cd-ac-list">
                {schemeTypeSearching && <div className="cd-ac-empty">Searching…</div>}
                {!schemeTypeSearching && schemeTypeResults.length === 0 && (
                  <div className="cd-ac-empty">No scheme found</div>
                )}
                {schemeTypeResults.map((s) => (
                  <div key={s.name} className="cd-ac-item" onMouseDown={() => selectSchemeType(s)} role="button" tabIndex={0}>
                    <div className="main">{s.scheme_name || s.name}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
          {schemeTypeLocked && (
            <div className="cd-hint">This bill already has a redemption from this scheme — only its assignments can be added here.</div>
          )}
        </div>
      )}
      {type === 'gold' && <>
        <div className="cd-gold-split">
          <button type="button" className="cd-btn cd-btn-secondary cd-gold-add-btn" onClick={() => setItemPickerOpen(true)}>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            Add Item
          </button>
          <div className="cd-gold-right">
            <table className="cd-gold-table">
              <thead><tr><th>Item Code</th><th>UOM</th><th>Qty</th><th>Rate</th><th>Amount</th><th></th></tr></thead>
              <tbody>
                {!goldRows.length && <tr><td colSpan={6} className="cd-ac-empty">No items added yet</td></tr>}
                {goldRows.map((r, i) => (
                  <tr key={i}>
                    <td>{r.item_code}</td>
                    <td>{r.stock_uom}</td>
                    <td>{r.qty}</td>
                    <td>{fmtINR(r.rate)}</td>
                    <td>{fmtINR(r.amount)}</td>
                    <td><button type="button" className="cd-gold-row-remove" title="Remove" onClick={() => removeGoldRow(i)}>×</button></td>
                  </tr>
                ))}
              </tbody>
              {goldRows.length > 0 && (
                <tfoot><tr><td colSpan={4}>Total</td><td colSpan={2}>{fmtINR(goldRowsTotal)}</td></tr></tfoot>
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
          <div className="cd-hint">The old gold is received into stock here — since it comes in from a customer, it never has a serial/batch of its own; one gets created automatically for each item that needs it.</div>
        </div>
      </>}
      {type === 'kitty' && (
        <div className="cd-field">
          <label className="cd-label">Matured Schemes — tick all you want to redeem onto this bill</label>
          {!opCustomer?.name ? (
            <div className="cd-ac-empty">Select a customer first</div>
          ) : !effectiveSchemeCode ? (
            <div className="cd-ac-empty">Select a Jewellery Scheme first</div>
          ) : schemesLoading ? (
            <div className="cd-ac-empty">Loading schemes…</div>
          ) : !schemeScopedSchemes.length ? (
            <div className="cd-ac-empty">No matured scheme found for this customer under {effectiveSchemeName || 'this scheme'}</div>
          ) : (
            <>
              {schemeScopedSchemes.length > 1 && (
                <input
                  className="cd-input"
                  style={{ marginBottom: 8 }}
                  placeholder="Search by scheme No., credit note, or scheme name…"
                  value={schemeQuery}
                  onChange={(e) => setSchemeQuery(e.target.value)}
                />
              )}
              {!availableSchemes.length ? (
                <div className="cd-ac-empty">No scheme matches "{schemeQuery}"</div>
              ) : (
                <div className="cd-scheme-list">
                  {availableSchemes.map((a) => (
                    <label key={a.name} className="cd-scheme-row">
                      <input type="checkbox" checked={!!selectedSchemes[a.name]} onChange={() => toggleScheme(a.name)} />
                      <div className="cd-scheme-text">
                        <div className="main">{a.name} · {a.scheme_name || a.scheme}</div>
                        <div className="sub">
                          Advance {fmtINR(a.advanceTotal || 0)}
                          {a.bonusAmount > 0 ? ` + Bonus Discount ${fmtINR(a.bonusAmount)}` : ''}
                          {componentDiscountLabel(a.componentDiscounts)}
                        </div>
                      </div>
                      <strong>{fmtINR(a.totalRedeemable || 0)}</strong>
                    </label>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
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
      {type === 'gold' && goldRowsTotal > 0 && <div className="cd-remaining ok">Purchase value: {fmtINR(goldRowsTotal)}</div>}
      {type === 'kitty' && selectedCount > 0 && <div className="cd-remaining ok">{selectedCount} scheme{selectedCount > 1 ? 's' : ''} selected — Total credit: {fmtINR(selectedTotal)}</div>}
    </div>
    <div className="cd-idialog-footer">
      <button className="cd-btn cd-btn-secondary" onClick={onClose}>Cancel</button>
      {type === 'return' && <button className="cd-btn cd-btn-primary" disabled={!number || submitting} onClick={handleCreateReturn}>{submitting ? 'Creating…' : 'Create Credit Note'}</button>}
      {type === 'gold' && <button className="cd-btn cd-btn-primary" disabled={!goldRows.length || !goldWarehouse || submitting} onClick={handleCreateOldGoldVoucher}>{submitting ? 'Creating…' : 'Create Purchase Invoice'}</button>}
      {type === 'kitty' && <button className="cd-btn cd-btn-primary" disabled={!selectedCount} onClick={settle}>Receive / Settle{selectedCount > 1 ? ` (${selectedCount})` : ''}</button>}
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
