import { apiGet, getData } from './api.js';

let cachedRates = null;
let cachedTouches = null;

async function fetchLatestMetalPriceRow(filters) {
  const fields = encodeURIComponent(JSON.stringify(['metal_type', 'metal_touch', 'rate', 'date']));
  const res = await apiGet(
    `/api/resource/Metal%20Price%20List?fields=${fields}&filters=${encodeURIComponent(JSON.stringify(filters))}&order_by=date desc&limit_page_length=1`,
  );
  return (getData(res) || [])[0] || null;
}

/**
 * Same method as Purchase Receipt page: latest Metal Price List per metal type — Gold
 * specifically pulls the latest row tagged with the 24KT (fine gold) touch, since that's the
 * baseline rate this app's purity-based calculations (rate x purity%) assume, not just
 * whichever touch happens to be most recently dated. Falls back to the latest Gold row of
 * any touch if nothing is tagged 24KT.
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
      `/api/resource/Metal%20Price%20List?fields=${fields}&filters=${filters}&order_by=date%20desc&limit_page_length=100`,
    );
    const rows = getData(res) || [];
    const rates = {};
    const touches = {};
    rows.forEach((row) => {
      if (row.metal_type && row.rate && !rates[row.metal_type]) {
        rates[row.metal_type] = parseFloat(row.rate) || 0;
        touches[row.metal_type] = row.metal_touch || '';
      }
    });

    try {
      const gold24kt = await fetchLatestMetalPriceRow([
        ['Metal Price List', 'metal_type', '=', 'Gold'],
        ['Metal Price List', 'metal_touch', 'in', ['24KT', '24 KT', '24K']],
      ]);
      if (gold24kt?.rate) {
        rates.Gold = parseFloat(gold24kt.rate) || 0;
        touches.Gold = gold24kt.metal_touch || '24KT';
      }
    } catch (e) {
      console.warn('24KT gold rate lookup failed, using latest Gold row instead:', e.message);
    }

    cachedRates = rates;
    cachedTouches = touches;
    return rates;
  } catch (e) {
    console.warn('loadMetalRates error:', e.message);
    return cachedRates || {};
  }
}

export function getMetalRates() {
  return cachedRates || {};
}

// The touch label (e.g. "22KT") that the most-recently-dated Metal Price List row for each
// metal type actually carries — so the header chip shows what was really fetched instead of
// an assumed/hardcoded touch.
export function getMetalTouches() {
  return cachedTouches || {};
}

export function getGoldRate() {
  return (cachedRates || {}).Gold || 0;
}

export function formatGoldRateChip(rates, touches = {}) {
  const gold = rates?.Gold || 0;
  const silver = rates?.Silver || 0;
  const goldTouch = touches?.Gold || '';
  return {
    gold: gold ? `${gold.toLocaleString('en-IN')} / g${goldTouch ? ` (${goldTouch})` : ''}` : '—',
    silver: silver ? `${silver.toLocaleString('en-IN')} / g` : '—',
  };
}
