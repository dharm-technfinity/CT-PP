import { COMPANY } from '../../lib/constants.js';
import { todayISO, round2 } from '../../lib/format.js';
import { calcLineBreakup } from './posCalculations.js';

// Per-component discounts from the Pricing Breakup popup (line.component_discounts) map
// straight onto their own custom Discount/Discount Type fields on the Sales Invoice Item row
// — Metal is deliberately excluded, since that's adjusted directly via Current Metal Rate
// instead of a discount.
const DISCOUNT_FIELD_MAP = {
  making: 'custom_making_discount',
  diamond: 'custom_diamond_discount',
  stone: 'custom_stone_discount',
  other: 'custom_other_discount',
};

// Confirmed against the actual Customize Form export — the Discount Type selects use
// "Percentage" / "Rate" as their options (not "Amount").
function discountTypeLabel(mode) {
  return mode === 'percent' ? 'Percentage' : 'Rate';
}

/**
 * Build Sales Invoice payload matching project conventions (Sales Order / Purchase Invoice).
 */
export function buildSalesInvoicePayload({
  customer,
  lines,
  totals,
  goldRate,
  docstatus = 0,
  payments = [],
  paidAmount = null,
  shiftName,
  settlements = [],
  salesTeam = [],
}) {
  const postingDate = todayISO();

  const items = lines.map((line, idx) => {
    const b = calcLineBreakup(line, goldRate);
    const discPct =
      0;

    const row = {
      doctype: 'Sales Invoice Item',
      idx: idx + 1,
      item_code: line.item_code,
      item_name: line.item_name || line.item_code,
      description: line.description || line.item_name || line.item_code,
      qty: parseFloat(line.qty || 1) || 1,
      uom: line.uom || 'Nos',
      stock_uom: line.uom || 'Nos',
      conversion_factor: 1,
      rate: b.baseRate,
      base_rate: b.baseRate,
      discount_percentage: discPct,
      amount: b.lineTotal,
      base_amount: b.lineTotal,
      net_amount: b.lineTotal,
      base_net_amount: b.lineTotal,
      gst_hsn_code: line.gst_hsn_code || '',
    };


    if (line.warehouse) row.warehouse = line.warehouse;
    if (line.serial_no) {
      row.serial_no = line.serial_no;
      row.use_serial_batch_fields = 1;
    }
    if (line.batch_no) row.batch_no = line.batch_no;
    if (line.gross_wt) row.custom_gross_weight = parseFloat(line.gross_wt);
    if (line.net_wt) row.custom_net_weight = parseFloat(line.net_wt);
    if (line.tounch) row.custom_tounch = line.tounch;

    const cd = line.component_discounts || {};
    Object.entries(DISCOUNT_FIELD_MAP).forEach(([key, fieldName]) => {
      const d = cd[key];
      const value = parseFloat(d?.value || 0) || 0;
      if (value > 0) {
        row[fieldName] = value;
        row[`${fieldName}_type`] = discountTypeLabel(d.mode);
      }
    });

    return row;
  });

  const paymentRows = payments.map((p, idx) => ({
    doctype: 'Sales Invoice Payment',
    idx: idx + 1,
    mode_of_payment: p.mode_of_payment,
    amount: round2(p.amount),
    base_amount: round2(p.amount),
    ...(p.reference_no ? { reference_no: p.reference_no } : {}),
  }));

  const branch = localStorage.getItem('cd_branch') || '';
  // Every discount that reduces Net Total has to be folded into ERPNext's ONE real
  // discount_amount field, or it never actually affects Grand Total — custom_making_discount
  // etc. (parentDiscountFields below) are informational-only fields with no calculation hook
  // behind them; writing a value there does nothing to the invoice's real totals. This combines
  // the manual bill discount, a redeemed scheme's blanket bonus, AND every component discount
  // (Making/Diamond/Stone/Other — see totals.componentBreakdown in posCalculations.js) into one
  // flat amount, matching what the POS screen actually showed the cashier.
  const combinedDiscount = round2(
    (totals.billDiscount || 0) + (totals.schemeBonusAmount || 0) + (totals.componentDiscountTotal || 0),
  );
  const billDiscountFields =
    combinedDiscount > 0
      ? {
          apply_discount_on: 'Net Total',
          discount_amount: combinedDiscount,
          base_discount_amount: combinedDiscount,
        }
      : {};

  // Scheme redemption's real advance — already-received money sitting unallocated on a
  // Payment Entry (see enrichSchemeAssignmentWithRedeemableValue in api.js) — is allocated
  // against this invoice via ERPNext's native Sales Invoice Advance table. This never touches
  // taxable value/GST, unlike the bonus discount above, because real money already changed
  // hands for it.
  const advances = settlements
    .flatMap((s) => s.advanceAllocations || [])
    .filter((a) => a.paymentEntry && a.amount > 0)
    .map((a, idx) => ({
      doctype: 'Sales Invoice Advance',
      idx: idx + 1,
      reference_type: 'Payment Entry',
      reference_name: a.paymentEntry,
      advance_amount: round2(a.amount),
      allocated_amount: round2(a.amount),
    }));
  const totalAdvance = round2(advances.reduce((s, a) => s + a.allocated_amount, 0));
  // paidAmount is explicitly passed (even as 0) by the real payment-confirmation flow, so a
  // fully advance-covered bill with zero new cash must NOT fall back to grandTotal — that
  // fallback only exists for the draft-save call site, which never passes paidAmount at all.
  const resolvedPaidAmount =
    paidAmount != null ? round2(paidAmount) : round2(Math.max(0, totals.grandTotal - totalAdvance));

  // Same Making/Diamond/Stone/Other Discount + Discount Type fields as the item row, but at
  // the parent level. totals.componentBreakdown already combines the cashier's own manual
  // bill-level discount with every redeemed scheme's own percentage on that component (see
  // applyComponentDiscounts in posCalculations.js) — always sent as a flat amount here since
  // multiple percent/amount sources can't be expressed as one percentage. Metal excluded here
  // too — adjusted via Current Metal Rate instead.
  const parentDiscountFields = {};
  Object.entries(DISCOUNT_FIELD_MAP).forEach(([key, fieldName]) => {
    const amount = round2(totals.componentBreakdown?.[key]?.discount || 0);
    if (amount > 0) {
      parentDiscountFields[fieldName] = amount;
      parentDiscountFields[`${fieldName}_type`] = 'Rate';
    }
  });

  return {
    doctype: 'Sales Invoice',
    docstatus,
    company: COMPANY,
    customer: customer.name,
    customer_name: customer.customer_name || customer.name,
    posting_date: postingDate,
    due_date: postingDate,
    is_pos: 1,
    update_stock: 1,
    currency: 'INR',
    ...(branch ? { branch } : {}),
    ...(shiftName ? { custom_pos_shift: shiftName } : {}),
    ...(salesTeam.length ? {
      sales_team: salesTeam.map((r) => ({
        doctype: 'Sales Team',
        sales_person: r.salesPerson,
        allocated_percentage: round2(Number(r.percentage) || 0),
        allocated_amount: round2(((Number(r.percentage) || 0) / 100) * totals.grandTotal),
      })),
    } : {}),
    ...billDiscountFields,
    ...parentDiscountFields,
    items,
    taxes: totals.taxes || [],
    payments: paymentRows,
    ...(advances.length ? { advances } : {}),
    paid_amount: resolvedPaidAmount,
    base_paid_amount: resolvedPaidAmount,
    outstanding_amount: 0,
  };
}

export function getInvoiceName(res) {
  return res?.data?.name || res?.message?.name || res?.name || null;
}
