import { apiGet, getData } from './api.js';

let cachedRates = null;
let cachedTouches = null;
let cachedDates = null;

// Same rule as /caratdesk-metal-rates.js on the HTML pages. metal_touch comes as a KT label
// ("24KT"), a percent ("99.9") or a fineness ("999") — reduce all of them to a comparable percent.
function metalTouchPercent(val) {
  const s = String(val || '').trim();
  const n = parseFloat(s.replace(/[^\d.]/g, '')) || 0;
  if (/k/i.test(s)) return (n / 24) * 100;
  return n > 100 ? n / 10 : n;
}

/**
 * General rate per metal type: the highest metal_touch for that metal, and within that touch
 * the latest-dated row (creation breaks same-day ties). Gold carries several touches so this
 * lands on 24KT — the baseline this app's purity-based calculations (rate x purity%) assume;
 * Silver/Platinum carry a single touch, so it is simply their latest row.
 */
export async function loadMetalRates() {
  try {
    const fields = encodeURIComponent(JSON.stringify(['metal_type', 'metal_touch', 'rate', 'date']));
    const filters = encodeURIComponent(
      JSON.stringify([
        ['Metal Price List', 'metal_type', 'in', ['Gold', 'Silver', 'Platinum']],
      ]),
    );
    const res = await apiGet(
      `/api/resource/Metal%20Price%20List?fields=${fields}&filters=${filters}&order_by=${encodeURIComponent('date desc, creation desc')}&limit_page_length=500`,
    );
    const rows = getData(res) || [];
    // Rows arrive newest first, so the first row seen for a touch is its latest; a later row
    // only replaces the pick when its touch is strictly higher.
    const best = {};
    rows.forEach((row) => {
      const rate = parseFloat(row.rate) || 0;
      if (!row.metal_type || !rate) return;
      const touch = metalTouchPercent(row.metal_touch);
      const cur = best[row.metal_type];
      if (!cur || touch > cur.touch) best[row.metal_type] = { rate, touch, label: row.metal_touch || '', date: row.date };
    });
    const rates = {};
    const touches = {};
    const dates = {};
    Object.entries(best).forEach(([metal, b]) => {
      rates[metal] = b.rate;
      touches[metal] = b.label;
      dates[metal] = b.date;
    });

    cachedRates = rates;
    cachedTouches = touches;
    cachedDates = dates;
    return rates;
  } catch (e) {
    console.warn('loadMetalRates error:', e.message);
    return cachedRates || {};
  }
}

export function getMetalRates() {
  return cachedRates || {};
}

// The touch label (e.g. "24KT") of the row each metal type's rate was taken from — so the
// header chip shows what was really fetched instead of an assumed/hardcoded touch.
export function getMetalTouches() {
  return cachedTouches || {};
}

// The date of the row each metal type's rate was taken from — shown as "Updated …" in the chip.
export function getMetalRateDates() {
  return cachedDates || {};
}

export function getGoldRate() {
  return (cachedRates || {}).Gold || 0;
}

// Same text as the banner on the HTML pages (/caratdesk-metal-rates.js): Gold with its touch,
// Silver rate alone, and the Gold row's date.
export function formatGoldRateChip(rates, touches = {}, dates = {}) {
  const gold = rates?.Gold || 0;
  const silver = rates?.Silver || 0;
  const goldTouch = touches?.Gold || '';
  const goldDate = dates?.Gold;
  return {
    gold: gold ? `₹${gold.toLocaleString('en-IN')} / g${goldTouch ? ` (${goldTouch})` : ''}` : '—',
    silver: silver ? `₹${silver.toLocaleString('en-IN')} / g` : '—',
    updated: goldDate
      ? new Date(goldDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
      : '',
  };
}
