import { useEffect, useState } from 'react';
import { fmtINR, parseApiError, round2 } from '../../lib/format.js';
import { useDebounce } from '../../hooks/useDebounce.js';
import { useToast } from '../../hooks/useToast.jsx';
import {
  fetchCustomerSchemeAssignments,
  searchJewellerySchemes,
  fetchPendingGoldPurchases,
  fetchGoldPurchasesUsedOnSalesInvoices,
  fetchPendingSalesReturns,
  fetchSettlementAvailableCredit,
} from '../../lib/api.js';
import { creditSettlementEntry } from './posInvoice.js';

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
// Gold Purchase's own Common Party Supplier nets its payable against the customer's Debtors
// with a Journal Entry when the Purchase Invoice is submitted, and a Sales Return's Credit Note
// credit is moved onto a Journal Entry the first time it's added to a bill (see api.js). Either
// credit is allocated on the Sales Invoice's Advances table — shrinking what the cashier collects
// without touching taxable value/GST — for as much of it as this bill uses; whatever's left
// stays with the customer for a later bill.

// Loads `fetcher()` into `setRows` (with its loading flag) whenever `deps` change and `when` holds.
function useLoadList(when, fetcher, setRows, setLoading, showToast, deps) {
  useEffect(() => {
    if (!when) return undefined;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const rows = await fetcher();
        if (!cancelled) setRows(rows);
      } catch (e) {
        if (!cancelled) showToast(parseApiError(e), 'error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

// One settlement row's form inside the Settlement dialog (SettlementDialog.jsx). It only picks
// records that already exist for the bill's customer — matured Jewellery Schemes, Gold Purchases
// and Sales Returns not yet used on any bill. Gold Purchases / Sales Returns themselves are
// created from their own buttons (CreateSettlementRecordModal.jsx). onSettle gets the entry (or,
// for several schemes at once, an array) to put on the bill.
// draftInvoiceName: the draft being edited, whose own saved Gold Purchases / Sales Returns stay recallable.
// heldSettlementNumbers: Gold Purchases / Sales Returns parked on held bills on this counter — not offered again.
// maxAmount: what's still payable on the bill — a Gold Purchase / Sales Return can't settle more.
export default function SettlementForm({ type, customer, settlements = [], draftInvoiceName = null, heldSettlementNumbers = [], maxAmount = 0, onSettle }) {
  const { showToast } = useToast();
  const [submitting, setSubmitting] = useState(false);
  // Gold Purchase / Sales Return: amount typed per record (record name -> text). Untouched ones
  // default to as much of its credit as the bill can still take.
  const [amounts, setAmounts] = useState({});

  // Jewellery Scheme — a checklist of the customer's own matured schemes, so several can be
  // redeemed onto one bill at once.
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

  // Submitted Gold Purchases / Sales Returns of this customer not yet used on any bill.
  const [pendingGold, setPendingGold] = useState([]);
  const [pendingGoldLoading, setPendingGoldLoading] = useState(false);
  const [pendingReturns, setPendingReturns] = useState([]);
  const [pendingReturnsLoading, setPendingReturnsLoading] = useState(false);

  const customerName = customer?.name;
  useLoadList(type === 'return' && customerName, () => fetchPendingSalesReturns(customerName, { excludeInvoice: draftInvoiceName }), setPendingReturns, setPendingReturnsLoading, showToast, [type, customerName, draftInvoiceName]);
  useLoadList(type === 'gold' && customerName, () => fetchPendingGoldPurchases(customerName, { excludeInvoice: draftInvoiceName }), setPendingGold, setPendingGoldLoading, showToast, [type, customerName, draftInvoiceName]);
  // Each row already comes back with its real advance (from the Payment Entries that collected
  // it) and bonus-month discount pre-computed — no separate per-row fetch needed.
  useLoadList(type === 'kitty' && customerName, () => fetchCustomerSchemeAssignments(customerName), setSchemeAssignments, setSchemesLoading, showToast, [type, customerName]);
  useLoadList(type === 'kitty', () => searchJewellerySchemes(debouncedSchemeTypeQuery), setSchemeTypeResults, setSchemeTypeSearching, showToast, [type, debouncedSchemeTypeQuery]);

  // Anything already on this bill (or a held bill) can't be added again — hidden instead of
  // just disabled, so the lists only ever show what's left.
  const takenNumbers = new Set([...settlements.map((s) => s.number), ...heldSettlementNumbers]);
  const pendingGoldAvailable = pendingGold.filter((p) => !takenNumbers.has(p.name));
  const pendingReturnsAvailable = pendingReturns.filter((r) => !takenNumbers.has(r.name));
  const unsettledSchemes = schemeAssignments.filter((a) => !takenNumbers.has(a.name));
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
  function settleSchemes() {
    // amount = the real advance only (what actually reduces the payable balance in the
    // Settlement list) — bonusAmount is kept separate since it's applied as a genuine discount
    // on the invoice's taxable value instead, not subtracted from payable a second time.
    const entries = schemeScopedSchemes
      .filter((a) => selectedSchemes[a.name])
      .map((a) => ({
        type,
        number: a.name,
        customer,
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
  const defaultAmount = (rec) => round2(Math.max(0, Math.min(rec.availableAmount, maxAmount)));
  const amountFor = (rec) => (amounts[rec.name] ?? String(defaultAmount(rec)));

  // Puts `rec` (a pending Gold Purchase / Sales Return) on the bill for the amount typed — after
  // re-reading its credit, since another counter may have used some of it since the list loaded.
  async function handleAddCredit(rec) {
    const amount = round2(parseFloat(amountFor(rec)) || 0);
    if (!(amount > 0)) { showToast('Enter the amount to settle', 'error'); return; }
    if (amount > rec.availableAmount + 0.009) { showToast(`Only ${fmtINR(rec.availableAmount)} is available on ${rec.name}`, 'error'); return; }
    if (amount > maxAmount + 0.009) { showToast(`Only ${fmtINR(maxAmount)} is still payable on this bill`, 'error'); return; }
    setSubmitting(true);
    try {
      const { rows, available } = await fetchSettlementAvailableCredit(type, rec.name, customerName, draftInvoiceName);
      let credit = available;
      if (available === null) {
        // A Gold Purchase without a Common Party Journal Entry — nothing to split, just check
        // no other bill has it.
        const used = await fetchGoldPurchasesUsedOnSalesInvoices([rec.name], draftInvoiceName);
        if (used.has(rec.name)) throw new Error(`${rec.name} is already used on Sales Invoice ${used.get(rec.name)}`);
        credit = rec.availableAmount;
      }
      if (amount > credit + 0.009) {
        const setRows = type === 'gold' ? setPendingGold : setPendingReturns;
        setRows((list) => list.map((r) => (r.name === rec.name ? { ...r, availableAmount: credit } : r)).filter((r) => r.availableAmount > 0));
        throw new Error(`Only ${fmtINR(credit)} is left on ${rec.name} now`);
      }
      onSettle(creditSettlementEntry(type, rec.name, customer, rows, amount, credit));
    } catch (e) {
      showToast(parseApiError(e), 'error');
    } finally {
      setSubmitting(false);
    }
  }

  return <div className="cd-settlement-form">
    {type === 'kitty' && <>
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
      <div className="cd-field">
        <label className="cd-label">Matured Schemes — tick all you want to redeem onto this bill</label>
        {!effectiveSchemeCode ? (
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
      <div className="cd-settlement-form-actions">
        {selectedCount > 0 && <span className="cd-remaining ok">{selectedCount} scheme{selectedCount > 1 ? 's' : ''} selected — Total credit: {fmtINR(selectedTotal)}</span>}
        <button type="button" className="cd-btn cd-btn-primary" disabled={!selectedCount} onClick={settleSchemes}>Receive / Settle{selectedCount > 1 ? ` (${selectedCount})` : ''}</button>
      </div>
    </>}

    {(type === 'gold' || type === 'return') && (() => {
      const isGold = type === 'gold';
      const loading = isGold ? pendingGoldLoading : pendingReturnsLoading;
      const records = isGold ? pendingGoldAvailable : pendingReturnsAvailable;
      return (
        <div className="cd-field">
          <label className="cd-label">{isGold ? 'Gold Purchases' : 'Sales Returns'} — credit available to settle (enter less to use only part of it)</label>
          {loading ? (
            <div className="cd-ac-empty">Loading {isGold ? 'Gold Purchases' : 'Sales Returns'}…</div>
          ) : !records.length ? (
            <div className="cd-ac-empty">No pending {isGold ? 'Gold Purchase' : 'Sales Return'} for this customer — create one with the {isGold ? 'Gold Purchase' : 'Sales Return'} button</div>
          ) : (
            <div className="cd-gold-pending-list">
              {records.map((r) => (
                <div key={r.name} className="cd-gold-pending-row">
                  <div className="cd-scheme-text">
                    <div className="main">{r.name} · {isGold ? (r.bill_no || '—') : `against ${r.return_against || '—'}`}</div>
                    <div className="sub">{r.posting_date} · Available {fmtINR(r.availableAmount)}</div>
                  </div>
                  <input
                    className="cd-input cd-settlement-amount-input"
                    type="number"
                    min="0"
                    step="0.01"
                    aria-label={`Amount to settle from ${r.name}`}
                    value={amountFor(r)}
                    onChange={(e) => setAmounts((prev) => ({ ...prev, [r.name]: e.target.value }))}
                  />
                  <button type="button" className="cd-btn cd-btn-secondary" disabled={submitting || !(maxAmount > 0)} onClick={() => handleAddCredit(r)}>Add to bill</button>
                </div>
              ))}
            </div>
          )}
          {!(maxAmount > 0) && records.length > 0 && <div className="cd-hint">Nothing is left to pay on this bill.</div>}
        </div>
      );
    })()}
  </div>;
}
