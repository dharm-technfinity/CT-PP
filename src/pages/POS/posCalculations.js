import { round2 } from '../../lib/format.js';

// Splits 100% evenly across however many Sales Team rows exist, last row absorbing the
// rounding remainder so the total always reads exactly 100 rather than e.g. 33.3×3 = 99.9.
export function redistributeSalesTeam(rows) {
  const n = rows.length;
  if (!n) return rows;
  const even = round2(100 / n);
  return rows.map((r, i) => ({ ...r, percentage: i === n - 1 ? round2(100 - even * (n - 1)) : even }));
}

function purityFraction(value) {
  const purity = parseFloat(value || 0);
  if (!purity) return 0;
  return purity > 100 ? purity / 1000 : purity / 100;
}

// Applies a per-component discount (₹ flat amount or %) to one raw pricing figure.
// Clamped to [0, raw] so a discount can never push a component negative or exceed it.
export function applyComponentDiscount(raw, discount) {
  const value = parseFloat(discount?.value || 0) || 0;
  if (value <= 0) return { raw, discount: 0, net: raw };
  const discountAmt =
    discount.mode === 'percent' ? round2((raw * value) / 100) : value;
  const clamped = Math.min(Math.max(discountAmt, 0), raw);
  return { raw, discount: round2(clamped), net: round2(raw - clamped) };
}

// Combines several discounts on the same component (e.g. a manual bill discount plus one or
// more redeemed schemes' own percentage) — each is resolved against the same original raw
// value independently, then the rupee results are added together. That matches how a scheme's
// "25% off Making" is actually defined (25% of the real charge), rather than compounding
// discounts sequentially on top of each other, which would silently understate the total.
export function applyComponentDiscounts(raw, discounts = []) {
  const total = discounts.reduce((sum, d) => {
    const value = parseFloat(d?.value || 0) || 0;
    if (value <= 0) return sum;
    const amt = d.mode === 'percent' ? (raw * value) / 100 : value;
    return sum + Math.max(0, amt);
  }, 0);
  const clamped = round2(Math.min(Math.max(total, 0), raw));
  return { raw, discount: clamped, net: round2(raw - clamped) };
}

export function calcLineBreakup(line, goldRate) {
  const netWt = parseFloat(line.net_wt || 0);
  const currentMetalRate = parseFloat(line.current_metal_rate || 0) || goldRate;
  const purity = purityFraction(line.tounch);
  const pureWt = parseFloat(line.pure_wt || 0) || round2(netWt * (purity || 1));
  // Every metal rate now comes from Metal Price List keyed by the item's own touch (e.g. the
  // 22KT row) — it's already purity-specific, so Metal Value is a plain Net Wt × Rate with no
  // separate purity scaling on top.
  const metalValueRaw = parseFloat(line.metal_value || 0) || round2(netWt * currentMetalRate);
  // Margin (Serial No's sell-rate markup) is folded into Making Charges — treated as the
  // same component rather than shown/discounted as its own line item.
  const makingRaw = parseFloat(line.making_charges || 0) + parseFloat(line.margin || 0);
  const diamondRaw = parseFloat(line.diamond_value || 0);
  const stoneRaw = parseFloat(line.stone_value || 0);
  const diamondWt = parseFloat(line.diamond_wt || 0);
  const stoneWt = parseFloat(line.stone_wt || 0);
  const handlingRaw = parseFloat(line.handling_charges || 0);
  const otherRaw = parseFloat(line.other_charges || 0);

  const cd = line.component_discounts || {};
  const components = {
    metal: applyComponentDiscount(metalValueRaw, cd.metal),
    making: applyComponentDiscount(makingRaw, cd.making),
    diamond: applyComponentDiscount(diamondRaw, cd.diamond),
    stone: applyComponentDiscount(stoneRaw, cd.stone),
    handling: applyComponentDiscount(handlingRaw, cd.handling),
    other: applyComponentDiscount(otherRaw, cd.other),
  };
  const metalValue = components.metal.net;
  const making = components.making.net;
  const diamond = components.diamond.net;
  const stone = components.stone.net;
  const handling = components.handling.net;
  const other = components.other.net;
  const componentDiscountTotal = round2(
    Object.values(components).reduce((s, c) => s + c.discount, 0),
  );
  const computedRate = round2(metalValue + making + diamond + stone + handling + other);
  const backendRate = parseFloat(line.rate || line.backend_rate || 0);
  // An explicit `false` means the user manually edited a pricing field in the Pricing
  // Breakup popup — that always wins, even for a receipt-sourced line that would otherwise
  // default to preferring its locked backend rate. This only affects what's calculated and
  // billed in the browser; it never writes anything back to the Purchase Receipt itself.
  const preferBackendRate =
    line.prefer_backend_rate === false
      ? false
      : line.prefer_backend_rate || line.rate_source === 'purchase_receipt';
  const baseRate =
    preferBackendRate && backendRate > 0
      ? round2(backendRate)
      : computedRate > 0
        ? computedRate
        : round2(backendRate);
  const qty = parseFloat(line.qty || 1) || 1;
  const subtotal = round2(baseRate * qty);
  // Item wise Discount is computed against Making + Diamond + Stone + Other only — Metal Value
  // is excluded from the base (it's still billed in full), matching how this discount is meant
  // to eat into charges/stone-diamond value, not the metal itself.
  const discountBase = round2((making + diamond + stone + other) * qty);
  const discountAmt =
    line.discount_mode === 'amount'
      ? parseFloat(line.discount_value || 0)
      : round2((discountBase * (parseFloat(line.discount_value || 0) || 0)) / 100);

  const lineTotal = round2(Math.max(0, subtotal - discountAmt));

  return {
    metalValue,
    pureWt,
    making,
    diamond,
    diamondWt,
    stone,
    stoneWt,
    handling,
    currentMetalRate,
    other,
    components,
    componentDiscountTotal,
    computedRate,
    backendRate,
    baseRate,
    subtotal,
    discountBase,
    discountAmt,
    lineTotal,
  };
}

// Same component keys calcLineBreakup breaks a single line into (Metal/Making/Diamond/
// Stone/Handling/Other — Margin is folded into Making), summed across every line in the
// cart, then each netted against its own bill-level discount — mirrors the per-line Pricing
// Breakup popup's per-component discount, just applied to the whole bill's totals instead of
// one item.
export function calcCartTotals(lines, goldRate, billDiscount = {}, gstSplit = [], billComponentDiscounts = {}, schemeBonusAmount = 0, schemeComponentDiscounts = []) {
  let totalQty = 0;
  let totalGrossWeight = 0;
  let totalNetWeight = 0;
  let totalPureWeight = 0;
  let subtotal = 0;
  let lineDiscount = 0;
  const rawComponents = { metal: 0, making: 0, diamond: 0, stone: 0, handling: 0, other: 0 };

  lines.forEach((line) => {
    const b = calcLineBreakup(line, goldRate);
    const qty = parseFloat(line.qty || 1) || 1;
    totalQty += parseFloat(line.qty || 0) || 0;
    totalGrossWeight += parseFloat(line.gross_wt || 0) * qty;
    totalNetWeight += parseFloat(line.net_wt || 0) * qty;
    totalPureWeight += parseFloat(b.pureWt || 0) * qty;
    subtotal += b.subtotal;
    lineDiscount += b.discountAmt;
    rawComponents.metal += b.metalValue * qty;
    rawComponents.making += b.making * qty;
    rawComponents.diamond += b.diamond * qty;
    rawComponents.stone += b.stone * qty;
    rawComponents.handling += b.handling * qty;
    rawComponents.other += b.other * qty;
  });

  subtotal = round2(subtotal);
  lineDiscount = round2(lineDiscount);
  Object.keys(rawComponents).forEach((key) => { rawComponents[key] = round2(rawComponents[key]); });

  const componentBreakdown = {};
  Object.keys(rawComponents).forEach((key) => {
    const discounts = [billComponentDiscounts[key], ...schemeComponentDiscounts.map((s) => s[key])].filter(Boolean);
    componentBreakdown[key] = applyComponentDiscounts(rawComponents[key], discounts);
  });
  const componentDiscountTotal = round2(
    Object.values(componentBreakdown).reduce((s, c) => s + c.discount, 0),
  );

  const beforeBillDiscount = round2(Math.max(0, subtotal - lineDiscount - componentDiscountTotal));
  const rawBillDiscount =
    billDiscount.mode === 'percent'
      ? round2((beforeBillDiscount * (parseFloat(billDiscount.value || 0) || 0)) / 100)
      : parseFloat(billDiscount.value || 0);
  const billDiscountAmount = round2(
    Math.min(beforeBillDiscount, Math.max(0, rawBillDiscount || 0)),
  );
  const afterBillDiscount = round2(Math.max(0, beforeBillDiscount - billDiscountAmount));
  // A redeemed scheme's bonus/free-month is real, genuine consideration nobody paid for — it's
  // a legitimate price reduction (unlike the scheme's real advance, which pays part of the
  // bill without touching the taxable value at all — see the `advances` allocation in
  // posInvoice.js). Folded in here so GST is correctly computed on the discounted value.
  const schemeBonusApplied = round2(Math.min(afterBillDiscount, Math.max(0, parseFloat(schemeBonusAmount) || 0)));
  const totalDiscount = round2(lineDiscount + componentDiscountTotal + billDiscountAmount + schemeBonusApplied);
  const netTotal = round2(afterBillDiscount - schemeBonusApplied);

  let runningTotal = netTotal;
  const taxes = gstSplit.map((t, idx) => {
    const chargeType = t.charge_type || (idx === 0 ? 'On Net Total' : 'On Previous Row Total');
    const base = chargeType === 'On Previous Row Total' ? runningTotal : netTotal;
    const taxAmount = round2((base * t.rate) / 100);
    runningTotal = round2(runningTotal + taxAmount);
    return {
      doctype: 'Sales Taxes and Charges',
      idx: idx + 1,
      charge_type: chargeType,
      account_head: t.account,
      description: t.description || t.account,
      rate: t.rate,
      tax_amount: taxAmount,
      net_total: base,
      total: runningTotal,
      included_in_print_rate: 0,
    };
  });

  const totalTax = round2(taxes.reduce((s, t) => s + t.tax_amount, 0));
  const grandTotal = round2(netTotal + totalTax);

  // Matched by name, not position — the picked template can be either a 2-row CGST+SGST
  // (intra-state) template or a single-row IGST (inter-state) one, so index [0]/[1] can't be
  // trusted to mean the same thing every time.
  const findTax = (re) => taxes.find((t) => re.test(t.description || t.account_head || ''))?.tax_amount || 0;
  const cgst = findTax(/cgst/i);
  const sgst = findTax(/sgst/i);
  const igst = findTax(/igst/i);

  return {
    totalQty,
    totalWeight: round2(totalNetWeight),
    totalGrossWeight: round2(totalGrossWeight),
    totalNetWeight: round2(totalNetWeight),
    totalPureWeight: round2(totalPureWeight),
    subtotal,
    lineDiscount,
    componentBreakdown,
    componentDiscountTotal,
    billDiscount: billDiscountAmount,
    billDiscountMode: billDiscount.mode || 'amount',
    billDiscountValue: billDiscount.value || '',
    beforeBillDiscount,
    schemeBonusAmount: schemeBonusApplied,
    totalDiscount,
    netTotal,
    taxes,
    cgst,
    sgst,
    igst,
    totalTax,
    grandTotal,
  };
}

export function newCartLine(partial = {}) {
  return {
    id: `line-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    item_code: '',
    item_name: '',
    description: '',
    tag: '',
    serial_no: '',
    qty: 1,
    uom: 'Nos',
    rate: 0,
    gross_wt: 0,
    net_wt: 0,
    pure_wt: 0,
    metal_value: 0,
    making_charges: 0,
    margin: 0,
    diamond_value: 0,
    diamond_wt: 0,
    diamond_uom: '',
    stone_wt: 0,
    stone_uom: '',
    handling_charges: 0,
    current_metal_rate: '',
    metal_rate_is_touch: false,
    metal_touch_label: '',
    stone_value: 0,
    other_charges: 0,
    tounch: '',
    wastage: 0,
    rate_source: '',
    receipt_name: '',
    bom_name: '',
    discount_mode: 'percent',
    discount_value: 0,
    gst_hsn_code: '',
    image: '',
    warehouse: '',
    breakupOpen: false,
    ...partial,
  };
}
