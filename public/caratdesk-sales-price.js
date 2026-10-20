// Estimated Sales Price for one Serial No — the same figure POS shows when that serial is scanned
// (before GST and discounts). Mirrors the POS pricing in src/lib/api.js (enrichItemFromSerial →
// fetchBomBreakup / fetchLiveRawMaterialRate → applySellRateMargin) and
// src/pages/POS/posCalculations.js (calcLineBreakup); keep the two in step when either changes.
//
//   Each BOM row is priced at today's rate: the row's own custom_selling_rate if set, else
//     Gold/Silver/Platinum → Metal Price List for the row's custom_gold_purity (cdGetTouchRate)
//     Diamond / Stone      → Diamond / Gemstone Price List, matched on PP Settings1 mappings
//     anything else        → the rate the row was costed at
//   Metal    = Net Wt × today's touch rate (not the sum of the metal rows)
//   Making   = Σ row making + handling, plus labour on metal rows (% of row value or ₹ per qty)
//   Other    = other rows + wastage on every row
//   Margin   = Metal × Serial No's custom_sell_rate %, folded into Making as POS does
//   Price    = Metal + Making + Diamond + Stone + Other
// A BOM with no live rate at all, or no BOM, falls back the way POS does (purchase rate + margin
// when the components don't add back up to it).
//
// Diamond Studded (the BOM has a Diamond row) is priced differently, as POS does:
//   Diamond / Stone / Other at the rows' cost rate, Making = row making + labour (no Handling,
//   no Wastage), all four x the highest "Item Catefory Wise Diamond Margin" % (PP Settings1)
//   among the diamond rows' item categories (none / 0 -> at cost). Metal = Net Wt x today's
//   touch rate, not marked up. No Tounch Wise Margin (custom_sell_rate).
//
// Needs /caratdesk-metal-rates.js loaded first, and the page's cdGetInstanceUrl/cdGetInstanceHeaders.
(function(){
  const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
  const num = v => parseFloat(v || 0) || 0;
  const _cache = {};
  let _settings = null;

  async function apiGet(path){
    const res = await fetch(cdGetInstanceUrl() + path, { headers: cdGetInstanceHeaders() });
    if(!res.ok) throw new Error('HTTP ' + res.status);
    const d = await res.json();
    return d?.data ?? d?.message ?? d;
  }
  // Page-lifetime cache of rate lookups; a failed or zero result isn't kept.
  function cached(key, fn){
    if(_cache[key]) return _cache[key];
    const p = _cache[key] = fn();
    p.then(v => { if(!v) delete _cache[key]; }, () => { delete _cache[key]; });
    return p;
  }

  function loadSettings(){
    if(_settings) return _settings;
    _settings = apiGet('/api/resource/PP%20Settings1/PP%20Settings1').then(doc => ({
      diamondAttrs: (doc.diamond_price_list_mapping || []).map(r => r.item_attribute).filter(Boolean),
      gemstoneAttrs: (doc.gemstone_price_list_mapping || []).map(r => r.item_attribute).filter(Boolean),
      diamondCategoryMargin: Object.fromEntries((doc.item_catefory_wise_diamond_margin || [])
        .filter(r => r.item_category)
        .map(r => [String(r.item_category).trim().toLowerCase(), num(r.margin)])),
    }));
    _settings.catch(e => { console.warn('PP Settings1 load failed:', e.message); _settings = null; });
    return _settings;
  }

  function classify(itemGroup){
    const g = String(itemGroup || '').trim().toLowerCase();
    if(g === 'gold') return { kind: 'metal', metalType: 'Gold' };
    if(g === 'silver') return { kind: 'metal', metalType: 'Silver' };
    if(g === 'platinum') return { kind: 'metal', metalType: 'Platinum' };
    if(g === 'diamond' || g === 'stone') return { kind: g };
    return { kind: 'other' };
  }

  function purityFraction(value){
    const p = num(value);
    if(!p) return 0;
    return p > 100 ? p / 1000 : p / 100;
  }

  // Diamond / Gemstone Price List rate for a raw material's attributes; generic (blank supplier)
  // row preferred. Gemstone rates are kept per UOM, so a gemstone needs one.
  async function attrMappedRate(itemCode, attrs, doctype, uom){
    if(!attrs.length) return 0;
    if(uom !== undefined && !uom) return 0;
    const item = await cached('Item|' + itemCode, () => apiGet('/api/resource/Item/' + encodeURIComponent(itemCode)));
    const attrVal = label => ((item.attributes || []).find(a => (a.attribute || '').trim().toLowerCase() === label.trim().toLowerCase())?.attribute_value || '').trim();
    const values = attrs.map(a => ({ field: a.trim().toLowerCase().replace(/\s+/g, '_'), value: attrVal(a) }));
    if(values.every(v => !v.value)) return 0;
    return cached(`${doctype}|${uom || ''}|${JSON.stringify(values)}`, async () => {
      const fields = JSON.stringify([...values.map(v => v.field), 'supplier', 'outright_rate']);
      const filters = JSON.stringify([['docstatus', '=', 1], ...values.map(v => [v.field, '=', v.value]), ...(uom ? [['uom', '=', uom]] : [])]);
      const rows = await apiGet(`/api/resource/${encodeURIComponent(doctype)}?fields=${encodeURIComponent(fields)}&filters=${encodeURIComponent(filters)}&limit_page_length=100`);
      if(!rows?.length) return 0;
      return num((rows.find(r => !r.supplier) || rows[0]).outright_rate);
    });
  }

  // Highest Diamond Margin % among a studded BOM's diamond rows' item categories, 0 when none.
  async function studdedDiamondMargin(diamondRows, settings){
    const margins = await Promise.all(diamondRows.map(async row => {
      if(!row.item_code) return 0;
      try{
        const item = await cached('Item|' + row.item_code, () => apiGet('/api/resource/Item/' + encodeURIComponent(row.item_code)));
        return settings.diamondCategoryMargin[String(item.custom_item_category || '').trim().toLowerCase()] || 0;
      }catch(e){
        console.warn('Diamond category lookup failed for', row.item_code, e.message);
        return 0;
      }
    }));
    return Math.max(0, ...margins);
  }

  async function liveRowRate(row, settings){
    const fallback = num(row.custom_costing_rate || row.rate || row.base_rate);
    const { kind, metalType } = classify(row.custom_item_group);
    const sellingRate = num(row.custom_selling_rate);
    if(sellingRate > 0) return { kind, rate: sellingRate, isLive: true };
    if(kind === 'other' || !row.item_code) return { kind, rate: fallback, isLive: false };
    try{
      if(kind === 'metal'){
        const purityLabel = String(row.custom_gold_purity || '').trim();
        const rate = await cdGetTouchRate(metalType, purityLabel);
        if(!rate) return { kind, rate: 0, isLive: false, missing: `${metalType}${purityLabel ? ' ' + purityLabel : ''}` };
        return { kind, rate, isLive: true, purityLabel };
      }
      const rate = kind === 'stone'
        ? await attrMappedRate(row.item_code, settings.gemstoneAttrs, 'Gemstone Price List', row.uom || row.stock_uom || '')
        : await attrMappedRate(row.item_code, settings.diamondAttrs, 'Diamond Price List');
      return { kind, rate: rate || fallback, isLive: rate > 0 };
    }catch(e){
      console.warn('Rate lookup failed for', row.item_code, e.message);
      return { kind, rate: fallback, isLive: false };
    }
  }

  // Same totals as POS fetchBomBreakup.
  async function bomBreakup(bomDoc){
    const rows = bomDoc?.items || [];
    if(!rows.length) return null;
    const settings = await loadSettings().catch(() => ({ diamondAttrs: [], gemstoneAttrs: [], diamondCategoryMargin: {} }));
    const diamondRows = rows.filter(r => classify(r.custom_item_group).kind === 'diamond');
    const isStudded = diamondRows.length > 0;
    const [rates, diamondMarginPercent] = await Promise.all([
      Promise.all(rows.map(r => {
        const kind = classify(r.custom_item_group).kind;
        if(!isStudded || kind === 'metal') return liveRowRate(r, settings);
        return { kind, rate: num(r.custom_costing_rate || r.rate || r.base_rate), isLive: false };
      })),
      isStudded ? studdedDiamondMargin(diamondRows, settings) : 0,
    ]);
    const acc = { metalValue: 0, metalRateTouch: 0, metalTouchLabel: '', makingCharges: 0, diamondValue: 0,
      stoneValue: 0, otherCharges: 0, netWeight: 0, hasLiveRate: false, missing: [], isStudded, diamondMarginPercent };
    rows.forEach((row, i) => {
      const qty = num(row.qty || row.stock_qty);
      const { kind, rate, isLive, purityLabel, missing } = rates[i];
      if(missing) acc.missing.push(missing);
      const handling = isStudded ? 0 : num(row.custom_handling_rate);
      const wastage = isStudded ? 0 : num(row.custom_wastage);
      const base = qty * rate + qty * num(row.custom_making) + qty * handling;
      const labourMode = row.custom_labour_mode || 'Percentage';
      const labourVal = num(row.custom_labour_val);
      const labour = kind !== 'metal' ? 0 : (labourMode === 'Percentage' || labourMode === '%') ? base * labourVal / 100 : qty * labourVal;
      if(kind === 'diamond') acc.diamondValue += qty * rate;
      else if(kind === 'stone') acc.stoneValue += qty * rate;
      else if(kind === 'metal'){
        acc.metalValue += qty * rate;
        if(isLive && purityLabel){ acc.metalRateTouch = rate; acc.metalTouchLabel = purityLabel; }
      } else acc.otherCharges += qty * rate;
      acc.makingCharges += qty * num(row.custom_making) + qty * handling + labour;
      acc.otherCharges += base * wastage / 100;
      acc.hasLiveRate = acc.hasLiveRate || isLive;
      const uom = String(row.uom || row.stock_uom || '').toLowerCase();
      if(uom === 'gram' || uom === 'gm' || uom === 'g') acc.netWeight += qty;
    });
    acc.missing = [...new Set(acc.missing)];
    if(isStudded){
      const factor = diamondMarginPercent > 0 ? diamondMarginPercent / 100 : 1;
      acc.studdedMarkup = (acc.makingCharges + acc.diamondValue + acc.stoneValue + acc.otherCharges) * (factor - 1);
      acc.makingCharges *= factor;
      acc.diamondValue *= factor;
      acc.stoneValue *= factor;
      acc.otherCharges *= factor;
      acc.hasLiveRate = true;
    }
    return acc;
  }

  // serial: the Serial No doc; item: its Item doc (or {}); bomDoc: the serial's BOM doc or null.
  // Resolves to { price, metal, metalRate, touchLabel, netWt, making, margin, sellRatePercent,
  // diamond, stone, other, usedPurchaseRate, warning, isStudded, diamondMarginPercent,
  // diamondMarginAmount (studded: what the Diamond Margin added on top of cost) } — price is 0 when it can't be worked out.
  async function cdEstimateSalesPrice(serial, item, bomDoc){
    item = item || {};
    const b = bomDoc ? await bomBreakup(bomDoc) : null;
    const sellRatePercent = b?.isStudded ? 0 : num(serial.custom_sell_rate);
    const out = { price: 0, metal: 0, metalRate: 0, touchLabel: '', netWt: 0, making: 0, margin: 0, sellRatePercent,
      diamond: 0, stone: 0, other: 0, usedPurchaseRate: false, warning: '',
      isStudded: Boolean(b?.isStudded), diamondMarginPercent: num(b?.diamondMarginPercent),
      diamondMarginAmount: round2(num(b?.studdedMarkup)) };
    if(b?.missing.length){
      out.warning = `Metal Price List rate not found for ${b.missing.join(', ')} — add it to see the estimated price.`;
      return out;
    }

    const itemGross = num(item.custom_gross_weight);
    out.netWt = num(serial.custom_net_weight) || num(item.custom_net_weight) || itemGross || num(b?.netWeight) || num(serial.custom_gross_weight);
    // Item master rate as POS uses it when the serial carries no purchase rate.
    const backendRate = num(serial.purchase_rate) || num(item.standard_rate || item.valuation_rate || item.last_purchase_rate);
    // No touch-wise rate on the BOM (or no BOM) → POS prices metal at the general Gold rate.
    out.metalRate = num(b?.metalRateTouch) || await cdGetMetalRate('Gold');
    out.touchLabel = b?.metalTouchLabel || '';
    out.metal = round2(out.netWt * out.metalRate);
    out.margin = round2(out.metal * sellRatePercent / 100);
    out.making = round2(num(b?.makingCharges) + out.margin);
    out.diamond = round2(num(b?.diamondValue));
    out.stone = round2(num(b?.stoneValue));
    out.other = round2(num(b?.otherCharges));
    const computed = round2(out.metal + out.making + out.diamond + out.stone + out.other);

    // Without any live rate, POS trusts the purchase rate whenever the recombined BOM components
    // don't add back up to it.
    const componentTotal = (b?.metalValue || backendRate) + num(b?.makingCharges) + num(b?.diamondValue) + num(b?.stoneValue) + num(b?.otherCharges);
    const preferBackend = b ? !b.hasLiveRate && Math.abs(componentTotal - backendRate) > 0.05 : false;
    if((preferBackend && backendRate > 0) || !(computed > 0)){
      out.price = round2(backendRate + out.margin);
      out.usedPurchaseRate = out.price > 0;
    } else {
      out.price = computed;
    }
    if(!(out.price > 0)) out.warning = 'Not enough pricing data on this serial to estimate a sales price.';
    return out;
  }

  window.cdEstimateSalesPrice = cdEstimateSalesPrice;
})();
