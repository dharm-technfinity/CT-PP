import { useRef, useEffect, useState } from 'react';
import { fmtINR, fmtWeight, round2 } from '../../lib/format.js';
import { calcLineBreakup } from './posCalculations.js';

function resolveImageSrc(image) {
  if (!image) return '';
  if (image.startsWith('http')) return image;
  return image;
}

export default function CartGrid({
  lines,
  goldRate,
  totals,
  billDiscount,
  settlements = [],
  onScan,
  scanning,
  onUpdateLine,
  onRemoveLine,
  onBillDiscountChange,
  onRemoveSettlement,
}) {
  const schemeCreditApplied = round2(settlements.reduce((s, x) => s + (Number(x.amount) || 0), 0));
  const balancePayable = round2(Math.max(0, totals.grandTotal - schemeCreditApplied));
  const scanRef = useRef(null);
  const [pricingLine, setPricingLine] = useState(null);

  useEffect(() => {
    scanRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!scanning) scanRef.current?.focus();
  }, [scanning, lines.length]);

  function handleScanKey(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      const val = e.target.value;
      e.target.value = '';
      onScan(val);
    }
  }

  return (
    <div className="cd-pos-main">
      <div className="cd-scan-bar">
        <div className="cd-scan-input-wrap">
          <svg viewBox="0 0 24 24">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <line x1="7" y1="8" x2="17" y2="8" />
            <line x1="7" y1="12" x2="17" y2="12" />
            <line x1="7" y1="16" x2="13" y2="16" />
          </svg>
          <input
            ref={scanRef}
            className="cd-input cd-scan-input"
            placeholder="Scan tag / barcode (Enter to add)"
            autoComplete="off"
            disabled={scanning}
            onKeyDown={handleScanKey}
          />
        </div>
        {scanning && (
          <span className="cd-spinner" aria-label="Scanning" />
        )}
      </div>

      <div className="cd-cart-wrap">
        {lines.length === 0 ? (
          <div className="cd-spinner-wrap">Scan a tag to begin billing</div>
        ) : (
          <table className="cd-pos-table">
            <thead>
              <tr>
                <th style={{ width: 250 }}>Item</th>
                <th style={{ width: 60, textAlign: 'right' }}>Qty</th>
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
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="cd-pos-adjustments">
        <div className="cd-adjustment-control">
          <label className="cd-label">Bill Discount</label>
          <div className="cd-adjustment-row">
            <div className="cd-disc-toggle">
              <button
                type="button"
                className={billDiscount.mode === 'amount' ? 'active' : ''}
                onClick={() => onBillDiscountChange({ mode: 'amount' })}
              >
                ₹
              </button>
              <button
                type="button"
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
                <span>{s.number}</span>
                <strong>-{fmtINR(s.amount)}</strong>
                {onRemoveSettlement && (
                  <button
                    type="button"
                    className="cd-settled-scheme-remove"
                    onClick={() => onRemoveSettlement(s.number)}
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
          <span>{fmtWeight(totals.totalGrossWeight)} g</span>
        </div>
        <div className="cd-summary-item">
          <label>Net Wt</label>
          <span>{fmtWeight(totals.totalNetWeight)} g</span>
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
      {pricingLine && <PricingPopup line={pricingLine} goldRate={goldRate} onClose={() => setPricingLine(null)} onUpdate={(patch) => { onUpdateLine(pricingLine.id, patch); setPricingLine(line => ({...line, ...patch})); }} />}
      </div>
    </div>
  );
}

function CartRow({ line, goldRate, onRemove, onPricing }) {
  const breakup = calcLineBreakup(line, goldRate);

  return (
    <tr className={line.breakupOpen ? 'is-expanded' : ''}>
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
          <div className="cd-pos-desc">{line.item_name || line.description}</div>
          {line.pricing_warning && (
            <div className="cd-pos-warning">
              {line.pricing_warning}
            </div>
          )}
        </div>
      </td>
      <td className="cd-pos-qty-cell"><strong>1</strong></td>
      <td className="cd-pos-weight-cell"><strong>{fmtWeight(line.gross_wt)} g</strong></td>
      <td className="cd-pos-weight-cell"><strong>{fmtWeight(line.net_wt)} g</strong></td>
      <td className="cd-pos-sub-cell">{line.tounch || 0}</td>
      <td className="cd-pos-amount-cell">{fmtINR(breakup.metalValue)}</td>
      <td className="cd-pos-amount-cell">{fmtINR(breakup.making)}</td>
      <td className="cd-pos-amount-cell">{fmtINR(breakup.diamond)}</td>
      <td className="cd-pos-amount-cell">{fmtINR(breakup.stone)}</td>
      <td style={{ fontWeight: 600, textAlign: 'right' }}>
        {fmtINR(breakup.lineTotal)}
      </td>
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
      <td className="cd-pos-sub-cell"><span>{fmtWeight(breakup.diamondWt)}{line.diamond_uom ? ` ${line.diamond_uom}` : ''}</span></td>
      <td className="cd-pos-sub-cell"><span>{fmtWeight(breakup.stoneWt)}{line.stone_uom ? ` ${line.stone_uom}` : ''}</span></td>
      <td className="cd-pos-amount-cell">{fmtINR(breakup.other)}</td>
      <td className="cd-pos-remove-cell">
        <button
          type="button"
          className="cd-del-btn"
          title="Remove"
          onClick={() => onRemove(line.id)}
        >
          ×
        </button>
      </td>
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

function PricingPopup({ line, goldRate, onClose, onUpdate }) {
  const b = calcLineBreakup(line, goldRate);
  // Editing any pricing component here recalculates the billed rate in the browser only —
  // it never writes back to the Purchase Receipt. It unsets prefer_backend_rate so
  // calcLineBreakup uses the live computed sum instead of the fixed receipt rate. Current
  // Metal Rate also clears the stored metal_value, since that otherwise short-circuits the
  // live net_wt x rate recalculation entirely.
  function updateField(key, value) {
    const patch = { [key]: value, prefer_backend_rate: false, manually_priced: true };
    if (key === 'current_metal_rate') patch.metal_value = 0;
    // Margin is folded into Making Charges — once the user takes manual control of Making
    // Charges, the typed figure is the whole thing, not making + a leftover margin on top.
    if (key === 'making_charges') patch.margin = 0;
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
    return <div className="cd-pricing-field"><label>{label}</label>{editable ? <input className="cd-input" type="number" min="0" step="0.01" value={displayValue ?? ''} onChange={e => updateField(key, e.target.value)} /> : <strong>{key.includes('wt') ? `${fmtWeight(line[key])} g` : fmtINR(line[key] || 0)}</strong>}</div>;
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
  return <><div className="cd-idialog-overlay" onClick={onClose} role="presentation" /><div className="cd-idialog xwide" role="dialog" aria-modal="true"><div className="cd-idialog-header"><span className="cd-idialog-title">Detailed Pricing Breakup · {line.tag || line.item_code}</span><button className="cd-idialog-close" onClick={onClose}>×</button></div><div className="cd-idialog-body"><div className="cd-pricing-grid">
    {field('Gross Weight', 'gross_wt')}
    <div className="cd-pricing-field">
      <label>Net Weight</label>
      <strong>{fmtWeight(line.net_wt)} g</strong>
      <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 4 }}><strong style={{ color: 'var(--text-muted)' }}>Purity:</strong> <strong style={{ color: 'var(--text-primary)' }}>{line.tounch || '—'}</strong></div>
    </div>
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
      <div style={{ textAlign: 'right', marginLeft: 'auto' }}><label>Item Rate</label><strong>{fmtINR(b.baseRate)}</strong></div>
    </div>
  </div></div><div className="cd-idialog-footer"><button className="cd-btn cd-btn-primary" onClick={onClose}>Apply Pricing</button></div></div></>;
}
