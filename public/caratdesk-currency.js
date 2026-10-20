// Shared document-currency logic for the CaratDesk buying pages (Purchase Order / Receipt /
// Invoice). A foreign supplier's document (e.g. USD) is entered in that currency with an
// exchange rate; ERPNext derives the INR (base_*) values, so stock and accounts stay in INR.
//
// Grid rates/amounts are in the document currency. Price lists (Metal / Diamond / Gemstone /
// Item standard rate), saved BOMs, tags and the Purity Ledger stay in INR — cdToDoc() converts
// an INR price into the grid, cdToInr() converts a grid value back.
//
// Page markup this expects (all optional except the two inputs):
//   input#docCurrency (read-only — follows the Supplier / source document), input#convRate — header fields
//   #convRateLbl                         — "(₹ per 1 USD)" hint next to the rate label
//   .cd-cur-tag                          — " (USD)" suffix on column headers / totals; empty for INR
//   .cd-cur-sym                          — currency symbol ("₹" / "$")
//   #totalsGrid[data-cols] + #tot-grand-inr-cell — extra "Grand Total (INR)" cell for foreign docs
//
// The exchange rate comes from ERPNext's own buying lookup (Currency Exchange records marked
// For Buying) for the page's date field, and stays editable on the document.
(function(){
  const COMPANY_CURRENCY = 'INR';
  const SYMBOLS = { INR:'₹', USD:'$' };
  const state = { currency: COMPANY_CURRENCY, rate: 1, manual: false };
  let cfg = { dateInputId: '', onChange: null, hasRates: null };

  const $ = id => document.getElementById(id);

  function cdDocCurrency(){ return state.currency; }
  function cdConvRate(){ return state.rate; }
  function cdIsForeign(){ return state.currency !== COMPANY_CURRENCY; }
  function cdToDoc(inr){ const v=parseFloat(inr)||0; return cdIsForeign() && state.rate>0 ? Math.round(v/state.rate*100)/100 : v; }
  function cdToInr(v){ v=parseFloat(v)||0; return cdIsForeign() ? Math.round(v*state.rate*100)/100 : v; }
  function cdCurSym(){ return SYMBOLS[state.currency] || (state.currency+' '); }
  // Money display: whole rupees for INR (the pages' existing style), cents for a foreign currency.
  function cdFmtMoney(n){
    return cdIsForeign()
      ? (n||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})
      : Math.round(n||0).toLocaleString('en-IN');
  }

  // Amount in a given document's own currency (list/detail pages): "₹1,23,456" or "$1,234.50".
  function cdFmtIn(n, cur){
    cur = cur || COMPANY_CURRENCY;
    if(cur === COMPANY_CURRENCY) return '₹'+Math.round(n||0).toLocaleString('en-IN');
    return (SYMBOLS[cur] || cur+' ')+(n||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  }

  async function apiGet(endpoint){
    if(typeof dev1Get === 'function') return dev1Get(endpoint);
    const headers = (typeof getDevHeaders === 'function') ? getDevHeaders() : null;
    const res = await fetch(`${cdGetInstanceUrl()}${endpoint}`, { headers: headers || {} });
    if(!res.ok) throw new Error('HTTP '+res.status);
    return res.json();
  }

  async function cdFetchBuyingRate(fromCurrency){
    const date=(cfg.dateInputId && $(cfg.dateInputId)?.value) || new Date().toISOString().slice(0,10);
    const qs=new URLSearchParams({ from_currency:fromCurrency, to_currency:COMPANY_CURRENCY, transaction_date:date, args:'for_buying' });
    const r=await apiGet(`/api/method/erpnext.setup.utils.get_exchange_rate?${qs}`);
    return parseFloat(r?.message)||0;
  }

  function cdRefreshCurrencyUI(){
    const foreign=cdIsForeign();
    const rateEl=$('convRate');
    if(rateEl && !rateEl.disabled) rateEl.readOnly = !foreign;
    const lbl=$('convRateLbl');
    if(lbl) lbl.textContent = foreign ? `(₹ per 1 ${state.currency})` : '';
    document.querySelectorAll('.cd-cur-tag').forEach(el=>{ el.textContent = foreign ? ` (${state.currency})` : ''; });
    document.querySelectorAll('.cd-cur-sym').forEach(el=>{ el.textContent = cdCurSym().trim(); });
    const grid=$('totalsGrid');
    if(grid){
      const cols=parseInt(grid.dataset.cols)||5;
      grid.style.gridTemplateColumns = `repeat(${foreign?cols+1:cols},1fr)`;
    }
    const inrCell=$('tot-grand-inr-cell');
    if(inrCell) inrCell.style.display = foreign ? '' : 'none';
  }

  // Sets currency + rate as-is (e.g. from a saved document) and refreshes labels/totals.
  // manual=true keeps the rate from being replaced when the date changes.
  function cdSetDocCurrency(cur, rate, opts){
    state.currency = cur || COMPANY_CURRENCY;
    state.rate = cdIsForeign() ? (parseFloat(rate)||0) : 1;
    if(opts && 'manual' in opts) state.manual = !!opts.manual;
    if($('docCurrency')) $('docCurrency').value = state.currency;
    if($('convRate')) $('convRate').value = state.rate || '';
    cdRefreshCurrencyUI();
    if(cfg.onChange) cfg.onChange();
  }

  // Applies the Supplier's / source document's currency: INR → rate 1; foreign → the buying rate
  // for the page's date. Currency isn't user-editable — ERPNext requires it to match the party account.
  async function cdApplyDocCurrency(cur){
    cur = cur || COMPANY_CURRENCY;
    const changed = cur !== state.currency;
    if(cur === COMPANY_CURRENCY){ cdSetDocCurrency(cur, 1, { manual:false }); }
    else{
      let rate=0;
      try{ rate=await cdFetchBuyingRate(cur); }catch(e){ console.warn('Exchange rate fetch failed:', e.message); }
      cdSetDocCurrency(cur, rate, { manual:false });
      if(!rate && typeof showToast === 'function')
        showToast(`No ${cur} → ${COMPANY_CURRENCY} buying rate found in Currency Exchange — enter the Exchange Rate manually`, 'error', 6000);
    }
    if(changed && cfg.hasRates && cfg.hasRates()) cdWarnRatesNotConverted();
    return changed;
  }

  function cdWarnRatesNotConverted(){
    if(typeof showToast === 'function')
      showToast(`Currency changed to ${state.currency} — check the item rates, they are not converted automatically`, 'info', 6000);
  }

  // Supplier.default_currency (blank → company currency).
  async function cdGetSupplierCurrency(supplierName){
    if(!supplierName) return COMPANY_CURRENCY;
    try{
      const r=await apiGet(`/api/resource/Supplier/${encodeURIComponent(supplierName)}`);
      return (r.data||r.message||{}).default_currency || COMPANY_CURRENCY;
    }catch(e){ console.warn('Supplier currency lookup failed:', e.message); return COMPANY_CURRENCY; }
  }

  async function cdApplySupplierCurrency(supplierName, knownCurrency){
    const cur = knownCurrency !== undefined ? (knownCurrency || COMPANY_CURRENCY) : await cdGetSupplierCurrency(supplierName);
    return cdApplyDocCurrency(cur);
  }

  // Wires the header fields. opts: { dateInputId, onChange(), hasRates() } — pass hasRates to have
  // cdApplyDocCurrency warn by itself; leave it out to call cdWarnRatesNotConverted() at the right moment.
  async function cdInitCurrency(opts){
    cfg = { ...cfg, ...(opts||{}) };
    $('convRate')?.addEventListener('input', e => {
      if(!cdIsForeign()){ e.target.value = 1; return; }
      state.manual = true;
      state.rate = parseFloat(e.target.value)||0;
      if(cfg.onChange) cfg.onChange();
    });
    if(cfg.dateInputId) $(cfg.dateInputId)?.addEventListener('change', async () => {
      if(!cdIsForeign() || state.manual) return;
      try{ const rate=await cdFetchBuyingRate(state.currency); if(rate) cdSetDocCurrency(state.currency, rate); }
      catch(e){ console.warn('Exchange rate refresh failed:', e.message); }
    });
    if($('docCurrency')) $('docCurrency').value = state.currency;
    cdRefreshCurrencyUI();
  }

  Object.assign(window, {
    COMPANY_CURRENCY, cdDocCurrency, cdConvRate, cdIsForeign, cdToDoc, cdToInr, cdCurSym, cdFmtMoney, cdFmtIn,
    cdFetchBuyingRate, cdRefreshCurrencyUI, cdSetDocCurrency, cdApplyDocCurrency, cdWarnRatesNotConverted,
    cdGetSupplierCurrency, cdApplySupplierCurrency, cdInitCurrency,
  });
})();
