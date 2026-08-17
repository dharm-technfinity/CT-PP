import { useEffect, useMemo, useState } from 'react';
import { fetchPaymentModes } from '../../lib/api.js';
import { fmtINR, round2 } from '../../lib/format.js';
import { useToast } from '../../hooks/useToast.jsx';

const DENOMINATIONS = [500, 200, 100, 50, 20, 10, 5, 2, 1];
const isCash = (mode) => String(mode).toLowerCase().includes('cash');
const isCard = (mode) => String(mode).toLowerCase().includes('card');
// Section 269ST: cash received against a single invoice can't be ₹2,00,000 or more.
const CASH_LIMIT = 200000;

export default function PaymentModal({ open, onClose, totals, settlements = [], onConfirm, confirming, lastInvoice, onRemoveSettlement }) {
  const { showToast } = useToast();
  // mode_of_payment is a real Link field to Mode of Payment — sourced strictly from the
  // backend doctype so a hardcoded label (e.g. "Wallet") can never be offered here and then
  // fail Link validation when the invoice is actually submitted.
  const [modes, setModes] = useState([]);
  const [rows, setRows] = useState([]);
  useEffect(() => {
    if (!open) return;
    fetchPaymentModes().then(remote => setModes(remote || [])).catch(() => setModes([]));
    queueMicrotask(() => {
      setRows([{ mode: 'Cash', amount: '', reference: '', cardNumber: '', expiry: '', counts: {} }]);
    });
  }, [open]);
  const settlementTotal = useMemo(() => round2(settlements.reduce((s, x) => s + (Number(x.amount) || 0), 0)), [settlements]);
  const payable = round2(Math.max(0, totals.grandTotal - settlementTotal));
  const allocated = round2(rows.reduce((s, r) => s + (Number(r.amount) || 0), 0));
  const pending = round2(Math.max(0, payable - allocated));
  const change = round2(Math.max(0, allocated - payable));
  const cashTotal = round2(rows.filter(r => isCash(r.mode)).reduce((s, r) => s + (Number(r.amount) || 0), 0));
  const cashOverLimit = cashTotal > CASH_LIMIT;
  if (!open) return null;
  const update = (i, patch) => setRows(prev => prev.map((r, x) => x === i ? {...r, ...patch} : r));
  // Cash is counted, not typed — each denomination's qty rolls straight into that row's
  // Amount, mirroring the same auto-calculation already used on the Jewellery Scheme
  // Assignment payment panel (previously this only updated a separate display total and
  // never touched the row's actual Amount field).
  function updateDenom(i, denom, val) {
    setRows(prev => prev.map((r, x) => {
      if (x !== i) return r;
      const counts = { ...(r.counts || {}), [denom]: val };
      const total = round2(DENOMINATIONS.reduce((s, d) => s + d * (Number(counts[d]) || 0), 0));
      return { ...r, counts, amount: total || '' };
    }));
  }
  function confirm() {
    if (pending > .01) return;
    if (cashOverLimit) { showToast(`Cash payment cannot exceed ${fmtINR(CASH_LIMIT)} per transaction`, 'error'); return; }
    let balance = payable;
    const payments = rows.flatMap(r => {
      const amount = Math.min(Number(r.amount) || 0, balance);
      if (amount <= 0) return [];
      balance = round2(balance - amount);
      return [{ mode_of_payment: r.mode, amount, reference_no: r.reference || undefined, card_number: r.cardNumber ? `**** **** **** ${r.cardNumber.replace(/\D/g, '').slice(-4)}` : undefined, expiry_date: r.expiry || undefined, denominations: isCash(r.mode) ? r.counts : undefined }];
    });
    // Settlements no longer become fake payment-mode rows — a redeemed scheme's real advance
    // is applied via the Sales Invoice's own `advances` allocation (built in posInvoice.js from
    // the same settlements, read directly off index.jsx's state), not money "received" here.
    onConfirm(payments, change);
  }
  return <><div className="cd-idialog-overlay" onClick={onClose} role="presentation" /><div className="cd-idialog payment-dialog" role="dialog" aria-modal="true">
    <div className="cd-idialog-header"><span className="cd-idialog-title">{lastInvoice ? `Invoice ${lastInvoice} submitted` : 'Payment & Settlement'}</span><button className="cd-idialog-close" onClick={onClose}>×</button></div>
    <div className="cd-idialog-body">{lastInvoice ? <div className="cd-success-banner"><h3>Payment recorded successfully</h3>{/* Print Invoice disabled per request
      <button className="cd-btn cd-btn-primary" onClick={() => window.open(getPrintUrl(lastInvoice), '_blank')}>Print Invoice</button>
      */}</div> : <>
      <div className="cd-payment-totals"><div className="row"><span>Subtotal</span><span>{fmtINR(totals.subtotal)}</span></div><div className="row"><span>Bill Discount</span><span>-{fmtINR(totals.billDiscount)}</span></div>{totals.schemeBonusAmount > 0 && <div className="row"><span>Scheme Bonus Discount</span><span>-{fmtINR(totals.schemeBonusAmount)}</span></div>}{totals.igst > 0 ? <div className="row"><span>IGST</span><span>{fmtINR(totals.igst)}</span></div> : <><div className="row"><span>CGST</span><span>{fmtINR(totals.cgst)}</span></div><div className="row"><span>SGST</span><span>{fmtINR(totals.sgst)}</span></div></>}<div className="row grand"><span>Grand Total</span><span>{fmtINR(totals.grandTotal)}</span></div></div>
      {settlements.length > 0 && <div className="cd-settlement-list"><label className="cd-label">Settlement Credit Applied</label>{settlements.map((s, i) => <div key={i}><span>{s.number}</span><strong>-{fmtINR(s.amount)}</strong>{onRemoveSettlement && <button type="button" className="cd-settled-scheme-remove" onClick={() => onRemoveSettlement(s.number)} aria-label={`Remove ${s.number}`}>×</button>}</div>)}<div className="total"><span>Balance payable</span><strong>{fmtINR(payable)}</strong></div></div>}
      <label className="cd-label">Payment modes</label>
      {rows.map((row, i) => <div className="cd-payment-entry" key={i}><div className="cd-payment-row"><select className="cd-select" value={row.mode} onChange={e => update(i, {mode: e.target.value})}>{modes.map(m => <option key={m}>{m}</option>)}</select><input className="cd-input" type="number" min="0" placeholder="Amount" value={row.amount} onChange={e => update(i, {amount: e.target.value})} />{rows.length > 1 && <button className="cd-del-btn" onClick={() => setRows(r => r.filter((_, x) => x !== i))}>×</button>}</div>
      {isCard(row.mode) && <div className="cd-card-fields"><input className="cd-input" inputMode="numeric" maxLength={19} placeholder="Card Number" value={row.cardNumber} onChange={e => update(i, {cardNumber: e.target.value.replace(/[^0-9 ]/g, '')})} /><input className="cd-input" type="month" aria-label="Expiry Date" value={row.expiry} onChange={e => update(i, {expiry: e.target.value})} /><input className="cd-input" placeholder="Reference Number" value={row.reference} onChange={e => update(i, {reference: e.target.value})} /></div>}
      {!isCash(row.mode) && !isCard(row.mode) && <input className="cd-input" placeholder="Reference / UTR / Voucher Number" value={row.reference} onChange={e => update(i, {reference: e.target.value})} />}
      {isCash(row.mode) && <div className="cd-cash-box"><label className="cd-label">Currency denominations</label><div className="cd-denomination-grid compact">{DENOMINATIONS.map(d => <label key={d}><span>₹{d}</span><input className="cd-input" type="number" min="0" value={row.counts?.[d] || ''} onChange={e => updateDenom(i, d, e.target.value)} /><strong>{fmtINR(d * (Number(row.counts?.[d]) || 0))}</strong></label>)}</div><div className="cd-cash-declared">Cash counted: <strong>{fmtINR(Number(row.amount) || 0)}</strong></div></div>}</div>)}
      <button className="cd-btn cd-btn-secondary" onClick={() => setRows(r => [...r, {mode: 'UPI', amount: '', reference: '', cardNumber: '', expiry: '', counts: {}}])}>+ Add Payment Mode</button>
      <div className="cd-payment-status-grid"><div><span>Amount Tendered</span><strong>{fmtINR(allocated + settlementTotal)}</strong></div><div><span>Balance Amount</span><strong>{fmtINR(pending)}</strong></div><div><span>Change Amount</span><strong>{fmtINR(change)}</strong></div></div>
      {cashOverLimit && <div className="cd-dlg-error" style={{margin: '12px 0 0'}}>Cash payment cannot exceed {fmtINR(CASH_LIMIT)} per transaction</div>}
    </>}</div>
    <div className="cd-idialog-footer"><button className="cd-btn cd-btn-secondary" onClick={onClose}>{lastInvoice ? 'Done' : 'Cancel'}</button>{!lastInvoice && <button className="cd-btn cd-btn-green" disabled={confirming || pending > .01 || cashOverLimit} onClick={confirm}>{confirming ? 'Processing…' : 'Confirm & Submit'}</button>}</div>
  </div></>;
}
