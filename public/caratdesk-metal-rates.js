// Shared Metal Price List rate logic for every CaratDesk HTML page (POS follows the same
// rules in src/lib/metalRates.js). Two lookups, used everywhere:
//
//   A. cdLoadMetalRates()  — the general rate per metal (topbar banner, Purity Ledger valuation,
//      generic fallbacks): the HIGHEST metal_touch for that metal, and within that touch the
//      latest-dated row. Gold carries several touches so this lands on 24KT; Silver/Platinum
//      carry a single touch, so it is simply their latest row.
//   B. cdGetTouchRate(metal, touch) — the rate for one specific touch (e.g. an item's 22KT).
//
// Both sort by date desc, creation desc — the latest date always wins, and between two rows on
// the same date the one entered last wins.
//
// Requests go to cdGetInstanceUrl() with cdGetInstanceHeaders()/getDevHeaders(), whichever the
// page defines; pass { baseUrl, headers } to target another instance (e.g. Purity Ledger page).
(function(){
  const METALS = ['Gold', 'Silver', 'Platinum'];
  const ORDER_BY = encodeURIComponent('date desc, creation desc');
  const _ratesCache = {};

  // metal_touch comes as a KT label ("24KT"), a percent ("99.9") or a fineness ("999") —
  // reduce all of them to a comparable percent.
  function cdMetalTouchPercent(val){
    const s = String(val || '').trim();
    const n = parseFloat(s.replace(/[^\d.]/g, '')) || 0;
    if(/k/i.test(s)) return n / 24 * 100;
    return n > 100 ? n / 10 : n;
  }

  function resolveTarget(opts){
    const baseUrl = opts?.baseUrl || (typeof cdGetInstanceUrl === 'function' ? cdGetInstanceUrl() : '');
    let headers = opts?.headers;
    if(!headers && typeof cdGetInstanceHeaders === 'function') headers = cdGetInstanceHeaders();
    if(!headers && typeof getDevHeaders === 'function') headers = getDevHeaders();
    return { baseUrl, headers };
  }

  async function fetchRows(filters, limit, opts){
    const { baseUrl, headers } = resolveTarget(opts);
    if(!headers) return [];
    const fields = encodeURIComponent(JSON.stringify(['metal_type', 'metal_touch', 'rate', 'date', 'modified']));
    const res = await fetch(
      `${baseUrl}/api/resource/Metal%20Price%20List?fields=${fields}&filters=${encodeURIComponent(JSON.stringify(filters))}&order_by=${ORDER_BY}&limit_page_length=${limit}`,
      { headers }
    );
    if(!res.ok) throw new Error('HTTP ' + res.status);
    const d = await res.json();
    return d?.data || d?.message || [];
  }

  // Rule A. Resolves to { Gold: { rate, label, touch, date }, Silver: {...}, Platinum: {...} }
  // (a metal with no rate is left out). Cached per instance for the page's lifetime.
  function cdLoadMetalRates(opts){
    const { baseUrl } = resolveTarget(opts);
    if(_ratesCache[baseUrl]) return _ratesCache[baseUrl];
    const p = (async () => {
      const rows = await fetchRows([['metal_type', 'in', METALS]], 500, opts);
      // Rows arrive newest first, so the first row seen for a touch is its latest; a later row
      // only replaces the pick when its touch is strictly higher.
      const best = {};
      rows.forEach(row => {
        const rate = parseFloat(row.rate) || 0;
        if(!row.metal_type || !rate) return;
        const touch = cdMetalTouchPercent(row.metal_touch);
        const cur = best[row.metal_type];
        if(!cur || touch > cur.touch) best[row.metal_type] = { rate, label: row.metal_touch || '', touch, date: row.date };
      });
      return best;
    })();
    _ratesCache[baseUrl] = p;
    p.catch(() => { delete _ratesCache[baseUrl]; });
    return p;
  }

  // Rule A rate for one metal type — 0 when none is set or the lookup fails.
  async function cdGetMetalRate(metalType, opts){
    try{
      const rates = await cdLoadMetalRates(opts);
      return rates[metalType]?.rate || 0;
    }catch(e){
      console.warn('Metal rate lookup failed:', e.message);
      return 0;
    }
  }

  // Rule B. Exact metal_touch label first (server side, newest row only); if no row carries that
  // exact label, the newest row whose touch is the same purity ("916" ≈ "91.6"). 0 if none.
  async function cdGetTouchRate(metalType, touch, opts){
    const label = String(touch ?? '').trim();
    if(!metalType || !label) return 0;
    try{
      const exact = await fetchRows([['metal_type', '=', metalType], ['metal_touch', '=', label]], 1, opts);
      if(exact[0]?.rate) return parseFloat(exact[0].rate) || 0;
      const wanted = Math.round(cdMetalTouchPercent(label) * 10) / 10;
      if(!wanted) return 0;
      const rows = await fetchRows([['metal_type', '=', metalType]], 500, opts);
      const match = rows.find(r => Math.round(cdMetalTouchPercent(r.metal_touch) * 10) / 10 === wanted);
      return parseFloat(match?.rate) || 0;
    }catch(e){
      console.warn(`Metal Price List lookup failed for ${metalType} ${label}:`, e.message);
      return 0;
    }
  }

  function fmtChipRate(info, showTouch){
    return info ? '₹' + info.rate.toLocaleString('en-IN') + ' / g' + (showTouch && info.label ? ' (' + info.label + ')' : '') : '—';
  }

  // Fills the topbar banner: <div class="cd-chip"> with two <strong>s (Gold, Silver) and an
  // optional #cdRateUpdated span. Only Gold shows its touch — Silver has a single touch, so
  // (as on the POS banner) it shows the rate alone.
  function cdRenderMetalRateChip(rates){
    const strongs = document.querySelectorAll('.cd-chip strong');
    if(strongs[0]) strongs[0].textContent = fmtChipRate(rates?.Gold, true);
    if(strongs[1]) strongs[1].textContent = fmtChipRate(rates?.Silver, false);
    const upd = document.getElementById('cdRateUpdated');
    const date = rates?.Gold?.date;
    if(upd) upd.textContent = date ? ' · Updated ' + new Date(date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
  }

  // Every touch's current rate, for the rates panel. Resolves to
  // [{ metal, rows: [{ label, touch, rate, date, modified }] }] in METALS order, touches highest first.
  // Rows arrive newest first, so the first row seen for a metal_touch label is its current rate.
  // Labels are shown exactly as entered in Metal Price List; touch is only used for ordering.
  async function cdLoadAllTouchRates(opts){
    const rows = await fetchRows([['metal_type', 'in', METALS]], 500, opts);
    const seen = {};
    rows.forEach(row => {
      const rate = parseFloat(row.rate) || 0;
      if(!row.metal_type || !rate) return;
      const label = String(row.metal_touch || '').trim();
      const byLabel = seen[row.metal_type] = seen[row.metal_type] || {};
      if(!byLabel[label]) byLabel[label] = { label, touch: cdMetalTouchPercent(label), rate, date: row.date, modified: row.modified };
    });
    return METALS.filter(m => seen[m]).map(metal => ({
      metal,
      rows: Object.values(seen[metal]).sort((a, b) => b.touch - a.touch),
    }));
  }

  // ── Rates side tab + panel ──
  // cdMountRatePanel() adds a "Metal Rate" tab on the right edge; clicking it opens a panel with
  // a Purity | Rate table (grouped under each metal) of every touch's current rate. Closes on ✕, outside click or
  // Esc or mouse-leave. Styles use the page's theme variables, so it follows light/dark mode.
  // opts: { baseUrl, headers } as for the lookups.
  const RATE_PANEL_CSS = `
  .cd-rp-tab,.cd-rp{font-family:'DM Sans',-apple-system,BlinkMacSystemFont,sans-serif;-webkit-font-smoothing:antialiased}
  .cd-rp-tab{position:fixed;right:0;top:0;bottom:0;margin:auto 0;height:fit-content;z-index:700;padding:18px 11px;border:0;outline:none;border-radius:10px 0 0 10px;
    cursor:pointer;font-size:13.5px;font-weight:600;letter-spacing:.02em;background:var(--pill-amber-bg);color:var(--pill-amber-txt);box-shadow:var(--shadow-sm);transition:background .14s}
  .cd-rp-tab:hover{background:var(--pill-amber-bg-hover,var(--pill-amber-bg))}
  .cd-rp-tab span{display:block;writing-mode:vertical-rl;transform:rotate(180deg)}
  .cd-rp-tab.away{display:none}
  .cd-rp-backdrop{position:fixed;inset:0;z-index:701;background:rgba(0,0,0,.25);display:none}
  .cd-rp-backdrop.open{display:block}
  .cd-rp{position:fixed;right:16px;top:0;bottom:0;margin:auto 0;height:fit-content;z-index:702;width:320px;max-width:calc(100vw - 32px);max-height:min(560px,calc(100vh - 32px));
    display:none;flex-direction:column;background:var(--surface);color:var(--text-primary);border:.5px solid var(--border);border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.2);overflow:hidden}
  .cd-rp.open{display:flex}
  .cd-rp-head{position:relative;text-align:center;padding:18px 48px 14px;border-bottom:.5px solid var(--border)}
  .cd-rp-title{font-size:15px;font-weight:600}
  .cd-rp-sub{font-size:13px;font-weight:600;color:var(--text-secondary);margin-top:4px;min-height:17px}
  .cd-rp-close{position:absolute;top:14px;right:14px;outline:none;width:30px;height:30px;border-radius:8px;border:0;background:transparent;color:var(--text-secondary);cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background .14s,color .14s}
  .cd-rp-close:hover{background:var(--nav-hover);color:var(--text-primary)}
  .cd-rp-close svg{width:15px;height:15px;stroke:currentColor;stroke-width:2;fill:none;stroke-linecap:round}
  .cd-rp-body{overflow-y:auto}
  .cd-rp-table{width:100%;border-collapse:collapse;font-size:13px}
  .cd-rp-metal{text-align:center;font-size:13px;font-weight:600;padding:12px 24px 10px;border-top:.5px solid var(--border)}
  .cd-rp-metal:first-child{border-top:0}
  .cd-rp-table th{text-align:left;font-size:11px;font-weight:500;color:var(--text-muted);letter-spacing:.05em;text-transform:uppercase;background:var(--bg);padding:10px 24px;border-bottom:.5px solid var(--border);white-space:nowrap}
  .cd-rp-table td{padding:9px 24px;color:var(--text-primary);border-bottom:.5px solid var(--border)}
  .cd-rp-table .num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
  .cd-rp-table td.num{font-weight:500}
  .cd-rp-table tbody tr:last-child td{border-bottom:0}
  .cd-rp-msg{padding:28px 24px;text-align:center;font-size:13px;color:var(--text-secondary)}
  @media(max-width:480px){.cd-rp{right:8px;max-width:calc(100vw - 16px)}}`;

  const escHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // Frappe datetime "2026-10-08 09:00:12.123456" → "08 Oct 2026, 09:00 am"
  const fmtDateTime = d => new Date(String(d).replace(' ', 'T').slice(0, 19)).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true });

  function renderRatePanel(body, sub, groups){
    if(!groups.length){
      body.innerHTML = '<div class="cd-rp-msg">No rates found in Metal Price List.</div>';
      sub.textContent = '';
      return;
    }
    let latest = '';
    // Each metal: its name centred, then its own Purity | Rate table
    body.innerHTML = groups.map(g => {
      const rowsHtml = g.rows.map(r => {
        if(r.modified && r.modified > latest) latest = r.modified;
        const rate = r.rate.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        return `<tr><td>${escHtml(r.label)}</td><td class="num">${rate}</td></tr>`;
      }).join('');
      return `<div class="cd-rp-metal">${escHtml(g.metal)}</div>`
        + `<table class="cd-rp-table"><thead><tr><th>Purity</th><th class="num">Rate (per g)</th></tr></thead><tbody>${rowsHtml}</tbody></table>`;
    }).join('');
    sub.textContent = latest ? 'Last Updated on ' + fmtDateTime(latest) : '';
  }

  function cdMountRatePanel(opts){
    if(document.getElementById('cdRatePanel')) return;
    const style = document.createElement('style');
    style.textContent = RATE_PANEL_CSS;
    document.head.appendChild(style);

    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'cd-rp-tab';
    tab.setAttribute('aria-controls', 'cdRatePanel');
    tab.setAttribute('aria-expanded', 'false');
    tab.title = 'Metal Rate';
    tab.innerHTML = '<span>Metal Rate</span>';

    const backdrop = document.createElement('div');
    backdrop.className = 'cd-rp-backdrop';

    const panel = document.createElement('div');
    panel.id = 'cdRatePanel';
    panel.className = 'cd-rp';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Metal Rate');
    panel.innerHTML = `
      <div class="cd-rp-head">
        <div><div class="cd-rp-title">Metal Rate</div><div class="cd-rp-sub"></div></div>
        <button type="button" class="cd-rp-close" aria-label="Close"><svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
      </div>
      <div class="cd-rp-body"><div class="cd-rp-msg">Loading rates…</div></div>`;

    document.body.append(tab, backdrop, panel);
    const body = panel.querySelector('.cd-rp-body');
    const sub = panel.querySelector('.cd-rp-sub');

    const setOpen = open => {
      panel.classList.toggle('open', open);
      backdrop.classList.toggle('open', open);
      tab.classList.toggle('away', open);
      tab.setAttribute('aria-expanded', String(open));
      if(open) panel.querySelector('.cd-rp-close').focus({ preventScroll: true });
      else tab.focus({ preventScroll: true });
    };
    tab.addEventListener('click', () => setOpen(true));
    backdrop.addEventListener('click', () => setOpen(false));
    panel.querySelector('.cd-rp-close').addEventListener('click', () => setOpen(false));
    document.addEventListener('keydown', e => { if(e.key === 'Escape' && panel.classList.contains('open')) setOpen(false); });
    // Closes once the mouse leaves the panel; the short delay forgives a cursor slipping off the edge.
    let leaveTimer;
    panel.addEventListener('mouseleave', () => { leaveTimer = setTimeout(() => setOpen(false), 300); });
    panel.addEventListener('mouseenter', () => clearTimeout(leaveTimer));

    cdLoadAllTouchRates(opts)
      .then(groups => renderRatePanel(body, sub, groups))
      .catch(e => {
        console.warn('Rates panel load failed:', e.message);
        body.innerHTML = '<div class="cd-rp-msg">Couldn\'t load rates. Please refresh the page.</div>';
      });
  }

  Object.assign(window, { cdMetalTouchPercent, cdLoadMetalRates, cdGetMetalRate, cdGetTouchRate, cdRenderMetalRateChip, cdLoadAllTouchRates, cdMountRatePanel });
})();
