import { useCallback, useEffect, useRef, useState } from 'react';
import PosHeader from './PosHeader.jsx';
import CustomerPanel from './CustomerPanel.jsx';
import CartGrid, { DiscountRow } from './CartGrid.jsx';
import PaymentModal from './PaymentModal.jsx';
import DaySummary from './DaySummary.jsx';
import ShiftModal from './ShiftModal.jsx';
import OperationsModal from './OperationsModal.jsx';
import SalesTeamDialog from './SalesTeamDialog.jsx';
import { usePosCart } from './usePosCart.js';
import { useToast } from '../../hooks/useToast.jsx';
import { loadMetalRates } from '../../lib/metalRates.js';
import {
  lookupByTag,
  saveSalesInvoice,
  submitSalesInvoice,
  postPurityLedgerForInvoice,
  fetchLoggedUser,
  fetchDaySummary,
  fetchGstSplitForCustomer,
  // getPrintUrl, // unused while Print Invoice / Reprint Last Invoice are disabled
  createPosShift,
  fetchPosShift,
  fetchOpenPosShift,
  fetchPosShiftSalesSummary,
  closePosShift,
  markSchemeAssignmentUsed,
  deactivateBom,
} from '../../lib/api.js';
import { parseApiError, fmtINR, fmtWeight, fmtTime, round2 } from '../../lib/format.js';
import {
  COMPANY,
  POS_HOLD_KEY,
  POS_LAST_INVOICE_KEY,
  POS_SHIFT_KEY,
} from '../../lib/constants.js';
import { buildSalesInvoicePayload, getInvoiceName } from './posInvoice.js';

function readHolds() {
  try {
    return JSON.parse(localStorage.getItem(POS_HOLD_KEY) || '[]');
  } catch {
    return [];
  }
}

function writeHolds(holds) {
  localStorage.setItem(POS_HOLD_KEY, JSON.stringify(holds));
}

// Maps a POS Shift backend doc onto the shape the UI already reads (shift.name/cashier/
// counter/openingCash/startedAt) so the rest of the component doesn't need to change.
function normalizeShift(doc) {
  if (!doc) return null;
  return {
    name: doc.name,
    user: doc.user,
    cashier: doc.cashier_name || doc.user,
    branch: doc.branch,
    counter: doc.counter,
    openingCash: parseFloat(doc.opening_cash) || 0,
    startedAt: doc.shift_start_datetime,
    status: doc.status,
    // Shift-level default Sales Team, picked at Shift Start — used to seed each new bill's
    // own Sales Team below (see defaultSalesTeam()), which can still be overridden per bill.
    salesTeam: (doc.sales_team || []).map((r) => ({
      salesPerson: r.sales_person,
      percentage: Number(r.allocated_percentage) || 0,
    })),
  };
}

// Fresh copy each call (not a shared reference) so editing one bill's Sales Team can never
// leak into the shift's own stored default or another bill seeded from the same shift.
function defaultSalesTeam(shiftObj) {
  return (shiftObj?.salesTeam || []).map((r) => ({ ...r }));
}

function ContextIcon({ name }) {
  const paths = {
    transaction: <><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="8" y1="13" x2="16" y2="13" /><line x1="8" y1="17" x2="16" y2="17" /></>,
    shift: <><circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15 15" /></>,
    counter: <><rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4" /></>,
    user: <><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" /><circle cx="12" cy="7" r="4" /></>,
  };
  return (
    <svg className="cd-pos-context-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

function DiscountDialog({ totals, billDiscount, onBillDiscountChange, billComponentDiscounts, onComponentDiscountChange, onClose }) {
  const b = totals.componentBreakdown;
  const discountNote = (comp) => comp.discount > 0 && (
    <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 4 }}>
      -{fmtINR(comp.discount)} → <strong style={{ color: 'var(--text-primary)' }}>{fmtINR(comp.net)}</strong>
    </div>
  );
  const componentField = (label, key, { highlight = false, discountable = true } = {}) => (
    <div className={highlight ? 'cd-pricing-field highlight' : 'cd-pricing-field'}>
      <label>{label}</label>
      <strong>{fmtINR(b[key].raw)}</strong>
      {discountable && (
        <>
          <DiscountRow discount={billComponentDiscounts[key]} onChange={(patch) => onComponentDiscountChange(key, patch)} />
          {discountNote(b[key])}
        </>
      )}
    </div>
  );
  return (
    <>
      <div className="cd-idialog-overlay" onClick={onClose} role="presentation" />
      <div className="cd-idialog xwide" role="dialog" aria-modal="true">
        <div className="cd-idialog-header">
          <span className="cd-idialog-title">Bill Discount · Pricing Breakup (all items)</span>
          <button type="button" className="cd-idialog-close" onClick={onClose}>×</button>
        </div>
        <div className="cd-idialog-body">
          <div className="cd-pricing-grid">
            <div className="cd-pricing-field"><label>Gross Weight</label><strong>{fmtWeight(totals.totalGrossWeight)} g</strong></div>
            <div className="cd-pricing-field"><label>Net Weight</label><strong>{fmtWeight(totals.totalNetWeight)} g</strong></div>
            {componentField('Metal Value', 'metal', { highlight: true, discountable: false })}
            {componentField('Making Charges', 'making')}
            {componentField('Diamond Value', 'diamond')}
            {componentField('Stone Value', 'stone')}
            {componentField('Handling Charges', 'handling')}
            {componentField('Other Charges', 'other')}
            {totals.componentDiscountTotal > 0 && (
              <div className="cd-pricing-field" style={{ background: 'var(--pill-green-bg)' }}>
                <label>Component Discount Total</label>
                <strong>{fmtINR(totals.componentDiscountTotal)}</strong>
              </div>
            )}
            <div className="cd-pricing-field total"><label>Subtotal (after component discounts)</label><strong>{fmtINR(totals.beforeBillDiscount)}</strong></div>
          </div>
          <div className="cd-adjustment-control" style={{ marginTop: 16 }}>
            <label className="cd-label">Overall Bill Discount</label>
            <div className="cd-adjustment-row">
              <div className="cd-disc-toggle">
                <button type="button" className={billDiscount.mode === 'amount' ? 'active' : ''} onClick={() => onBillDiscountChange({ mode: 'amount' })}>₹</button>
                <button type="button" className={billDiscount.mode === 'percent' ? 'active' : ''} onClick={() => onBillDiscountChange({ mode: 'percent' })}>%</button>
              </div>
              <input
                className="cd-input cd-num-input"
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={billDiscount.value}
                onChange={(e) => onBillDiscountChange({ value: e.target.value })}
              />
            </div>
          </div>
        </div>
        <div className="cd-idialog-footer">
          <button type="button" className="cd-btn cd-btn-primary" onClick={onClose}>Apply</button>
        </div>
      </div>
    </>
  );
}

export default function PosPage() {
  const { showToast } = useToast();
  const [user, setUser] = useState(null);
  const [goldRate, setGoldRate] = useState(0);
  const [gstSplit, setGstSplit] = useState([]);
  const [customer, setCustomer] = useState(null);
  // Sales Team — who gets credit for this sale, each with a Contribution %. Reset alongside
  // customer/cart per bill (see handleCancel/handleHold/handleConfirmPayment), not persisted
  // across bills like Branch is.
  const [salesTeam, setSalesTeam] = useState([]);
  const [salesTeamOpen, setSalesTeamOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [customerOpen, setCustomerOpen] = useState(false);
  const [customerPromptForPayment, setCustomerPromptForPayment] = useState(false);
  const [lastInvoice, setLastInvoice] = useState(
    () => localStorage.getItem(POS_LAST_INVOICE_KEY) || null,
  );
  const [daySummary, setDaySummary] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [holds, setHolds] = useState(readHolds);
  const [shift, setShift] = useState(null);
  const [shiftMode, setShiftMode] = useState(null);
  const [discountOpen, setDiscountOpen] = useState(false);
  const [operation, setOperation] = useState(null);
  const [settlements, setSettlements] = useState([]);
  const [transactionNo, setTransactionNo] = useState(() => localStorage.getItem("cd_pos_current_txn") || "Not reserved");
  const menuRef = useRef(null);

  // A redeemed scheme's bonus/free-month is a genuine discount (see posCalculations.js) — its
  // real advance portion doesn't touch this at all, that's applied via Sales Invoice `advances`
  // allocation in posInvoice.js instead.
  const schemeBonusAmount = settlements
    .filter((s) => s.type === 'kitty')
    .reduce((sum, s) => sum + (parseFloat(s.bonusAmount) || 0), 0);
  // Each redeemed scheme's own Making/Diamond % is kept as a separate entry here (not merged
  // into cart.billComponentDiscounts) so two schemes discounting the same component both apply
  // — see applyComponentDiscounts in posCalculations.js — instead of the later one silently
  // overwriting the earlier one.
  const schemeComponentDiscounts = settlements
    .filter((s) => s.type === 'kitty')
    .map((s) => s.componentDiscounts || {});
  const cart = usePosCart(goldRate, gstSplit, schemeBonusAmount, schemeComponentDiscounts);
  // Same "Balance Payable" figure CartGrid shows below the cart — grand total minus each
  // redeemed scheme's real advance (settlements' own .amount, separate from the bonus discount
  // already folded into cart.totals.grandTotal above) — so the Pay button never quotes the full
  // total when a scheme settlement already covers some or all of it.
  const schemeCreditApplied = round2(settlements.reduce((s, x) => s + (Number(x.amount) || 0), 0));
  const balancePayable = round2(Math.max(0, cart.totals.grandTotal - schemeCreditApplied));

  const refreshDaySummary = useCallback(async () => {
    setSummaryLoading(true);
    try {
      const summary = await fetchDaySummary();
      setDaySummary(summary);
    } catch (e) {
      showToast(parseApiError(e), 'error');
    } finally {
      setSummaryLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    let cancelled = false;
    fetchLoggedUser().then(setUser).catch(() => {});
    loadMetalRates().then((rates) => setGoldRate(rates.Gold || 0));
    queueMicrotask(() => {
      if (!cancelled) refreshDaySummary();
    });
    return () => {
      cancelled = true;
    };
  }, [refreshDaySummary]);

  // CGST+SGST vs IGST depends on whether the selected customer's state matches the
  // Company's — recompute whenever the customer changes (including back to "no customer",
  // which falls back to the default template) instead of fetching one fixed split at mount.
  useEffect(() => {
    let cancelled = false;
    fetchGstSplitForCustomer(COMPANY, customer?.name).then((rows) => {
      if (!cancelled) setGstSplit(rows);
      if (!rows.length) console.warn('No Sales Taxes and Charges Template found — invoices will save without GST rows.');
    });
    return () => {
      cancelled = true;
    };
  }, [customer]);

  useEffect(() => {
    function onDocClick(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  // Resumes whatever shift is actually open for this user on the backend, rather than
  // trusting a local cache — the cached shift name is just a shortcut to skip straight to a
  // single GET instead of listing, and gets ignored if that shift isn't Open anymore (e.g.
  // closed from another device).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const me = await fetchLoggedUser();
        if (!me?.email || cancelled) return;
        const cachedName = localStorage.getItem(POS_SHIFT_KEY);
        let doc = cachedName ? await fetchPosShift(cachedName) : null;
        if (doc && doc.status !== 'Open') doc = null;
        if (!doc) doc = await fetchOpenPosShift(me.email);
        if (cancelled) return;
        if (doc) {
          setShift(normalizeShift(doc));
          localStorage.setItem(POS_SHIFT_KEY, doc.name);
        } else {
          localStorage.removeItem(POS_SHIFT_KEY);
        }
      } catch (e) {
        console.warn('Resume shift failed:', e.message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleShift(data) {
    if (shiftMode === 'start') {
      // Branch is picked in the Shift Start dialog itself (data.branch) — not required here;
      // it's only enforced later, right before a Sales Invoice actually gets created.
      if (data.branch) localStorage.setItem('cd_branch', data.branch);
      window.dispatchEvent(new CustomEvent('cd-branch-changed', { detail: data.branch || '' }));
      try {
        const me = await fetchLoggedUser();
        const doc = await createPosShift({
          userEmail: me?.email,
          branch: data.branch || '',
          counter: 'Counter 1',
          openingCash: data.openingCash,
          salesTeam: data.salesTeam || [],
        });
        const next = normalizeShift(doc);
        setShift(next);
        setSalesTeam(defaultSalesTeam(next));
        setShiftMode(null);
        localStorage.setItem(POS_SHIFT_KEY, next.name);
        const tx = `${next.name}-0001`;
        localStorage.setItem('cd_pos_current_txn', tx);
        setTransactionNo(tx);
        showToast(`Shift started · ${next.counter}`, 'success');
      } catch (e) {
        showToast(parseApiError(e), 'error');
      }
    } else if (shiftMode === 'end') {
      try {
        const summary = await fetchPosShiftSalesSummary(shift.name);
        const cashSales = summary.modeBreakup['Cash'] || 0;
        const expectedCash = Math.round(((shift.openingCash || 0) + cashSales) * 100) / 100;
        const paymentSummaryRows = [
          { mode: 'Cash', expected: expectedCash, counted: data.countedCash || 0 },
          // Non-cash modes are electronically verified, not hand-counted here yet — counted
          // defaults to expected until Shift End gets its own per-mode entry fields.
          ...Object.entries(summary.modeBreakup)
            .filter(([mode]) => mode !== 'Cash')
            .map(([mode, expected]) => ({ mode, expected, counted: expected })),
        ];
        await closePosShift(shift.name, {
          closingCash: data.countedCash || 0,
          expectedCash,
          totalSalesAmount: summary.totalSales,
          totalTransactions: summary.totalTransactions,
          paymentSummaryRows,
        });
        setShift(null);
        setShiftMode(null);
        localStorage.removeItem(POS_SHIFT_KEY);
        setTransactionNo('Shift closed');
        localStorage.removeItem('cd_pos_current_txn');
        // Branch is chosen fresh per shift — clear it so the next shift start requires picking
        // one again, rather than silently carrying over whatever was selected before.
        localStorage.removeItem('cd_branch');
        window.dispatchEvent(new CustomEvent('cd-branch-changed', { detail: '' }));
        showToast('Cash drawer closed and shift reconciled', 'success');
      } catch (e) {
        showToast(parseApiError(e), 'error');
      }
    } else {
      // Shift Change / User Change isn't backed by POS Shift yet — a real user change means
      // closing this shift and opening a new one under the new user, which needs its own flow.
      setShift((prev) => (prev ? { ...prev, cashier: data.nextCashier || prev.cashier } : prev));
      setShiftMode(null);
      showToast('Cashier or user changed', 'success');
    }
  }

  // OperationsModal's Jewellery Scheme flow can settle several matured schemes for the same
  // customer in one go, so this accepts either a single entry (gold/return, if ever wired up
  // to settlements) or an array (kitty's multi-select) and reports one consolidated toast.
  // Each entry's own componentDiscounts (Making/Diamond %) stays on the settlement itself —
  // schemeComponentDiscounts above derives the combined list every render — rather than being
  // written into cart.billComponentDiscounts, so multiple schemes discounting the same
  // component both apply instead of one overwriting the other.
  function handleSettlement(entryOrEntries) {
    const entries = Array.isArray(entryOrEntries) ? entryOrEntries : [entryOrEntries];
    if (!entries.length) return;
    setSettlements((prev) => [...prev, ...entries]);
    setOperation(null);
    showToast(
      entries.length > 1 ? `${entries.length} schemes added as invoice settlement` : `${entries[0].number} added as invoice settlement`,
      'success',
    );
  }

  // Safe to just drop client-side — a settlement is only ever written to the backend (marking
  // the scheme's own record as used) once the invoice is actually confirmed and submitted, so
  // removing it here before that point leaves the scheme untouched and redeemable again.
  function handleRemoveSettlement(number) {
    setSettlements((prev) => prev.filter((s) => s.number !== number));
    showToast(`${number} removed from this bill`, 'success');
  }

  async function handleScan(tag) {
    const trimmed = (tag || '').trim();
    if (!trimmed) return;
    if (!shift) { showToast('Start a shift before scanning', 'error'); setShiftMode('start'); return; }
    if (!customer?.name) { showToast('Select a customer before scanning', 'error'); openCustomerPicker(); return; }
    const duplicate = cart.lines.some((line) =>
      [line.tag, line.serial_no, line.item_code].some((value) =>
        String(value || "").toLowerCase() === trimmed.toLowerCase(),
      ),
    );
    if (duplicate) {
      showToast(`Serial number "${trimmed}" is already in this bill`, "error");
      return;
    }
    setScanning(true);
    try {
      const item = await lookupByTag(trimmed);
      if (!item) {
        showToast(`No item found for tag "${trimmed}"`, 'error');
        return;
      }
      cart.addUniqueLine(item);
      showToast(
        item.pricing_warning || `Added ${item.item_name || item.item_code}`,
        item.pricing_warning ? 'info' : 'success',
      );
    } catch (e) {
      showToast(parseApiError(e), 'error');
    } finally {
      setScanning(false);
    }
  }

  function validateBill() {
    if (!customer?.name) {
      showToast('Select a customer first', 'error');
      openCustomerPicker();
      return false;
    }
    if (!cart.lines.length) {
      showToast('Scan at least one item', 'error');
      return false;
    }
    if (!localStorage.getItem('cd_branch')) {
      showToast('Select a branch before creating an invoice', 'error');
      return false;
    }
    return true;
  }

  async function handleSaveDraft() {
    if (!validateBill()) return;
    setSaving(true);
    try {
      const payload = buildSalesInvoicePayload({
        customer,
        lines: cart.lines,
        totals: cart.totals,
        goldRate,
        docstatus: 0,
        shiftName: shift?.name,
        salesTeam,
      });
      const res = await saveSalesInvoice(payload, cart.draftInvoiceName);
      const name = getInvoiceName(res);
      if (!name) throw new Error('Draft save failed — no invoice name returned');
      cart.setDraftInvoiceName(name);
      showToast(`Draft saved: ${name}`, 'success');
    } catch (e) {
      showToast(parseApiError(e), 'error');
    } finally {
      setSaving(false);
    }
  }

  function handleHold() {
    if (!cart.lines.length && !customer) {
      showToast('Nothing to hold', 'error');
      return;
    }
    const label =
      window.prompt('Hold label (optional)', `Hold ${new Date().toLocaleTimeString('en-IN')}`) ||
      `Hold ${Date.now()}`;
    const nextHolds = readHolds();
    nextHolds.unshift({
      id: `hold-${Date.now()}`,
      label,
      savedAt: new Date().toISOString(),
      customer,
      salesTeam,
      settlements,
      snapshot: cart.getSnapshot(),
    });
    const next = nextHolds.slice(0, 20);
    writeHolds(next);
    setHolds(next);
    setCustomer(null);
    setSalesTeam(defaultSalesTeam(shift));
    cart.clearCart();
    setSettlements([]);
    setMenuOpen(false);
    showToast('Bill held — use Resume to restore', 'success');
  }

  function handleResume(holdId) {
    const current = readHolds();
    const hold = current.find((h) => h.id === holdId);
    if (!hold) {
      showToast('Hold not found', 'error');
      return;
    }
    setCustomer(hold.customer || null);
    setSalesTeam(hold.salesTeam || []);
    cart.loadCart(hold.snapshot || { lines: [], draftInvoiceName: null });
    setSettlements(hold.settlements || []);
    const remaining = current.filter((h) => h.id !== holdId);
    writeHolds(remaining);
    setHolds(remaining);
    setMenuOpen(false);
    showToast('Bill resumed', 'success');
  }

  function handleCancel() {
    if (
      cart.lines.length &&
      !window.confirm('Clear current bill and customer?')
    ) {
      return;
    }
    setCustomer(null);
    setSalesTeam(defaultSalesTeam(shift));
    cart.clearCart();
    setSettlements([]);
    setPaymentOpen(false);
    setLastInvoice(null);
    setMenuOpen(false);
  }

  // Reprint Last Invoice disabled per request
  // function handleReprintLast() {
  //   const name =
  //     lastInvoice || localStorage.getItem(POS_LAST_INVOICE_KEY);
  //   if (!name) {
  //     showToast('No invoice to reprint', 'error');
  //     return;
  //   }
  //   window.open(getPrintUrl(name), '_blank');
  //   setMenuOpen(false);
  // }

  function openPayment() {
    if (!shift) { showToast('Start a shift before billing', 'error'); setShiftMode('start'); return; }
    if (!cart.lines.length) {
      showToast("Scan at least one item", "error");
      return;
    }
    if (!customer?.name) {
      setCustomerPromptForPayment(true);
      setCustomerOpen(true);
      return;
    }
    if (!localStorage.getItem('cd_branch')) {
      showToast('Select a branch before creating an invoice', 'error');
      return;
    }
    setPaymentOpen(true);
    setLastInvoice(null);
  }

  function openCustomerPicker() {
    setCustomerPromptForPayment(false);
    setCustomerOpen(true);
  }

  async function handleConfirmPayment(payments) {
    setConfirming(true);
    try {
      const paidAmount = payments.reduce(
        (s, p) => s + (parseFloat(p.amount) || 0),
        0,
      );

      const payload = buildSalesInvoicePayload({
        customer,
        lines: cart.lines,
        totals: cart.totals,
        goldRate,
        docstatus: 0,
        payments,
        paidAmount,
        shiftName: shift?.name,
        settlements,
        salesTeam,
      });

      const res = await saveSalesInvoice(payload, cart.draftInvoiceName);
      let name = getInvoiceName(res);
      if (!name) throw new Error('Invoice save failed');

      await submitSalesInvoice(name);

      // Best-effort — never blocks checkout on a ledger failure, since the invoice is already
      // submitted by this point (same pattern as the deactivateBom/markSchemeAssignmentUsed
      // calls just below).
      postPurityLedgerForInvoice(name, customer?.name, cart.lines).catch((e) =>
        console.error('postPurityLedgerForInvoice failed:', e.message),
      );

      // Each sold serialized piece had its own per-unit BOM — once it's sold, ERPNext's own
      // update_stock flips the Serial No to Delivered automatically, but the BOM itself stays
      // "active" unless we turn it off, which would let it keep showing up as live/default
      // for that item code.
      const soldBomNames = [...new Set(cart.lines.filter((l) => l.bom_name).map((l) => l.bom_name))];
      await Promise.all(soldBomNames.map((n) => deactivateBom(n)));

      // Belt-and-suspenders on top of ERPNext's own unallocated_amount tracking — once a
      // redeemed scheme's credit is actually locked into a submitted invoice, mark it used so
      // it can never be offered for redemption again.
      const redeemedSchemeNames = [...new Set(settlements.filter((s) => s.type === 'kitty').map((s) => s.number))];
      await Promise.all(redeemedSchemeNames.map((n) => markSchemeAssignmentUsed(n)));

      localStorage.setItem(POS_LAST_INVOICE_KEY, name);
      setLastInvoice(name);
      showToast(`Invoice ${name} submitted`, 'success');

      setCustomer(null);
      setSalesTeam(defaultSalesTeam(shift));
      cart.clearCart();
      setSettlements([]);
      await refreshDaySummary();
    } catch (e) {
      showToast(parseApiError(e), 'error');
    } finally {
      setConfirming(false);
    }
  }

  return (
    <div className="cd-pos-app">
      <PosHeader user={user} />

      <div className="cd-pos-context">
        <span><ContextIcon name="transaction" />Transaction <strong>{transactionNo}</strong></span>
        <span><ContextIcon name="shift" />Shift <strong>{shift?.name || "Not started"}</strong></span>
        {shift?.startedAt && <span><ContextIcon name="shift" />Started <strong>{fmtTime(shift.startedAt)}</strong></span>}
        <span><ContextIcon name="counter" />Counter <strong>{shift?.counter || "Unallocated"}</strong></span>
        <span><ContextIcon name="user" />Cashier <strong>{shift?.cashier || user?.fullName || "—"}</strong></span>
        <span><ContextIcon name="user" />Customer <button type="button" className="cd-pos-context-btn" onClick={openCustomerPicker}>{customer?.customer_name || "Select customer"}</button></span>
        <span><ContextIcon name="user" />Sales Team <button type="button" className="cd-pos-context-btn" onClick={() => setSalesTeamOpen(true)}>{salesTeam.length ? `${salesTeam[0].salesPerson}${salesTeam.length > 1 ? ` +${salesTeam.length - 1} more` : ''}` : "Select sales team"}</button></span>
      </div>

      <div className="cd-pos-body cd-pos-body-full">
        <CartGrid
          lines={cart.lines}
          goldRate={goldRate}
          totals={cart.totals}
          billDiscount={cart.billDiscount}
          settlements={settlements}
          onScan={handleScan}
          scanning={scanning}
          onUpdateLine={cart.updateLine}
          onRemoveLine={cart.removeLine}
          onBillDiscountChange={(patch) =>
            cart.setBillDiscount((prev) => ({ ...prev, ...patch }))
          }
          onRemoveSettlement={handleRemoveSettlement}
        />
      </div>

      <footer className="cd-pos-footer">
        <div className="cd-payment-launch"><span><strong>Payment & Settlement</strong></span><button type="button" className="cd-btn cd-btn-green cd-btn-wide" disabled={!cart.lines.length} onClick={openPayment}>Enter Payment</button></div>
        <DaySummary summary={daySummary} loading={summaryLoading} />

        <div className="cd-pos-footer-right">
          {!shift ? <button type="button" className="cd-btn cd-btn-primary" onClick={() => setShiftMode("start")}>Shift Start</button> : <>
            <button type="button" className="cd-btn cd-btn-secondary" onClick={() => setShiftMode("end")}>Shift End</button>
          </>}
          <button type="button" className="cd-btn cd-btn-secondary" onClick={() => setDiscountOpen(true)}>Discount</button>
          <button type="button" className="cd-btn cd-btn-secondary" onClick={() => setOperation("gold")}>Gold Purchase</button>
          <button type="button" className="cd-btn cd-btn-secondary" onClick={() => setOperation("kitty")}>Jewellery Scheme</button>
          <button type="button" className="cd-btn cd-btn-secondary" onClick={() => setOperation("return")}>Sales Return</button>
          <button
            type="button"
            className="cd-btn cd-btn-secondary"
            onClick={handleCancel}
          >
            Clear
          </button>

          <button
            type="button"
            className="cd-btn cd-btn-secondary"
            disabled={saving}
            onClick={handleSaveDraft}
          >
            {saving ? 'Saving…' : 'Save Draft'}
          </button>

          <div className="cd-dropdown-wrap" ref={menuRef}>
            <button
              type="button"
              className="cd-btn cd-btn-secondary"
              onClick={() => setMenuOpen((o) => !o)}
            >
              Actions ▾
            </button>
            {menuOpen && (
              <div className="cd-dropdown-menu">
                <button
                  type="button"
                  className="cd-dropdown-item"
                  onClick={handleHold}
                >
                  Hold Bill
                </button>
                {holds.length > 0 && (
                  <>
                    <div
                      style={{
                        padding: '6px 12px',
                        fontSize: 10,
                        fontWeight: 600,
                        color: 'var(--text-muted)',
                        textTransform: 'uppercase',
                      }}
                    >
                      Resume
                    </div>
                    {holds.map((h) => (
                      <button
                        key={h.id}
                        type="button"
                        className="cd-dropdown-item"
                        onClick={() => handleResume(h.id)}
                      >
                        {h.label}
                        <span
                          style={{
                            display: 'block',
                            fontSize: 11,
                            color: 'var(--text-muted)',
                          }}
                        >
                          {(h.snapshot?.lines || []).length} item(s)
                        </span>
                      </button>
                    ))}
                  </>
                )}
                <button
                  type="button"
                  className="cd-dropdown-item"
                  onClick={handleCancel}
                >
                  Cancel Bill
                </button>
                {/* Reprint Last Invoice disabled per request
                <button
                  type="button"
                  className="cd-dropdown-item"
                  onClick={handleReprintLast}
                >
                  Reprint Last Invoice
                </button>
                */}
              </div>
            )}
          </div>

          <button
            type="button"
            className="cd-btn cd-btn-green"
            onClick={openPayment}
            disabled={!cart.lines.length}
          >
            Pay {cart.lines.length ? `· ${fmtINR(balancePayable)}` : ''}
          </button>
        </div>
      </footer>

      {customerOpen && (
        <>
          <div className="cd-idialog-overlay" onClick={() => setCustomerOpen(false)} role="presentation" />
          <div className="cd-idialog wide" role="dialog" aria-modal="true">
            <div className="cd-idialog-header"><span className="cd-idialog-title">Select customer to submit bill</span><button type="button" className="cd-idialog-close" onClick={() => setCustomerOpen(false)}>×</button></div>
            <CustomerPanel customer={customer} onClear={() => setCustomer(null)} onSelect={(selected) => { setCustomer(selected); setCustomerOpen(false); if (customerPromptForPayment) setPaymentOpen(true); }} />
          </div>
        </>
      )}

      <SalesTeamDialog
        open={salesTeamOpen}
        salesTeam={salesTeam}
        grandTotal={cart.totals.grandTotal}
        onClose={() => setSalesTeamOpen(false)}
        onSave={setSalesTeam}
      />

      {discountOpen && (
        <DiscountDialog
          totals={cart.totals}
          billDiscount={cart.billDiscount}
          onBillDiscountChange={(patch) => cart.setBillDiscount((prev) => ({ ...prev, ...patch }))}
          billComponentDiscounts={cart.billComponentDiscounts}
          onComponentDiscountChange={(key, patch) =>
            cart.setBillComponentDiscounts((prev) => ({ ...prev, [key]: { ...(prev[key] || {}), ...patch } }))
          }
          onClose={() => setDiscountOpen(false)}
        />
      )}

      <ShiftModal key={shiftMode || 'closed'} open={Boolean(shiftMode)} mode={shiftMode} shift={shift} user={user} onClose={() => setShiftMode(null)} onSave={handleShift} />
      <OperationsModal key={operation || 'op-none'} type={operation} customer={customer} settlements={settlements} onClose={() => setOperation(null)} onSettle={handleSettlement} onCreated={refreshDaySummary} />

      <PaymentModal
        open={paymentOpen}
        settlements={settlements}
        onClose={() => {
          setPaymentOpen(false);
          if (lastInvoice) setLastInvoice(null);
        }}
        totals={cart.totals}
        onConfirm={handleConfirmPayment}
        confirming={confirming}
        lastInvoice={lastInvoice}
        onRemoveSettlement={handleRemoveSettlement}
      />
    </div>
  );
}
