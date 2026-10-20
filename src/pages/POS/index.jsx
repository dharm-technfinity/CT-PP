import { useCallback, useEffect, useRef, useState } from 'react';
import PosHeader from './PosHeader.jsx';
import CustomerPanel from './CustomerPanel.jsx';
import CartGrid, { DiscountRow } from './CartGrid.jsx';
import { batchLineError } from './posCalculations.js';
import PaymentModal from './PaymentModal.jsx';
import DaySummary from './DaySummary.jsx';
import ShiftModal from './ShiftModal.jsx';
import SettlementDialog from './SettlementDialog.jsx';
import CreateSettlementRecordModal from './CreateSettlementRecordModal.jsx';
import SalesTeamDialog from './SalesTeamDialog.jsx';
import GoldPurchaseDetailsModal from './GoldPurchaseDetailsModal.jsx';
import InvoicePickerModal from './InvoicePickerModal.jsx';
import BulkSerialModal from './BulkSerialModal.jsx';
import { usePosCart } from './usePosCart.js';
import { useToast } from '../../hooks/useToast.jsx';
import { loadMetalRates } from '../../lib/metalRates.js';
import { createLimiter } from '../../lib/limit.js';
import {
  lookupByTag,
  lookupLinesByTag,
  breakSetsForSoldLines,
  adjustBatchPcs,
  saveSalesInvoice,
  submitSalesInvoice,
  fetchSalesInvoice,
  fetchSalesInvoicePermissions,
  printSalesInvoiceDefault,
  cancelSalesInvoice,
  createAmendedSalesInvoice,
  releaseSchemeAssignmentsForInvoice,
  activateBom,
  getCustomerDetails,
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
  fetchPosButtonPermissions,
  canShowPosButton,
  fetchGoldPurchaseInvoice,
  fetchGoldPurchaseCreditRows,
  fetchJewellerySchemeNames,
  fetchPostingDates,
  fetchGoldPurchasesUsedOnSalesInvoices,
  fetchSalesReturnCreditRows,
  fetchSettlementAvailableCredit,
  salesInvoiceHasSettlementReferences,
} from '../../lib/api.js';
import { parseApiError, fmtINR, fmtWeight, fmtTime, fmtDateTime, round2 } from '../../lib/format.js';
import {
  COMPANY,
  POS_HOLD_KEY,
  POS_LAST_INVOICE_KEY,
  POS_SHIFT_KEY,
} from '../../lib/constants.js';
import { buildSalesInvoicePayload, creditSettlementEntry, getInvoiceName, invoiceToCartState, settlementsFromInvoice } from './posInvoice.js';

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
  // PP Settings1.pos_role: button_type -> role, gating which POS action buttons this user
  // sees. Empty until loaded, so those buttons stay hidden (fail closed) until we know.
  const [posPermissions, setPosPermissions] = useState({ posRoleMap: {}, userRoles: [] });
  const canShowButton = (buttonType) =>
    canShowPosButton(buttonType, posPermissions.userRoles, posPermissions.posRoleMap);
  const [goldRate, setGoldRate] = useState(0);
  const [gstSplit, setGstSplit] = useState([]);
  const [gstAddressFields, setGstAddressFields] = useState({});
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
  // Manager Mode hidden per request — see the footer
  // const [managerModeOpen, setManagerModeOpen] = useState(false);
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
  const [settlementOpen, setSettlementOpen] = useState(false);
  // Gold Purchase / Sales Return buttons — 'gold' | 'return' while their create-only dialog is open.
  const [createRecordType, setCreateRecordType] = useState(null);
  const [settlements, setSettlements] = useState([]);
  // Gold Purchase chip clicked — { name, readOnly } of the Purchase Invoice being shown.
  const [goldDetails, setGoldDetails] = useState(null);
  const [batchWarehousePick, setBatchWarehousePick] = useState(null);
  const [bulkAddOpen, setBulkAddOpen] = useState(false);
  // Scans still being looked up (faster scanning — see handleScan).
  const [pendingScans, setPendingScans] = useState(0);
  const pendingScanKeysRef = useRef(new Set());
  const scanChainRef = useRef(Promise.resolve());
  const scanLimiterRef = useRef(createLimiter(4));
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
  const { billEpochRef } = cart;
  // Latest lines / settlements for queued scans, which finish after later renders.
  const linesRef = useRef(cart.lines);
  const settlementsRef = useRef(settlements);
  useEffect(() => {
    linesRef.current = cart.lines;
    settlementsRef.current = settlements;
  }, [cart.lines, settlements]);
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
    fetchPosButtonPermissions().then(setPosPermissions).catch(() => {});
    loadMetalRates().then((rates) => setGoldRate(rates.Gold || 0));
    queueMicrotask(() => {
      if (!cancelled) refreshDaySummary();
    });
    return () => {
      cancelled = true;
    };
  }, [refreshDaySummary]);

  // CGST+SGST vs IGST depends on the selected customer — recompute whenever it changes
  // (including back to "no customer", which falls back to the default template). The address
  // fields ERPNext picked them from go on the invoice too (see fetchGstSplitForCustomer).
  useEffect(() => {
    let cancelled = false;
    fetchGstSplitForCustomer(COMPANY, customer?.name).then(({ taxes, addressFields }) => {
      if (cancelled) return;
      setGstSplit(taxes);
      setGstAddressFields(addressFields);
      if (!taxes.length) console.warn('No Sales Taxes and Charges Template found — invoices will save without GST rows.');
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

  // "Open in POS" from the Sales Invoice list lands here as /caratdesk-pos?invoice=<name>.
  //  - Draft: loaded into the cart for editing. Its name is kept as cart.draftInvoiceName so
  //    Save Draft / Pay update that same invoice instead of creating a new one.
  //  - Submitted: shown read-only (viewingInvoice). Cancel & Amend is offered only when
  //    ERPNext says this user may cancel AND amend this invoice (Role Permissions Manager).
  const [invoiceToOpen] = useState(() => new URLSearchParams(window.location.search).get('invoice'));
  const [viewingInvoice, setViewingInvoice] = useState(null);
  const [amending, setAmending] = useState(false);
  const [recallOpen, setRecallOpen] = useState(false);
  // Print prints the invoice open in POS — a submitted one being viewed, or a recalled draft
  // with items — so the button is disabled until one is.
  const [printing, setPrinting] = useState(false);
  const { loadCart } = cart;

  // Throws on failure — callers decide how to report it. Returns the loaded cart state.
  const loadInvoice = useCallback(async (invoiceName) => {
    const doc = await fetchSalesInvoice(invoiceName);
    if (!doc?.name) throw new Error(`Sales Invoice ${invoiceName} not found`);
    if (doc.is_return) throw new Error(`${doc.name} is a return — open it from Sales Invoices instead`);
    if (Number(doc.docstatus) === 2) throw new Error(`${doc.name} is cancelled`);
    const submitted = Number(doc.docstatus) === 1;
    const [customerDoc, state, perms, restored] = await Promise.all([
      getCustomerDetails(doc.customer).catch(() => ({ name: doc.customer, customer_name: doc.customer_name })),
      invoiceToCartState(doc, lookupByTag, { submitted }),
      submitted ? fetchSalesInvoicePermissions(doc.name) : null,
      // A submitted invoice's settlements are display-only — no need to re-check its Gold
      // Purchases or look up their (already reconciled) credit.
      settlementsFromInvoice(doc, submitted ? { getSchemeNames: fetchJewellerySchemeNames, getPostingDates: fetchPostingDates } : {
        getGoldPurchase: fetchGoldPurchaseInvoice,
        getGoldCredit: fetchGoldPurchaseCreditRows,
        getReturnCredit: fetchSalesReturnCreditRows,
        getSchemeNames: fetchJewellerySchemeNames,
        getPostingDates: fetchPostingDates,
      }),
    ]);
    state.warnings.push(...restored.warnings);
    setCustomer(customerDoc);
    setSalesTeam(state.salesTeam);
    // A submitted invoice isn't a draft POS can save back to — never let its name reach
    // saveSalesInvoice as draftInvoiceName.
    loadCart(submitted ? { ...state.snapshot, draftInvoiceName: null } : state.snapshot);
    setSettlements(restored.settlements);
    setViewingInvoice(submitted ? { doc, canCancelAmend: perms.canCancel && perms.canAmend } : null);
    return { doc, state };
  }, [loadCart]);

  const showInvoiceOpenedToast = useCallback((doc, state) => {
    if (Number(doc.docstatus) === 1) {
      showToast(`Viewing submitted invoice ${doc.name} (read only)`, 'info');
    } else if (state.warnings.length) {
      showToast(`Opened ${doc.name} — some items used saved rates: ${state.warnings[0]}`, 'info');
    } else {
      showToast(`Opened draft ${doc.name}`, 'success');
    }
  }, [showToast]);

  useEffect(() => {
    const invoiceName = invoiceToOpen;
    if (!invoiceName) return;
    const params = new URLSearchParams(window.location.search);
    params.delete('invoice');
    const qs = params.toString();
    window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : ''));

    let cancelled = false;
    (async () => {
      setScanning(true);
      try {
        const { doc, state } = await loadInvoice(invoiceName);
        if (cancelled) return;
        showInvoiceOpenedToast(doc, state);
      } catch (e) {
        if (!cancelled) showToast(parseApiError(e), 'error');
      } finally {
        if (!cancelled) setScanning(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [invoiceToOpen, loadInvoice, showInvoiceOpenedToast, showToast]);

  const printInvoiceName = viewingInvoice?.doc?.name || (cart.lines.length ? cart.draftInvoiceName : null);

  async function handlePrint() {
    setMenuOpen(false);
    setPrinting(true);
    showToast(`Preparing print for ${printInvoiceName}…`, 'info');
    try {
      await printSalesInvoiceDefault(printInvoiceName);
    } catch (e) {
      showToast(parseApiError(e), 'error');
    } finally {
      setPrinting(false);
    }
  }

  // Recall Invoice: same path as "Open in POS" — draft into the cart, submitted read-only.
  async function handleRecallInvoice(invoiceName) {
    if (!viewingInvoice && cart.lines.length && !window.confirm('Replace the current bill with the recalled invoice?')) return;
    setRecallOpen(false);
    setScanning(true);
    try {
      const { doc, state } = await loadInvoice(invoiceName);
      showInvoiceOpenedToast(doc, state);
    } catch (e) {
      showToast(parseApiError(e), 'error');
    } finally {
      setScanning(false);
    }
  }

  function closeViewedInvoice() {
    setViewingInvoice(null);
    setCustomer(null);
    setSalesTeam(defaultSalesTeam(shift));
    cart.clearCart();
    setSettlements([]);
  }

  // Cancels the submitted invoice, undoes what POS's own checkout did on top of ERPNext
  // (Purity Ledger debit, BOM deactivation, scheme marked used — ERPNext's cancel already
  // reverses stock, serials, GL and payments), then opens an amended draft for re-billing.
  // Cancelling is the one step that must succeed; the clean-up steps after it are each
  // attempted and anything that fails is reported by name so it can be fixed by hand.
  async function handleCancelAndAmend() {
    const doc = viewingInvoice?.doc;
    if (!doc) return;
    if (!window.confirm(
      `Cancel ${doc.name} and create an amended draft?\n\n` +
      'The original invoice will be cancelled (stock, payments and accounting reversed). ' +
      'The amended bill must be paid again, and any Jewellery Scheme must be re-applied. ' +
      'Gold Purchases and Sales Returns stay on the amended bill.',
    )) return;

    setAmending(true);
    try {
      await cancelSalesInvoice(doc.name);
    } catch (e) {
      showToast(`Could not cancel ${doc.name}: ${parseApiError(e)}`, 'error');
      setAmending(false);
      return;
    }

    const notUndone = [];
    const serialLines = (doc.items || []).flatMap((it) =>
      String(it.serial_no || '').split('\n').map((s) => s.trim()).filter(Boolean).map((serial_no) => ({ serial_no })),
    );
    const ledger = await postPurityLedgerForInvoice(doc.name, doc.customer, serialLines, {
      isCredit: true,
      branch: doc.branch || undefined,
    });
    if (ledger.failed.length) notUndone.push('Purity Ledger reversal');
    const batchPcs = await adjustBatchPcs(doc.items || [], +1);
    if (batchPcs.failed.length) notUndone.push(`Pcs back on batch ${batchPcs.failed.join(', ')}`);
    try {
      const schemes = await releaseSchemeAssignmentsForInvoice(doc.customer, doc.advances || [], doc.custom_settlement_references || []);
      if (schemes.failed.length) notUndone.push(`release of scheme ${schemes.failed.join(', ')}`);
    } catch (e) {
      console.warn('releaseSchemeAssignmentsForInvoice failed:', e.message);
      notUndone.push('Jewellery Scheme release');
    }

    try {
      const amendedName = await createAmendedSalesInvoice(doc);
      // Re-scanning the now-Active serials in the amended draft is also what tells us each
      // piece's BOM, so reactivation happens after the draft is loaded.
      const { state } = await loadInvoice(amendedName);
      // Cancelling freed each Gold Purchase's / Sales Return's credit again, so they carry
      // straight over to the amended bill instead of having to be recalled one by one.
      const carried = await settlementsFromInvoice(
        { ...doc, custom_settlement_references: (doc.custom_settlement_references || []).filter((r) => ['Gold Purchase', 'Sales Return'].includes(r.settlement_type)) },
        { getGoldPurchase: fetchGoldPurchaseInvoice, getGoldCredit: fetchGoldPurchaseCreditRows, getReturnCredit: fetchSalesReturnCreditRows, getPostingDates: fetchPostingDates },
      );
      if (carried.settlements.length) setSettlements(carried.settlements);
      const bomNames = [...new Set(state.snapshot.lines.map((l) => l.bom_name).filter(Boolean))];
      const bomResults = await Promise.allSettled(bomNames.map((n) => activateBom(n)));
      const failedBoms = bomNames.filter((_, i) => bomResults[i].status === 'rejected');
      if (failedBoms.length) notUndone.push(`reactivation of BOM ${failedBoms.join(', ')}`);
      if (notUndone.length) {
        showToast(`${doc.name} cancelled, amended draft ${amendedName} opened — but could not complete: ${notUndone.join('; ')}`, 'error');
      } else {
        showToast(`${doc.name} cancelled — amended draft ${amendedName} opened`, 'success');
      }
    } catch (e) {
      closeViewedInvoice();
      showToast(`${doc.name} cancelled, but the amended draft could not be created: ${parseApiError(e)}`, 'error');
    } finally {
      setAmending(false);
      refreshDaySummary();
    }
  }

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

  // A Settlement row's Jewellery Scheme form can settle several matured schemes for the same
  // customer in one go, so this accepts either a single entry (gold/return) or an array (kitty's
  // multi-select) and reports one consolidated toast. Returns whether anything was added.
  // Each entry's own componentDiscounts (Making/Diamond %) stays on the settlement itself —
  // schemeComponentDiscounts above derives the combined list every render — rather than being
  // written into cart.billComponentDiscounts, so multiple schemes discounting the same
  // component both apply instead of one overwriting the other.
  function handleSettlement(entryOrEntries) {
    const onBill = new Set(settlements.map((s) => s.number));
    const all = Array.isArray(entryOrEntries) ? entryOrEntries : [entryOrEntries];
    const entries = all.filter((e) => !onBill.has(e.number));
    if (entries.length < all.length) {
      showToast(`${all.filter((e) => onBill.has(e.number)).map((e) => e.number).join(', ')} is already on this bill`, 'error');
    }
    if (!entries.length) return false;
    setSettlements((prev) => [...prev, ...entries]);
    showToast(
      entries.length > 1 ? `${entries.length} schemes added as invoice settlement` : `${entries[0].number} added as invoice settlement`,
      'success',
    );
    return true;
  }

  // Settlement types this user's role may use (PP Settings1 pos_role, same button names as before).
  const SETTLEMENT_BUTTONS = { gold: 'Gold Purchase', kitty: 'Jewellery Scheme', return: 'Sales Return' };
  const allowedSettlementTypes = Object.keys(SETTLEMENT_BUTTONS).filter((t) => canShowButton(SETTLEMENT_BUTTONS[t]));
  // Batch (raw material) bills don't take Gold Purchase / Jewellery Scheme settlements.
  const batchReason = cart.lines.some((l) => l.is_batch) ? 'Not available on a bill with batch (raw material) items' : '';
  const settlementDisabledReasons = { gold: batchReason, kitty: batchReason };

  // Settlements are made for the bill's own customer, so one has to be picked first.
  function openSettlement() {
    if (!customer?.name) {
      showToast('Select a customer before adding a settlement', 'error');
      openCustomerPicker();
      return;
    }
    setSettlementOpen(true);
  }

  // Safe to just drop client-side — a settlement is only ever written to the backend (marking
  // the scheme's own record as used) once the invoice is actually confirmed and submitted, so
  // removing it here before that point leaves the scheme untouched and redeemable again.
  function removeSettlement(number) {
    setSettlements((prev) => prev.filter((s) => s.number !== number));
  }

  // A Gold Purchase is already a submitted Purchase Invoice, so its × opens the details dialog
  // instead — the cashier chooses there between just removing it from the bill (recallable
  // later) and cancelling the Purchase Invoice itself.
  function handleRemoveSettlement(settlement) {
    if (settlement.type === 'gold') {
      setGoldDetails({ name: settlement.number, readOnly: false });
      return;
    }
    removeSettlement(settlement.number);
    showToast(`${settlement.number} removed from this bill`, 'success');
  }

  function handleOpenSettlement(settlement) {
    setGoldDetails({ name: settlement.number, readOnly: Boolean(viewingInvoice) });
  }

  // Lowercased tag / serial / item code of every line in the bill (for duplicate checks).
  function cartKeys(lines) {
    return new Set(lines.flatMap((line) => [line.tag, line.serial_no, line.item_code])
      .filter(Boolean).map((value) => String(value).toLowerCase()));
  }

  // Faster scanning: the scan box stays open while lookups run. Each scan starts its lookup at
  // once (a few at a time) and lands in the bill in the order it was scanned. A scan still being
  // looked up counts as already in the bill, so scanning it twice is caught too.
  async function handleScan(tag) {
    const trimmed = (tag || '').trim();
    if (!trimmed || viewingInvoice) return;
    if (!shift) { showToast('Start a shift before scanning', 'error'); setShiftMode('start'); return; }
    if (!customer?.name) { showToast('Select a customer before scanning', 'error'); openCustomerPicker(); return; }
    const key = trimmed.toLowerCase();
    const duplicate = linesRef.current.find((line) =>
      [line.tag, line.serial_no, line.item_code].some((value) => String(value || "").toLowerCase() === key),
    );
    if (duplicate?.is_batch) {
      // Same batch again — sell more of it by changing the Qty on the line already there.
      showToast(`Batch ${duplicate.batch_no} is already in this bill — change its Qty there`, 'info');
      setTimeout(() => document.getElementById(`qty-${duplicate.id}`)?.focus(), 0);
      return;
    }
    if (duplicate || pendingScanKeysRef.current.has(key)) {
      showToast(`Serial number "${trimmed}" is already in this bill`, "error");
      return;
    }
    pendingScanKeysRef.current.add(key);
    setPendingScans((n) => n + 1);
    // A set's serial comes back as its ₹0 set tag + each piece; anything else is one line
    const lookup = scanLimiterRef.current(() => lookupLinesByTag(trimmed));
    lookup.catch(() => {}); // handled in order below
    const bill = billEpochRef.current;
    scanChainRef.current = scanChainRef.current.then(async () => {
      try {
        const items = await lookup;
        // The bill was finished / cancelled / swapped while this was being looked up.
        if (bill !== billEpochRef.current) return;
        if (!items.length) {
          showToast(`No item found for tag "${trimmed}"`, 'error');
          return;
        }
        // Batch (raw material) bills don't take Gold Purchase / Jewellery Scheme settlements.
        if (items[0].is_batch && settlementsRef.current.some((st) => st.type === 'gold' || st.type === 'kitty')) {
          showToast('Remove the Gold Purchase / Jewellery Scheme from this bill before adding batch items.', 'error');
          return;
        }
        if (items[0].batch_warehouse_options) {
          setBatchWarehousePick(items[0]);
          return;
        }
        items.forEach((item) => cart.addUniqueLine(item));
        const [first] = items;
        const warning = items.find((item) => item.pricing_warning)?.pricing_warning;
        let message = warning || `Added ${first.item_name || first.item_code}`;
        if (first.is_set_tag) message = warning || `Added set ${first.serial_no} with ${items.length - 1} piece(s)`;
        else if (first.set_serial && !linesRef.current.some((l) => l.serial_no === first.set_serial)) {
          message = `${first.item_name || first.item_code} is part of set ${first.set_serial} — selling it alone will break the set`;
        }
        showToast(message, warning || first.set_serial ? 'info' : 'success');
      } catch (e) {
        if (bill === billEpochRef.current) showToast(`${trimmed}: ${parseApiError(e)}`, 'error');
      } finally {
        pendingScanKeysRef.current.delete(key);
        setPendingScans((n) => n - 1);
      }
    });
  }

  function openBulkAdd() {
    if (viewingInvoice) return;
    if (!shift) { showToast('Start a shift before adding items', 'error'); setShiftMode('start'); return; }
    if (!customer?.name) { showToast('Select a customer before adding items', 'error'); openCustomerPicker(); return; }
    setBulkAddOpen(true);
  }

  function handleBulkAdd(items) {
    setBulkAddOpen(false);
    const before = cartKeys(linesRef.current);
    const added = items.filter((item) => !before.has(String(item.tag || item.serial_no || '').toLowerCase()));
    added.forEach((item) => cart.addUniqueLine(item));
    const warnings = added.filter((item) => item.pricing_warning).length;
    showToast(
      `Added ${added.length} item(s) to the bill${warnings ? ` · ${warnings} using Item master rate — check pricing` : ''}`,
      warnings ? 'info' : 'success',
    );
  }

  // A batch with stock in more than one warehouse — the cashier picks which one it sells from.
  function handlePickBatchWarehouse(option) {
    const line = batchWarehousePick;
    setBatchWarehousePick(null);
    if (!line) return;
    cart.addUniqueLine({
      ...line,
      warehouse: option.warehouse,
      batch_available_qty: option.qty,
      qty: Math.min(1, option.qty) || 1,
      batch_warehouse_options: null,
    });
    showToast(line.pricing_warning || `Added ${line.item_name || line.item_code} from ${option.warehouse}`, line.pricing_warning ? 'info' : 'success');
  }

  // First batch line that can't be billed yet (no Qty, more than the batch has, ...).
  function findBatchLineProblem() {
    for (const line of cart.lines) {
      const error = batchLineError(line);
      if (error) return `${line.batch_no}: ${error}`;
    }
    return '';
  }

  // Removing one piece of a set billed whole means the rest is no longer the full set — drop
  // the set tag too, so the remaining pieces sell individually (and the set gets broken).
  function handleRemoveLine(id) {
    const line = cart.lines.find((l) => l.id === id);
    const setTag = line?.set_serial && cart.lines.find((l) => l.is_set_tag && l.serial_no === line.set_serial);
    cart.removeLine(id);
    if (setTag) {
      cart.removeLine(setTag.id);
      showToast(`Set ${setTag.serial_no} will be broken — the remaining piece(s) sell individually`, 'info');
    }
  }

  function validateBill() {
    if (!customer?.name) {
      showToast('Select a customer first', 'error');
      openCustomerPicker();
      return false;
    }
    if (pendingScans) {
      showToast(`Wait — ${pendingScans} scan(s) still being added`, 'info');
      return false;
    }
    if (!cart.lines.length) {
      showToast('Scan at least one item', 'error');
      return false;
    }
    const batchProblem = findBatchLineProblem();
    if (batchProblem) {
      showToast(batchProblem, 'error');
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
        settlements,
        salesTeam,
        gstAddressFields,
        includeSettlementReferences: await salesInvoiceHasSettlementReferences(),
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
    if (viewingInvoice) {
      closeViewedInvoice();
      setMenuOpen(false);
      return;
    }
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
    if (pendingScans) {
      showToast(`Wait — ${pendingScans} scan(s) still being added`, 'info');
      return;
    }
    if (!cart.lines.length) {
      showToast("Scan at least one item", "error");
      return;
    }
    const batchProblem = findBatchLineProblem();
    if (batchProblem) {
      showToast(batchProblem, 'error');
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
    if (viewingInvoice) return;
    setCustomerPromptForPayment(false);
    setCustomerOpen(true);
  }

  async function handleConfirmPayment(payments) {
    setConfirming(true);
    try {
      // Last check before the bill locks the Gold Purchases / Sales Returns in — another counter
      // may have used some of their credit since they were added here, and the Journal Entry
      // rows behind them may have been split since. Re-read each one and re-allocate this bill's
      // amount on the rows as they are now.
      const billSettlements = await Promise.all(settlements.map(async (s) => {
        if (s.type !== 'gold' && s.type !== 'return') return s;
        const { rows, available } = await fetchSettlementAvailableCredit(s.type, s.number, customer.name, cart.draftInvoiceName);
        if (available === null) {
          const used = await fetchGoldPurchasesUsedOnSalesInvoices([s.number], cart.draftInvoiceName);
          if (used.has(s.number)) throw new Error(`Gold Purchase ${s.number} is already used on Sales Invoice ${used.get(s.number)} — remove it from this bill first`);
          return s;
        }
        if (s.amount > available + 0.009) {
          throw new Error(`Only ${fmtINR(available)} is left on ${s.number} — remove it from this bill and add it again`);
        }
        return creditSettlementEntry(s.type, s.number, s.customer, rows, s.amount, s.creditTotal, s.posting_date);
      }));

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
        settlements: billSettlements,
        salesTeam,
        gstAddressFields,
        includeSettlementReferences: await salesInvoiceHasSettlementReferences(),
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

      // A set piece sold without its set tag breaks that set: the ₹0 set serial leaves stock and
      // the remaining pieces become individual items.
      const sets = await breakSetsForSoldLines(cart.lines, name);
      if (sets.failed.length) {
        showToast(`Could not break set ${sets.failed.join(', ')} — check the Error Log / break it by hand`, 'error');
      }

      // Pcs sold out of a batch come off the Batch's own Pcs count (ERPNext moves only the qty).
      const batchPcs = await adjustBatchPcs(cart.lines, -1);
      if (batchPcs.failed.length) {
        showToast(`Could not reduce Pcs on batch ${batchPcs.failed.join(', ')} — update it by hand`, 'error');
      }

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
        {shift?.startedAt && <span><ContextIcon name="shift" />Started <strong>{fmtDateTime(shift.startedAt)}</strong></span>}
        <span><ContextIcon name="counter" />Counter <strong>{shift?.counter || "Unallocated"}</strong></span>
        <span><ContextIcon name="user" />Cashier <strong>{shift?.cashier || user?.fullName || "—"}</strong></span>
        <span><ContextIcon name="user" />Customer <button type="button" className="cd-pos-context-btn" onClick={openCustomerPicker}>{customer?.customer_name || "Select customer"}</button></span>
        <span><ContextIcon name="user" />Sales Team <button type="button" className="cd-pos-context-btn" disabled={Boolean(viewingInvoice)} onClick={() => setSalesTeamOpen(true)}>{salesTeam.length ? `${salesTeam[0].salesPerson}${salesTeam.length > 1 ? ` +${salesTeam.length - 1} more` : ''}` : "Select sales team"}</button></span>
      </div>

      {viewingInvoice && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '10px 16px', background: 'var(--pill-blue-bg)', color: 'var(--pill-blue-txt)', borderBottom: '.5px solid var(--border)', fontSize: 13 }}>
          <span>
            Submitted invoice <strong>{viewingInvoice.doc.name}</strong> · {viewingInvoice.doc.status} · {viewingInvoice.doc.posting_date} · Grand Total <strong>{fmtINR(viewingInvoice.doc.grand_total)}</strong>
            {(viewingInvoice.doc.payments || []).filter((p) => p.amount).length > 0 && (
              <> · Paid by {(viewingInvoice.doc.payments || []).filter((p) => p.amount).map((p) => `${p.mode_of_payment} ${fmtINR(p.amount)}`).join(', ')}</>
            )}
            {' '}— read only
            <div style={{ fontSize: 11.5, opacity: 0.8, marginTop: 2 }}>
              Weights and components come from each tag's receipt/BOM; the metal rate is worked out from the billed amount.
            </div>
          </span>
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            {viewingInvoice.canCancelAmend && (
              <button type="button" className="cd-btn cd-btn-secondary" disabled={amending} onClick={handleCancelAndAmend}>
                {amending ? 'Cancelling…' : 'Cancel & Amend'}
              </button>
            )}
            <button type="button" className="cd-btn cd-btn-secondary" disabled={amending} onClick={closeViewedInvoice}>Close</button>
          </span>
        </div>
      )}

      <div className="cd-pos-body cd-pos-body-full">
        <CartGrid
          readOnly={Boolean(viewingInvoice)}
          lines={cart.lines}
          goldRate={goldRate}
          totals={cart.totals}
          billDiscount={cart.billDiscount}
          settlements={settlements}
          onScan={handleScan}
          onBulkAdd={openBulkAdd}
          scanning={scanning}
          pendingScans={pendingScans}
          onUpdateLine={cart.updateLine}
          onRemoveLine={handleRemoveLine}
          onBillDiscountChange={(patch) =>
            cart.setBillDiscount((prev) => ({ ...prev, ...patch }))
          }
          onRemoveSettlement={viewingInvoice ? undefined : handleRemoveSettlement}
          onOpenSettlement={handleOpenSettlement}
        />
      </div>

      <footer className="cd-pos-footer">
        <DaySummary summary={daySummary} loading={summaryLoading} />

        <div className="cd-pos-footer-right">
          {!shift ? <button type="button" className="cd-btn cd-btn-primary" onClick={() => setShiftMode("start")}>Shift Start</button> : <>
            {/* Manager Mode hidden per request
            <button type="button" className="cd-btn cd-btn-blue" onClick={() => setManagerModeOpen(true)}>Manager Mode</button>
            */}
            <button type="button" className="cd-btn cd-btn-secondary" onClick={() => setShiftMode("end")}>Shift End</button>
          </>}
          {!viewingInvoice && canShowButton('Discount') && (
            <button type="button" className="cd-btn cd-btn-secondary" onClick={() => setDiscountOpen(true)}>Discount</button>
          )}
          {!viewingInvoice && canShowButton('Gold Purchase') && (
            <button type="button" className="cd-btn cd-btn-secondary" onClick={() => setCreateRecordType('gold')}>Gold Purchase</button>
          )}
          {canShowButton('Sales Return') && (
            <button type="button" className="cd-btn cd-btn-secondary" onClick={() => setCreateRecordType('return')}>Sales Return</button>
          )}
          {!viewingInvoice && allowedSettlementTypes.length > 0 && (
            <button
              type="button"
              className="cd-btn cd-btn-secondary cd-btn-has-badge"
              onClick={openSettlement}
              aria-label={settlements.length ? `Settlement, ${settlements.length} applied` : 'Settlement'}
            >
              Settlement
              {settlements.length > 0 && <span className="cd-btn-badge" aria-hidden="true">{settlements.length}</span>}
            </button>
          )}
          <button
            type="button"
            className="cd-btn cd-btn-secondary"
            onClick={handleCancel}
          >
            Clear
          </button>

          {!viewingInvoice && <>
          <button
            type="button"
            className="cd-btn cd-btn-secondary"
            disabled={saving}
            onClick={handleSaveDraft}
          >
            {saving ? 'Saving…' : 'Save Draft'}
          </button>
          </>}

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
                  onClick={() => { setMenuOpen(false); setRecallOpen(true); }}
                >
                  Recall Invoice
                </button>
                <button
                  type="button"
                  className="cd-dropdown-item"
                  disabled={!printInvoiceName || printing}
                  onClick={handlePrint}
                >
                  Print
                </button>
                {!viewingInvoice && <>
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
                </>}
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

          {!viewingInvoice && (
          <button
            type="button"
            className="cd-btn cd-btn-green"
            onClick={openPayment}
            disabled={!cart.lines.length}
          >
            Pay {cart.lines.length ? `· ${fmtINR(balancePayable)}` : ''}
          </button>
          )}
        </div>
      </footer>

      {recallOpen && (
        <InvoicePickerModal
          customer={customer}
          onClose={() => setRecallOpen(false)}
          onRecall={handleRecallInvoice}
        />
      )}


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
      {settlementOpen && (
        <SettlementDialog
          allowedTypes={allowedSettlementTypes}
          disabledReasons={settlementDisabledReasons}
          customer={customer}
          settlements={settlements}
          balancePayable={balancePayable}
          draftInvoiceName={cart.draftInvoiceName}
          heldSettlementNumbers={holds.flatMap((h) => (h.settlements || []).map((s) => s.number))}
          onSettle={handleSettlement}
          onRemove={handleRemoveSettlement}
          onOpenSettlement={handleOpenSettlement}
          onClose={() => setSettlementOpen(false)}
        />
      )}
      {createRecordType && (
        <CreateSettlementRecordModal
          type={createRecordType}
          customer={customer}
          onClose={() => setCreateRecordType(null)}
          onCreated={refreshDaySummary}
        />
      )}

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
        onOpenSettlement={handleOpenSettlement}
      />

      {bulkAddOpen && (
        <BulkSerialModal
          existingKeys={cartKeys(cart.lines)}
          onClose={() => setBulkAddOpen(false)}
          onAdd={handleBulkAdd}
        />
      )}

      {batchWarehousePick && (
        <>
          <div className="cd-idialog-overlay" onClick={() => setBatchWarehousePick(null)} role="presentation" />
          <div className="cd-idialog" role="dialog" aria-modal="true">
            <div className="cd-idialog-header">
              <span className="cd-idialog-title">Batch {batchWarehousePick.batch_no} · pick a warehouse</span>
              <button type="button" className="cd-idialog-close" onClick={() => setBatchWarehousePick(null)}>×</button>
            </div>
            <div className="cd-idialog-body" style={{ display: 'grid', gap: 8 }}>
              <div className="cd-hint">This batch has stock in more than one warehouse. Choose where this sale comes from.</div>
              {batchWarehousePick.batch_warehouse_options.map((option) => (
                <button
                  key={option.warehouse}
                  type="button"
                  className="cd-btn"
                  style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}
                  onClick={() => handlePickBatchWarehouse(option)}
                >
                  <span>{option.warehouse}</span>
                  <strong>{fmtWeight(option.qty)} {batchWarehousePick.batch_uom_label || batchWarehousePick.uom}</strong>
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      <GoldPurchaseDetailsModal
        key={goldDetails?.name || 'gold-details-none'}
        name={goldDetails?.name}
        readOnly={goldDetails?.readOnly}
        onClose={() => setGoldDetails(null)}
        onRemove={(name) => {
          removeSettlement(name);
          setGoldDetails(null);
          showToast(`Gold Purchase ${name} removed from this bill — add it back from Settlement → Gold Purchase → Pending Gold Purchases`, 'success');
        }}
        onCancelled={(name) => {
          removeSettlement(name);
          setGoldDetails(null);
          refreshDaySummary();
        }}
      />
    </div>
  );
}
