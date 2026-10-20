import { COMPANY } from '../../lib/constants.js';
import { todayISO, round2 } from '../../lib/format.js';
import { calcLineBreakup, newCartLine } from './posCalculations.js';

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
  // customer_address / company_address / place_of_supply … that the bill's taxes were picked for
  // (fetchGstSplitForCustomer in api.js) — sent so India Compliance checks GST against the same ones.
  gstAddressFields = {},
  includeSettlementReferences = false,
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
    if (line.is_batch) {
      row.use_serial_batch_fields = 1;
      const pcs = parseInt(line.pcs || 0, 10) || 0;
      if (pcs > 0) row.custom_pcs = pcs;
    }
    // A metal batch line holds its weight per 1 g of qty — the row records the grams sold.
    const wtQty = line.is_batch ? row.qty : 1;
    if (line.gross_wt) row.custom_gross_weight = parseFloat(line.gross_wt) * wtQty;
    if (line.net_wt) row.custom_net_weight = parseFloat(line.net_wt) * wtQty;
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
  // Payment Entry (see enrichSchemeAssignmentWithRedeemableValue in api.js) — and a Gold
  // Purchase's customer credit on its Common Party Journal Entry (see
  // fetchGoldPurchaseCreditRows) are allocated against this invoice via ERPNext's native
  // Sales Invoice Advance table. This never touches taxable value/GST, unlike the bonus
  // discount above, because real value already changed hands for it.
  const advances = settlements
    .flatMap((s) => s.advanceAllocations || [])
    .filter((a) => (a.referenceName || a.paymentEntry) && a.amount > 0)
    .map((a, idx) => ({
      doctype: 'Sales Invoice Advance',
      idx: idx + 1,
      reference_type: a.referenceType || 'Payment Entry',
      reference_name: a.referenceName || a.paymentEntry,
      ...(a.referenceRow ? { reference_row: a.referenceRow } : {}),
      // advanceAmount: the Journal Entry row's whole unallocated credit when only part of it is
      // used (partial Gold Purchase / Sales Return) — ERPNext checks it against the row as-is.
      advance_amount: round2(a.advanceAmount ?? a.amount),
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
    ...gstAddressFields,
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
    // Always sent (even empty) once the field exists, so a settlement removed from a reopened
    // draft is removed from the saved invoice too.
    ...(includeSettlementReferences ? { custom_settlement_references: settlementReferenceRows(settlements) } : {}),
    paid_amount: resolvedPaidAmount,
    base_paid_amount: resolvedPaidAmount,
    outstanding_amount: 0,
  };
}

const SETTLEMENT_REFERENCE_TYPES = {
  gold: { settlement_type: 'Gold Purchase', reference_doctype: 'Purchase Invoice' },
  kitty: { settlement_type: 'Jewellery Scheme', reference_doctype: 'Jewellery Scheme Assignment' },
  return: { settlement_type: 'Sales Return', reference_doctype: 'Sales Invoice' },
};

// One Settlement References row per settlement on the bill, so the Sales Invoice itself records
// which Gold Purchase / Jewellery Scheme / Sales Return settled it.
function settlementReferenceRows(settlements) {
  return settlements
    .filter((s) => SETTLEMENT_REFERENCE_TYPES[s.type] && s.number)
    .map((s, idx) => ({
      doctype: 'Sales Invoice Settlement Reference',
      idx: idx + 1,
      ...SETTLEMENT_REFERENCE_TYPES[s.type],
      reference_name: s.number,
      amount: round2(s.amount),
      bonus_amount: round2(s.bonusAmount),
      ...(s.scheme ? { scheme: s.scheme } : {}),
    }));
}

const SETTLEMENT_TYPE_BY_LABEL = Object.fromEntries(
  Object.entries(SETTLEMENT_REFERENCE_TYPES).map(([type, { settlement_type }]) => [settlement_type, type]),
);

// Spreads `amount` over a Gold Purchase's / Sales Return's Journal Entry credit rows (from
// fetchSettlementAvailableCredit in api.js), oldest first — one Advances allocation per row used.
// Each keeps its row's full credit as advanceAmount, since only part of it may be allocated.
export function allocateCredit(rows, amount) {
  let left = round2(amount);
  const allocations = [];
  for (const row of rows) {
    if (left <= 0) break;
    const part = round2(Math.min(row.amount, left));
    allocations.push({ ...row, advanceAmount: row.amount, amount: part });
    left = round2(left - part);
  }
  return allocations;
}

// A Gold Purchase / Sales Return on the bill: `amount` is what this bill uses, `creditTotal` what
// was available when it was added (shown as "of ₹…" when only part of it is used). Without credit
// rows (a Gold Purchase with no Common Party Journal Entry) it just lowers what's collected.
// postingDate: the Purchase Invoice's / Credit Note's own date, shown next to its number.
export function creditSettlementEntry(type, number, customer, rows, amount, creditTotal, postingDate) {
  return {
    type,
    number,
    customer,
    ...(postingDate ? { posting_date: postingDate } : {}),
    amount: round2(amount),
    creditTotal: round2(creditTotal ?? amount),
    bonusAmount: 0,
    advanceAllocations: rows.length ? allocateCredit(rows, amount) : [],
    componentDiscounts: {},
  };
}

// Reverse of settlementReferenceRows — rebuilds the bill's settlements from a saved invoice.
//  - A scheme's bonus was folded into discount_amount when the bill was saved, so it's taken
//    back out of the bill discount by invoiceToCartState and re-applied here, keeping totals
//    identical. Its Making % etc. stay inside the bill-level component discounts (where they
//    were saved), so componentDiscounts is left empty to avoid applying them twice.
//  - Advances: each Gold Purchase / Sales Return gets its Journal Entry credit back, for the same
//    (possibly partial) amount the bill saved; the scheme Payment Entries can't be told apart per
//    scheme from the saved invoice, so they all ride on the first scheme settlement — the total
//    allocated is unchanged.
//  - getGoldCredit / getReturnCredit(name, customer) return the credit rows (api.js) so this file
//    stays free of network calls. A cancelled Gold Purchase, or a Sales Return whose credit is
//    gone (throws), is dropped; one with less credit left than saved is cut down — both reported
//    in `warnings`.
//  - getSchemeNames(codes) turns each scheme's saved code back into its name for display, and
//    getPostingDates(doctype, names) gives Gold Purchases / Sales Returns their dates back.
export async function settlementsFromInvoice(doc, { getGoldPurchase, getGoldCredit, getReturnCredit, getSchemeNames, getPostingDates } = {}) {
  const customer = { name: doc.customer, customer_name: doc.customer_name };
  const settlements = [];
  const warnings = [];
  let schemeAdvancesAssigned = false;
  for (const ref of doc.custom_settlement_references || []) {
    const type = SETTLEMENT_TYPE_BY_LABEL[ref.settlement_type];
    if (!type || !ref.reference_name) continue;
    const savedAmount = parseFloat(ref.amount || 0) || 0;
    if (type === 'gold' || type === 'return') {
      let rows = [];
      if (type === 'gold') {
        const pi = getGoldPurchase ? await getGoldPurchase(ref.reference_name).catch(() => null) : null;
        if (pi && Number(pi.docstatus) === 2) {
          warnings.push(`Gold Purchase ${ref.reference_name} is cancelled and was left off this bill`);
          continue;
        }
        rows = getGoldCredit ? await getGoldCredit(ref.reference_name, doc.customer) : [];
      } else if (getReturnCredit) {
        try {
          rows = await getReturnCredit(ref.reference_name, doc.customer);
        } catch (e) {
          warnings.push(`Sales Return ${ref.reference_name} was left off this bill: ${e.message}`);
          continue;
        }
      }
      const credit = round2(rows.reduce((s, r) => s + r.amount, 0));
      let amount = savedAmount;
      if (rows.length && credit < savedAmount) {
        amount = credit;
        warnings.push(`${ref.reference_name} has only ${credit} credit left — reduced from ${savedAmount}`);
      }
      settlements.push(creditSettlementEntry(type, ref.reference_name, customer, rows, amount, rows.length ? credit : amount));
      continue;
    }
    const entry = {
      type,
      number: ref.reference_name,
      customer,
      amount: savedAmount,
      bonusAmount: parseFloat(ref.bonus_amount || 0) || 0,
      advanceAllocations: [],
      componentDiscounts: {},
      ...(ref.scheme ? { scheme: ref.scheme, scheme_name: ref.scheme } : {}),
    };
    if (type === 'kitty' && !schemeAdvancesAssigned) {
      entry.advanceAllocations = (doc.advances || [])
        .filter((a) => a.reference_type === 'Payment Entry' && a.reference_name)
        .map((a) => ({ paymentEntry: a.reference_name, amount: parseFloat(a.allocated_amount || 0) || 0 }));
      schemeAdvancesAssigned = true;
    }
    settlements.push(entry);
  }
  if (getPostingDates) {
    for (const [type, doctype] of [['gold', 'Purchase Invoice'], ['return', 'Sales Invoice']]) {
      const entries = settlements.filter((s) => s.type === type);
      if (!entries.length) continue;
      const dates = await getPostingDates(doctype, entries.map((s) => s.number));
      entries.forEach((s) => { if (dates.get(s.number)) s.posting_date = dates.get(s.number); });
    }
  }
  if (getSchemeNames) {
    const kitty = settlements.filter((s) => s.type === 'kitty');
    const names = kitty.length ? await getSchemeNames(kitty.map((s) => s.scheme)) : new Map();
    kitty.forEach((s) => { s.scheme_name = names.get(s.scheme) || s.scheme_name; });
  }
  return { settlements, warnings };
}

function discountFromFields(source, fieldName) {
  const value = parseFloat(source?.[fieldName] || 0) || 0;
  if (!(value > 0)) return null;
  return { mode: source[`${fieldName}_type`] === 'Percentage' ? 'percent' : 'amount', value };
}

// A Sales Invoice row only keeps the billed rate — the Metal/Making/Diamond/Stone split and the
// metal rate used at billing time aren't stored anywhere. To show a submitted invoice's
// breakup, the piece's own receipt/BOM components (weights, making, diamond, stone, other) are
// taken as-is and the metal rate is worked back out so the row totals exactly what was billed.
// Falls back to just pinning the billed rate if even a zero metal value would overshoot it
// (e.g. diamond prices have risen since the sale).
export function matchLineToBilledRate(line, billedRate) {
  const target = parseFloat(billedRate || 0) || 0;
  const pinned = { ...line, rate: target, backend_rate: target, prefer_backend_rate: true, sell_rate_percent: 0 };
  if (!(target > 0)) return pinned;
  const netWt = parseFloat(line.net_wt || 0) || 0;
  const base = { ...line, prefer_backend_rate: false, metal_value: 0 };
  // Solve on the metal rate when there's a net weight (so Net Wt x Rate reads correctly in the
  // breakup popup), otherwise directly on Metal Value.
  const withValue = (v) => (netWt > 0 ? { ...base, current_metal_rate: v } : { ...base, metal_value: v });
  const rateAt = (v) => calcLineBreakup(withValue(v), 0).baseRate;
  const min = netWt > 0 ? 0.0001 : 0;
  if (rateAt(min) > target + 0.01) return pinned;
  let lo = min;
  let hi = netWt > 0 ? target / netWt + 1 : target;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (rateAt(mid) < target) lo = mid;
    else hi = mid;
  }
  // Left unrounded: rounding the rate even to 4 dp can leave the total a paisa off the bill.
  const line2 = withValue(hi);
  return Math.abs(calcLineBreakup(line2, 0).baseRate - target) <= 0.05 ? line2 : pinned;
}

/**
 * Reverse of buildSalesInvoicePayload — turns a saved Sales Invoice back into POS cart state so
 * it can be reopened from the Sales Invoice list. Serialized rows are re-scanned via
 * lookupByTag so they get the same pricing breakup a fresh scan would; anything that can't be
 * re-scanned falls back to the rate saved on the invoice row.
 *  - Draft: re-priced at today's rates, exactly like a fresh scan.
 *  - submitted: true — the serials are already Delivered, so they're looked up with
 *    allowDelivered for their weights/components only, and each line is pinned to the rate
 *    actually billed (matchLineToBilledRate).
 */
export async function invoiceToCartState(doc, lookupByTag, { submitted = false } = {}) {
  const warnings = [];

  // Every row's lookups run at once (each is several API calls); rows keep the invoice's order.
  const rowLines = await Promise.all((doc.items || []).map(async (it) => {
    const componentDiscounts = {};
    Object.entries(DISCOUNT_FIELD_MAP).forEach(([key, fieldName]) => {
      const d = discountFromFields(it, fieldName);
      if (d) componentDiscounts[key] = d;
    });
    const serials = String(it.serial_no || '').split('\n').map((s) => s.trim()).filter(Boolean);

    if (serials.length) {
      return Promise.all(serials.map(async (serial) => {
        let scanned = null;
        if (lookupByTag) {
          try {
            scanned = await lookupByTag(serial, { allowDelivered: submitted });
          } catch (e) {
            warnings.push(`${serial}: ${e.message}`);
          }
        }
        if (scanned) {
          const line = newCartLine({ ...scanned, qty: 1, component_discounts: componentDiscounts });
          return submitted ? { ...matchLineToBilledRate(line, it.rate), pricing_warning: '' } : line;
        }
        return savedRowToLine(it, { qty: 1, serial_no: serial, tag: serial });
      }));
    }
    if (it.batch_no) return [await batchRowToLine(it, lookupByTag, { submitted, componentDiscounts, warnings })];
    return [savedRowToLine(it)];
  }));
  const lines = rowLines.flat();

  // Parent-level custom_*_discount fields hold the bill-level component discounts (always as a
  // flat Rate); discount_amount is those plus the overall bill discount folded together, so the
  // overall bill discount is whatever remains after taking the component ones back out.
  const billComponentDiscounts = {};
  let componentTotal = 0;
  Object.entries(DISCOUNT_FIELD_MAP).forEach(([key, fieldName]) => {
    const d = discountFromFields(doc, fieldName);
    if (d) {
      billComponentDiscounts[key] = { mode: 'amount', value: d.value };
      componentTotal += d.value;
    }
  });
  // A redeemed scheme's bonus was folded into discount_amount too — it's re-applied through its
  // restored settlement instead (see settlementsFromInvoice), so it's taken back out here.
  const schemeBonusTotal = (doc.custom_settlement_references || [])
    .filter((r) => r.settlement_type === 'Jewellery Scheme')
    .reduce((s, r) => s + (parseFloat(r.bonus_amount || 0) || 0), 0);
  const billDiscountValue = round2((parseFloat(doc.discount_amount || 0) || 0) - componentTotal - schemeBonusTotal);

  return {
    snapshot: {
      lines,
      draftInvoiceName: doc.name,
      billDiscount: { mode: 'amount', value: billDiscountValue > 0 ? String(billDiscountValue) : '' },
      billComponentDiscounts,
    },
    salesTeam: (doc.sales_team || []).map((r) => ({
      salesPerson: r.sales_person,
      percentage: Number(r.allocated_percentage) || 0,
    })),
    warnings,
  };
}

// A saved batch row back into a batch line. Draft: re-scanned like a fresh scan (today's rate,
// stock left) with the saved Qty/Pcs/warehouse — a rate the cashier had typed in is kept when
// the price list still has none. Submitted: shown at the billed rate, weights per 1 unit of qty.
async function batchRowToLine(it, lookupByTag, { submitted, componentDiscounts, warnings }) {
  const qty = parseFloat(it.qty || 1) || 1;
  const pcs = parseInt(it.custom_pcs || 0, 10) || 0;
  if (!submitted && lookupByTag) {
    try {
      const scanned = await lookupByTag(it.batch_no);
      if (scanned?.is_batch) {
        const option = (scanned.batch_warehouse_options || []).find((o) => o.warehouse === it.warehouse);
        const savedRate = parseFloat(it.rate || 0) || 0;
        const rateField = { metal: 'current_metal_rate', diamond: 'diamond_value', stone: 'stone_value' }[scanned.batch_kind] || 'other_charges';
        const keepRate = scanned.pricing_warning && savedRate > 0
          ? { [rateField]: savedRate, pricing_warning: '', ...(scanned.batch_kind === 'metal' ? { metal_value: 0 } : {}) }
          : {};
        return newCartLine({
          ...scanned,
          ...keepRate,
          ...(option ? { warehouse: option.warehouse, batch_available_qty: option.qty } : {}),
          batch_warehouse_options: null,
          qty,
          pcs,
          component_discounts: componentDiscounts,
        });
      }
    } catch (e) {
      warnings.push(`${it.batch_no}: ${e.message}`);
    }
  }
  const perUnit = (v) => (parseFloat(v || 0) || 0) / qty;
  return savedRowToLine(it, {
    tag: it.batch_no,
    is_batch: true,
    pcs,
    gross_wt: perUnit(it.custom_gross_weight),
    net_wt: perUnit(it.custom_net_weight),
    batch_available_qty: qty,
  });
}

// The saved rate already has that row's component discounts baked in, so it's billed as-is
// (prefer_backend_rate) rather than re-applying them.
function savedRowToLine(it, extra = {}) {
  const rate = parseFloat(it.rate || 0) || 0;
  return newCartLine({
    item_code: it.item_code,
    item_name: it.item_name || it.item_code,
    description: it.description || it.item_name || it.item_code,
    tag: it.item_code,
    qty: parseFloat(it.qty || 1) || 1,
    uom: it.uom || 'Nos',
    rate,
    backend_rate: rate,
    prefer_backend_rate: true,
    gross_wt: parseFloat(it.custom_gross_weight || 0) || 0,
    net_wt: parseFloat(it.custom_net_weight || 0) || 0,
    tounch: it.custom_tounch || '',
    gst_hsn_code: it.gst_hsn_code || '',
    warehouse: it.warehouse || '',
    batch_no: it.batch_no || '',
    rate_source: 'sales_invoice',
    ...extra,
  });
}

export function getInvoiceName(res) {
  return res?.data?.name || res?.message?.name || res?.name || null;
}
