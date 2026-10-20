// Auto-fills Rate in a Make BOM dialog row once its raw material is picked — the same sources
// the Purchase Receipt's Make BOM uses (caratdesk-new-purchase-receipt.html applyMkbomRate /
// applyMkbomDiamondRate / applyMkbomStoneRate):
//
//   Gold/Silver/Platinum → Metal Price List for the item's own purity (cdGetTouchRate from
//                          /caratdesk-metal-rates.js, which must load first); no row for that
//                          purity → the general metal rate scaled by purity.
//   Diamond              → Diamond Price List, matched on PP Settings1 "Diamond Price List Mapping".
//   Gemstone             → Gemstone Price List, matched on PP Settings1 "Gemstone Price List
//                          Mapping" plus the dialog's UOM (gemstone rates are kept per UOM).
//
// Diamond/Gemstone prefer a row for the given supplier, then a generic (blank supplier) row.
// Rate only — no diamond margin. A Rate the user already typed is never overwritten (except a
// Gemstone UOM change, which re-looks up for the new UOM).
//
// The page supplies: cdGetInstanceUrl/cdGetInstanceHeaders, mkbomDlgRecalc(rowId), and the
// dialog's #mkbom-rate-<rowId> / #mkbom-uom-<rowId> inputs. showToast/mapUom are used if present.
(function(){
  let _settings = null;
  const _stoneRows = {}; // rowId -> { attrVals, supplier } for rows routed to Gemstone

  function headers(){ return typeof cdGetInstanceHeaders === 'function' ? cdGetInstanceHeaders() : null; }
  function toast(msg, type){ if(typeof showToast === 'function') showToast(msg, type); }
  function normUom(u){ return typeof mapUom === 'function' ? mapUom(u) : u; }
  function attrValue(attrVals, key){
    const v = attrVals?.[key];
    if(!v) return '';
    return typeof v === 'object' ? v.value : v;
  }

  // PP Settings1 mappings, loaded once per page.
  function cdLoadBomRateSettings(){
    if(_settings) return _settings;
    _settings = (async () => {
      const s = { metalMap:{}, templateMap:{}, diamondAttrs:[], gemstoneAttrs:[] };
      const h = headers();
      if(!h) return s;
      const res = await fetch(`${cdGetInstanceUrl()}/api/resource/PP%20Settings1/PP%20Settings1`, { headers: h });
      if(!res.ok) throw new Error('HTTP ' + res.status);
      const d = await res.json();
      const doc = d?.data || d?.message || {};
      // First row per metal wins in metalMap; per-template attributes live in templateMap.
      (doc.metal_mapping1 || []).forEach(r => {
        if(r.metal_type && r.item_attribute && !s.metalMap[r.metal_type]) s.metalMap[r.metal_type] = r.item_attribute;
        if(r.template_type && r.metal_type) s.templateMap[r.template_type] = { metalType: r.metal_type, attr: r.item_attribute || '' };
      });
      s.diamondAttrs  = (doc.diamond_price_list_mapping  || []).map(r => r.item_attribute).filter(Boolean);
      s.gemstoneAttrs = (doc.gemstone_price_list_mapping || []).map(r => r.item_attribute).filter(Boolean);
      return s;
    })();
    _settings.catch(e => { console.warn('PP Settings1 load failed:', e.message); _settings = null; });
    return _settings;
  }

  function detectMetalType(s, template){
    const t = String(template || '').trim();
    if(s.templateMap[t]) return s.templateMap[t].metalType;
    if(/gold/i.test(t)) return 'Gold';
    if(/silver/i.test(t)) return 'Silver';
    if(/platinum/i.test(t)) return 'Platinum';
    return '';
  }

  async function metalRate(s, metalType, template, attrVals){
    const attrName = s.templateMap[String(template || '').trim()]?.attr || s.metalMap[metalType] || (metalType + ' Purity');
    let label = '', abbr = '';
    const entry = attrVals?.[attrName];
    if(entry){
      label = String(typeof entry === 'object' ? entry.value : entry).trim();
      abbr  = String(typeof entry === 'object' ? entry.abbr  : entry).trim();
    } else {
      // No mapped purity attribute — take the first picked value that reads as a purity (1–999).
      for(const v of Object.values(attrVals || {})){
        const a = typeof v === 'object' ? v.abbr : v;
        const n = parseFloat(a);
        if(n >= 1 && n <= 999){ abbr = String(a); label = String(typeof v === 'object' ? v.value : v).trim(); break; }
      }
    }
    let rate = label ? await cdGetTouchRate(metalType, label) : 0;
    if(!rate && abbr && abbr !== label) rate = await cdGetTouchRate(metalType, abbr);
    if(rate) return rate;
    // No Metal Price List row for this purity — scale the general (highest-touch) rate by purity.
    const general = (await cdLoadMetalRates())[metalType];
    if(!general) return 0;
    const pct = cdMetalTouchPercent(label) || cdMetalTouchPercent(abbr);
    if(pct > 0 && general.touch > 0) return Math.round(general.rate / general.touch * pct * 100) / 100;
    return general.rate;
  }

  // Returns the matched rate, 0 if nothing matches, or null when the item carries none of these
  // attributes (i.e. it isn't this kind of item). `uom` given → Gemstone, exact UOM match required.
  async function priceListRate(attrs, attrVals, doctype, supplier, uom){
    if(!attrs.length) return null;
    const values = attrs.map(a => ({ field: String(a).trim().toLowerCase().replace(/\s+/g, '_'), value: attrValue(attrVals, a) }));
    if(values.every(v => !v.value)) return null;
    if(uom !== undefined && !uom) return 0;
    const h = headers();
    if(!h) return 0;
    const fields  = [...values.map(v => v.field), 'supplier', 'outright_rate'];
    const filters = [['docstatus', '=', 1], ...values.map(v => [v.field, '=', v.value])];
    if(uom) filters.push(['uom', '=', normUom(uom)]);
    const res = await fetch(
      `${cdGetInstanceUrl()}/api/resource/${encodeURIComponent(doctype)}?fields=${encodeURIComponent(JSON.stringify(fields))}&filters=${encodeURIComponent(JSON.stringify(filters))}&limit_page_length=100`,
      { headers: h }
    );
    if(!res.ok) return 0;
    const d = await res.json();
    const rows = d?.data || d?.message || [];
    if(!rows.length) return 0;
    let match = null;
    if(supplier) match = rows.find(r => (r.supplier || '').trim() === supplier);
    if(!match) match = rows.find(r => !r.supplier);
    if(!match) match = rows[0];
    return parseFloat(match.outright_rate) || 0;
  }

  async function templateOf(item){
    if(item.variant_of) return item.variant_of;
    const h = headers();
    if(!h) return '';
    try{
      const res = await fetch(`${cdGetInstanceUrl()}/api/resource/Item/${encodeURIComponent(item.item_code)}?fields=${encodeURIComponent(JSON.stringify(['variant_of']))}`, { headers: h });
      const d = await res.json();
      return (d?.data || d?.message || {}).variant_of || '';
    }catch(e){ return ''; }
  }

  function setRate(rowId, rate, force){
    const el = document.getElementById('mkbom-rate-' + rowId);
    if(!el) return false;
    if(!force && (parseFloat(el.value) || 0) !== 0) return false; // user already typed one
    el.value = rate;
    if(typeof mkbomDlgRecalc === 'function') mkbomDlgRecalc(rowId);
    return true;
  }

  async function stoneRate(rowId, force){
    const row = _stoneRows[rowId];
    if(!row) return;
    const s = await cdLoadBomRateSettings();
    const uom = document.getElementById('mkbom-uom-' + rowId)?.value || '';
    const rate = await priceListRate(s.gemstoneAttrs, row.attrVals, 'Gemstone Price List', row.supplier, uom);
    if(rate === null) return;
    if(!setRate(rowId, rate || 0, force)) return;
    if(rate) toast('Stone rate: ' + rate.toLocaleString('en-IN'), 'success');
    else toast(`No Gemstone rate for UOM ${uom || '-'} — enter rate manually`, 'info');
  }

  // Call right after the dialog shows the matched item (Rate already reset to 0).
  // opts: { attrVals, supplier, uomReady } — uomReady resolves once the item's UOM is selected.
  async function cdAutoFillMkbomRate(rowId, item, opts){
    delete _stoneRows[rowId];
    try{
      const s = await cdLoadBomRateSettings();
      const attrVals = opts?.attrVals || {};
      const supplier = opts?.supplier || '';
      const template = await templateOf(item);
      const metalType = detectMetalType(s, template);
      if(metalType){
        const rate = await metalRate(s, metalType, template, attrVals);
        if(rate && setRate(rowId, rate)) toast(metalType + ' rate: ' + rate.toLocaleString('en-IN'), 'success');
        return;
      }
      // Which mapped Gemstone attribute shows up in the picked attributes tells a coloured stone
      // apart from a diamond.
      const isStone = s.gemstoneAttrs.some(a => Object.prototype.hasOwnProperty.call(attrVals, a));
      if(isStone){
        _stoneRows[rowId] = { attrVals, supplier };
        await (opts?.uomReady || Promise.resolve());
        await stoneRate(rowId, false);
        return;
      }
      const rate = await priceListRate(s.diamondAttrs, attrVals, 'Diamond Price List', supplier);
      if(rate && setRate(rowId, rate)) toast('Diamond rate: ' + rate.toLocaleString('en-IN'), 'success');
    }catch(e){ console.warn('Make BOM rate auto-fill failed:', e.message); }
  }

  // Dialog UOM changed — Gemstone rates are per UOM, so look up again (0 if none for that UOM).
  function cdMkbomUomChanged(rowId){
    if(_stoneRows[rowId]) stoneRate(rowId, true).catch(e => console.warn('Stone rate lookup failed:', e.message));
  }

  Object.assign(window, { cdLoadBomRateSettings, cdAutoFillMkbomRate, cdMkbomUomChanged });
})();
