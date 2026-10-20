import { useRef, useEffect, useState } from 'react';
import { fmtINR, fmtWeight, round2 } from '../../lib/format.js';
import { calcLineBreakup, batchLineError } from './posCalculations.js';
import SettlementLabel from './SettlementLabel.jsx';

function resolveImageSrc(image) {
  if (!image) return '';
  if (image.startsWith('http')) return image;
  return image;
}

// Batch-only bill: total sold per unit, e.g. "3.250 Ct · 12.500 g".
function batchWeightSummary(lines) {
  const byUnit = {};
  lines.forEach((l) => {
    const unit = l.batch_uom_label || l.uom || '';
    byUnit[unit] = (byUnit[unit] || 0) + (parseFloat(l.qty || 0) || 0);
  });
  return Object.entries(byUnit).map(([unit, qty]) => `${fmtWeight(qty)} ${unit}`.trim()).join(' · ');
}

export default function CartGrid({
  lines,
  goldRate,
  totals,
  billDiscount,
  settlements = [],
  onScan,
  onBulkAdd,
  scanning,
  // Scans still being looked up — the box stays open for the next one meanwhile.
  pendingScans = 0,
  onUpdateLine,
  onRemoveLine,
  onBillDiscountChange,
  onRemoveSettlement,
  onOpenSettlement,
  // Viewing a submitted invoice — everything is shown but nothing can be scanned, removed,
  // discounted or re-priced.
  readOnly = false,
}) {
  const schemeCreditApplied = round2(settlements.reduce((s, x) => s + (Number(x.amount) || 0), 0));
  const balancePayable = round2(Math.max(0, totals.grandTotal - schemeCreditApplied));
  const scanRef = useRef(null);
  const [pricingLine, setPricingLine] = useState(null);
  // A bill of only batch (raw material) lines gets its own short layout; Finished Goods columns
  // (weights, purity, making, ...) don't apply to it.
  const anyBatch = lines.some((l) => l.is_batch);
  const allBatch = lines.length > 0 && lines.every((l) => l.is_batch);
  const batchWeight = allBatch ? batchWeightSummary(lines) : '';

  useEffect(() => {
    scanRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!scanning) scanRef.current?.focus();
  }, [scanning, lines.length]);

  function submitScan() {
    const val = scanRef.current?.value ?? '';
    if (scanRef.current) scanRef.current.value = '';
    onScan(val);
  }

  function handleScanSubmit(e) {
    e.preventDefault();
    submitScan();
  }

  function handleScanKey(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      submitScan();
    }
  }

  return (
    <div className="cd-pos-main">
      <div className="cd-scan-bar">
        <form className="cd-scan-input-wrap" onSubmit={handleScanSubmit}>
          <svg viewBox="0 0 24 24">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <line x1="7" y1="8" x2="17" y2="8" />
            <line x1="7" y1="12" x2="17" y2="12" />
            <line x1="7" y1="16" x2="13" y2="16" />
          </svg>
          <input
            ref={scanRef}
            className="cd-input cd-scan-input"
            placeholder={readOnly ? 'Submitted invoice — read only' : 'Scan tag / barcode (Enter to add)'}
            autoComplete="off"
            enterKeyHint="go"
            disabled={scanning || readOnly}
            onKeyDown={handleScanKey}
          />
        </form>
        {(scanning || pendingScans > 0) && (
          <span className="cd-spinner" aria-label="Scanning" />
        )}
        {pendingScans > 1 && <span className="cd-hint" style={{ margin: 0, whiteSpace: 'nowrap' }}>{pendingScans} adding…</span>}
        {!readOnly && onBulkAdd && (
          <button type="button" className="cd-btn cd-btn-secondary" style={{ whiteSpace: 'nowrap' }} onClick={onBulkAdd} title="Paste or upload many serial numbers at once">
            Bulk Add
          </button>
        )}
      </div>

      <div className="cd-cart-wrap">
        {lines.length === 0 ? (
          <div className="cd-spinner-wrap">Scan a tag to begin billing</div>
        ) : (
          allBatch ? (
          <table className="cd-pos-table cd-pos-table-batch">
            <thead>
              <tr>
                <th style={{ width: 380 }}>Item</th>
                <th style={{ width: 110, textAlign: 'right' }}>UOM</th>
                <th style={{ width: 170, textAlign: 'right' }}>Qty</th>
                <th style={{ width: 170, textAlign: 'right' }}>Rate</th>
                <th style={{ width: 190, textAlign: 'right' }}>Amount</th>
                <th style={{ width: 42 }} />
                <th style={{ width: 29 }} />
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <BatchRow
                  key={line.id}
                  line={line}
                  goldRate={goldRate}
                  onUpdate={onUpdateLine}
                  onRemove={onRemoveLine}
                  onPricing={setPricingLine}
                  readOnly={readOnly}
                />
              ))}
            </tbody>
          </table>
          ) : (
          <table className="cd-pos-table" style={anyBatch ? { minWidth: 2210 } : undefined}>
            <thead>
              <tr>
                <th style={{ width: 250 }}>Item</th>
                <th style={{ width: anyBatch ? 120 : 60, textAlign: 'right' }}>Qty</th>
                {anyBatch && (
                  <>
                    <th style={{ width: 120, textAlign: 'right' }}>Rate</th>
                  </>
                )}
                <th style={{ width: 120, textAlign: 'right' }}>Gross Wt</th>
                <th style={{ width: 120, textAlign: 'right' }}>Net Wt</th>
                <th style={{ width: 95, textAlign: 'right' }}>Purity</th>
                <th style={{ width: 170, textAlign: 'right' }}>Metal</th>
                <th style={{ width: 170, textAlign: 'right' }}>Making</th>
                <th style={{ width: 170, textAlign: 'right' }}>Diamond</th>
                <th style={{ width: 170, textAlign: 'right' }}>Stone</th>
                <th style={{ width: 170, textAlign: 'right' }}>Total</th>
                <th style={{ width: 42, textAlign: 'right' }} />
                <th style={{ width: 120, textAlign: 'right' }}>Dia Wt</th>
                <th style={{ width: 120, textAlign: 'right' }}>St Wt</th>
                <th style={{ width: 170, textAlign: 'right' }}>Other</th>
                <th style={{ width: 29, textAlign: 'right' }} />
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <CartRow
                  key={line.id}
                  line={line}
                  goldRate={goldRate}
                  onUpdate={onUpdateLine}
                  onRemove={onRemoveLine}
                  onPricing={setPricingLine}
                  readOnly={readOnly}
                  showBatchCols={anyBatch}
                />
              ))}
            </tbody>
          </table>
          )
        )}
      </div>

      <div className="cd-pos-adjustments">
        <div className="cd-adjustment-control">
          <label className="cd-label">Bill Discount</label>
          <div className="cd-adjustment-row">
            <div className="cd-disc-toggle">
              <button
                type="button"
                disabled={readOnly}
                className={billDiscount.mode === 'amount' ? 'active' : ''}
                onClick={() => onBillDiscountChange({ mode: 'amount' })}
              >
                ₹
              </button>
              <button
                type="button"
                disabled={readOnly}
                className={billDiscount.mode === 'percent' ? 'active' : ''}
                onClick={() => onBillDiscountChange({ mode: 'percent' })}
              >
                %
              </button>
            </div>
            <input
              className="cd-input cd-num-input"
              type="number"
              min="0"
              step="0.01"
              placeholder="0.00"
              value={billDiscount.value}
              disabled={readOnly}
              onChange={(e) => onBillDiscountChange({ value: e.target.value })}
            />
          </div>
        </div>
        <div className="cd-adjustment-total">
          <span>Invoice Discount</span>
          <strong>-{fmtINR(totals.billDiscount)}</strong>
        </div>
      </div>

      {settlements.length > 0 && (
        <div className="cd-settled-schemes">
          <label className="cd-label">Settlements Applied</label>
          <div className="cd-settled-scheme-list">
            {settlements.map((s, i) => (
              <div className="cd-settled-scheme-chip" key={`${s.number}-${i}`}>
                <SettlementLabel settlement={s} onOpen={onOpenSettlement} />
                <strong>-{fmtINR(s.amount)}</strong>
                {onRemoveSettlement && (
                  <button
                    type="button"
                    className="cd-settled-scheme-remove"
                    onClick={() => onRemoveSettlement(s)}
                    aria-label={`Remove ${s.number}`}
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="cd-summary-bar">
        <div className="cd-summary-item">
          <label>Total Qty</label>
          <span>{totals.totalQty}</span>
        </div>
        <div className="cd-summary-item">
          <label>Gross Wt</label>
          <span>{batchWeight || `${fmtWeight(totals.totalGrossWeight)} g`}</span>
        </div>
        <div className="cd-summary-item">
          <label>Net Wt</label>
          <span>{batchWeight || `${fmtWeight(totals.totalNetWeight)} g`}</span>
        </div>

        <div className="cd-summary-item">
          <label>Subtotal</label>
          <span>{fmtINR(totals.subtotal)}</span>
        </div>

        {totals.componentDiscountTotal > 0 && (
          <div className="cd-summary-item">
            <label>Scheme Discount</label>
            <span>-{fmtINR(totals.componentDiscountTotal)}</span>
          </div>
        )}
        <div className="cd-summary-item">
          <label>Bill Discount</label>
          <span>-{fmtINR(totals.billDiscount)}</span>
        </div>
        {totals.schemeBonusAmount > 0 && (
          <div className="cd-summary-item">
            <label>Scheme Bonus Discount</label>
            <span>-{fmtINR(totals.schemeBonusAmount)}</span>
          </div>
        )}
        {totals.igst > 0 ? (
          <div className="cd-summary-item">
            <label>IGST</label>
            <span>{fmtINR(totals.igst)}</span>
          </div>
        ) : (
          <>
            <div className="cd-summary-item">
              <label>CGST</label>
              <span>{fmtINR(totals.cgst)}</span>
            </div>
            <div className="cd-summary-item">
              <label>SGST</label>
              <span>{fmtINR(totals.sgst)}</span>
            </div>
          </>
        )}
        <div className="cd-summary-item grand">
          <label>Grand Total</label>
          <span>{fmtINR(totals.grandTotal)}</span>
        </div>
        {schemeCreditApplied > 0 && (
          <>
            <div className="cd-summary-item">
              <label>Settlement Credit Applied</label>
              <span>-{fmtINR(schemeCreditApplied)}</span>
            </div>
            <div className="cd-summary-item grand">
              <label>Balance Payable</label>
              <span>{fmtINR(balancePayable)}</span>
            </div>
          </>
        )}
      {pricingLine && <PricingPopup line={pricingLine} goldRate={goldRate} readOnly={readOnly} onClose={() => setPricingLine(null)} onUpdate={(patch) => { onUpdateLine(pricingLine.id, patch); setPricingLine(line => ({...line, ...patch})); }} />}
      </div>
    </div>
  );
}

// The component a batch line's per-unit rate lives in (see batchToCartLine in api.js).
const BATCH_RATE_FIELD = { metal: 'current_metal_rate', diamond: 'diamond_value', stone: 'stone_value' };

function batchRateField(line) {
  return BATCH_RATE_FIELD[line.batch_kind] || 'other_charges';
}

function batchUnit(line) {
  return line.batch_uom_label || line.uom || '';
}

function batchTracksPcs(line) {
  return (parseInt(line.batch_available_pcs || 0, 10) || 0) > 0 || (parseInt(line.pcs || 0, 10) || 0) > 0;
}

const DASH = <span style={{ color: 'var(--text-muted)' }}>—</span>;
const batchCellStack = { display: 'grid', gap: 3, justifyItems: 'end' };

function BatchQtyCell({ line, onUpdate, readOnly }) {
  const error = batchLineError(line);
  return (
    <div style={batchCellStack}>
      <input
        id={`qty-${line.id}`}
        className="cd-input cd-num-input cd-pos-batch-input"
        type="number"
        min="0"
        step="0.001"
        title={`Qty sold (${batchUnit(line)})`}
        value={line.qty ?? ''}
        disabled={readOnly}
        onChange={(e) => onUpdate(line.id, { qty: e.target.value })}
      />
      {!readOnly && <span className="cd-pos-desc" style={{ color: 'var(--text-muted)' }}>of {fmtWeight(line.batch_available_qty)} {batchUnit(line)}</span>}
      {(parseInt(line.pcs || 0, 10) || 0) > 0 && <span className="cd-pos-desc" style={{ color: 'var(--text-muted)' }}>{line.pcs} pcs</span>}
      {!readOnly && error && <span className="cd-pos-warning" style={{ textAlign: 'right' }}>{error}</span>}
    </div>
  );
}

function BatchRateCell({ line, onUpdate, readOnly }) {
  const field = batchRateField(line);
  function change(value) {
    const patch = { [field]: value, manually_priced: true };
    if (field === 'current_metal_rate') patch.metal_value = 0;
    if (parseFloat(value || 0) > 0) patch.pricing_warning = '';
    onUpdate(line.id, patch);
  }
  return (
    <div style={batchCellStack}>
      <input
        id={`rate-${line.id}`}
        className="cd-input cd-num-input cd-pos-batch-input"
        type="number"
        min="0"
        step="0.01"
        title={`Rate per ${batchUnit(line)}`}
        value={line[field] ?? ''}
        disabled={readOnly}
        onChange={(e) => change(e.target.value)}
      />
      <span className="cd-pos-desc" style={{ color: 'var(--text-muted)' }}>₹ / {batchUnit(line)}</span>
    </div>
  );
}

function ItemCell({ line }) {
  return (
    <td className="cd-pos-item-cell">
      <div className="cd-pos-item-media">
        {line.image ? (
          <img
            src={resolveImageSrc(line.image)}
            alt=""
            className="cd-pos-thumb"
          />
        ) : (
          <div className="cd-pos-thumb cd-pos-thumb-empty">—</div>
        )}
      </div>
      <div className="cd-pos-item-copy">
        <div className="cd-pos-tag">{line.tag || line.item_code}</div>
        <div className="cd-pos-desc" title={line.item_name || line.description}>{line.item_name || line.description}</div>
        {line.set_note && <div className="cd-pos-desc" style={{ color: 'var(--pill-blue-txt)' }}>{line.set_note}</div>}
        {line.is_batch && <div className="cd-pos-desc" style={{ color: 'var(--pill-blue-txt)' }}>Batch{line.warehouse ? ` · ${line.warehouse}` : ''}</div>}
        {line.pricing_warning && (
          <div className="cd-pos-warning" title={line.pricing_warning}>
            {line.is_batch ? 'No price-list rate — enter it' : line.pricing_warning}
          </div>
        )}
      </div>
    </td>
  );
}

function PricingButton({ line, onPricing }) {
  return (
    <td className="cd-pos-remove-cell">
      <button
        type="button"
        className="cd-breakup-icon-btn"
        title="Pricing Breakup"
        onClick={() => onPricing(line)}
      >
        <svg viewBox="0 0 24 24" width="20" height="20">
          <rect x="4" y="3" width="16" height="18" rx="2" />
          <line x1="8" y1="8" x2="16" y2="8" />
          <line x1="8" y1="12" x2="16" y2="12" />
          <line x1="8" y1="16" x2="12" y2="16" />
        </svg>
      </button>
    </td>
  );
}

function RemoveButton({ line, onRemove, readOnly }) {
  return (
    <td className="cd-pos-remove-cell">
      {!readOnly && (
        <button
          type="button"
          className="cd-del-btn"
          title="Remove"
          onClick={() => onRemove(line.id)}
        >
          ×
        </button>
      )}
    </td>
  );
}

// Bill with only batch lines: Item | UOM | Qty | Rate | Amount (Pcs is in the Pricing Breakup).
function BatchRow({ line, goldRate, onUpdate, onRemove, onPricing, readOnly }) {
  const breakup = calcLineBreakup(line, goldRate);
  return (
    <tr>
      <ItemCell line={line} />
      <td className="cd-pos-weight-cell"><strong>{batchUnit(line)}</strong></td>
      <td className="cd-pos-qty-cell"><BatchQtyCell line={line} onUpdate={onUpdate} readOnly={readOnly} /></td>
      <td className="cd-pos-qty-cell"><BatchRateCell line={line} onUpdate={onUpdate} readOnly={readOnly} /></td>
      <td className="cd-pos-weight-cell"><strong>{fmtINR(breakup.lineTotal)}</strong></td>
      <PricingButton line={line} onPricing={onPricing} />
      <RemoveButton line={line} onRemove={onRemove} readOnly={readOnly} />
    </tr>
  );
}

// Full Finished Goods row. With batch lines in the bill it also has Pcs/Rate columns; on a batch
// row the cells that don't apply to its kind show "—" instead of zeros (and vice versa).
function CartRow({ line, goldRate, onUpdate, onRemove, onPricing, readOnly, showBatchCols }) {
  const breakup = calcLineBreakup(line, goldRate);
  const isBatch = Boolean(line.is_batch);
  // Batch lines hold per-unit figures (per 1 g / ct); the row shows what's actually sold.
  const q = isBatch ? parseFloat(line.qty || 1) || 1 : 1;
  const kind = line.batch_kind;
  // On a batch row a cell shows only for its own kind, or when it has a value (e.g. Making typed
  // in the Pricing Breakup).
  const applies = (cellKind, value) => !isBatch || cellKind === kind || Math.abs(value) > 0.0001;
  const amount = (cellKind, value) => (applies(cellKind, value) ? fmtINR(value * q) : DASH);

  return (
    <tr className={line.breakupOpen ? 'is-expanded' : ''}>
      <ItemCell line={line} />
      <td className="cd-pos-qty-cell">
        {isBatch ? <BatchQtyCell line={line} onUpdate={onUpdate} readOnly={readOnly} /> : <strong>1</strong>}
      </td>
      {showBatchCols && (
        <>
          <td className="cd-pos-qty-cell">{isBatch ? <BatchRateCell line={line} onUpdate={onUpdate} readOnly={readOnly} /> : DASH}</td>
        </>
      )}
      <td className="cd-pos-weight-cell">{applies('metal', 0) ? <strong>{fmtWeight(line.gross_wt * q)} g</strong> : DASH}</td>
      <td className="cd-pos-weight-cell">{applies('metal', 0) ? <strong>{fmtWeight(line.net_wt * q)} g</strong> : DASH}</td>
      <td className="cd-pos-sub-cell">{applies('metal', 0) ? line.tounch || 0 : DASH}</td>
      <td className="cd-pos-amount-cell">{amount('metal', breakup.metalValue)}</td>
      <td className="cd-pos-amount-cell">{amount('making', breakup.making)}</td>
      <td className="cd-pos-amount-cell">{amount('diamond', breakup.diamond)}</td>
      <td className="cd-pos-amount-cell">{amount('stone', breakup.stone)}</td>
      <td style={{ fontWeight: 600, textAlign: 'right' }}>
        {fmtINR(breakup.lineTotal)}
      </td>
      <PricingButton line={line} onPricing={onPricing} />
      <td className="cd-pos-sub-cell">{applies('diamond', 0) ? <span>{fmtWeight(breakup.diamondWt * q)}{line.diamond_uom ? ` ${line.diamond_uom}` : ''}</span> : DASH}</td>
      <td className="cd-pos-sub-cell">{applies('stone', 0) ? <span>{fmtWeight(breakup.stoneWt * q)}{line.stone_uom ? ` ${line.stone_uom}` : ''}</span> : DASH}</td>
      <td className="cd-pos-amount-cell">{amount('other', breakup.other)}</td>
      <RemoveButton line={line} onRemove={onRemove} readOnly={readOnly} />
    </tr>
  );
}

// ₹/% toggle + value input for one component's discount, matching the existing Bill
// Discount control's look (cd-disc-toggle / cd-num-input) so it feels like the same feature.
export function DiscountRow({ discount, onChange, disabled = false }) {
  const mode = discount?.mode || 'percent';
  const value = discount?.value ?? '';
  return (
    <div className="cd-adjustment-row" style={{ marginTop: 6 }}>
      <div className="cd-disc-toggle">
        <button type="button" disabled={disabled} className={mode === 'amount' ? 'active' : ''} onClick={() => onChange({ mode: 'amount', value })}>₹</button>
        <button type="button" disabled={disabled} className={mode === 'percent' ? 'active' : ''} onClick={() => onChange({ mode: 'percent', value })}>%</button>
      </div>
      <input
        className="cd-input cd-num-input"
        type="number"
        min="0"
        step="0.01"
        placeholder="Discount"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange({ mode, value: e.target.value })}
      />
    </div>
  );
}

function PricingPopup({ line, goldRate, onClose, onUpdate, readOnly = false }) {
  const b = calcLineBreakup(line, goldRate);
  // Editing any pricing component here recalculates the billed rate in the browser only —
  // it never writes back to the Purchase Receipt. It unsets prefer_backend_rate so
  // calcLineBreakup uses the live computed sum instead of the fixed receipt rate. Current
  // Metal Rate also clears the stored metal_value, since that otherwise short-circuits the
  // live net_wt x rate recalculation entirely.
  function updateField(key, value) {
    const patch = { [key]: value, prefer_backend_rate: false, manually_priced: true };
    if (key === 'current_metal_rate') patch.metal_value = 0;
    // Net Weight drives Metal Value (Net Wt × Rate) and Pure Weight (Net Wt × Purity) — both
    // are otherwise locked to whatever the Purchase Receipt/BOM originally stored, so they need
    // to be cleared here too or they'd keep short-circuiting to the old, now-stale figures
    // instead of recomputing off the weight the user just typed.
    if (key === 'net_wt') { patch.metal_value = 0; patch.pure_wt = 0; }
    // Margin is folded into Making Charges — once the user takes manual control of Making
    // Charges, the typed figure is the whole thing, not making + a leftover margin on top.
    if (key === 'making_charges') patch.sell_rate_percent = 0;
    onUpdate(patch);
  }
  // Same unlock rule applies to discounts — a discount on any component is a manual price
  // adjustment too, so it needs prefer_backend_rate:false to actually reach the billed rate.
  // Component discounts and Item wise Discount are mutually exclusive (see updateOverallDiscount
  // below) — applying one here zeroes out Item wise Discount to avoid double-discounting.
  function updateDiscount(discountKey, patch) {
    const nextDiscounts = { ...(line.component_discounts || {}), [discountKey]: { ...(line.component_discounts?.[discountKey] || {}), ...patch } };
    const value = patch.value ?? line.component_discounts?.[discountKey]?.value;
    onUpdate({
      component_discounts: nextDiscounts,
      ...(parseFloat(value || 0) > 0 ? { discount_value: 0 } : {}),
      prefer_backend_rate: false,
      manually_priced: true,
    });
  }
  // Item wise Discount applies to Making + Diamond + Stone + Other combined (see discountBase
  // in calcLineBreakup) — it and the individual per-component discounts above are mutually
  // exclusive, so applying a non-zero value here clears every component discount to avoid
  // double-discounting the same charges.
  const hasOverallDiscount = parseFloat(line.discount_value || 0) > 0;
  const hasComponentDiscount = Object.values(line.component_discounts || {}).some((d) => parseFloat(d?.value || 0) > 0);
  function updateOverallDiscount(patch) {
    const value = patch.value ?? line.discount_value;
    onUpdate({
      discount_mode: patch.mode ?? line.discount_mode ?? 'percent',
      discount_value: value,
      ...(parseFloat(value || 0) > 0 ? { component_discounts: {} } : {}),
      prefer_backend_rate: false,
      manually_priced: true,
    });
  }
  // Current Metal Rate is blank on the line itself until the user types an override — the
  // rate actually driving Metal Value until then is calcLineBreakup's derived rate (the
  // per-item rate the scan/BOM resolved, or the live gold rate as a last resort). Show that
  // effective rate here instead of a misleadingly blank box.
  const field = (label, key, editable = false) => {
    const displayValue = key === 'current_metal_rate' && (line[key] === '' || line[key] == null)
      ? b.currentMetalRate || ''
      : line[key];
    return <div className="cd-pricing-field"><label>{label}</label>{editable ? <input className="cd-input" type="number" min="0" step="0.01" value={readOnly && displayValue !== '' && displayValue != null ? round2(displayValue) : displayValue ?? ''} onChange={e => updateField(key, e.target.value)} /> : <strong>{key.includes('wt') ? `${fmtWeight(line[key])} g` : fmtINR(line[key] || 0)}</strong>}</div>;
  };
  const discountNote = (comp) => comp.discount > 0 && (
    <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 4 }}>
      -{fmtINR(comp.discount)} → <strong style={{ color: 'var(--text-primary)' }}>{fmtINR(comp.net)}</strong>
    </div>
  );
  // "Total Discount Applied" mirrors whichever discount type is actually active — component
  // discounts and Item wise Discount are mutually exclusive (see updateDiscount /
  // updateOverallDiscount above), so at most one of these is ever non-zero. Its % is always
  // against Making + Diamond + Stone + Other only (no Metal Value, no Handling) — the same base
  // Item wise Discount itself is computed against (discountBase in calcLineBreakup) — not the
  // item's full amount, so both discount types report a percentage on the same footing.
  const totalDiscountApplied = b.componentDiscountTotal > 0 ? b.componentDiscountTotal : b.discountAmt;
  const componentDiscountBase = round2(
    b.components.making.raw + b.components.diamond.raw + b.components.stone.raw + b.components.other.raw
  );
  const totalDiscountBase = b.componentDiscountTotal > 0 ? componentDiscountBase : b.discountBase;
  const totalDiscountPct = totalDiscountBase > 0 ? round2((totalDiscountApplied / totalDiscountBase) * 100) : 0;
  const discountField = (label, key, discountKey, wt) => (
    <div className="cd-pricing-field">
      {wt && (
        <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginBottom: 4 }}>
          <strong style={{ color: 'var(--text-muted)' }}>{wt.label}:</strong> <strong style={{ color: 'var(--text-primary)' }}>{fmtWeight(wt.value)}{wt.uom ? ` ${wt.uom}` : ''}</strong>
        </div>
      )}
      <label>{label}</label>
      <input className="cd-input" type="number" min="0" step="0.01" value={line[key] ?? ''} onChange={e => updateField(key, e.target.value)} />
      <DiscountRow discount={line.component_discounts?.[discountKey]} onChange={(patch) => updateDiscount(discountKey, patch)} disabled={hasOverallDiscount} />
      {discountNote(b.components[discountKey])}
    </div>
  );
  return <><div className="cd-idialog-overlay" onClick={onClose} role="presentation" /><div className="cd-idialog xwide" role="dialog" aria-modal="true"><div className="cd-idialog-header"><span className="cd-idialog-title">Detailed Pricing Breakup · {line.tag || line.item_code}</span><button className="cd-idialog-close" onClick={onClose}>×</button></div><div className="cd-idialog-body"><fieldset disabled={readOnly} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}><div className="cd-pricing-grid">
    {field('Gross Weight', 'gross_wt')}
    <div className="cd-pricing-field">
      {/* A batch line is priced per 1 unit of qty — its weight comes from the Qty in the cart. */}
      <label>{line.is_batch ? `Qty sold (${line.batch_uom_label || line.uom})` : 'Net Weight (g)'}</label>
      {line.is_batch
        ? <strong>{fmtWeight(line.qty)} · values below are per 1 {line.batch_uom_label || line.uom}</strong>
        : <input className="cd-input" type="number" min="0" step="0.001" value={line.net_wt ?? ''} onChange={e => updateField('net_wt', e.target.value)} />}
      <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 4 }}><strong style={{ color: 'var(--text-muted)' }}>Purity:</strong> <strong style={{ color: 'var(--text-primary)' }}>{line.tounch || '—'}</strong></div>
    </div>
    {line.is_batch && batchTracksPcs(line) && (
      <div className="cd-pricing-field">
        <label>Pcs sold (of {line.batch_available_pcs})</label>
        <input className="cd-input" type="number" min="0" step="1" value={line.pcs || ''} onChange={e => onUpdate({ pcs: e.target.value })} />
      </div>
    )}
    {field(line.metal_rate_is_touch && line.metal_touch_label ? `Current Metal Rate (${line.metal_touch_label})` : 'Current Metal Rate', 'current_metal_rate', true)}
    <div className="cd-pricing-field highlight">
      <label>Metal Value<br />(Net Wt × Rate)</label>
      <strong>{fmtINR(b.components.metal.raw)}</strong>
    </div>
    <div className="cd-pricing-field">
      <label>Making<br />Charges</label>
      <input className="cd-input" type="number" min="0" step="0.01" value={b.components.making.raw} onChange={e => updateField('making_charges', e.target.value)} />
      <DiscountRow discount={line.component_discounts?.making} onChange={(patch) => updateDiscount('making', patch)} disabled={hasOverallDiscount} />
      {discountNote(b.components.making)}
    </div>
    {discountField('Diamond Value', 'diamond_value', 'diamond', { label: 'Diamond Wt', value: b.diamondWt, uom: line.diamond_uom })}
    {discountField('Stone Value', 'stone_value', 'stone', { label: 'Stone Wt', value: b.stoneWt, uom: line.stone_uom })}
    {discountField(<>Other<br />Charges</>, 'other_charges', 'other')}
    <div className="cd-pricing-field">
      <label>Item wise Discount</label>
      <DiscountRow discount={{ mode: line.discount_mode || 'percent', value: line.discount_value }} onChange={updateOverallDiscount} disabled={hasComponentDiscount} />
      {b.discountAmt > 0 && (
        <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 4 }}>
          -{fmtINR(b.discountAmt)} → <strong style={{ color: 'var(--text-primary)' }}>{fmtINR(b.lineTotal)}</strong>
        </div>
      )}
    </div>
    <div className="cd-pricing-field total" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
      {totalDiscountApplied > 0 && (
        <div><label>Total Discount Applied</label><strong style={{ color: 'var(--pill-red-txt)' }}>-{fmtINR(totalDiscountApplied)}<span style={{ marginLeft: 6 }}>({totalDiscountPct}%)</span></strong></div>
      )}
      <div style={{ textAlign: 'right', marginLeft: 'auto' }}><label>{line.is_batch ? `Rate per ${line.batch_uom_label || line.uom}` : 'Item Rate'}</label><strong>{fmtINR(b.baseRate)}</strong></div>
    </div>
  </div></fieldset></div><div className="cd-idialog-footer"><button className="cd-btn cd-btn-primary" onClick={onClose}>{readOnly ? 'Close' : 'Apply Pricing'}</button></div></div></>;
}
