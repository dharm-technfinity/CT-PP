import { getGoldRate, getMetalRates } from './metalRates.js';

export function getAuthHeaders(contentType = 'application/json') {
  const key = localStorage.getItem('cd_api_key');
  const secret = localStorage.getItem('cd_api_secret');
  if (!key || !secret) return null;
  const headers = {
    Authorization: `token ${key}:${secret}`,
    Accept: 'application/json',
  };
  if (contentType) headers['Content-Type'] = contentType;
  return headers;
}

function handle401() {
  window.location.replace('/caratdesk-login?logout=1');
}

function round2(n) {
  return Math.round((parseFloat(n) || 0) * 100) / 100;
}

function cleanDoc(doc) {
  return Object.fromEntries(
    Object.entries(doc).filter(([, value]) => value !== undefined && value !== null && value !== ''),
  );
}

async function parseResponse(res) {
  let data;
  try {
    data = await res.json();
  } catch {
    data = {};
  }
  if (res.status === 401) {
    handle401();
    throw new Error('Session expired');
  }
  if (!res.ok) {
    const msg =
      data?.exception ||
      data?.message ||
      data?._server_messages ||
      `HTTP ${res.status}`;
    const err = new Error(String(msg).split('\n')[0].slice(0, 300));
    err.status = res.status;
    throw err;
  }
  return data;
}

export async function apiGet(endpoint) {
  const headers = getAuthHeaders(null);
  if (!headers) throw new Error('Not authenticated');
  delete headers['Content-Type'];
  try {
    const res = await fetch(endpoint, { headers });
    return await parseResponse(res);
  } catch (e) {
    if (e.message === 'Session expired') throw e;
    throw new Error(e.message || 'Network error', { cause: e });
  }
}

export async function apiPost(endpoint, body) {
  const headers = getAuthHeaders();
  if (!headers) throw new Error('Not authenticated');
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    return await parseResponse(res);
  } catch (e) {
    if (e.message === 'Session expired') throw e;
    throw new Error(e.message || 'Network error', { cause: e });
  }
}

export async function apiPut(endpoint, body) {
  const headers = getAuthHeaders();
  if (!headers) throw new Error('Not authenticated');
  try {
    const res = await fetch(endpoint, {
      method: 'PUT',
      headers,
      body: JSON.stringify(body),
    });
    return await parseResponse(res);
  } catch (e) {
    if (e.message === 'Session expired') throw e;
    throw new Error(e.message || 'Network error', { cause: e });
  }
}

export async function apiMethod(method, args = {}) {
  return apiPost(`/api/method/${method}`, args);
}

export function getData(res) {
  return res?.data ?? res?.message ?? res;
}

const CUSTOMER_FIELDS = [
  'name',
  'customer_name',
  'mobile_no',
  'email_id',
  'customer_group',
  'territory',
];

export async function searchCustomers(query) {
  const q = (query || '').trim();
  if (!q) {
    try {
      const res = await apiMethod('frappe.client.get_list', {
        doctype: 'Customer',
        fields: CUSTOMER_FIELDS,
        limit_page_length: 10,
        order_by: 'modified desc',
      });
      return getData(res) || [];
    } catch {
      const fields = JSON.stringify(CUSTOMER_FIELDS);
      const res = await apiGet(
        `/api/resource/Customer?fields=${encodeURIComponent(fields)}&limit_page_length=10&order_by=modified desc`,
      );
      return getData(res) || [];
    }
  }
  const orFilters = [
    ['Customer', 'customer_name', 'like', `%${q}%`],
    ['Customer', 'mobile_no', 'like', `%${q}%`],
  ];

  try {
    const res = await apiMethod('frappe.client.get_list', {
      doctype: 'Customer',
      fields: CUSTOMER_FIELDS,
      or_filters: orFilters,
      limit_page_length: 10,
      order_by: 'modified desc',
    });
    const rows = getData(res) || [];
    return mergeByName(rows, await searchCustomersByContact(q));
  } catch {
    const fields = JSON.stringify(CUSTOMER_FIELDS);
    const res = await apiGet(
      `/api/resource/Customer?fields=${encodeURIComponent(fields)}&or_filters=${encodeURIComponent(JSON.stringify(orFilters))}&limit_page_length=10&order_by=modified desc`,
    );
    const rows = getData(res) || [];
    return mergeByName(rows, await searchCustomersByContact(q));
  }
}

// Customers whose name matches exactly (case-insensitive) — warns before creating a same-name duplicate.
export async function getCustomersByName(customerName) {
  const n = (customerName || '').trim();
  if (!n) return [];
  try {
    const filters = JSON.stringify([['customer_name', 'like', n.replace(/[%_]/g, '\\$&')]]);
    const fields = JSON.stringify(CUSTOMER_FIELDS);
    const res = await apiGet(
      `/api/resource/Customer?fields=${encodeURIComponent(fields)}&filters=${encodeURIComponent(filters)}&limit_page_length=10`,
    );
    return getData(res) || [];
  } catch {
    return [];
  }
}

export async function getCustomerByMobile(mobile) {
  const normalized = normalizeMobile(mobile);
  if (!normalized) return null;

  try {
    const filters = JSON.stringify([['Customer', 'mobile_no', '=', normalized]]);
    const fields = JSON.stringify(CUSTOMER_FIELDS);
    const res = await apiGet(
      `/api/resource/Customer?fields=${encodeURIComponent(fields)}&filters=${encodeURIComponent(filters)}&limit_page_length=1`,
    );
    const rows = getData(res) || [];
    if (rows[0]) return rows[0];
  } catch {
    // Fall through to linked Contact lookup.
  }

  try {
    const filters = JSON.stringify([['Contact', 'mobile_no', '=', normalized]]);
    const fields = JSON.stringify(['name', 'first_name', 'mobile_no', 'email_id']);
    const res = await apiGet(
      `/api/resource/Contact?fields=${encodeURIComponent(fields)}&filters=${encodeURIComponent(filters)}&limit_page_length=1`,
    );
    const rows = getData(res) || [];
    const contact = rows[0];
    if (!contact?.name) return null;
    const linkedCustomer = await getLinkedCustomerName('Contact', contact.name);
    if (!linkedCustomer) return null;
    const customer = await getCustomerDetails(linkedCustomer);
    return {
      ...customer,
      mobile_no: customer?.mobile_no || contact.mobile_no || normalized,
      email_id: customer?.email_id || contact.email_id || '',
    };
  } catch {
    return null;
  }
}

export async function getCustomerDetails(name) {
  const res = await apiGet(
    `/api/resource/Customer/${encodeURIComponent(name)}`,
  );
  const customer = getData(res) || {};
  const [address, contact] = await Promise.all([
    getFirstLinkedDoc('Address', name, [
      'name',
      'address_line1',
      'city',
      'state',
      'pincode',
      'gstin',
    ]),
    getFirstLinkedDoc('Contact', name, [
      'name',
      'first_name',
      'mobile_no',
      'phone',
      'email_id',
    ]),
  ]);
  return {
    ...customer,
    mobile_no: customer.mobile_no || contact?.mobile_no || contact?.phone || '',
    email_id: customer.email_id || contact?.email_id || '',
    address_line1: address?.address_line1 || '',
    city: address?.city || customer.city || '',
    state: address?.state || customer.state || '',
    pincode: address?.pincode || customer.pincode || '',
    gstin: address?.gstin || customer.gstin || '',
  };
}

export async function createCustomerWithLinks(payload) {
  const customerName = (payload.customer_name || '').trim();
  const firstName = (payload.first_name || customerName).trim();
  const lastName = (payload.last_name || '').trim();
  const mobileNo = normalizeMobile(payload.mobile_no);
  const emailId = (payload.email_id || '').trim();
  const defaults = await getCustomerDefaults();

  const customerRes = await apiPost('/api/resource/Customer', {
    doctype: 'Customer',
    customer_name: customerName,
    customer_type: 'Individual',
    customer_group: defaults.customer_group,
    territory: defaults.territory,
    mobile_no: mobileNo,
    email_id: emailId,
    pan: payload.pan || '',
    gstin: payload.gstin || '',
    custom_aadhar_card: payload.aadhaar_no || '',
    custom_date_of_birth: payload.date_of_birth || undefined,
    custom_date_of_anniversary: payload.anniversary || undefined,
  });
  const customer = getData(customerRes);
  const customerId = customer?.name;
  if (!customerId) throw new Error('Customer creation failed');

  const hasAddressDetails = payload.address_line1 || payload.address_line2 || payload.city || payload.pincode || payload.gstin;
  if (hasAddressDetails) {
    try {
      await apiPost('/api/resource/Address', cleanDoc({
        doctype: 'Address',
        address_title: customerName,
        address_type: payload.is_shipping_address && !payload.is_primary_address ? 'Shipping' : 'Billing',
        is_primary_address: payload.is_primary_address ? 1 : 0,
        is_shipping_address: payload.is_shipping_address ? 1 : 0,
        address_line1: payload.address_line1 || '',
        address_line2: payload.address_line2 || '',
        city: payload.city || '',
        state: payload.state || '',
        pincode: payload.pincode || '',
        country: payload.country || 'India',
        gstin: payload.gstin || '',
        links: [
          {
            doctype: 'Dynamic Link',
            link_doctype: 'Customer',
            link_name: customerId,
            link_title: customerName,
          },
        ],
      }));
    } catch (e) {
      console.warn('Address create:', e.message);
    }
  }

  if (mobileNo || emailId) {
    try {
      await apiPost('/api/resource/Contact', cleanDoc({
        doctype: 'Contact',
        salutation: payload.salutation || '',
        first_name: firstName,
        last_name: lastName,
        mobile_no: mobileNo,
        email_id: emailId,
        links: [
          {
            doctype: 'Dynamic Link',
            link_doctype: 'Customer',
            link_name: customerId,
            link_title: customerName,
          },
        ],
      }));
    } catch (e) {
      console.warn('Contact create:', e.message);
    }
  }

  let imageUrl = '';
  if (payload.imageFile) {
    try {
      imageUrl = await uploadFile(payload.imageFile, { doctype: 'Customer', docname: customerId, fieldname: 'image' });
    } catch (e) {
      console.warn('Customer image upload:', e.message);
    }
  }

  return {
    ...customer,
    name: customerId,
    customer_name: customer.customer_name || customerName,
    mobile_no: customer.mobile_no || mobileNo,
    email_id: customer.email_id || emailId,
    address_line1: payload.address_line1 || '',
    address_line2: payload.address_line2 || '',
    city: payload.city || '',
    state: payload.state || '',
    pincode: payload.pincode || '',
    country: payload.country || 'India',
    gstin: payload.gstin || '',
    salutation: payload.salutation || '',
    image: imageUrl || customer.image || '',
  };
}

// Frappe's upload_file endpoint: when doctype/docname/fieldname are given, it both stores the
// file AND sets that field on the target doc server-side — no separate PATCH needed.
export async function uploadFile(file, { doctype, docname, fieldname, isPrivate = 0 } = {}) {
  const headers = getAuthHeaders(null);
  if (!headers) throw new Error('Not authenticated');
  delete headers['Content-Type']; // let the browser set the multipart boundary
  const fd = new FormData();
  fd.append('file', file);
  fd.append('is_private', isPrivate ? '1' : '0');
  if (doctype) fd.append('doctype', doctype);
  if (docname) fd.append('docname', docname);
  if (fieldname) fd.append('fieldname', fieldname);
  const res = await fetch('/api/method/upload_file', { method: 'POST', headers, body: fd });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.exception || data?.message || `HTTP ${res.status}`);
  return data?.message?.file_url || '';
}

function normalizeMobile(value) {
  return String(value || '').replace(/\D/g, '');
}

function mergeByName(...groups) {
  const byName = new Map();
  groups.flat().forEach((row) => {
    if (!row?.name || byName.has(row.name)) return;
    byName.set(row.name, row);
  });
  return [...byName.values()];
}

async function searchCustomersByContact(query) {
  const q = (query || '').trim();
  if (!q) return [];
  try {
    const fields = JSON.stringify(['name', 'first_name', 'mobile_no', 'email_id']);
    const orFilters = JSON.stringify([
      ['Contact', 'first_name', 'like', `%${q}%`],
      ['Contact', 'mobile_no', 'like', `%${q}%`],
      ['Contact', 'phone', 'like', `%${q}%`],
    ]);
    const res = await apiGet(
      `/api/resource/Contact?fields=${encodeURIComponent(fields)}&or_filters=${encodeURIComponent(orFilters)}&limit_page_length=5&order_by=modified desc`,
    );
    const contacts = getData(res) || [];
    const rows = await Promise.all(
      contacts.map(async (contact) => {
        const linkedCustomer = await getLinkedCustomerName('Contact', contact.name);
        if (!linkedCustomer) return null;
        try {
          const customer = await getCustomerDetails(linkedCustomer);
          return {
            ...customer,
            mobile_no: customer?.mobile_no || contact.mobile_no || '',
            email_id: customer?.email_id || contact.email_id || '',
          };
        } catch {
          return {
            name: linkedCustomer,
            customer_name: linkedCustomer,
            mobile_no: contact.mobile_no || '',
            email_id: contact.email_id || '',
          };
        }
      }),
    );
    return rows.filter(Boolean);
  } catch {
    return [];
  }
}

async function getLinkedCustomerName(parenttype, parent) {
  try {
    const fields = JSON.stringify(['link_name']);
    const filters = JSON.stringify([
      ['Dynamic Link', 'parenttype', '=', parenttype],
      ['Dynamic Link', 'parent', '=', parent],
      ['Dynamic Link', 'link_doctype', '=', 'Customer'],
    ]);
    const res = await apiGet(
      `/api/resource/Dynamic%20Link?fields=${encodeURIComponent(fields)}&filters=${encodeURIComponent(filters)}&limit_page_length=1`,
    );
    const rows = getData(res) || [];
    return rows[0]?.link_name || '';
  } catch {
    return '';
  }
}

async function getFirstLinkedDoc(parenttype, customerName, fields) {
  try {
    const linkFields = JSON.stringify(['parent']);
    const filters = JSON.stringify([
      ['Dynamic Link', 'parenttype', '=', parenttype],
      ['Dynamic Link', 'link_doctype', '=', 'Customer'],
      ['Dynamic Link', 'link_name', '=', customerName],
    ]);
    const linkRes = await apiGet(
      `/api/resource/Dynamic%20Link?fields=${encodeURIComponent(linkFields)}&filters=${encodeURIComponent(filters)}&limit_page_length=1&order_by=modified desc`,
    );
    const linkRows = getData(linkRes) || [];
    const parent = linkRows[0]?.parent;
    if (!parent) return null;
    const docRes = await apiGet(
      `/api/resource/${encodeURIComponent(parenttype)}/${encodeURIComponent(parent)}?fields=${encodeURIComponent(JSON.stringify(fields))}`,
    );
    return getData(docRes);
  } catch {
    return null;
  }
}

let customerDefaultsCache = null;

async function getCustomerDefaults() {
  if (customerDefaultsCache) return customerDefaultsCache;
  const [customerGroup, territory] = await Promise.all([
    getExistingDocName('Customer Group', 'Individual', [
      ['Customer Group', 'is_group', '=', 0],
    ]),
    getExistingDocName('Territory', 'India', [
      ['Territory', 'is_group', '=', 0],
    ]),
  ]);
  customerDefaultsCache = {
    customer_group: customerGroup || 'Individual',
    territory: territory || 'India',
  };
  return customerDefaultsCache;
}

async function getExistingDocName(doctype, preferred, fallbackFilters) {
  try {
    const res = await apiGet(
      `/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(preferred)}?fields=${encodeURIComponent(JSON.stringify(['name']))}`,
    );
    const doc = getData(res);
    if (doc?.name) return doc.name;
  } catch {
    // Try the first available leaf value below.
  }

  try {
    const res = await apiGet(
      `/api/resource/${encodeURIComponent(doctype)}?fields=${encodeURIComponent(JSON.stringify(['name']))}&filters=${encodeURIComponent(JSON.stringify(fallbackFilters))}&limit_page_length=1`,
    );
    const rows = getData(res) || [];
    return rows[0]?.name || preferred;
  } catch {
    return preferred;
  }
}

const PURCHASE_RECEIPT_ITEM_FIELDS = [
  'name',
  'item_code',
  'item_name',
  'description',
  'stock_uom',
  'gst_hsn_code',
  'standard_rate',
  'valuation_rate',
  'last_purchase_rate',
  'image',
  'variant_of',
  'attributes',
  'custom_gross_weight',
  'custom_net_weight',
  'custom_tounch',
  'custom_no_of_tag',
  'custom_is_finished_item',
  'custom_is_set',
  'custom_item_category1',
];

const SAFE_ITEM_FIELDS = [
  'name',
  'item_code',
  'item_name',
  'description',
  'stock_uom',
  'gst_hsn_code',
  'standard_rate',
  'valuation_rate',
  'last_purchase_rate',
  'image',
  'has_serial_no',
  'has_batch_no',
];

const PURCHASE_RECEIPT_SERIAL_FIELDS = [
  'name',
  'parent',
  'parenttype',
  'item_code',
  'item_name',
  'description',
  'qty',
  'received_qty',
  'rate',
  'amount',
  'uom',
  'stock_uom',
  'warehouse',
  'gst_hsn_code',
  'batch_no',
  'serial_no',
  'serial_and_batch_bundle',
  'custom_bom',
  'custom_gross_weight',
  'custom_net_weight',
  'custom_tounch',
  'custom_wastage',
  'custom_packet_no',
  'custom_image',
  'modified',
];

const MINIMAL_PURCHASE_RECEIPT_SERIAL_FIELDS = [
  'name',
  'parent',
  'item_code',
  'item_name',
  'description',
  'qty',
  'rate',
  'amount',
  'uom',
  'stock_uom',
  'warehouse',
  'batch_no',
  'serial_no',
  'serial_and_batch_bundle',
  'custom_bom',
  'custom_gross_weight',
  'custom_net_weight',
  'custom_tounch',
  'custom_wastage',
  'custom_image',
  'modified',
];

const receiptSerialCache = new Map();
const serialBatchBundleCache = new Map();

// Marks an error as a deliberate POS scan validation failure (Delivered serial, missing Metal
// Price List rate, etc.) so it's re-thrown straight to the scan handler's toast instead of being
// swallowed as a "not found, try the next lookup" case.
function posValidationError(message) {
  const err = new Error(message);
  err.isPosValidation = true;
  return err;
}

// allowDelivered is for viewing an already-sold piece (a submitted invoice reopened read-only in
// POS) — it still needs the same receipt/BOM breakup, but must never be used to bill it again.
// Explicit fields keep scan-time lookups light — an unrestricted GET would also pull back every
// custom field on the doc, including the (potentially several) image URLs stored in
// custom_serial_no_images, on every single POS scan. The BOM / weight fields are written onto the
// serial on Purchase Receipt submit, so a scan can price the piece without finding its receipt row.
const POS_SERIAL_FIELDS = JSON.stringify([
  'name',
  'item_code',
  'item_name',
  'warehouse',
  'status',
  'batch_no',
  'custom_sell_rate',
  'custom_parent_serial_no',
  'custom_bom',
  'custom_gross_weight',
  'custom_net_weight',
  'custom_tounch',
  'purchase_rate',
  'reference_doctype',
  'reference_name',
]);

export async function lookupByTag(tag, { allowDelivered = false } = {}) {
  const trimmed = (tag || '').trim();
  if (!trimmed) return null;

  // Serial No (tag) and Batch ID (printed on a batch's barcode label — loose raw-material stock
  // sold by qty) are looked up at once, so a batch scan doesn't wait out a Serial No miss first.
  const [serial, batch] = await Promise.all([
    fetchSerialForPos(trimmed),
    fetchBatchDoc(trimmed).catch((e) => {
      if (!isNotFoundError(e)) console.warn('Batch lookup:', e.message);
      return null;
    }),
  ]);

  if (serial?.name) {
    try {
      return await enrichItemFromSerial(serial, { allowDelivered });
    } catch (e) {
      if (e.isPosValidation) throw e;
      console.warn('Serial lookup:', e.message);
    }
  }

  if (batch?.name) {
    try {
      return await batchToCartLine(batch, { allowDelivered });
    } catch (e) {
      if (e.isPosValidation) throw e;
      console.warn('Batch lookup:', e.message);
    }
  }

  // Fallback: ERPNext Item Barcode child table.
  try {
    const barcodeFields = JSON.stringify(['parent', 'barcode']);
    const barcodeFilters = JSON.stringify([['Item Barcode', 'barcode', '=', trimmed]]);
    const barcodeRes = await apiGet(
      `/api/resource/Item%20Barcode?fields=${encodeURIComponent(barcodeFields)}&filters=${encodeURIComponent(barcodeFilters)}&limit_page_length=1`,
    );
    const barcodes = getData(barcodeRes) || [];
    const parentItem = barcodes[0]?.parent;
    if (parentItem) {
      const item = await fetchItemForPos(parentItem);
      return mapItemToCartLine(item, trimmed, { barcode: trimmed });
    }
  } catch (e) {
    console.warn('Barcode lookup:', e.message);
  }

  // Fallback: item_code exact match, same Item API shape used by Purchase Receipt.
  try {
    const item = await fetchItemForPos(trimmed);
    if (item?.name) return mapItemToCartLine(item, trimmed);
  } catch {
    // not found by item code
  }

  return null;
}

function isNotFoundError(e) {
  return e?.status === 404 || e?.cause?.status === 404 || /DoesNotExistError/.test(e?.message || '');
}

// The Serial No itself, or null when there's no such serial. Only a failure other than "not
// found" (e.g. no read access to the doc) tries the list API as well, which may still return it.
async function fetchSerialForPos(name) {
  try {
    const res = await apiGet(
      `/api/resource/Serial%20No/${encodeURIComponent(name)}?fields=${encodeURIComponent(POS_SERIAL_FIELDS)}`,
    );
    return getData(res) || null;
  } catch (e) {
    if (isNotFoundError(e)) return null;
    console.warn('Serial doc lookup:', e.message);
  }
  try {
    const filters = JSON.stringify([['Serial No', 'name', '=', name]]);
    const res = await apiGet(
      `/api/resource/Serial%20No?fields=${encodeURIComponent(POS_SERIAL_FIELDS)}&filters=${encodeURIComponent(filters)}&limit_page_length=1`,
    );
    return (getData(res) || [])[0] || null;
  } catch (e) {
    console.warn('Serial lookup:', e.message);
    return null;
  }
}

// Set tag line -> the piece serials found while building it, so lookupLinesByTag needn't fetch
// them a second time.
const setPiecesByLine = new WeakMap();

async function enrichItemFromSerial(serial, { allowDelivered = false } = {}) {
  const itemCode = serial.item_code;
  if (!itemCode) return null;
  if (!allowDelivered && String(serial.status || '').trim().toLowerCase() === 'delivered') {
    throw posValidationError(`Serial No ${serial.name} is already Delivered and cannot be billed again.`);
  }
  let item;
  try {
    item = await fetchItemForPos(itemCode);
  } catch {
    item = { item_code: itemCode, item_name: serial.item_name || itemCode };
  }

  // Set item (Item "Is Set"): its value and weight live on its pieces, so the set's own serial
  // is billed as a ₹0 tag line. A set whose pieces were unlinked was broken by an earlier sale
  // of one piece; a set received before pieces existed has none and sells as a normal line.
  if (Number(item.custom_is_set)) {
    const pieces = await fetchSetPieceSerials(serial.name);
    if (pieces.length) {
      const line = setTagLine(item, serial);
      setPiecesByLine.set(line, pieces);
      return line;
    }
    if (!allowDelivered && String(serial.status || '').trim().toLowerCase() !== 'active') {
      throw posValidationError(`Set ${serial.name} was already broken — scan its pieces individually.`);
    }
  }

  const cartLine = {
    ...mapItemToCartLine(item, serial.name, { serial }),
    serial_no: serial.name,
    tag: serial.name,
    warehouse: serial.warehouse || '',
    batch_no: serial.batch_no || '',
  };
  // The serial's own BOM + weights price it at today's rates without its receipt row. The
  // receipt row (found via the serial's reference_name first) is only needed when the serial has
  // no BOM, or the BOM has no live rate and the purchase rate becomes the fallback.
  let bomBreakup = serial.custom_bom ? await fetchBomBreakup(serial.custom_bom) : null;
  let receiptItem = bomBreakup?.hasLiveRate ? receiptItemFromSerial(serial, item) : null;
  if (!receiptItem) {
    const fromReceipt = await fetchReceiptItemForSerial(serial.name, itemCode, serial);
    if (fromReceipt) {
      receiptItem = fromReceipt;
      const receiptBom = fromReceipt.custom_bom || '';
      if (receiptBom !== (bomBreakup?.bomName || '')) bomBreakup = receiptBom ? await fetchBomBreakup(receiptBom) : null;
    } else if (bomBreakup) {
      receiptItem = receiptItemFromSerial(serial, item);
    }
  }
  let line;
  if (!receiptItem) {
    line = {
      ...cartLine,
      pricing_warning: `Receipt pricing not found for ${serial.name}; using Item master rate.`,
    };
  } else {
    line = applyReceiptItemToCartLine(cartLine, receiptItem, bomBreakup);
  }
  const parentSet = serial.custom_parent_serial_no || '';
  if (parentSet) line = { ...line, set_serial: parentSet, set_note: `Part of set ${parentSet}` };
  // Diamond Studded items carry the Diamond Margin instead of the Tounch Wise Margin.
  return applySellRateMargin(line, bomBreakup?.isStudded ? 0 : serial.custom_sell_rate);
}

// A one-piece receipt row built from the Serial No's own fields (per-piece weights, so qty 1).
function receiptItemFromSerial(serial, item) {
  const rate = parseFloat(serial.purchase_rate || 0) || 0;
  return {
    item_code: serial.item_code,
    item_name: serial.item_name || item.item_name,
    description: item.description || serial.item_name || item.item_name,
    qty: 1,
    rate,
    amount: rate,
    uom: item.stock_uom,
    custom_bom: serial.custom_bom,
    custom_gross_weight: serial.custom_gross_weight,
    custom_net_weight: serial.custom_net_weight,
    custom_tounch: serial.custom_tounch,
  };
}

const BATCH_FIELDS = ['name', 'item', 'item_name', 'disabled', 'expiry_date', 'batch_qty', 'stock_uom', 'custom_pcs'];

async function fetchBatchDoc(batchId) {
  const fields = encodeURIComponent(JSON.stringify(BATCH_FIELDS));
  const res = await apiGet(`/api/resource/Batch/${encodeURIComponent(batchId)}?fields=${fields}`);
  return getData(res) || {};
}

// Stock left in a batch, per warehouse — ERPNext's get_batch_qty returns [{warehouse, qty}]
// when called with only a batch_no. Falls back to the Batch's own batch_qty (warehouse unknown,
// so ERPNext uses the item/POS default) if the method isn't reachable for this user.
async function fetchBatchWarehouseQty(batch) {
  try {
    const rows = getData(await apiMethod('erpnext.stock.doctype.batch.batch.get_batch_qty', { batch_no: batch.name }));
    if (Array.isArray(rows)) {
      return rows
        .map((r) => ({ warehouse: r.warehouse || '', qty: Math.round((parseFloat(r.qty) || 0) * 1000) / 1000 }))
        .filter((r) => r.qty > 0);
    }
  } catch (e) {
    console.warn('get_batch_qty failed:', e.message);
  }
  const qty = parseFloat(batch.batch_qty) || 0;
  return qty > 0 ? [{ warehouse: '', qty }] : [];
}

// Per-unit selling rate for a batch item (per gram for metal, per carat for diamond, ...) from
// the price list its Item Group points to — Gold/Silver/Platinum → Metal Price List by the
// item's purity attribute, Diamond → Diamond Price List, Stone → Gemstone Price List. Anything
// else (or no price-list match) is 0, for the cashier to type in.
async function fetchBatchItemRate(item, kind, metalType) {
  if (kind === 'other') return { rate: 0, purityLabel: '' };
  const ppSettings = await loadPPSettings();
  const getAttr = (label) => getItemAttrValue(item.attributes, label);
  if (kind === 'metal') {
    const purityLabel = getAttr(ppSettings.metalMap[metalType] || `${metalType} Purity`);
    return { rate: await fetchMetalPriceListRate(metalType, purityLabel), purityLabel };
  }
  if (kind === 'stone') {
    return { rate: await fetchAttrMappedRate(getAttr, ppSettings.gemstoneAttrs, 'Gemstone Price List', item.stock_uom || ''), purityLabel: '' };
  }
  return { rate: await fetchAttrMappedRate(getAttr, ppSettings.diamondAttrs, 'Diamond Price List'), purityLabel: '' };
}

/**
 * Batch → one cart line sold by qty. The per-unit rate sits in the component its Item Group
 * belongs to, so qty × rate flows through calcLineBreakup like any other line: metal as
 * Net Wt 1 g × Metal Rate (so weight totals read qty grams), diamond/stone/other as their own
 * per-unit value. When the batch has stock in several warehouses the line carries
 * batch_warehouse_options for the cashier to pick one.
 */
async function batchToCartLine(batch, { allowDelivered = false } = {}) {
  const itemCode = batch.item;
  if (!itemCode) return null;
  const item = await fetchItemDoc(itemCode, [
    'name', 'item_code', 'item_name', 'description', 'stock_uom', 'gst_hsn_code', 'image',
    'item_group', 'has_batch_no', 'attributes',
  ]);
  if (!Number(item.has_batch_no)) {
    throw posValidationError(`${itemCode} is not a batch item (Has Batch No is off) — batch ${batch.name} can't be billed.`);
  }
  if (!allowDelivered) {
    if (Number(batch.disabled)) throw posValidationError(`Batch ${batch.name} is disabled and can't be billed.`);
    if (batch.expiry_date && batch.expiry_date < new Date().toLocaleDateString('en-CA')) {
      throw posValidationError(`Batch ${batch.name} expired on ${batch.expiry_date} and can't be billed.`);
    }
  }
  const stock = allowDelivered ? [] : await fetchBatchWarehouseQty(batch);
  if (!allowDelivered && !stock.length) throw posValidationError(`Batch ${batch.name} has no stock left.`);

  const { kind, metalType } = classifyBomItemGroup(item.item_group);
  const [{ rate, purityLabel }, uomSymbol] = await Promise.all([
    fetchBatchItemRate(item, kind, metalType),
    fetchUomSymbol(item.stock_uom || batch.stock_uom),
  ]);
  const availablePcs = parseInt(batch.custom_pcs || 0, 10) || 0;
  const first = stock[0] || { warehouse: '', qty: 0 };
  const kindLabel = { metal: metalType, diamond: 'Diamond', stone: 'Stone' }[kind] || 'this item';

  return {
    item_code: item.item_code || item.name || itemCode,
    item_name: item.item_name || batch.item_name || itemCode,
    description: item.description || item.item_name || itemCode,
    tag: batch.name,
    batch_no: batch.name,
    is_batch: true,
    batch_kind: kind,
    batch_uom_label: uomSymbol || item.stock_uom || '',
    batch_available_qty: first.qty,
    batch_available_pcs: availablePcs,
    batch_warehouse_options: stock.length > 1 ? stock : null,
    warehouse: first.warehouse,
    qty: Math.min(1, first.qty) || 1,
    pcs: 0,
    uom: item.stock_uom || batch.stock_uom || 'Nos',
    rate: 0,
    backend_rate: 0,
    prefer_backend_rate: false,
    rate_source: 'batch',
    gross_wt: kind === 'metal' ? 1 : 0,
    net_wt: kind === 'metal' ? 1 : 0,
    tounch: purityLabel,
    current_metal_rate: kind === 'metal' ? rate : '',
    metal_rate_is_touch: kind === 'metal' && rate > 0,
    metal_touch_label: kind === 'metal' ? purityLabel : '',
    diamond_value: kind === 'diamond' ? rate : 0,
    diamond_wt: kind === 'diamond' ? 1 : 0,
    diamond_uom: kind === 'diamond' ? uomSymbol : '',
    stone_value: kind === 'stone' ? rate : 0,
    stone_wt: kind === 'stone' ? 1 : 0,
    stone_uom: kind === 'stone' ? uomSymbol : '',
    other_charges: kind === 'other' ? rate : 0,
    gst_hsn_code: item.gst_hsn_code || '',
    image: item.image || '',
    pricing_warning: rate > 0 ? '' : `No price-list rate for ${kindLabel} — enter the rate.`,
  };
}

/**
 * After a batch sale (sign -1) or its return/cancel (sign +1): moves each batch's custom_pcs by
 * the Pcs on those lines. Best-effort and non-throwing — the invoice is already submitted —
 * each batch is retried once; returns the batches that still failed.
 */
export async function adjustBatchPcs(lines, sign) {
  const byBatch = {};
  (lines || []).forEach((l) => {
    const pcs = Math.abs(parseInt(l.pcs ?? l.custom_pcs ?? 0, 10) || 0);
    if (l.batch_no && pcs > 0) byBatch[l.batch_no] = (byBatch[l.batch_no] || 0) + pcs;
  });
  const failed = [];
  for (const [batchNo, pcs] of Object.entries(byBatch)) {
    let done = false;
    for (let attempt = 0; attempt < 2 && !done; attempt++) {
      try {
        const fields = encodeURIComponent(JSON.stringify(['custom_pcs']));
        const doc = getData(await apiGet(`/api/resource/Batch/${encodeURIComponent(batchNo)}?fields=${fields}`)) || {};
        const current = parseInt(doc.custom_pcs || 0, 10) || 0;
        await apiPut(`/api/resource/Batch/${encodeURIComponent(batchNo)}`, { custom_pcs: Math.max(0, current + sign * pcs) });
        done = true;
      } catch (e) {
        console.error(`Batch ${batchNo} Pcs update failed (attempt ${attempt + 1}):`, e.message);
      }
    }
    if (!done) failed.push(batchNo);
  }
  return { failed };
}

// Pieces of a set — Serial Nos whose custom_parent_serial_no is the set's Serial No (written by
// Purchase Receipt on submit, cleared when the set is broken).
async function fetchSetPieceSerials(setSerial) {
  try {
    return await fetchDocList(
      'Serial No',
      ['name', 'item_code', 'status'],
      [['Serial No', 'custom_parent_serial_no', '=', setSerial]],
      { limit: 50, orderBy: 'name asc' },
    );
  } catch (e) {
    console.warn('Set pieces lookup:', e.message);
    return [];
  }
}

// The set's own serial as a ₹0 line — no weights or components, so it adds nothing to totals,
// but it's on the invoice so it leaves stock together with its pieces.
function setTagLine(item, serial) {
  return {
    item_code: item.item_code || item.name || serial.item_code,
    item_name: `${item.item_name || item.item_code || serial.item_code} (set tag)`,
    description: item.description || item.item_name || serial.item_code,
    tag: serial.name,
    serial_no: serial.name,
    qty: 1,
    uom: item.stock_uom || 'Nos',
    rate: 0,
    backend_rate: 0,
    prefer_backend_rate: true,
    rate_source: 'set_tag',
    is_set_tag: true,
    set_note: 'Set tag · value is on its pieces',
    gst_hsn_code: item.gst_hsn_code || '',
    image: item.image || '',
    warehouse: serial.warehouse || '',
    batch_no: serial.batch_no || '',
  };
}

/**
 * Scan → cart lines. A set's serial returns its ₹0 set tag line followed by each of its pieces
 * still in stock (so the whole set is billed as its pieces); anything else returns the one
 * line lookupByTag gives (a piece scanned on its own carries set_serial — see
 * breakSetsForSoldLines). Empty array when nothing matches.
 */
export async function lookupLinesByTag(tag, options = {}) {
  const line = await lookupByTag(tag, options);
  if (!line) return [];
  if (!line.is_set_tag) return [line];
  const pieces = (setPiecesByLine.get(line) || await fetchSetPieceSerials(line.serial_no))
    .filter((p) => String(p.status || '').trim().toLowerCase() === 'active');
  if (!pieces.length) throw posValidationError(`Set ${line.serial_no} has no pieces left in stock.`);
  // All pieces at once; they keep the set's order.
  const pieceLines = await Promise.all(pieces.map((piece) => lookupByTag(piece.name, options)));
  return [line, ...pieceLines.filter(Boolean).map((pieceLine) => ({ ...pieceLine, set_note: `Set ${line.serial_no}` }))];
}

/**
 * After an invoice is submitted: every set that had a piece sold WITHOUT its set tag is broken —
 * the set's ₹0 Serial No is taken out of stock (Material Issue, no accounting impact since it
 * carries no value) and its remaining pieces are unlinked so they sell as individual items.
 * The sold piece keeps its link for history. Best-effort and non-throwing, like the other
 * post-submit steps; returns which sets were broken and which failed.
 */
export async function breakSetsForSoldLines(lines, invoiceName) {
  const sold = new Set((lines || []).map((l) => l.serial_no).filter(Boolean));
  const setSerials = [...new Set((lines || [])
    .filter((l) => l.set_serial && !sold.has(l.set_serial))
    .map((l) => l.set_serial))];
  const broken = [];
  const failed = [];
  const branch = localStorage.getItem('cd_branch') || '';
  for (const setSerial of setSerials) {
    try {
      const fields = encodeURIComponent(JSON.stringify(['name', 'item_code', 'warehouse', 'status']));
      const setDoc = getData(await apiGet(`/api/resource/Serial%20No/${encodeURIComponent(setSerial)}?fields=${fields}`)) || {};
      if (String(setDoc.status || '').trim().toLowerCase() === 'active' && setDoc.warehouse) {
        const res = await apiPost('/api/resource/Stock Entry', {
          doctype: 'Stock Entry',
          stock_entry_type: 'Material Issue',
          purpose: 'Material Issue',
          company: COMPANY,
          posting_date: new Date().toLocaleDateString('en-CA'),
          ...(branch ? { branch } : {}),
          remarks: `Set ${setSerial} broken — piece sold individually on ${invoiceName}`,
          items: [{
            doctype: 'Stock Entry Detail',
            item_code: setDoc.item_code,
            qty: 1,
            transfer_qty: 1,
            uom: 'Nos',
            stock_uom: 'Nos',
            conversion_factor: 1,
            s_warehouse: setDoc.warehouse,
            use_serial_batch_fields: 1,
            serial_no: setSerial,
            allow_zero_valuation_rate: 1,
            basic_rate: 0,
          }],
        });
        const entryName = getData(res)?.name;
        if (!entryName) throw new Error('Stock Entry was not created');
        await apiPut(`/api/resource/Stock%20Entry/${encodeURIComponent(entryName)}`, { docstatus: 1 });
      }
      const pieces = await fetchSetPieceSerials(setSerial);
      for (const piece of pieces) {
        if (sold.has(piece.name)) continue;
        await apiPut(`/api/resource/Serial%20No/${encodeURIComponent(piece.name)}`, { custom_parent_serial_no: '' });
      }
      broken.push(setSerial);
    } catch (e) {
      console.error('Breaking set', setSerial, 'failed:', e.message);
      failed.push(setSerial);
    }
  }
  return { broken, failed };
}

// Serial No's own sell-rate markup (%). Only the percentage is stored here — the margin
// itself is worked out live in calcLineBreakup as today's Metal Value x sell rate % (e.g.
// Metal Value 90,000 at 10% = 9,000 added to Making), so it follows the current Metal Price
// List rate and any Net Wt / metal rate edited in the Pricing Breakup popup.
function applySellRateMargin(line, sellRatePercentRaw) {
  const sellRatePercent = parseFloat(sellRatePercentRaw || 0) || 0;
  if (!(sellRatePercent > 0)) return line;
  return { ...line, sell_rate_percent: sellRatePercent };
}

async function fetchItemForPos(itemCode) {
  try {
    return await fetchItemDoc(itemCode, PURCHASE_RECEIPT_ITEM_FIELDS);
  } catch (e) {
    console.warn('Item full-field lookup:', e.message);
    return fetchItemDoc(itemCode, SAFE_ITEM_FIELDS);
  }
}

async function fetchItemDoc(itemCode, fieldsList) {
  const fields = encodeURIComponent(JSON.stringify(fieldsList));
  const res = await apiGet(
    `/api/resource/Item/${encodeURIComponent(itemCode)}?fields=${fields}`,
  );
  return getData(res) || {};
}

function mapItemToCartLine(item, tag, context = {}) {
  const rate = parseFloat(item.standard_rate || item.valuation_rate || item.last_purchase_rate || 0);
  const grossWt = parseFloat(item.custom_gross_weight || 0);
  const netWt = parseFloat(item.custom_net_weight || grossWt || 0);
  return {
    item_code: item.item_code || item.name,
    item_name: item.item_name || item.item_code,
    description: item.description || item.item_name || item.item_code,
    tag: tag || item.item_code,
    barcode: context.barcode || '',
    qty: 1,
    uom: item.stock_uom || 'Nos',
    rate,
    backend_rate: rate,
    gross_wt: grossWt,
    net_wt: netWt,
    pure_wt: 0,
    metal_value: 0,
    tounch: item.custom_tounch || '',
    wastage: 0,
    making_charges: 0,
    stone_value: 0,
    other_charges: 0,
    rate_source: 'item_master',
    gst_hsn_code: item.gst_hsn_code || '',
    image: item.image || '',
    serial_no: context.serial?.name || '',
    batch_no: context.serial?.batch_no || '',
    warehouse: '',
  };
}

async function fetchReceiptItemForSerial(serialNo, itemCode, serial = {}) {
  const cacheKey = `${itemCode || ''}::${serialNo}`;
  if (receiptSerialCache.has(cacheKey)) return receiptSerialCache.get(cacheKey);

  const fromSerialLink = await fetchReceiptItemFromSerialLink(serialNo, itemCode, serial);
  if (fromSerialLink) return cacheReceiptItem(cacheKey, fromSerialLink);

  const direct = await fetchReceiptItemsBySerialField(serialNo);
  const matchedDirect = await findReceiptRowMatchingSerial(direct, serialNo, itemCode);
  if (matchedDirect) return cacheReceiptItem(cacheKey, matchedDirect);

  const bundleMatch = await fetchReceiptItemByBundleEntry(serialNo, itemCode);
  if (bundleMatch) return cacheReceiptItem(cacheKey, bundleMatch);

  const scannedRows = await fetchReceiptItemByItemBundleScan(serialNo, itemCode);
  if (scannedRows) return cacheReceiptItem(cacheKey, scannedRows);

  const recentReceiptRow = await fetchReceiptItemFromRecentReceipts(serialNo, itemCode);
  return cacheReceiptItem(cacheKey, recentReceiptRow || null);
}

function cacheReceiptItem(cacheKey, receiptItem) {
  receiptSerialCache.set(cacheKey, receiptItem);
  return receiptItem;
}

async function fetchReceiptItemsBySerialField(serialNo) {
  return fetchPurchaseReceiptItems(
    [['Purchase Receipt Item', 'serial_no', 'like', `%${serialNo}%`]],
    20,
  );
}

async function fetchReceiptItemByBundleEntry(serialNo, itemCode) {
  try {
    const entries = await fetchDocList(
      'Serial and Batch Entry',
      ['parent', 'serial_no', 'batch_no'],
      [
        ['Serial and Batch Entry', 'serial_no', '=', serialNo],
      ],
      { limit: 20 },
    );
    const bundleNames = [...new Set(entries.map((row) => row.parent).filter(Boolean))];
    if (!bundleNames.length) return null;
    const rows = await fetchPurchaseReceiptItems(
      [
        ['Purchase Receipt Item', 'serial_and_batch_bundle', 'in', bundleNames],
      ],
      50,
    );
    return findReceiptRowMatchingSerial(rows, serialNo, itemCode);
  } catch (e) {
    console.warn('Purchase Receipt bundle lookup:', e.message);
    return null;
  }
}

async function fetchReceiptItemByItemBundleScan(serialNo, itemCode) {
  if (!itemCode) return null;
  const rows = await fetchPurchaseReceiptItems(
    [['Purchase Receipt Item', 'item_code', '=', itemCode]],
    250,
  );
  return findReceiptRowMatchingSerial(rows, serialNo, itemCode);
}

async function fetchReceiptItemFromSerialLink(serialNo, itemCode, serial) {
  const receiptNames = getSerialReceiptNames(serial);
  for (const receiptName of receiptNames) {
    const row = await fetchReceiptItemFromReceiptDoc(receiptName, serialNo, itemCode);
    if (row) return row;
  }
  return null;
}

function getSerialReceiptNames(serial) {
  const names = [];
  if (
    serial.purchase_document_no &&
    (!serial.purchase_document_type || serial.purchase_document_type === 'Purchase Receipt')
  ) {
    names.push(serial.purchase_document_no);
  }
  if (serial.reference_doctype === 'Purchase Receipt' && serial.reference_name) {
    names.push(serial.reference_name);
  }
  if (serial.purchase_receipt) names.push(serial.purchase_receipt);
  if (serial.purchase_receipt_no) names.push(serial.purchase_receipt_no);
  if (serial.voucher_type === 'Purchase Receipt' && serial.voucher_no) {
    names.push(serial.voucher_no);
  }
  return [...new Set(names.filter(Boolean))];
}

async function fetchReceiptItemFromRecentReceipts(serialNo, itemCode) {
  try {
    const receipts = await fetchDocList(
      'Purchase Receipt',
      ['name', 'modified'],
      [['Purchase Receipt', 'docstatus', '!=', 2]],
      { orderBy: 'modified desc', limit: 100 },
    );
    for (const receipt of receipts) {
      const row = await fetchReceiptItemFromReceiptDoc(receipt.name, serialNo, itemCode);
      if (row) return row;
    }
  } catch (e) {
    console.warn('Recent Purchase Receipt scan:', e.message);
  }
  return null;
}

async function fetchReceiptItemFromReceiptDoc(receiptName, serialNo, itemCode) {
  try {
    const res = await apiGet(
      `/api/resource/Purchase%20Receipt/${encodeURIComponent(receiptName)}`,
    );
    const receipt = getData(res) || {};
    return findReceiptRowMatchingSerial(
      (receipt.items || []).map((row) => normalizeReceiptItem(row, receipt.name)),
      serialNo,
      itemCode,
    );
  } catch (e) {
    console.warn('Purchase Receipt doc lookup:', receiptName, e.message);
    return null;
  }
}

async function fetchPurchaseReceiptItems(filters, limit) {
  try {
    return await fetchDocList(
      'Purchase Receipt Item',
      PURCHASE_RECEIPT_SERIAL_FIELDS,
      filters,
      { orderBy: 'modified desc', limit },
    );
  } catch (e) {
    console.warn('Purchase Receipt item lookup:', e.message);
    try {
      return await fetchDocList(
        'Purchase Receipt Item',
        MINIMAL_PURCHASE_RECEIPT_SERIAL_FIELDS,
        filters,
        { orderBy: 'modified desc', limit },
      );
    } catch (fallbackError) {
      console.warn('Purchase Receipt item fallback lookup:', fallbackError.message);
      return [];
    }
  }
}

async function fetchDocList(doctype, fields, filters, options = {}) {
  const orderBy = options.orderBy || 'modified desc';
  const limit = options.limit || 20;
  try {
    const res = await apiGet(
      `/api/resource/${encodeURIComponent(doctype)}?fields=${encodeURIComponent(JSON.stringify(fields))}&filters=${encodeURIComponent(JSON.stringify(filters))}&order_by=${encodeURIComponent(orderBy)}&limit_page_length=${limit}`,
    );
    return getData(res) || [];
  } catch {
    const res = await apiMethod('frappe.client.get_list', {
      doctype,
      fields,
      filters,
      order_by: orderBy,
      limit_page_length: limit,
    });
    return getData(res) || [];
  }
}

async function findReceiptRowMatchingSerial(rows, serialNo, itemCode) {
  for (const row of rows || []) {
    const normalized = normalizeReceiptItem(row);
    if (itemCode && normalized.item_code && normalized.item_code !== itemCode) continue;
    if (receiptRowMatchesSerial(normalized, serialNo, itemCode)) return normalized;
    if (await receiptRowBundleMatchesSerial(normalized, serialNo)) return normalized;
  }
  return null;
}

function normalizeReceiptItem(row, parentName = '') {
  return {
    ...row,
    parent: row.parent || parentName,
    parenttype: row.parenttype || 'Purchase Receipt',
  };
}

function receiptRowMatchesSerial(row, serialNo, itemCode) {
  if (itemCode && row.item_code && row.item_code !== itemCode) return false;
  const serials = String(row.serial_no || '')
    .split(/[\s,\n]+/)
    .map((value) => value.trim())
    .filter(Boolean);
  return serials.includes(serialNo);
}

async function receiptRowBundleMatchesSerial(row, serialNo) {
  if (!row.serial_and_batch_bundle) return false;
  const bundle = await fetchSerialBatchBundle(row.serial_and_batch_bundle);
  return (bundle?.entries || []).some((entry) => entry.serial_no === serialNo);
}

async function fetchSerialBatchBundle(bundleName) {
  if (!bundleName) return null;
  if (serialBatchBundleCache.has(bundleName)) return serialBatchBundleCache.get(bundleName);
  try {
    const res = await apiGet(
      `/api/resource/Serial%20and%20Batch%20Bundle/${encodeURIComponent(bundleName)}`,
    );
    const bundle = getData(res) || null;
    serialBatchBundleCache.set(bundleName, bundle);
    return bundle;
  } catch (e) {
    console.warn('Serial and Batch Bundle lookup:', e.message);
    serialBatchBundleCache.set(bundleName, null);
    return null;
  }
}

// ── Live price-list rate lookups (Metal/Diamond/Gemstone) for BOM raw materials ──
// Mirrors the "PP Settings1"-driven lookup Purchase Receipt already uses when a BOM is built,
// so a scanned item's component values reflect today's price list instead of the rate frozen
// on the BOM whenever it was last saved. Config (PP Settings1) is cached for the session;
// the actual price list rows are always fetched fresh, per scan.
let ppSettingsCache = null;

async function loadPPSettings() {
  if (ppSettingsCache) return ppSettingsCache;
  try {
    const res = await apiGet('/api/resource/PP%20Settings1/PP%20Settings1');
    const doc = getData(res) || {};
    const metalMap = {};
    (doc.metal_mapping1 || []).forEach((r) => {
      if (r.metal_type && r.item_attribute) metalMap[r.metal_type] = r.item_attribute;
    });
    const posRoleMap = {};
    (doc.pos_role || []).forEach((r) => {
      if (!r.button_type || !r.role) return;
      (posRoleMap[r.button_type] || (posRoleMap[r.button_type] = [])).push(r.role);
    });
    ppSettingsCache = {
      metalMap,
      diamondAttrs: (doc.diamond_price_list_mapping || []).map((r) => r.item_attribute).filter(Boolean),
      gemstoneAttrs: (doc.gemstone_price_list_mapping || []).map((r) => r.item_attribute).filter(Boolean),
      goldPurchaseItemGroups: (doc.gold_purchase_setting || []).map((r) => r.item_group).filter(Boolean),
      posRoleMap,
      // "Item Catefory Wise Diamond Margin": diamond raw material's custom_item_category -> margin %
      diamondCategoryMargin: Object.fromEntries((doc.item_catefory_wise_diamond_margin || [])
        .filter((r) => r.item_category)
        .map((r) => [String(r.item_category).trim().toLowerCase(), parseFloat(r.margin || 0) || 0])),
    };
  } catch (e) {
    console.warn('loadPPSettings failed:', e.message);
    ppSettingsCache = { metalMap: {}, diamondAttrs: [], gemstoneAttrs: [], goldPurchaseItemGroups: [], posRoleMap: {}, diamondCategoryMargin: {} };
  }
  return ppSettingsCache;
}

// ── POS button role-gating (PP Settings1.pos_role: button_type -> role) ──
// A button with no configured row is hidden for everyone except Administrator/System
// Manager, so a forgotten config entry fails closed instead of silently exposing a button.
let currentUserRolesCache = null;

async function fetchCurrentUserRoles() {
  if (currentUserRolesCache) return currentUserRolesCache;
  // Preferred path: a whitelisted server method (frappe.get_roles) that isn't subject to the
  // User doctype's permlevel-1 restriction on the "roles" field, so it needs no Role Permission
  // Manager grant. Falls back to reading the User doc directly if that method isn't deployed yet.
  try {
    const res = await apiMethod('caratdesk_get_current_user_roles');
    const roles = getData(res);
    if (Array.isArray(roles)) return (currentUserRolesCache = roles.filter(Boolean));
  } catch {
    // not deployed yet — fall through to the User-doc lookup below
  }
  try {
    const idRes = await apiMethod('frappe.auth.get_logged_user');
    const email = idRes?.message || localStorage.getItem('cd_user_email') || '';
    if (!email) return (currentUserRolesCache = []);
    const res = await apiGet(`/api/resource/User/${encodeURIComponent(email)}`);
    const doc = getData(res) || {};
    currentUserRolesCache = (doc.roles || []).map((r) => r.role).filter(Boolean);
  } catch (e) {
    console.warn('fetchCurrentUserRoles failed:', e.message);
    currentUserRolesCache = [];
  }
  return currentUserRolesCache;
}

// Single call for the POS page to load both the button->role config and the logged-in
// user's roles once per session.
export async function fetchPosButtonPermissions() {
  const [ppSettings, userRoles] = await Promise.all([loadPPSettings(), fetchCurrentUserRoles()]);
  return { posRoleMap: ppSettings.posRoleMap, userRoles };
}

const POS_ADMIN_ROLES = ['Administrator', 'System Manager'];

export function canShowPosButton(buttonType, userRoles = [], posRoleMap = {}) {
  if (userRoles.some((r) => POS_ADMIN_ROLES.includes(r))) return true;
  const allowedRoles = posRoleMap[buttonType];
  if (!allowedRoles || !allowedRoles.length) return false;
  return allowedRoles.some((r) => userRoles.includes(r));
}

// "Diamond Seive Size" -> "diamond_seive_size" — Diamond/Gemstone Price List fields are
// named exactly this way, matching the PP Settings attribute label.
function ppAttrToFieldName(label) {
  return String(label || '').trim().toLowerCase().replace(/\s+/g, '_');
}

// BOM Item rows carry their own custom_item_group now (set at Purchase Receipt / Make BOM
// time) — that's the authoritative classification for which pricing bucket a row belongs to,
// replacing the old guesswork of pattern-matching the item's name/variant for "gold"/"silver".
function classifyBomItemGroup(itemGroup) {
  const g = String(itemGroup || '').trim().toLowerCase();
  if (g === 'gold') return { kind: 'metal', metalType: 'Gold' };
  if (g === 'silver') return { kind: 'metal', metalType: 'Silver' };
  if (g === 'platinum') return { kind: 'metal', metalType: 'Platinum' };
  if (g === 'diamond') return { kind: 'diamond' };
  if (g === 'stone') return { kind: 'stone' };
  return { kind: 'other' };
}

function getItemAttrValue(itemAttributes, label) {
  const match = (itemAttributes || []).find(
    (a) => (a.attribute || '').trim().toLowerCase() === String(label || '').trim().toLowerCase(),
  );
  return (match?.attribute_value || '').trim();
}

// Price-list rates and raw-material attributes repeat across every BOM row and every scan, so
// they're kept for a few minutes. The promise is cached, so lookups running side by side share one
// request; a failed or zero result isn't kept, so a rate added meanwhile is picked up next scan.
const RATE_CACHE_TTL_MS = 5 * 60 * 1000;
const rateCache = new Map();
function cachedFor(key, fn) {
  const hit = rateCache.get(key);
  if (hit && hit.expires > Date.now()) return hit.promise;
  const promise = fn();
  rateCache.set(key, { promise, expires: Date.now() + RATE_CACHE_TTL_MS });
  promise.then(
    (value) => { if (!value) rateCache.delete(key); },
    () => rateCache.delete(key),
  );
  return promise;
}

// Generic attribute-mapped Price List lookup (Diamond/Gemstone) — builds an exact-match
// filter from whichever attributes PP Settings configures, matched against the raw
// material's own attribute values. Prefers a generic (blank supplier) entry, same as the
// Purchase Receipt page's fetchAttrMappedRate. `uom` (Gemstone Price List only) additionally
// requires an exact match on the list's `uom` field — Gemstone rates are kept per UOM.
async function fetchAttrMappedRate(getAttrValue, priceAttrs, doctype, uom) {
  if (!priceAttrs?.length) return 0;
  const values = priceAttrs.map((attr) => ({ field: ppAttrToFieldName(attr), value: getAttrValue(attr) }));
  if (values.every((v) => !v.value)) return 0;
  if (uom !== undefined && !uom) return 0;
  return cachedFor(`${doctype}|${uom || ''}|${JSON.stringify(values)}`, () => fetchAttrMappedRateUncached(values, doctype, uom));
}

async function fetchAttrMappedRateUncached(values, doctype, uom) {
  try {
    const fields = JSON.stringify([...values.map((v) => v.field), 'supplier', 'outright_rate']);
    const filters = JSON.stringify([
      ['docstatus', '=', 1],
      ...values.map((v) => [v.field, '=', v.value]),
      ...(uom ? [['uom', '=', uom]] : []),
    ]);
    const res = await apiGet(
      `/api/resource/${encodeURIComponent(doctype)}?fields=${encodeURIComponent(fields)}&filters=${encodeURIComponent(filters)}&limit_page_length=100`,
    );
    const rows = getData(res) || [];
    if (!rows.length) return 0;
    const match = rows.find((r) => !r.supplier) || rows[0];
    return parseFloat(match.outright_rate) || 0;
  } catch (e) {
    console.warn(`${doctype} rate lookup failed:`, e.message);
    return 0;
  }
}

// Latest rate for one Metal Type + Metal Touch (e.g. Gold / 22KT) — both filtered server
// side, newest date first (creation breaks ties between same-day entries), so only the single
// current row comes back instead of scanning a capped page of every touch for that metal.
async function fetchMetalPriceListRate(metalType, purityLabel) {
  if (!metalType || !purityLabel) return 0;
  return cachedFor(`Metal|${metalType}|${purityLabel.trim()}`, () => fetchMetalPriceListRateUncached(metalType, purityLabel));
}

async function fetchMetalPriceListRateUncached(metalType, purityLabel) {
  try {
    const fields = JSON.stringify(['metal_type', 'metal_touch', 'rate', 'date']);
    const filters = JSON.stringify([
      ['metal_type', '=', metalType],
      ['metal_touch', '=', purityLabel.trim()],
    ]);
    const res = await apiGet(
      `/api/resource/Metal%20Price%20List?fields=${encodeURIComponent(fields)}&filters=${encodeURIComponent(filters)}&order_by=${encodeURIComponent('date desc, creation desc')}&limit_page_length=1`,
    );
    const match = (getData(res) || [])[0];
    return match ? parseFloat(match.rate) || 0 : 0;
  } catch (e) {
    console.warn('Metal Price List lookup failed:', e.message);
    return 0;
  }
}

// Classifies one BOM raw-material row from its own custom_item_group (Gold/Silver/Platinum →
// metal, Diamond → diamond, Stone → stone, anything else → other) and looks up today's rate
// from the matching Price List doctype. A row's own custom_selling_rate — set once at
// Purchase Receipt / Make BOM time, for any raw material, not just diamond — always wins over
// a live lookup. Falls back to the row's own custom_costing_rate (the rate it was actually
// costed at when the BOM was built) ahead of rate/base_rate, since those can be silently
// recalculated later by ERPNext itself (the BOM's rm_cost_as_per is Valuation Rate) — so a row
// is never silently zeroed out (or quietly re-priced) just because PP Settings / a price list
// is mid-setup on a given site.
// A BOM raw material's attributes (Diamond/Gemstone Price List match) and category (Diamond
// Margin), cached for a few minutes like the rates.
function fetchRawMaterialItem(itemCode) {
  return cachedFor(`RawItem|${itemCode}`, () => fetchItemDoc(itemCode, ['attributes', 'custom_item_category']));
}

// Diamond Studded item (its BOM has a Diamond row): the highest "Item Catefory Wise Diamond
// Margin" among its diamond rows' item categories, 0 when none is configured.
async function fetchStuddedDiamondMargin(diamondRows, ppSettings) {
  const margins = await Promise.all(diamondRows.map(async (row) => {
    if (!row.item_code) return 0;
    try {
      const item = await fetchRawMaterialItem(row.item_code);
      return ppSettings.diamondCategoryMargin[String(item.custom_item_category || '').trim().toLowerCase()] || 0;
    } catch (e) {
      console.warn('Diamond category lookup failed:', row.item_code, e.message);
      return 0;
    }
  }));
  return Math.max(0, ...margins);
}

async function fetchLiveRawMaterialRate(row, ppSettings) {
  const fallback = parseFloat(row.custom_costing_rate || row.rate || row.base_rate || 0) || 0;
  const { kind, metalType } = classifyBomItemGroup(row.custom_item_group);

  const sellingRate = parseFloat(row.custom_selling_rate || 0) || 0;
  if (sellingRate > 0) return { kind, rate: sellingRate, isLive: true };

  if (kind === 'other' || !row.item_code) return { kind, rate: fallback, isLive: false };

  // Metal touch/purity comes straight off the BOM Item row's own custom_gold_purity — set at
  // Purchase Receipt / Make BOM time from the item's variant — rather than re-deriving it via
  // an Item Variant Attribute lookup, so no separate PP Settings metal-attribute mapping is
  // required for this bucket.
  if (kind === 'metal') {
    const purityLabel = String(row.custom_gold_purity || '').trim();
    const rate = await fetchMetalPriceListRate(metalType, purityLabel);
    if (!rate) {
      throw posValidationError(
        `Metal Price List rate not found for ${metalType}${purityLabel ? ` (${purityLabel})` : ''}. Add a rate in Metal Price List before billing this item.`,
      );
    }
    return { kind, rate, isLive: true, purityLabel };
  }

  let item;
  try {
    item = await fetchRawMaterialItem(row.item_code);
  } catch {
    return { kind, rate: fallback, isLive: false };
  }
  const getAttr = (label) => getItemAttrValue(item.attributes, label);

  if (kind === 'stone') {
    const rate = await fetchAttrMappedRate(getAttr, ppSettings.gemstoneAttrs, 'Gemstone Price List', row.uom || row.stock_uom || '');
    return { kind, rate: rate || fallback, isLive: rate > 0 };
  }
  // diamond
  const rate = await fetchAttrMappedRate(getAttr, ppSettings.diamondAttrs, 'Diamond Price List');
  return { kind, rate: rate || fallback, isLive: rate > 0 };
}

// UOM's own `symbol` field (e.g. "Ct" for "Carat") — shown instead of the full UOM name.
// Cached per session since the same handful of UOMs (Carat, Gram, ...) repeat across every BOM.
const uomSymbolCache = {};
const uomSymbolPending = {};
async function fetchUomSymbol(uomName) {
  if (!uomName) return '';
  if (uomSymbolCache[uomName] !== undefined) return uomSymbolCache[uomName];
  // Lines looked up side by side share one request per UOM.
  uomSymbolPending[uomName] ||= fetchUomSymbolUncached(uomName).finally(() => { delete uomSymbolPending[uomName]; });
  return uomSymbolPending[uomName];
}

async function fetchUomSymbolUncached(uomName) {
  try {
    const res = await apiGet(`/api/resource/UOM/${encodeURIComponent(uomName)}?fields=${encodeURIComponent(JSON.stringify(['symbol']))}`);
    const doc = getData(res) || {};
    uomSymbolCache[uomName] = doc.symbol || uomName;
  } catch (e) {
    console.warn('fetchUomSymbol failed:', e.message);
    uomSymbolCache[uomName] = uomName;
  }
  return uomSymbolCache[uomName];
}

async function fetchBomBreakup(bomName) {
  try {
    const res = await apiGet(`/api/resource/BOM/${encodeURIComponent(bomName)}`);
    const bom = getData(res) || {};
    const rows = bom.items || [];
    const ppSettings = await loadPPSettings();
    // Diamond Studded (any Diamond row): Diamond / Stone / Other / Making at the BOM's cost rates,
    // no Wastage or Handling, all x the Diamond Margin % — metal stays at today's touch rate and
    // isn't marked up. Without a Diamond row the BOM is priced the regular way below.
    const diamondRows = rows.filter((row) => classifyBomItemGroup(row.custom_item_group).kind === 'diamond');
    const isStudded = diamondRows.length > 0;
    const [liveRates, diamondMarginPercent] = await Promise.all([
      Promise.all(rows.map((row) => {
        const kind = classifyBomItemGroup(row.custom_item_group).kind;
        if (!isStudded || kind === 'metal') return fetchLiveRawMaterialRate(row, ppSettings);
        return { kind, rate: parseFloat(row.custom_costing_rate || row.rate || row.base_rate || 0) || 0, isLive: false };
      })),
      isStudded ? fetchStuddedDiamondMargin(diamondRows, ppSettings) : 0,
    ]);

    const breakup = rows.reduce(
      (acc, row, idx) => {
        const qty = parseFloat(row.qty || row.stock_qty || 0) || 0;
        const { kind, rate, isLive, purityLabel } = liveRates[idx];
        const making = parseFloat(row.custom_making || 0) || 0;
        const handling = isStudded ? 0 : parseFloat(row.custom_handling_rate || 0) || 0;
        const wastage = isStudded ? 0 : parseFloat(row.custom_wastage || 0) || 0;
        const labourVal = parseFloat(row.custom_labour_val || 0) || 0;
        const labourMode = row.custom_labour_mode || 'Percentage';
        const uom = String(row.uom || row.stock_uom || '').toLowerCase();
        const purity = getPurityFraction(row.custom_gold_purity);
        const base = qty * rate + qty * making + qty * handling;
        // Same rule as Purchase Receipt's recalcBomRow: Percentage is % of the row value; Fixed
        // Rate / Range (legacy 'g') are ₹ per unit of qty. Labour is charged on metal rows only —
        // older BOMs carry the FG item's labour on every row, so it's ignored on non-metal rows here.
        const isPercentLabour = labourMode === 'Percentage' || labourMode === '%';
        const labour = kind !== 'metal' ? 0 : isPercentLabour ? (base * labourVal) / 100 : qty * labourVal;
        const wastageAmount = (base * wastage) / 100;
        if (kind === 'diamond') { acc.diamondValue += qty * rate; acc.diamondWeight += qty; acc.diamondUom = row.uom || acc.diamondUom; }
        else if (kind === 'stone') { acc.stoneValue += qty * rate; acc.stoneWeight += qty; acc.stoneUom = row.uom || acc.stoneUom; }
        else if (kind === 'metal') {
          acc.metalValue += qty * rate;
          // Metal Price List rates are already touch-specific (e.g. the 22KT row), not a 24KT
          // rate to be scaled by purity — keep the rate/label from the metal row so the UI can
          // show and re-use the actual touch-wise rate instead of a flat 24KT figure.
          if (isLive && purityLabel) { acc.metalRateTouch = rate; acc.metalTouchLabel = purityLabel; }
        } else {
          // Any BOM row whose custom_item_group isn't Gold/Silver/Platinum/Diamond/Stone
          // (e.g. Polki, findings, etc.) falls into Other Amount.
          acc.otherCharges += qty * rate;
        }
        acc.makingCharges += qty * making + qty * handling + labour;
        acc.otherCharges += wastageAmount;
        acc.totalAmount += parseFloat(row.custom_bom_amt || row.amount || 0) || 0;
        acc.hasLiveRate = acc.hasLiveRate || isLive;
        if (uom === 'gram' || uom === 'gm' || uom === 'g') {
          acc.netWeight += qty;
          acc.grossWeight += qty;
          acc.pureWeight += purity ? qty * purity : qty;
        }
        return acc;
      },
      {
        bomName,
        metalValue: 0,
        metalRateTouch: 0,
        metalTouchLabel: '',
        makingCharges: 0,
        diamondValue: 0,
        diamondWeight: 0,
        diamondUom: '',
        stoneValue: 0,
        stoneWeight: 0,
        stoneUom: '',
        otherCharges: 0,
        totalAmount: 0,
        grossWeight: 0,
        netWeight: 0,
        pureWeight: 0,
        hasLiveRate: false,
      },
    );
    if (isStudded) {
      // 0 / no configured margin -> billed at cost (x 100%).
      const factor = diamondMarginPercent > 0 ? diamondMarginPercent / 100 : 1;
      breakup.makingCharges *= factor;
      breakup.diamondValue *= factor;
      breakup.stoneValue *= factor;
      breakup.otherCharges *= factor;
      breakup.isStudded = true;
      breakup.diamondMarginPercent = diamondMarginPercent;
      // The studded breakup is the price — never swapped for the purchase rate.
      breakup.hasLiveRate = true;
    }
    const [diamondSymbol, stoneSymbol] = await Promise.all([
      fetchUomSymbol(breakup.diamondUom),
      fetchUomSymbol(breakup.stoneUom),
    ]);
    breakup.diamondUom = diamondSymbol || breakup.diamondUom;
    breakup.stoneUom = stoneSymbol || breakup.stoneUom;
    return breakup;
  } catch (e) {
    if (e.isPosValidation) throw e;
    console.warn('BOM breakup lookup:', e.message);
    return null;
  }
}

function getPurityFraction(value) {
  const purity = parseFloat(value || 0);
  if (!purity) return 0;
  return purity > 100 ? purity / 1000 : purity / 100;
}

function countReceiptSerials(serialText) {
  return String(serialText || '')
    .split(/[\s,\n]+/)
    .map((value) => value.trim())
    .filter(Boolean).length;
}

function getReceiptRowDivisor(receiptItem) {
  const serialCount = countReceiptSerials(receiptItem.serial_no);
  if (serialCount > 1) return serialCount;
  const qty = parseFloat(receiptItem.qty || receiptItem.received_qty || 0) || 0;
  return qty > 1 ? qty : 1;
}

function perPieceValue(value, divisor) {
  const parsed = parseFloat(value || 0) || 0;
  return parsed && divisor > 1 ? parsed / divisor : parsed;
}

function applyReceiptItemToCartLine(line, receiptItem, bomBreakup) {
  const rowDivisor = getReceiptRowDivisor(receiptItem);
  const receiptQty = parseFloat(receiptItem.qty || receiptItem.received_qty || 0) || 0;
  const receiptAmount = parseFloat(receiptItem.amount || 0) || 0;
  const receiptRate =
    parseFloat(receiptItem.rate || 0) ||
    (receiptQty > 0 ? receiptAmount / receiptQty : receiptAmount) ||
    line.rate ||
    0;
  const receiptGrossWt = perPieceValue(receiptItem.custom_gross_weight, rowDivisor);
  const receiptNetWt = perPieceValue(receiptItem.custom_net_weight, rowDivisor);
  const bomNetWt = parseFloat(bomBreakup?.netWeight || 0) || 0;
  const bomGrossWt = parseFloat(bomBreakup?.grossWeight || 0) || 0;
  const grossWt =
    receiptGrossWt ||
    parseFloat(line.gross_wt || 0) ||
    bomGrossWt ||
    bomNetWt ||
    0;
  const netWt =
    receiptNetWt ||
    parseFloat(line.net_wt || 0) ||
    bomNetWt ||
    grossWt ||
    0;
  // Purity comes from the BOM's own Gold row (custom_gold_purity, e.g. "22KT") — captured in
  // metalTouchLabel while fetchBomBreakup resolves that row's live Metal Price List rate —
  // rather than the Purchase Receipt Item's custom_tounch.
  const tounch = bomBreakup?.metalTouchLabel || line.tounch || '';
  const purity = getPurityFraction(tounch);
  const pureWt = parseFloat(bomBreakup?.pureWeight || 0) || (netWt && purity ? netWt * purity : 0);
  // Only used below for the preferBackendRate divergence check — Metal Value itself is never
  // stored on the line as this frozen BOM-row sum (see metal_value: 0 further down). It's
  // always fetched fresh from the Metal Price List and recomputed as Net Wt x Rate instead,
  // so multiple metal raw-material rows in a BOM never inflate the billed figure.
  const metalValue = bomBreakup?.metalValue || receiptRate;
  const makingCharges = bomBreakup?.makingCharges || 0;
  const diamondValue = bomBreakup?.diamondValue || 0;
  const stoneValue = bomBreakup?.stoneValue || 0;
  const otherCharges = bomBreakup?.otherCharges || 0;
  const componentTotal = metalValue + makingCharges + diamondValue + stoneValue + otherCharges;
  // Once any component came from a live Price List lookup, the computed breakdown is the
  // authoritative rate (that's the whole point — bill today's rate, not the frozen receipt
  // rate), even though it will now legitimately diverge from receiptRate. Without a live
  // lookup (no BOM, or PP Settings/price lists not configured for this item), keep the old
  // safety net: trust the actual invoiced rate whenever the recombined components don't add
  // back up to it.
  const preferBackendRate = bomBreakup?.hasLiveRate
    ? false
    : Math.abs(componentTotal - receiptRate) > 0.05;

  return {
    ...line,
    item_code: receiptItem.item_code || line.item_code,
    item_name: receiptItem.item_name || line.item_name,
    description: receiptItem.description || receiptItem.item_name || line.description,
    qty: 1,
    uom: receiptItem.uom || receiptItem.stock_uom || line.uom,
    rate: receiptRate,
    backend_rate: receiptRate,
    gross_wt: grossWt,
    net_wt: netWt,
    pure_wt: pureWt,
    // Left at 0 on purpose: Metal Value is always derived live in calcLineBreakup as
    // Net Wt x current_metal_rate (fetched from the Metal Price List below), never as the
    // sum of each metal BOM row's own amount — that summed figure double-counts whenever a
    // BOM has more than one Gold/Silver/Platinum raw-material row.
    metal_value: 0,
    making_charges: makingCharges,
    diamond_value: diamondValue,
    diamond_wt: bomBreakup?.diamondWeight || 0,
    diamond_uom: bomBreakup?.diamondUom || '',
    stone_value: stoneValue,
    stone_wt: bomBreakup?.stoneWeight || 0,
    stone_uom: bomBreakup?.stoneUom || '',
    other_charges: otherCharges,
    // Metal Price List rates are touch-specific (e.g. 22KT), not a 24KT rate meant to be
    // scaled by purity — carry that through so the Pricing Breakup shows and re-uses the
    // real touch-wise rate instead of the flat 24KT ticker rate.
    current_metal_rate: bomBreakup?.metalRateTouch || line.current_metal_rate,
    metal_rate_is_touch: Boolean(bomBreakup?.metalRateTouch),
    metal_touch_label: bomBreakup?.metalTouchLabel || '',
    tounch,
    wastage: receiptItem.custom_wastage || 0,
    gst_hsn_code: receiptItem.gst_hsn_code || line.gst_hsn_code,
    warehouse: receiptItem.warehouse || line.warehouse,
    batch_no: receiptItem.batch_no || line.batch_no,
    image: receiptItem.custom_image || line.image,
    receipt_name: receiptItem.parent || '',
    bom_name: receiptItem.custom_bom || bomBreakup?.bomName || '',
    rate_source: 'purchase_receipt',
    prefer_backend_rate: preferBackendRate,
  };
}

export async function fetchItem(itemCode) {
  return fetchItemDoc(itemCode, SAFE_ITEM_FIELDS);
}

// ── Guided variant item picker (Type → Template → Attributes → matched Item) ──
// Mirrors the pick-button dialog already used in Purchase Order / Purchase Receipt /
// Sales Invoice, so item selection is consistent across the whole app instead of a plain
// flat search. Relies on the same whitelisted server methods those pages already call.
export async function fetchItemGroupChildren(parentGroup) {
  try {
    const res = await apiMethod('caratdesk_get_item_group_children', { parent_group: parentGroup });
    return res?.message || [];
  } catch (e) {
    console.warn('fetchItemGroupChildren failed:', e.message);
    return [];
  }
}

async function fetchChildItemGroups(parentGroup) {
  try {
    const fields = JSON.stringify(['name']);
    const filters = JSON.stringify([['Item Group', 'parent_item_group', '=', parentGroup]]);
    const res = await apiGet(
      `/api/resource/Item%20Group?fields=${encodeURIComponent(fields)}&filters=${encodeURIComponent(filters)}&limit_page_length=100`,
    );
    return (getData(res) || []).map((g) => g.name).filter(Boolean);
  } catch (e) {
    console.warn('fetchChildItemGroups failed:', e.message);
    return [];
  }
}

export async function fetchAllDescendantItemGroups(parentGroup) {
  const all = [];
  async function recurse(group) {
    const children = await fetchChildItemGroups(group);
    await Promise.all(children.map(async (child) => { all.push(child); await recurse(child); }));
  }
  await recurse(parentGroup);
  return all;
}

export async function fetchItemTemplatesByGroups(groupNames) {
  if (!groupNames?.length) return [];
  try {
    const filters = JSON.stringify([
      ['Item', 'has_variants', '=', 1],
      ['Item', 'disabled', '=', 0],
      ['Item', 'item_group', 'in', groupNames],
    ]);
    const fields = JSON.stringify(['name', 'item_name', 'item_group']);
    const res = await apiGet(
      `/api/resource/Item?fields=${encodeURIComponent(fields)}&filters=${encodeURIComponent(filters)}&limit_page_length=100`,
    );
    return getData(res) || [];
  } catch (e) {
    console.warn('fetchItemTemplatesByGroups failed:', e.message);
    return [];
  }
}

// Gold Purchase's item picker skips the Type (item group) step entirely — the valid item
// groups for it are configured once in PP Settings1's "Gold Purchase Setting" table instead of
// the cashier picking one each time.
export async function fetchGoldPurchaseItemGroups() {
  const settings = await loadPPSettings();
  return settings.goldPurchaseItemGroups || [];
}

// Gold Purchase's Valuation Amount is looked up live from the Metal Price List — keyed by
// the resolved item's own item_group (-> metal type, via the same classifyBomItemGroup rule
// the BOM raw-material rate lookup uses) and its "<Metal> Purity" variant attribute (e.g.
// "Gold Purity"), instead of a possibly stale standard_rate/valuation_rate on the Item itself.
export async function fetchGoldPurchaseValuationRate(item) {
  if (!item?.item_code) return 0;
  let full = item;
  if (full.item_group === undefined || full.attributes === undefined) {
    try {
      full = { ...item, ...(await fetchItemDoc(item.item_code, ['item_group', 'attributes'])) };
    } catch (e) {
      console.warn('fetchGoldPurchaseValuationRate item lookup failed:', e.message);
      return 0;
    }
  }
  const { kind, metalType } = classifyBomItemGroup(full.item_group);
  if (kind !== 'metal' || !metalType) return 0;
  const purityLabel = getItemAttrValue(full.attributes, `${metalType} Purity`);
  if (!purityLabel) return 0;
  return fetchMetalPriceListRate(metalType, purityLabel);
}

export async function fetchTemplateAttributes(templateItemCode) {
  try {
    const res = await apiMethod('caratdesk_get_template_attributes', { template_name: templateItemCode });
    return res?.message?.attributes || [];
  } catch (e) {
    console.warn('fetchTemplateAttributes failed:', e.message);
    return [];
  }
}

export async function findItemVariant(templateItemCode, attributes) {
  try {
    const res = await apiMethod('caratdesk_find_item_variant', {
      template_item_code: templateItemCode,
      attributes: JSON.stringify(attributes),
    });
    return res?.message || null;
  } catch (e) {
    console.warn('findItemVariant failed:', e.message);
    return null;
  }
}

export async function searchItems(query) {
  const q = (query || '').trim();
  const fields = SAFE_ITEM_FIELDS;
  try {
    const args = {
      doctype: 'Item',
      fields,
      limit_page_length: 10,
      order_by: 'modified desc',
      ...(q ? { or_filters: [['Item', 'item_code', 'like', `%${q}%`], ['Item', 'item_name', 'like', `%${q}%`]] } : {}),
    };
    const res = await apiMethod('frappe.client.get_list', args);
    return getData(res) || [];
  } catch {
    const fieldsParam = encodeURIComponent(JSON.stringify(fields));
    const orFilters = q ? `&or_filters=${encodeURIComponent(JSON.stringify([['Item', 'item_code', 'like', `%${q}%`], ['Item', 'item_name', 'like', `%${q}%`]]))}` : '';
    const res = await apiGet(
      `/api/resource/Item?fields=${fieldsParam}${orFilters}&limit_page_length=10&order_by=modified desc`,
    );
    return getData(res) || [];
  }
}

// Common Party Accounting: a Customer and Supplier can be linked as "the same real-world
// party" via a Party Link record, in either direction (either side can be primary). Checks
// both directions and returns whichever party in the match is flagged Supplier.
export async function fetchLinkedSupplierForCustomer(customerName) {
  if (!customerName) return null;
  try {
    const fields = JSON.stringify(['name', 'primary_role', 'primary_party', 'secondary_role', 'secondary_party']);
    const [asPrimary, asSecondary] = await Promise.all([
      apiGet(`/api/resource/Party%20Link?fields=${encodeURIComponent(fields)}&filters=${encodeURIComponent(JSON.stringify([['primary_role', '=', 'Customer'], ['primary_party', '=', customerName]]))}&limit_page_length=1`),
      apiGet(`/api/resource/Party%20Link?fields=${encodeURIComponent(fields)}&filters=${encodeURIComponent(JSON.stringify([['secondary_role', '=', 'Customer'], ['secondary_party', '=', customerName]]))}&limit_page_length=1`),
    ]);
    const row = (getData(asPrimary) || [])[0] || (getData(asSecondary) || [])[0];
    if (!row) return null;
    if (row.primary_role === 'Supplier') return row.primary_party;
    if (row.secondary_role === 'Supplier') return row.secondary_party;
    return null;
  } catch (e) {
    console.warn('fetchLinkedSupplierForCustomer failed:', e.message);
    return null;
  }
}

export async function fetchWarehouses() {
  try {
    const res = await apiGet(`/api/resource/Warehouse?fields=${encodeURIComponent(JSON.stringify(['name']))}&filters=${encodeURIComponent(JSON.stringify([['disabled', '=', 0], ['is_group', '=', 0]]))}&limit_page_length=0&order_by=name asc`);
    return (getData(res) || []).map((w) => w.name);
  } catch (e) {
    console.warn('fetchWarehouses failed:', e.message);
    return [];
  }
}

// New Customer's Country field — linked to the Country doctype (the full list is short and
// effectively static, so it's cached for the session instead of re-fetched per keystroke).
let countriesCache = null;
export async function fetchCountries() {
  if (countriesCache) return countriesCache;
  try {
    const res = await apiGet(`/api/resource/Country?fields=${encodeURIComponent(JSON.stringify(['name']))}&limit_page_length=0&order_by=name asc`);
    countriesCache = (getData(res) || []).map((c) => c.name).filter(Boolean);
  } catch (e) {
    console.warn('fetchCountries failed:', e.message);
    countriesCache = [];
  }
  return countriesCache;
}

// POS header's Branch field — linked to the Branch doctype, short/effectively static list
// like Country, so it's cached for the session instead of re-fetched per keystroke.
let branchesCache = null;
export async function fetchBranches() {
  if (branchesCache) return branchesCache;
  try {
    const res = await apiGet(`/api/resource/Branch?fields=${encodeURIComponent(JSON.stringify(['name']))}&limit_page_length=0&order_by=name asc`);
    branchesCache = (getData(res) || []).map((b) => b.name).filter(Boolean);
  } catch (e) {
    console.warn('fetchBranches failed:', e.message);
    branchesCache = [];
  }
  return branchesCache;
}

// Sales Team dialog's Sales Person field — linked to the Sales Person doctype, short/
// effectively static list like Branch, so it's cached for the session too. commission_rate
// is each person's own default commission % (set on their Sales Person record), used to
// auto-fill that row's Contribution % the moment they're picked.
let salesPersonsCache = null;
export async function fetchSalesPersons() {
  if (salesPersonsCache) return salesPersonsCache;
  try {
    const res = await apiGet(`/api/resource/Sales%20Person?fields=${encodeURIComponent(JSON.stringify(['name', 'commission_rate']))}&filters=${encodeURIComponent(JSON.stringify([['enabled', '=', 1], ['is_group', '=', 0]]))}&limit_page_length=0&order_by=name asc`);
    salesPersonsCache = (getData(res) || [])
      .filter((s) => s.name)
      .map((s) => ({ name: s.name, commissionRate: Number(s.commission_rate) || 0 }));
  } catch (e) {
    console.warn('fetchSalesPersons failed:', e.message);
    salesPersonsCache = [];
  }
  return salesPersonsCache;
}

// Gold Purchase — a real Purchase Invoice against the Supplier linked to this Customer via
// Common Party Accounting, with update_stock:1 since the gold genuinely enters PP's inventory.
// ERPNext's own Common Party Accounting then automatically nets this Purchase Invoice's payable
// against the same party's Debtors on their next Sales Invoice (the same mechanism behind the
// auto-generated Journal Entry seen reconciling SINV-26-00032 against ACC-JV-2026-00020) — no
// custom settlement logic needed for that part.
// The item is whatever the cashier picks (no hardcoded item) — since customer-brought gold was
// never one of PP's own serialized/batched pieces, a fresh Serial No or Batch is auto-created
// here whenever the selected item requires one, so update_stock:1 always has something valid to
// receive against regardless of which item gets chosen.
// Next GP-YYYYMMDD-##### for today, based on the highest existing bill_no with that day's
// prefix. Zero-padded to 5 digits, restarting at 00001 each day. Two Gold Purchases created
// in the same instant (rare at a single POS counter) could in principle race onto the same
// number since this isn't a DB-enforced series — acceptable here given real-world POS volume.
// (Gold Purchases created before the GP- prefix keep their old OG- bill numbers.)
async function generateGoldPurchaseBillNo(dateStr) {
  const prefix = `GP-${dateStr}-`;
  const fields = JSON.stringify(['bill_no']);
  const filters = JSON.stringify([['bill_no', 'like', `${prefix}%`]]);
  const res = await apiGet(
    `/api/resource/Purchase Invoice?fields=${encodeURIComponent(fields)}&filters=${encodeURIComponent(filters)}&order_by=bill_no desc&limit_page_length=1`
  );
  const lastBillNo = (getData(res) || [])[0]?.bill_no || '';
  const lastSeq = parseInt(lastBillNo.slice(prefix.length), 10) || 0;
  return `${prefix}${String(lastSeq + 1).padStart(5, '0')}`;
}

// items: [{item_code, item_name, description?, qty, rate, amount?, has_serial_no?, has_batch_no?,
// stock_uom?, gst_hsn_code?, gross_wt?, net_wt?, diamond_value?}, …] — one row per item staged in the Gold Purchase dialog's
// table, same shape addGoldRowFromPicker() in SettlementForm.jsx builds. Every row that needs a
// Serial No or Batch gets its own, in sequence, same as the single-item version did.
export async function createGoldPurchaseInvoice({ customer, items, warehouse }) {
  const supplier = await fetchLinkedSupplierForCustomer(customer);
  if (!supplier) {
    throw new Error(`Common Party Supplier is not linked for this customer. Create a Party Link (Customer ↔ Supplier) for "${customer}" before recording a Gold Purchase.`);
  }
  if (!warehouse) {
    throw new Error('Select a warehouse to receive the Gold Purchase into.');
  }
  if (!items?.length) {
    throw new Error('Add at least one item before creating the Purchase Invoice.');
  }

  // toISOString() reports the UTC calendar date, not the local one — in IST (UTC+5:30) that's
  // wrong for roughly the first 5.5 hours of every local day (still "yesterday" in UTC), which
  // left bill_date to a server-side default that could land a day ahead of this due_date and
  // trip "Due Date cannot be before Supplier Invoice Date". en-CA locale formats as YYYY-MM-DD
  // in the browser's own local timezone, so this always matches what the user actually sees.
  const today = new Date().toLocaleDateString('en-CA');
  const billNo = await generateGoldPurchaseBillNo(today.replace(/-/g, ''));

  const rows = [];
  for (const item of items) {
    const qty = Math.abs(item.qty);
    const row = {
      doctype: 'Purchase Invoice Item',
      item_code: item.item_code,
      item_name: item.item_name,
      description: item.description || item.item_name,
      qty,
      uom: item.stock_uom || 'Nos',
      stock_uom: item.stock_uom || 'Nos',
      conversion_factor: 1,
      // Amount carries the Diamond Value on top of Net Wt x metal rate, so the invoice rate is
      // the effective per-gram rate that reproduces it.
      rate: item.amount && qty ? item.amount / qty : item.rate,
      warehouse,
      gst_hsn_code: item.gst_hsn_code || '',
      ...(item.gross_wt ? { custom_gross_weight: item.gross_wt } : {}),
      ...(item.net_wt ? { custom_net_weight: item.net_wt } : {}),
      ...(item.diamond_value ? { custom_diamond_value: item.diamond_value } : {}),
    };

    if (item.has_serial_no) {
      const serialRes = await apiPost('/api/resource/Serial%20No', { doctype: 'Serial No', item_code: item.item_code });
      const serialName = serialRes?.data?.name || serialRes?.name;
      if (!serialName) throw new Error(`Could not create a Serial No for ${item.item_code}`);
      row.serial_no = serialName;
      row.use_serial_batch_fields = 1;
    } else if (item.has_batch_no) {
      const batchRes = await apiPost('/api/resource/Batch', { doctype: 'Batch', item: item.item_code });
      const batchName = batchRes?.data?.name || batchRes?.name;
      if (!batchName) throw new Error(`Could not create a Batch for ${item.item_code}`);
      row.batch_no = batchName;
      row.use_serial_batch_fields = 1;
    }
    rows.push(row);
  }

  const payload = {
    doctype: 'Purchase Invoice',
    supplier,
    posting_date: today,
    due_date: today,
    bill_date: today,
    // India Compliance's GST Settings makes Bill No mandatory on every Purchase Invoice, but a
    // walk-in Gold Purchase customer never has a real vendor invoice number to give us.
    // GP-YYYYMMDD-##### (see generateGoldPurchaseBillNo) stands in for it — traceable to "Gold
    // Purchase, this day, Nth of the day" instead of a fake vendor invoice number.
    bill_no: billNo,
    custom_type: 'Gold Purchase',
    currency: 'INR',
    update_stock: 1,
    items: rows,
    taxes: [],
  };
  const createRes = await apiPost('/api/resource/Purchase Invoice', payload);
  const name = createRes?.data?.name || createRes?.name;
  if (!name) throw new Error('Purchase Invoice creation failed — no name returned');
  await apiPut(`/api/resource/Purchase%20Invoice/${encodeURIComponent(name)}`, { docstatus: 1 });
  return name;
}

export async function fetchGoldPurchaseInvoice(name) {
  const res = await apiGet(`/api/resource/Purchase%20Invoice/${encodeURIComponent(name)}`);
  return getData(res) || null;
}

// ERPNext's own cancel reverses the stock receipt, the GL entries and the Common Party Journal
// Entry that netted this invoice against the customer, so a cancelled Gold Purchase has no
// remaining effect anywhere.
export async function cancelGoldPurchaseInvoice(name) {
  return apiMethod('frappe.client.cancel', { doctype: 'Purchase Invoice', name });
}

// Common Party Accounting posts a Journal Entry when the Gold Purchase is submitted: Dr the
// supplier against this Purchase Invoice, Cr the linked customer as an unallocated advance.
// That customer credit is what the Sales Invoice allocates in its Advances table, so the gold
// value actually settles the bill instead of leaving it outstanding. Empty when Common Party
// Accounting didn't post one — the bill then just collects less, as before.
export async function fetchGoldPurchaseCreditRows(purchaseInvoice, customerName) {
  return fetchJournalCreditRows('Purchase Invoice', purchaseInvoice, customerName);
}

// The customer's unallocated credit rows on submitted Journal Entries that also reference
// referenceType/referenceName — each shaped for one Sales Invoice Advances row ({referenceType,
// referenceName, referenceRow, amount}). When a Sales Invoice uses (part of) a row, ERPNext
// stamps the used part with the invoice and keeps any rest as a new unreferenced row, so a credit
// that's been partly used — or freed again by a cancelled bill — can sit on several rows.
async function fetchJournalCreditRows(referenceType, referenceName, customerName) {
  if (!referenceName || !customerName) return [];
  try {
    const res = await apiMethod('frappe.client.get_list', {
      doctype: 'Journal Entry Account',
      parent: 'Journal Entry',
      fields: ['parent'],
      filters: [
        ['reference_type', '=', referenceType],
        ['reference_name', '=', referenceName],
        ['docstatus', '=', 1],
      ],
      limit_page_length: 5,
    });
    const jeNames = [...new Set((getData(res) || []).map((r) => r.parent))];
    const rows = [];
    for (const jeName of jeNames) {
      const je = getData(await apiGet(`/api/resource/Journal%20Entry/${encodeURIComponent(jeName)}`)) || {};
      (je.accounts || [])
        .filter((r) => r.party_type === 'Customer' && r.party === customerName && !r.reference_name &&
          (parseFloat(r.credit_in_account_currency) || 0) > 0)
        .forEach((r) => rows.push({
          referenceType: 'Journal Entry',
          referenceName: je.name,
          referenceRow: r.name,
          amount: round2(r.credit_in_account_currency),
        }));
    }
    return rows;
  } catch (e) {
    console.warn(`fetchJournalCreditRows failed for ${referenceType} ${referenceName}:`, e.message);
  }
  return [];
}

// Purchase Invoice name -> the Sales Invoice (draft or submitted) it's already on, read from the
// Sales Invoice's Settlement References table. excludeInvoice is the bill being edited right
// now, whose own saved references don't count against it. Empty if that table doesn't exist yet.
export async function fetchGoldPurchasesUsedOnSalesInvoices(purchaseInvoiceNames, excludeInvoice = null) {
  return fetchSettlementReferencesUsed('Purchase Invoice', purchaseInvoiceNames, excludeInvoice);
}

async function fetchSettlementReferencesUsed(referenceDoctype, names, excludeInvoice) {
  const used = new Map();
  if (!names.length) return used;
  try {
    const res = await apiMethod('frappe.client.get_list', {
      doctype: 'Sales Invoice Settlement Reference',
      parent: 'Sales Invoice',
      fields: ['reference_name', 'parent'],
      filters: [
        ['reference_doctype', '=', referenceDoctype],
        ['reference_name', 'in', names],
        ['docstatus', 'in', [0, 1]],
        ...(excludeInvoice ? [['parent', '!=', excludeInvoice]] : []),
      ],
      limit_page_length: 0,
    });
    (getData(res) || []).forEach((r) => used.set(r.reference_name, r.parent));
  } catch (e) {
    console.warn(`fetchSettlementReferencesUsed failed for ${referenceDoctype}:`, e.message);
  }
  return used;
}

// A Credit Note leaves its credit as a negative outstanding on the return itself, which a new
// Sales Invoice can't allocate — its Advances table only takes Payment / Journal Entries. This
// Journal Entry moves that credit onto an unallocated customer row (Dr the customer against the
// Credit Note, Cr the same customer with no reference) — the same shape as a Gold Purchase's
// Common Party Journal Entry — so the POS bill allocates it in Advances the same way.
async function createReturnCreditJournalEntry(creditNote) {
  const amount = round2(Math.abs(parseFloat(creditNote.outstanding_amount) || 0));
  const party = { account: creditNote.debit_to, party_type: 'Customer', party: creditNote.customer };
  const res = await apiPost('/api/resource/Journal Entry', {
    doctype: 'Journal Entry',
    voucher_type: 'Journal Entry',
    company: creditNote.company,
    posting_date: new Date().toLocaleDateString('en-CA'),
    user_remark: `Sales Return ${creditNote.name} credit carried to a POS bill`,
    accounts: [
      { doctype: 'Journal Entry Account', ...party, debit_in_account_currency: amount, reference_type: 'Sales Invoice', reference_name: creditNote.name },
      { doctype: 'Journal Entry Account', ...party, credit_in_account_currency: amount, is_advance: 'Yes' },
    ],
  });
  const name = res?.data?.name || res?.name;
  if (!name) throw new Error('Journal Entry creation failed — no name returned');
  await apiPut(`/api/resource/Journal%20Entry/${encodeURIComponent(name)}`, { docstatus: 1 });
}

// The Credit Note's credit rows for the POS bill's Advances (see fetchJournalCreditRows) — moving
// it onto its Journal Entry first if that hasn't happened yet. Throws when the return has no
// credit left (e.g. it was refunded in cash, or already used up on other bills).
export async function fetchSalesReturnCreditRows(creditNoteName, customerName) {
  let rows = await fetchJournalCreditRows('Sales Invoice', creditNoteName, customerName);
  if (rows.length) return rows;
  const creditNote = getData(await apiGet(`/api/resource/Sales%20Invoice/${encodeURIComponent(creditNoteName)}`)) || {};
  if (!(parseFloat(creditNote.outstanding_amount) < 0)) {
    throw new Error(`Sales Return ${creditNoteName} has no credit left to settle on this bill`);
  }
  await createReturnCreditJournalEntry(creditNote);
  rows = await fetchJournalCreditRows('Sales Invoice', creditNoteName, customerName);
  if (!rows.length) throw new Error(`Could not find the credit for Sales Return ${creditNoteName}`);
  return rows;
}

// referenceName -> the customer's credit still unallocated on the submitted Journal Entries that
// reference it (Gold Purchase's Common Party Journal Entry / a Sales Return's credit Journal
// Entry). When a Sales Invoice uses part of that credit, ERPNext splits the row and stamps the used
// part with the invoice, so only what's left counts here. Names with no such Journal Entry at all
// are left out (unlike a fully used one, which maps to 0).
async function fetchJournalCreditByReference(referenceType, names, customerName) {
  const credit = new Map();
  if (!names.length || !customerName) return credit;
  const refRows = getData(await apiMethod('frappe.client.get_list', {
    doctype: 'Journal Entry Account',
    parent: 'Journal Entry',
    fields: ['parent', 'reference_name'],
    filters: [
      ['reference_type', '=', referenceType],
      ['reference_name', 'in', names],
      ['docstatus', '=', 1],
    ],
    limit_page_length: 0,
  })) || [];
  const nameByJe = new Map(refRows.map((r) => [r.parent, r.reference_name]));
  nameByJe.forEach((name) => credit.set(name, 0));
  if (!nameByJe.size) return credit;
  const creditRows = getData(await apiMethod('frappe.client.get_list', {
    doctype: 'Journal Entry Account',
    parent: 'Journal Entry',
    fields: ['parent', 'credit_in_account_currency'],
    filters: [
      ['parent', 'in', [...nameByJe.keys()]],
      ['party_type', '=', 'Customer'],
      ['party', '=', customerName],
      ['reference_name', 'is', 'not set'],
      ['credit_in_account_currency', '>', 0],
    ],
    limit_page_length: 0,
  })) || [];
  creditRows.forEach((r) => {
    const name = nameByJe.get(r.parent);
    credit.set(name, round2((credit.get(name) || 0) + (parseFloat(r.credit_in_account_currency) || 0)));
  });
  return credit;
}

// referenceName -> total amount other *draft* Sales Invoices have put on it (their Settlement
// References). A draft isn't reconciled yet, so its share still shows as unallocated Journal Entry
// credit and has to be taken off by hand. excludeInvoice is the bill being edited right now.
async function fetchSettlementAmountsOnDrafts(referenceDoctype, names, excludeInvoice) {
  const held = new Map();
  if (!names.length) return held;
  try {
    const rows = getData(await apiMethod('frappe.client.get_list', {
      doctype: 'Sales Invoice Settlement Reference',
      parent: 'Sales Invoice',
      fields: ['reference_name', 'amount'],
      filters: [
        ['reference_doctype', '=', referenceDoctype],
        ['reference_name', 'in', names],
        ['docstatus', '=', 0],
        ...(excludeInvoice ? [['parent', '!=', excludeInvoice]] : []),
      ],
      limit_page_length: 0,
    })) || [];
    rows.forEach((r) => held.set(r.reference_name, round2((held.get(r.reference_name) || 0) + (parseFloat(r.amount) || 0))));
  } catch (e) {
    console.warn(`fetchSettlementAmountsOnDrafts failed for ${referenceDoctype}:`, e.message);
  }
  return held;
}

const SETTLEMENT_REFERENCE_DOCTYPE = { gold: 'Purchase Invoice', return: 'Sales Invoice' };

// What's left of a Gold Purchase's / Sales Return's credit for the bill being edited, with the
// Journal Entry rows it sits on: { rows, available }. Each row's amount is its full unallocated
// credit — a Sales Invoice Advance's advance_amount must match it exactly, or ERPNext refuses the
// invoice ("modified after you pulled it") — while available also takes off what other draft
// bills already hold. A Gold Purchase that never got a Common Party Journal Entry returns
// { rows: [], available: null }. Throws for a Sales Return with no credit left.
export async function fetchSettlementAvailableCredit(type, number, customerName, excludeInvoice = null) {
  const rows = type === 'return'
    ? await fetchSalesReturnCreditRows(number, customerName)
    : await fetchGoldPurchaseCreditRows(number, customerName);
  if (!rows.length) return { rows, available: null };
  const held = (await fetchSettlementAmountsOnDrafts(SETTLEMENT_REFERENCE_DOCTYPE[type], [number], excludeInvoice)).get(number) || 0;
  const total = rows.reduce((s, r) => s + r.amount, 0);
  return { rows, available: round2(Math.max(0, total - held)) };
}

// The customer's submitted Credit Notes with credit still left to settle (availableAmount) — a
// return can be used across several bills until its credit runs out.
export async function fetchPendingSalesReturns(customerName, { excludeInvoice = null } = {}) {
  if (!customerName) return [];
  const fields = JSON.stringify(['name', 'return_against', 'posting_date', 'grand_total', 'outstanding_amount']);
  const filters = JSON.stringify([
    ['customer', '=', customerName],
    ['docstatus', '=', 1],
    ['is_return', '=', 1],
  ]);
  const res = await apiGet(
    `/api/resource/Sales%20Invoice?fields=${encodeURIComponent(fields)}&filters=${encodeURIComponent(filters)}&order_by=creation desc&limit_page_length=50`,
  );
  const rows = getData(res) || [];
  if (!rows.length) return [];
  // Credit still on the Credit Note itself hasn't been moved to a Journal Entry yet, so no bill
  // can be holding any of it; the rest is on its Journal Entry.
  const moved = rows.filter((r) => !(parseFloat(r.outstanding_amount) < 0)).map((r) => r.name);
  const [jeCredit, held] = await Promise.all([
    fetchJournalCreditByReference('Sales Invoice', moved, customerName),
    fetchSettlementAmountsOnDrafts('Sales Invoice', moved, excludeInvoice),
  ]);
  return rows
    .map((r) => {
      const total = parseFloat(r.outstanding_amount) < 0
        ? round2(Math.abs(parseFloat(r.outstanding_amount)))
        : round2((jeCredit.get(r.name) || 0) - (held.get(r.name) || 0));
      return { ...r, availableAmount: Math.max(0, total) };
    })
    .filter((r) => r.availableAmount > 0);
}

// The customer's submitted Gold Purchases with credit still left to settle (availableAmount) — so
// one can be used across several bills, and one removed from a bill (or left over from a
// cancelled bill) can be added back instead of being bought in a second time. One with no Common
// Party Journal Entry has no credit to split, so it's offered whole until any bill uses it.
export async function fetchPendingGoldPurchases(customerName, { excludeInvoice = null } = {}) {
  const supplier = await fetchLinkedSupplierForCustomer(customerName);
  if (!supplier) return [];
  const fields = JSON.stringify(['name', 'bill_no', 'posting_date', 'grand_total', 'rounded_total']);
  const filters = JSON.stringify([
    ['supplier', '=', supplier],
    ['custom_type', '=', 'Gold Purchase'],
    ['docstatus', '=', 1],
    ['is_return', '=', 0],
  ]);
  const res = await apiGet(
    `/api/resource/Purchase%20Invoice?fields=${encodeURIComponent(fields)}&filters=${encodeURIComponent(filters)}&order_by=creation desc&limit_page_length=50`,
  );
  const rows = getData(res) || [];
  if (!rows.length) return [];
  const names = rows.map((r) => r.name);
  const [jeCredit, held, used] = await Promise.all([
    fetchJournalCreditByReference('Purchase Invoice', names, customerName),
    fetchSettlementAmountsOnDrafts('Purchase Invoice', names, excludeInvoice),
    fetchGoldPurchasesUsedOnSalesInvoices(names, excludeInvoice),
  ]);
  return rows
    .map((r) => {
      const total = jeCredit.has(r.name)
        ? round2(jeCredit.get(r.name) - (held.get(r.name) || 0))
        : (used.has(r.name) ? 0 : round2(parseFloat(r.rounded_total || r.grand_total) || 0));
      return { ...r, availableAmount: Math.max(0, total) };
    })
    .filter((r) => r.availableAmount > 0);
}

// Settlement References is a custom child table on Sales Invoice — only sent once it exists,
// since ERPNext rejects a child-table key it doesn't know. Checked once per page load.
let settlementReferencesFieldPromise = null;
export function salesInvoiceHasSettlementReferences() {
  if (!settlementReferencesFieldPromise) {
    settlementReferencesFieldPromise = apiGet('/api/method/frappe.desk.form.load.getdoctype?doctype=Sales%20Invoice')
      .then((res) => (res?.docs || []).some((d) =>
        d.name === 'Sales Invoice' && (d.fields || []).some((f) => f.fieldname === 'custom_settlement_references'),
      ))
      .catch((e) => {
        console.warn('salesInvoiceHasSettlementReferences failed:', e.message);
        settlementReferencesFieldPromise = null;
        return false;
      });
  }
  return settlementReferencesFieldPromise;
}

// Same Address-lookup pattern already used on the Purchase Invoice page (fetchAddrByLink) —
// the primary Address linked to a Company/Customer via Dynamic Link carries the `state` used
// to decide CGST+SGST (intra-state) vs IGST (inter-state).
async function fetchLinkedAddressState(linkDoctype, linkName) {
  if (!linkName) return '';
  try {
    const fields = JSON.stringify(['state', 'is_primary_address']);
    const filters = JSON.stringify([
      ['Dynamic Link', 'link_doctype', '=', linkDoctype],
      ['Dynamic Link', 'link_name', '=', linkName],
    ]);
    const res = await apiGet(
      `/api/resource/Address?fields=${encodeURIComponent(fields)}&filters=${encodeURIComponent(filters)}&order_by=is_primary_address desc, modified desc&limit_page_length=5`,
    );
    const rows = getData(res) || [];
    if (!rows.length) return '';
    const primary = rows.find((a) => a.is_primary_address) || rows[0];
    return (primary.state || '').trim();
  } catch (e) {
    console.warn(`fetchLinkedAddressState failed for ${linkDoctype} ${linkName}:`, e.message);
    return '';
  }
}

let companyStateCache = null;
async function fetchCompanyState(company) {
  if (companyStateCache !== null) return companyStateCache;
  companyStateCache = await fetchLinkedAddressState('Company', company);
  return companyStateCache;
}

async function fetchDefaultGstTemplate() {
  try {
    const fields = JSON.stringify(['name', 'is_default']);
    const res = await apiGet(
      `/api/resource/Sales%20Taxes%20and%20Charges%20Template?fields=${encodeURIComponent(fields)}&limit_page_length=20`,
    );
    const templates = getData(res) || [];
    if (!templates.length) return null;
    return templates.find((t) => t.is_default)?.name || templates[0].name;
  } catch (e) {
    console.warn('fetchDefaultGstTemplate failed:', e.message);
    return null;
  }
}

async function fetchGstTemplateRows(templateName) {
  if (!templateName) return [];
  try {
    const res = await apiGet(
      `/api/resource/Sales%20Taxes%20and%20Charges%20Template/${encodeURIComponent(templateName)}`,
    );
    const doc = getData(res) || {};
    return (doc.taxes || []).map((row) => ({
      account: row.account_head,
      rate: parseFloat(row.rate) || 0,
      description: row.description || row.account_head,
      charge_type: row.charge_type || 'On Net Total',
    }));
  } catch (e) {
    console.warn('fetchGstTemplateRows failed:', e.message);
    return [];
  }
}

// Address / GST fields from ERPNext's party lookup that are sent on the invoice too, so India
// Compliance validates against the same addresses the POS's taxes were picked for.
const SALES_PARTY_ADDRESS_FIELDS = [
  'customer_address',
  'company_address',
  'company_gstin',
  'billing_address_gstin',
  'gst_category',
  'place_of_supply',
  'taxes_and_charges',
];

// Taxes for the selected customer's bill, plus the address fields they were worked out from:
// { taxes: [{account, rate, description, charge_type}], addressFields: {...} }.
// ERPNext's own party lookup comes first — it's what the Sales Invoice form calls when a
// customer is picked, and India Compliance hooks into it to choose the place of supply and the
// intra-state (CGST+SGST) / inter-state (IGST) template from the very customer billing address
// and company address it later validates the invoice against. Guessing the two states
// separately here could pick different addresses and fail submit with "Cannot charge IGST for
// intra-state supplies". The state-name comparison below is only the fallback when that lookup
// gives no taxes (e.g. no customer yet, or Tax Categories not set up).
export async function fetchGstSplitForCustomer(company, customerName) {
  if (customerName) {
    try {
      const details = getData(await apiMethod('erpnext.accounts.party.get_party_details', {
        party: customerName,
        party_type: 'Customer',
        company,
        doctype: 'Sales Invoice',
        posting_date: new Date().toLocaleDateString('en-CA'),
      })) || {};
      let taxes = (details.taxes || []).map((row) => ({
        account: row.account_head,
        rate: parseFloat(row.rate) || 0,
        description: row.description || row.account_head,
        charge_type: row.charge_type || 'On Net Total',
      }));
      if (!taxes.length && details.taxes_and_charges) taxes = await fetchGstTemplateRows(details.taxes_and_charges);
      if (taxes.length) {
        const addressFields = Object.fromEntries(
          SALES_PARTY_ADDRESS_FIELDS.filter((f) => details[f]).map((f) => [f, details[f]]),
        );
        return { taxes, addressFields };
      }
    } catch (e) {
      console.warn('get_party_details failed — falling back to the address-state check:', e.message);
    }
  }
  return { taxes: await fetchGstSplitByAddressState(company, customerName), addressFields: {} };
}

// Fallback: CGST+SGST vs IGST by whether the Company's state matches the Customer's — same
// convention as the Purchase Invoice page (In-State/Intra template vs Out-of-State/Inter
// template, matched by name).
async function fetchGstSplitByAddressState(company, customerName) {
  try {
    const [companyState, customerState, fields] = await Promise.all([
      fetchCompanyState(company),
      fetchLinkedAddressState('Customer', customerName),
      apiGet('/api/resource/Sales%20Taxes%20and%20Charges%20Template?fields=["name"]&limit_page_length=50'),
    ]);
    const templates = (getData(fields) || []).map((t) => t.name);

    if (!companyState || !customerState || !templates.length) {
      // Not enough address data yet (e.g. no customer picked, or addresses mid-setup) —
      // fall back to whichever template is flagged default, same as before this change.
      const fallback = await fetchDefaultGstTemplate();
      return fetchGstTemplateRows(fallback);
    }

    const sameState = companyState.toLowerCase() === customerState.toLowerCase();
    const matchRegex = sameState ? /in[- ]?state|intra|cgst|sgst/i : /out[- ]?state|inter|igst/i;
    const matched = templates.find((t) => matchRegex.test(t));

    if (!matched) {
      console.warn(`No ${sameState ? 'in-state (CGST+SGST)' : 'out-of-state (IGST)'} Sales Taxes and Charges Template found by name — falling back to the default template.`);
      const fallback = await fetchDefaultGstTemplate();
      return fetchGstTemplateRows(fallback);
    }
    return fetchGstTemplateRows(matched);
  } catch (e) {
    console.warn('fetchGstSplitByAddressState failed:', e.message);
    return [];
  }
}

export async function fetchPaymentModes() {
  try {
    const res = await apiGet(
      '/api/resource/Mode%20of%20Payment?fields=["name"]&limit=50&order_by=name asc',
    );
    const rows = getData(res) || [];
    const modes = rows.map((r) => r.name).filter(Boolean);
    return modes.length ? modes : null;
  } catch {
    return null;
  }
}

export async function fetchLoggedUser() {
  try {
    const res = await apiMethod('frappe.auth.get_logged_user');
    const email = res?.message || localStorage.getItem('cd_user_email') || '';
    if (!email) {
      return {
        email: '',
        fullName: localStorage.getItem('cd_user') || 'User',
      };
    }
    try {
      const userRes = await apiGet(
        `/api/resource/User/${encodeURIComponent(email)}?fields=${encodeURIComponent(JSON.stringify(['full_name', 'name', 'email']))}`,
      );
      const user = getData(userRes);
      return {
        email: user?.email || email,
        fullName:
          user?.full_name ||
          localStorage.getItem('cd_user') ||
          email.split('@')[0],
      };
    } catch {
      return {
        email,
        fullName: localStorage.getItem('cd_user') || email.split('@')[0],
      };
    }
  } catch {
    return {
      email: localStorage.getItem('cd_user_email') || '',
      fullName: localStorage.getItem('cd_user') || 'User',
    };
  }
}

export async function fetchDaySummary(date) {
  const postingDate = date || new Date().toISOString().slice(0, 10);
  const filters = JSON.stringify([
    ['Sales Invoice', 'posting_date', '=', postingDate],
    ['Sales Invoice', 'docstatus', '=', 1],
  ]);
  const fields = JSON.stringify([
    'name',
    'grand_total',
    'paid_amount',
  ]);
  const res = await apiGet(
    `/api/resource/Sales%20Invoice?fields=${encodeURIComponent(fields)}&filters=${encodeURIComponent(filters)}&limit_page_length=200`,
  );
  const invoices = getData(res) || [];

  let totalSales = 0;
  invoices.forEach((inv) => {
    totalSales += parseFloat(inv.grand_total || 0);
  });

  const modeBreakup = {};
  for (const inv of invoices) {
    try {
      const detail = await apiGet(
        `/api/resource/Sales%20Invoice/${encodeURIComponent(inv.name)}?fields=${encodeURIComponent(JSON.stringify(['payments']))}`,
      );
      const doc = getData(detail);
      (doc?.payments || []).forEach((p) => {
        const mode = p.mode_of_payment || 'Other';
        modeBreakup[mode] =
          (modeBreakup[mode] || 0) + parseFloat(p.amount || 0);
      });
    } catch {
      // skip payment detail errors
    }
  }

  return {
    date: postingDate,
    invoiceCount: invoices.length,
    totalSales: Math.round(totalSales * 100) / 100,
    modeBreakup,
  };
}

export async function saveSalesInvoice(payload, existingName) {
  if (existingName) {
    return apiPut(
      `/api/resource/Sales%20Invoice/${encodeURIComponent(existingName)}`,
      payload,
    );
  }
  return apiPost('/api/resource/Sales Invoice', payload);
}

export async function fetchSalesInvoice(name) {
  const res = await apiGet(`/api/resource/Sales%20Invoice/${encodeURIComponent(name)}`);
  return getData(res) || null;
}

// Asks ERPNext itself whether the logged-in user may cancel / amend this specific invoice, so
// POS's Cancel & Amend button follows Role Permissions Manager (and any User Permission
// restrictions) exactly, with no separate POS role to keep in sync.
export async function fetchSalesInvoicePermissions(name) {
  const check = async (permType) => {
    try {
      const res = await apiMethod('frappe.client.has_permission', {
        doctype: 'Sales Invoice',
        docname: name,
        perm_type: permType,
      });
      return Boolean(getData(res)?.has_permission);
    } catch {
      return false;
    }
  };
  const [canCancel, canAmend] = await Promise.all([check('cancel'), check('amend')]);
  return { canCancel, canAmend };
}

export async function cancelSalesInvoice(name) {
  return apiMethod('frappe.client.cancel', { doctype: 'Sales Invoice', name });
}

const CHILD_META_FIELDS = ['name', 'parent', 'parentfield', 'parenttype', 'docstatus', 'owner', 'creation', 'modified', 'modified_by'];

function copyChildRows(rows = [], drop = []) {
  return rows.map((row) => {
    const copy = { ...row };
    [...CHILD_META_FIELDS, ...drop].forEach((f) => delete copy[f]);
    return copy;
  });
}

// Same idea as ERPNext's own "Amend" button: a new draft linked back via amended_from, which
// ERPNext names <original>-1, -2, ... Only the fields POS itself writes are carried over (not a
// blind copy of the whole doc), since POS rebuilds the full payload on Save Draft / Pay anyway
// and a blind copy would also drag along no-copy fields like e-invoice IRN data. Payments and
// scheme advances are left off — the amended bill is paid again from scratch.
export async function createAmendedSalesInvoice(original) {
  const parentFields = [
    'company', 'customer', 'customer_name', 'posting_date', 'due_date', 'is_pos', 'update_stock',
    'currency', 'branch', 'custom_pos_shift', 'apply_discount_on', 'discount_amount',
    'base_discount_amount', 'custom_making_discount', 'custom_making_discount_type',
    'custom_diamond_discount', 'custom_diamond_discount_type', 'custom_stone_discount',
    'custom_stone_discount_type', 'custom_other_discount', 'custom_other_discount_type',
  ];
  const payload = { doctype: 'Sales Invoice', docstatus: 0, amended_from: original.name };
  parentFields.forEach((f) => {
    if (original[f] !== undefined && original[f] !== null) payload[f] = original[f];
  });
  // The cancelled invoice's Serial and Batch Bundle is cancelled with it — the amended rows
  // go back to plain serial_no so ERPNext builds a fresh bundle on submit.
  payload.items = copyChildRows(original.items, ['serial_and_batch_bundle']).map((row) =>
    row.serial_no || row.batch_no ? { ...row, use_serial_batch_fields: 1 } : row,
  );
  payload.taxes = copyChildRows(original.taxes);
  if (original.sales_team?.length) payload.sales_team = copyChildRows(original.sales_team);

  const res = await apiPost('/api/resource/Sales Invoice', payload);
  const name = getData(res)?.name;
  if (!name) throw new Error('Amended invoice was not created');
  return name;
}

// Undoes markSchemeAssignmentUsed for a cancelled invoice. Invoices with Settlement References
// name their Jewellery Scheme Assignments directly; older ones only record which Payment
// Entries they drew advances from, so those are matched to the customer's used assignments by
// the Payment Entries on their own installment rows. Returns the names it could not release.
export async function releaseSchemeAssignmentsForInvoice(customerName, advances = [], settlementReferences = []) {
  const referenced = [...new Set(settlementReferences
    .filter((r) => r.reference_doctype === 'Jewellery Scheme Assignment')
    .map((r) => r.reference_name)
    .filter(Boolean))];
  if (referenced.length) {
    const results = await Promise.allSettled(referenced.map((name) =>
      apiPut(`/api/resource/Jewellery%20Scheme%20Assignment/${encodeURIComponent(name)}`, { used: 0 }),
    ));
    return {
      released: referenced.filter((_, i) => results[i].status === 'fulfilled'),
      failed: referenced.filter((_, i) => results[i].status === 'rejected'),
    };
  }
  const peNames = new Set(advances.map((a) => a.reference_name).filter(Boolean));
  if (!customerName || !peNames.size) return { released: [], failed: [] };
  const fields = JSON.stringify(['name']);
  const filters = JSON.stringify([['customer', '=', customerName], ['used', '=', 1]]);
  const res = await apiGet(
    `/api/resource/Jewellery%20Scheme%20Assignment?fields=${encodeURIComponent(fields)}&filters=${encodeURIComponent(filters)}&limit_page_length=100`,
  );
  const released = [];
  const failed = [];
  for (const { name } of getData(res) || []) {
    try {
      const doc = getData(await apiGet(`/api/resource/Jewellery%20Scheme%20Assignment/${encodeURIComponent(name)}`)) || {};
      const linked = (doc.jewellery_scheme_assignment_details || []).some((r) => peNames.has(r.payment_entry));
      if (!linked) continue;
      await apiPut(`/api/resource/Jewellery%20Scheme%20Assignment/${encodeURIComponent(name)}`, { used: 0 });
      released.push(name);
    } catch (e) {
      console.warn(`releaseSchemeAssignment failed for ${name}:`, e.message);
      failed.push(name);
    }
  }
  return { released, failed };
}

export async function submitSalesInvoice(name) {
  return apiPut(
    `/api/resource/Sales%20Invoice/${encodeURIComponent(name)}`,
    { docstatus: 1 },
  );
}

// ── Purity Ledger Entry (POS checkout / returns) ──
// Same GL-Entry-style ledger the static caratdesk-new-purchase-receipt.html /
// caratdesk-new-sales-invoice.html pages post to — this is the POS Billing side of it. POS
// builds and submits its own Sales Invoice directly (submitSalesInvoice/createSalesReturn
// above), a separate code path from the HTML Sales Invoice page, so it needs its own posting
// helper rather than sharing one across an inline <script> boundary.
const COMPANY = 'P.P. Jewellers Retail Pvt. Ltd.';

function purityLedgerDatetimeNow() {
  const d = new Date(), pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

async function getLastPurityLedgerBalance(metalType) {
  try {
    const fields = encodeURIComponent(JSON.stringify(['balance']));
    const filters = encodeURIComponent(JSON.stringify([['metal_type', '=', metalType]]));
    const res = await apiGet(`/api/resource/Purity%20Ledger%20Entry?fields=${fields}&filters=${filters}&order_by=creation%20desc&limit_page_length=1`);
    const rows = getData(res) || [];
    return parseFloat(rows[0]?.balance) || 0;
  } catch {
    return 0;
  }
}

// Sales Invoice (POS included) carries no per-row Net Wt/Pure Wt/metal type of its own — that
// data lives on the Serial No record Purchase Receipt tagged at the time that piece was
// received (custom_net_weight, custom_pure_wt, custom_metal_type). Same lookup
// collectSIWeightDebits() does in the HTML Sales Invoice page.
async function collectPOSWeightDebits(lines) {
  const debits = {};
  for (const line of lines) {
    const sn = line.serial_no;
    if (!sn) continue;
    try {
      // Restricted to just the 3 fields this needs — an unrestricted GET would also pull the
      // custom_serial_no_images child table (and its image URLs) once per sold serial, on
      // every POS invoice submit.
      const debitFields = encodeURIComponent(JSON.stringify([
        'custom_net_weight',
        'custom_pure_wt',
        'custom_metal_type',
      ]));
      const res = await apiGet(`/api/resource/Serial%20No/${encodeURIComponent(sn)}?fields=${debitFields}`);
      const doc = getData(res) || {};
      const netWt = parseFloat(doc.custom_net_weight) || 0;
      const pureWt = parseFloat(doc.custom_pure_wt) || 0;
      if (netWt <= 0 && pureWt <= 0) continue;
      // A set's own serial holds the combined weight of its pieces, which are on the same
      // invoice and counted themselves — skip it so the weight isn't posted twice.
      if (line.is_set_tag || (await fetchSetPieceSerials(sn)).length) continue;
      const metalType = doc.custom_metal_type || 'Gold';
      if (!debits[metalType]) debits[metalType] = { netWt: 0, pureWt: 0 };
      debits[metalType].netWt += netWt;
      debits[metalType].pureWt += pureWt;
    } catch (e) {
      console.warn('Purity Ledger: failed to fetch Serial No', sn, ':', e.message);
    }
  }
  return debits;
}

/**
 * Posts one Purity Ledger Entry per metal type for a Sales Invoice sold/returned through POS —
 * Dr for a normal sale (weight leaving stock), Cr for a return (weight coming back in).
 * Best-effort and non-throwing: a ledger posting failure must never undo an already-submitted
 * sale, so every failure here is caught and logged, never re-thrown to the caller. Returns the
 * metal types that failed to post so a caller can surface them if it needs to.
 */
export async function postPurityLedgerForInvoice(invoiceName, customerName, lines, { isCredit = false, branch } = {}) {
  const failed = [];
  try {
    const debits = await collectPOSWeightDebits(lines || []);
    const rates = getMetalRates();
    const br = branch ?? (localStorage.getItem('cd_branch') || '');
    for (const metalType of Object.keys(debits)) {
      const { netWt, pureWt } = debits[metalType];
      if (netWt <= 0 && pureWt <= 0) continue;
      try {
        const lastBalance = await getLastPurityLedgerBalance(metalType);
        const rate = rates[metalType] || 0;
        await apiPost('/api/resource/Purity Ledger Entry', {
          datetime: purityLedgerDatetimeNow(),
          posting_date: new Date().toLocaleDateString('en-CA'),
          company: COMPANY,
          branch: br,
          metal_type: metalType,
          pure_wt_cr: isCredit ? pureWt : 0,
          net_wt_cr: isCredit ? netWt : 0,
          pure_wt_dr: isCredit ? 0 : pureWt,
          net_wt_dr: isCredit ? 0 : netWt,
          amount_credit: isCredit ? pureWt * rate : 0,
          amount_debit: isCredit ? 0 : pureWt * rate,
          voucher_type: 'Sales Invoice',
          voucher_name: invoiceName,
          party_type: 'Customer',
          party: customerName,
          balance: isCredit ? lastBalance + pureWt : lastBalance - pureWt,
          is_cancel: 0,
        });
      } catch (e) {
        console.error('Purity Ledger Entry failed for', metalType, ':', e.message);
        failed.push(metalType);
      }
    }
  } catch (e) {
    console.error('postPurityLedgerForInvoice failed:', e.message);
    failed.push('all');
  }
  return { failed };
}

// Submitted, non-return invoices for a customer — used to populate the "Previous invoice"
// picker in the Sales Return flow so it references a real invoice instead of a placeholder.
// Original Sales Invoice name -> the return (credit note, draft or submitted) already made
// against it. A cancelled return doesn't count, so that invoice can be returned again.
export async function fetchReturnsAgainstInvoices(invoiceNames) {
  const found = new Map();
  if (!invoiceNames.length) return found;
  const fields = JSON.stringify(['name', 'return_against']);
  const filters = JSON.stringify([
    ['is_return', '=', 1],
    ['return_against', 'in', invoiceNames],
    ['docstatus', 'in', [0, 1]],
  ]);
  const res = await apiGet(
    `/api/resource/Sales%20Invoice?fields=${encodeURIComponent(fields)}&filters=${encodeURIComponent(filters)}&limit_page_length=0`,
  );
  (getData(res) || []).forEach((r) => found.set(r.return_against, r.name));
  return found;
}

// The customer's submitted invoices that can still be returned — status alone isn't enough,
// since ERPNext doesn't always move a paid POS invoice to "Credit Note Issued", and a draft
// return (e.g. one whose submit failed) never changes the original's status at all.
export async function fetchCustomerInvoices(customerName) {
  if (!customerName) return [];
  try {
    const fields = JSON.stringify(['name', 'posting_date', 'grand_total', 'status']);
    const filters = JSON.stringify([
      ['customer', '=', customerName],
      ['docstatus', '=', 1],
      ['is_return', '=', 0],
      ['status', '!=', 'Credit Note Issued'],
    ]);
    const res = await apiGet(
      `/api/resource/Sales%20Invoice?fields=${encodeURIComponent(fields)}&filters=${encodeURIComponent(filters)}&order_by=posting_date desc&limit_page_length=50`,
    );
    const rows = getData(res) || [];
    const returned = await fetchReturnsAgainstInvoices(rows.map((r) => r.name));
    return rows.filter((r) => !returned.has(r.name));
  } catch (e) {
    console.warn('fetchCustomerInvoices failed:', e.message);
    return [];
  }
}

// A matured scheme's real redeemable value is NOT a fabricated credit note — it's the actual
// unallocated advance sitting on the Payment Entry(s) that collected each installment (each
// one already booked as a real advance the moment it was paid, since this company has "Book
// Advance Payments in Separate Party Account" enabled), plus a genuine discount for any
// bonus/free month the scheme grants (nothing was ever paid for that portion, so it's modelled
// as a price reduction at redemption time, not more fake money). Scopes the POS "Jewellery
// Scheme" operation's checklist to the selected customer's own Matured, not-yet-redeemed
// (used=0) schemes, with each one's real advance + bonus already computed.
// Jewellery Scheme (the scheme *type*, e.g. "Swaran Mani Scheme") — lets the cashier scope the
// POS "Jewellery Scheme" dialog's matured-assignments checklist to one scheme type, since a
// single bill can only redeem assignments from one scheme type at a time.
// name -> posting_date for documents of one doctype (e.g. the Gold Purchases / Sales Returns on
// a reopened bill, whose Settlement References keep only the number).
export async function fetchPostingDates(doctype, names) {
  const dates = new Map();
  const unique = [...new Set(names.filter(Boolean))];
  if (!unique.length) return dates;
  try {
    const fields = JSON.stringify(['name', 'posting_date']);
    const filters = JSON.stringify([['name', 'in', unique]]);
    const res = await apiGet(
      `/api/resource/${encodeURIComponent(doctype)}?fields=${encodeURIComponent(fields)}&filters=${encodeURIComponent(filters)}&limit_page_length=0`,
    );
    (getData(res) || []).forEach((r) => dates.set(r.name, r.posting_date));
  } catch (e) {
    console.warn(`fetchPostingDates failed for ${doctype}:`, e.message);
  }
  return dates;
}

// Jewellery Scheme code -> its scheme_name (a saved invoice's Settlement References keep only the code).
export async function fetchJewellerySchemeNames(codes) {
  const names = new Map();
  const unique = [...new Set(codes.filter(Boolean))];
  if (!unique.length) return names;
  try {
    const fields = JSON.stringify(['name', 'scheme_name']);
    const filters = JSON.stringify([['name', 'in', unique]]);
    const res = await apiGet(
      `/api/resource/Jewellery%20Scheme?fields=${encodeURIComponent(fields)}&filters=${encodeURIComponent(filters)}&limit_page_length=0`,
    );
    (getData(res) || []).forEach((s) => names.set(s.name, s.scheme_name || s.name));
  } catch (e) {
    console.warn('fetchJewellerySchemeNames failed:', e.message);
  }
  return names;
}

export async function searchJewellerySchemes(query) {
  const q = (query || '').trim();
  const fields = JSON.stringify(['name', 'scheme_name', 'is_disable']);
  const filters = JSON.stringify([
    ['is_disable', '=', 0],
    ...(q ? [['scheme_name', 'like', `%${q}%`]] : []),
  ]);
  try {
    const res = await apiGet(
      `/api/resource/Jewellery%20Scheme?fields=${encodeURIComponent(fields)}&filters=${encodeURIComponent(filters)}&limit_page_length=10&order_by=modified desc`,
    );
    return getData(res) || [];
  } catch (e) {
    console.warn('searchJewellerySchemes failed:', e.message);
    return [];
  }
}

export async function fetchCustomerSchemeAssignments(customerName) {
  if (!customerName) return [];
  try {
    const fields = JSON.stringify(['name', 'scheme', 'scheme_name', 'emi_amount', 'date', 'status']);
    const filters = JSON.stringify([
      ['customer', '=', customerName],
      ['docstatus', '=', 1],
      // Closed = pre-closed: redeemable for what was paid (see enrichSchemeAssignmentWithRedeemableValue)
      ['status', 'in', ['Matured', 'Closed']],
      ['used', '=', 0],
    ]);
    const res = await apiGet(
      `/api/resource/Jewellery%20Scheme%20Assignment?fields=${encodeURIComponent(fields)}&filters=${encodeURIComponent(filters)}&order_by=modified desc&limit_page_length=50`,
    );
    const rows = getData(res) || [];
    const enriched = await Promise.all(rows.map((a) => enrichSchemeAssignmentWithRedeemableValue(a)));
    // A scheme closed before any EMI was paid, or already used up on earlier bills, has nothing to redeem
    return enriched.filter((a) => (!a.preClosed || a.monthsPaid > 0) && !(a.redeemedOn?.length && a.advanceTotal <= 0));
  } catch (e) {
    console.warn('fetchCustomerSchemeAssignments failed:', e.message);
    return [];
  }
}

// Submitted Sales Invoices that already redeemed this assignment (from their Settlement
// References). A partly-used scheme comes back for its balance, but its bonus and discounts were
// given on the first of these bills. A cancelled bill drops out, so its benefits return with it.
async function fetchSchemeRedeemedOnInvoices(assignmentName) {
  const refRes = await apiGet(
    `/api/method/frappe.client.get_list?doctype=${encodeURIComponent('Sales Invoice Settlement Reference')}&parent=${encodeURIComponent('Sales Invoice')}`
      + `&fields=${encodeURIComponent(JSON.stringify(['parent']))}`
      + `&filters=${encodeURIComponent(JSON.stringify([['reference_doctype', '=', 'Jewellery Scheme Assignment'], ['reference_name', '=', assignmentName]]))}&limit_page_length=0`,
  );
  const parents = [...new Set((getData(refRes) || []).map((r) => r.parent).filter(Boolean))];
  if (!parents.length) return [];
  const invRes = await apiGet(
    `/api/resource/Sales%20Invoice?fields=${encodeURIComponent(JSON.stringify(['name']))}&filters=${encodeURIComponent(JSON.stringify([['name', 'in', parents], ['docstatus', '=', 1]]))}&order_by=posting_date asc&limit_page_length=0`,
  );
  return (getData(invRes) || []).map((r) => r.name);
}

async function enrichSchemeAssignmentWithRedeemableValue(assignment) {
  const empty = { ...assignment, advanceAllocations: [], advanceTotal: 0, bonusAmount: 0, componentDiscounts: {}, totalRedeemable: 0, failed: true };
  try {
    const [detailRes, schemeRes, redeemedOn] = await Promise.all([
      apiGet(`/api/resource/Jewellery%20Scheme%20Assignment/${encodeURIComponent(assignment.name)}`),
      apiGet(`/api/resource/Jewellery%20Scheme/${encodeURIComponent(assignment.scheme)}`),
      fetchSchemeRedeemedOnInvoices(assignment.name),
    ]);
    const doc = getData(detailRes) || {};
    const schemeDoc = getData(schemeRes) || {};
    const details = doc.jewellery_scheme_assignment_details || [];

    // Several installments can share one Payment Entry (e.g. multiple EMIs paid together in
    // one go) — dedupe to the distinct set actually funding this assignment. A split payment
    // (Cash + UPI) makes one Payment Entry per mode but the rows link only the first, so the
    // rest are found by their custom_scheme_assignment link.
    const linkedRes = await apiGet(
      `/api/resource/Payment%20Entry?fields=${encodeURIComponent(JSON.stringify(['name']))}&filters=${encodeURIComponent(JSON.stringify([['custom_scheme_assignment', '=', assignment.name], ['docstatus', '=', 1]]))}&limit_page_length=0`,
    ).catch(() => null);
    const paymentEntryNames = [...new Set([
      ...details.map((r) => r.payment_entry),
      ...(getData(linkedRes) || []).map((pe) => pe.name),
    ].filter(Boolean))];
    const peDocs = await Promise.all(
      paymentEntryNames.map((pe) =>
        apiGet(`/api/resource/Payment%20Entry/${encodeURIComponent(pe)}?fields=${encodeURIComponent(JSON.stringify(['name', 'docstatus', 'unallocated_amount']))}`)
          .then((r) => getData(r))
          .catch(() => null),
      ),
    );
    const advanceAllocations = peDocs
      .filter((pe) => pe && pe.docstatus === 1 && parseFloat(pe.unallocated_amount) > 0)
      .map((pe) => ({ paymentEntry: pe.name, amount: parseFloat(pe.unallocated_amount) || 0 }));
    const advanceTotal = round2(advanceAllocations.reduce((s, a) => s + a.amount, 0));
    // The basis for every percentage below is what the customer actually paid in EMIs, not the
    // Payment Entry's live unallocated_amount (which is what actually gets referenced on the
    // Sales Invoice's advances table, a separate concern) — matches the client's own Excel
    // working, which always computes off SUM(EMI amounts), not a bank-ledger figure.
    const totalEmiPaid = round2(
      details.filter((r) => String(r.status || '').toLowerCase() === 'paid').reduce((s, r) => s + (parseFloat(r.emi) || 0), 0),
    );

    // A Closed assignment was pre-closed: the customer stopped paying, so it redeems what was
    // actually paid with the discounts earned for that many months, but never the bonus month.
    const preClosed = String(assignment.status || '').toLowerCase() === 'closed';
    const monthsPaid = details.filter((r) => String(r.status || '').toLowerCase() === 'paid').length;

    // Bonus month (Swaran Mani): the company adds bonus_installments worth of free EMI money —
    // only when the scheme runs to maturity.
    let bonusAmount = 0;
    if (schemeDoc.has_bonus_month && !preClosed) {
      const bonusCount = parseInt(schemeDoc.bonus_installments, 10) || 1;
      bonusAmount = round2(bonusCount * (parseFloat(assignment.emi_amount) || 0));
    }

    // Discounts come from the scheme_duration_table row for the months paid (the last row once
    // matured), for every scheme:
    //  - mc_percentage_discount: % of the TOTAL EMI PAID (not of the item's Making Charge),
    //    turned into a flat rupee discount against Making Charges
    //  - mc_discount_amount: despite its name a % off the bill's Making Charges (used only when
    //    the row has no mc_percentage_discount)
    //  - discount_on_diamond_jewellery: % off the bill's Diamond value
    const durationRow = (schemeDoc.scheme_duration_table || [])
      .filter((r) => (parseInt(r.month, 10) || 0) <= monthsPaid)
      .sort((a, b) => (parseInt(a.month, 10) || 0) - (parseInt(b.month, 10) || 0))
      .pop();
    const componentDiscounts = {};
    const mcPct = parseFloat(durationRow?.mc_percentage_discount || 0) || 0;
    const mcBillPct = parseFloat(durationRow?.mc_discount_amount || 0) || 0;
    const diamondPct = parseFloat(durationRow?.discount_on_diamond_jewellery || 0) || 0;
    if (mcPct > 0 && totalEmiPaid > 0) {
      componentDiscounts.making = { mode: 'amount', value: round2(totalEmiPaid * (mcPct / 100)) };
    } else if (mcBillPct > 0) {
      componentDiscounts.making = { mode: 'percent', value: mcBillPct };
    }
    if (diamondPct > 0) componentDiscounts.diamond = { mode: 'percent', value: diamondPct };

    // "Freeze the Gold" schemes (accumulate_gold) lock in a gold weight per installment at the
    // rate on its payment date (captured in gold_rate/gold_qty when marked Paid — see
    // caratdesk-jewellery-scheme.html). At redemption the accumulated grams are valued at
    // TODAY's rate; the part above what was actually paid in cash is a genuine, company-funded
    // gain nobody paid for — same treatment as a flat bonus, not real advance money. This is
    // independent of the has_bonus_month branch above (Swaran Nidhi has neither bonus_month nor
    // a bonus from it, but still gets this on top of its Making Charges discount).
    if (schemeDoc.accumulate_gold) {
      const accumulatedGrams = round2(details.reduce((s, r) => s + (parseFloat(r.gold_qty) || 0), 0));
      if (accumulatedGrams > 0) {
        const goldValueToday = round2(accumulatedGrams * getGoldRate());
        bonusAmount = round2(bonusAmount + Math.max(0, goldValueToday - totalEmiPaid));
      }
    }

    // Bonus and discounts are given once, on the first bill — after that only the balance is left
    if (redeemedOn.length) {
      bonusAmount = 0;
      Object.keys(componentDiscounts).forEach((k) => { delete componentDiscounts[k]; });
    }

    return { ...assignment, advanceAllocations, advanceTotal, bonusAmount, componentDiscounts, preClosed, monthsPaid, redeemedOn, totalRedeemable: round2(advanceTotal + bonusAmount) };
  } catch (e) {
    console.warn(`enrichSchemeAssignmentWithRedeemableValue failed for ${assignment.name}:`, e.message);
    return empty;
  }
}

// Belt-and-suspenders lock so a scheme's advance can't be redeemed onto a second bill later —
// ERPNext's own Payment Entry unallocated_amount already prevents re-allocating the same real
// money, but this stops the scheme from even being offered again in the picker.
export async function markSchemeAssignmentUsed(assignmentName) {
  if (!assignmentName) return;
  try {
    await apiPut(`/api/resource/Jewellery%20Scheme%20Assignment/${encodeURIComponent(assignmentName)}`, { used: 1 });
  } catch (e) {
    console.warn(`markSchemeAssignmentUsed failed for ${assignmentName}:`, e.message);
  }
}

// ERPNext doesn't reconcile a POS invoice's Advances table, so a submitted bill that redeems a
// scheme stays Partly Paid for the scheme amount and the scheme's Payment Entries stay
// unallocated. caratdesk_reconcile_scheme_advances (Server Script) runs ERPNext's own Payment
// Reconciliation for it. Returns { reconciled, skipped, outstanding }; throws on failure.
export async function reconcileSchemeAdvances(invoiceName) {
  const res = await apiPost('/api/method/caratdesk_reconcile_scheme_advances', { data: { invoice: invoiceName } });
  return res?.message || {};
}

// After a bill redeems a scheme: marks it used only once no advance is left on its Payment
// Entries — a partly-used scheme stays redeemable for its balance. Returns whether it was marked.
export async function markSchemeAssignmentUsedIfSpent(assignmentName) {
  if (!assignmentName) return false;
  try {
    const doc = getData(await apiGet(`/api/resource/Jewellery%20Scheme%20Assignment/${encodeURIComponent(assignmentName)}`)) || {};
    const { advanceTotal, failed } = await enrichSchemeAssignmentWithRedeemableValue(doc);
    if (failed || advanceTotal > 0.009) return false;
    await markSchemeAssignmentUsed(assignmentName);
    return true;
  } catch (e) {
    console.warn(`markSchemeAssignmentUsedIfSpent failed for ${assignmentName}:`, e.message);
    return false;
  }
}

// Each serialized finished-good has its own per-unit BOM (e.g. "BOM-Bangle-Antique-1-ST-011") —
// once that specific piece is sold, its BOM is no longer "active" stock and shouldn't show up
// as a live/default BOM for the item code going forward.
export async function deactivateBom(bomName) {
  if (!bomName) return;
  try {
    await apiPut(`/api/resource/BOM/${encodeURIComponent(bomName)}`, { is_active: 0 });
  } catch (e) {
    console.warn(`deactivateBom failed for ${bomName}:`, e.message);
  }
}

// Reverse of deactivateBom, used when a sold invoice is cancelled and its pieces are back in
// stock. Throws (unlike deactivateBom) so the Cancel & Amend flow can report what it couldn't undo.
export async function activateBom(bomName) {
  if (!bomName) return;
  await apiPut(`/api/resource/BOM/${encodeURIComponent(bomName)}`, { is_active: 1 });
}

// Creates a real, linked Credit Note against an existing submitted Sales Invoice — mirrors the
// original's items/taxes with quantities and amounts negated, and sets is_return/return_against
// the way ERPNext expects, instead of faking a "Sales Return Credit Note" payment-mode row on
// some unrelated later bill. Whole-invoice return only (no partial item selection yet).
export async function createSalesReturn(originalInvoiceName) {
  const res = await apiGet(`/api/resource/Sales%20Invoice/${encodeURIComponent(originalInvoiceName)}`);
  const original = getData(res);
  if (!original?.name) throw new Error('Original invoice not found');
  // Re-checked here, not just in the picker — another counter may have returned it since.
  const existing = (await fetchReturnsAgainstInvoices([original.name])).get(original.name);
  if (existing) throw new Error(`Sales Return ${existing} is already created against ${original.name}`);

  const items = (original.items || []).map((item) => ({
    doctype: 'Sales Invoice Item',
    item_code: item.item_code,
    item_name: item.item_name,
    description: item.description,
    qty: -Math.abs(item.qty),
    uom: item.uom,
    stock_uom: item.stock_uom,
    conversion_factor: item.conversion_factor || 1,
    rate: item.rate,
    amount: -Math.abs(item.amount),
    warehouse: item.warehouse || undefined,
    serial_no: item.serial_no || undefined,
    batch_no: item.batch_no || undefined,
    // Batch rows have no serial of their own — without this ERPNext wants a Serial and Batch
    // Bundle on the return row instead of the plain batch_no.
    ...(item.batch_no && !item.serial_no ? { use_serial_batch_fields: 1 } : {}),
    ...(item.custom_pcs ? { custom_pcs: item.custom_pcs } : {}),
    gst_hsn_code: item.gst_hsn_code || '',
  }));

  const taxes = (original.taxes || []).map((tax, idx) => ({
    doctype: 'Sales Taxes and Charges',
    idx: idx + 1,
    charge_type: tax.charge_type,
    account_head: tax.account_head,
    description: tax.description,
    rate: tax.rate,
    tax_amount: -Math.abs(tax.tax_amount),
    included_in_print_rate: tax.included_in_print_rate ? 1 : 0,
  }));

  const today = new Date().toISOString().slice(0, 10);
  const payload = {
    doctype: 'Sales Invoice',
    is_return: 1,
    return_against: original.name,
    customer: original.customer,
    customer_name: original.customer_name,
    company: original.company,
    posting_date: today,
    due_date: today,
    currency: original.currency,
    is_pos: original.is_pos || 0,
    update_stock: original.update_stock || 0,
    items,
    taxes,
    ignore_pricing_rule: 1,
  };

  const createRes = await apiPost('/api/resource/Sales Invoice', payload);
  const name = createRes?.data?.name || createRes?.name;
  if (!name) throw new Error('Return creation failed — no invoice name returned');
  await apiPut(`/api/resource/Sales%20Invoice/${encodeURIComponent(name)}`, { docstatus: 1 });

  // A return puts weight back into stock — Cr the ledger, mirroring isReturnSI on the HTML
  // Sales Invoice page. Best-effort: postPurityLedgerForInvoice never throws, so a ledger
  // failure can't undo a return that's already been submitted.
  await postPurityLedgerForInvoice(name, original.customer, items, {
    isCredit: true,
    branch: original.branch || undefined,
  });

  // Pcs sold out of a batch go back onto it, the same way ERPNext puts the qty back.
  const pcs = await adjustBatchPcs(items, +1);
  if (pcs.failed.length) console.error(`Return ${name}: could not add Pcs back to batch ${pcs.failed.join(', ')}`);

  return name;
}

export function getPrintUrl(invoiceName) {
  const params = new URLSearchParams({
    doctype: 'Sales Invoice',
    name: invoiceName,
    format: 'Standard',
    no_letterhead: '0',
  });
  return `/api/method/frappe.utils.print_format.download_pdf?${params.toString()}`;
}

// Auth is a token header, so the PDF can't just be opened by URL — fetch it, load it into a
// hidden iframe and raise the browser's print dialog. If the browser won't print the frame,
// fall back to showing the PDF in a new tab.
export async function printSalesInvoice(invoiceName) {
  return printPdf(getPrintUrl(invoiceName));
}

async function fetchPdfBlobUrl(endpoint) {
  const headers = getAuthHeaders(null);
  if (!headers) throw new Error('Not authenticated');
  const res = await fetch(endpoint, { headers });
  if (res.status === 401) handle401();
  if (!res.ok) throw new Error(`Could not load invoice PDF (HTTP ${res.status})`);
  return URL.createObjectURL(new Blob([await res.blob()], { type: 'application/pdf' }));
}

async function printPdf(endpoint) {
  const url = await fetchPdfBlobUrl(endpoint);
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  frame.src = url;
  frame.onload = () => {
    try {
      frame.contentWindow.focus();
      frame.contentWindow.print();
    } catch {
      window.open(url, '_blank');
    }
  };
  document.body.appendChild(frame);
  // The print dialog keeps reading the frame while open, so clean up only well after.
  setTimeout(() => { frame.remove(); URL.revokeObjectURL(url); }, 120000);
}

// Same endpoint and options ERPNext's list-view Print dialog uses, so Letter Head / Print
// Format / Page Size behave exactly as they do in the desk.
export function getPrintWithOptionsUrl(invoiceName, { format, letterhead, pageSize, pageHeight, pageWidth } = {}) {
  const options = {};
  if (pageSize === 'Custom') {
    if (pageHeight) options['page-height'] = Number(pageHeight);
    if (pageWidth) options['page-width'] = Number(pageWidth);
  } else if (pageSize) {
    options['page-size'] = pageSize;
  }
  const params = new URLSearchParams({
    doctype: 'Sales Invoice',
    name: JSON.stringify([invoiceName]),
    format: format || 'Standard',
    no_letterhead: letterhead ? '0' : '1',
    letterhead: letterhead || 'No Letterhead',
    options: JSON.stringify(options),
  });
  return `/api/method/frappe.utils.print_format.download_multi_pdf?${params.toString()}`;
}

// POS Print: straight to the browser's print window with the Sales Invoice's default Print
// Format and default Letter Head. No page size is sent, so ERPNext's Print Settings decide it.
export async function printSalesInvoiceDefault(invoiceName) {
  const [{ defaultFormat }, heads] = await Promise.all([fetchPrintFormats('Sales Invoice'), fetchLetterHeads()]);
  const letterhead = heads.find((h) => Number(h.is_default))?.name || '';
  return printPdf(getPrintWithOptionsUrl(invoiceName, { format: defaultFormat || 'Standard', letterhead }));
}

// Enabled Print Formats for a doctype, plus which one is its default (set via Customize Form,
// which stores it as a Property Setter). The default lookup is best-effort — non-admin users
// may not be allowed to read Property Setters.
export async function fetchPrintFormats(doctype) {
  const fields = JSON.stringify(['name']);
  const filters = JSON.stringify([['doc_type', '=', doctype], ['disabled', '=', 0]]);
  const [formatsRes, defaultRes] = await Promise.allSettled([
    apiGet(`/api/resource/Print%20Format?fields=${encodeURIComponent(fields)}&filters=${encodeURIComponent(filters)}&order_by=name asc&limit_page_length=0`),
    apiGet(`/api/resource/Property%20Setter?fields=${encodeURIComponent(JSON.stringify(['value']))}&filters=${encodeURIComponent(JSON.stringify([['doc_type', '=', doctype], ['property', '=', 'default_print_format']]))}&limit_page_length=1`),
  ]);
  const names = formatsRes.status === 'fulfilled' ? (getData(formatsRes.value) || []).map((r) => r.name) : [];
  const defaultFormat = defaultRes.status === 'fulfilled' ? (getData(defaultRes.value) || [])[0]?.value || null : null;
  return { formats: ['Standard', ...names.filter((n) => n !== 'Standard')], defaultFormat };
}

export async function fetchLetterHeads() {
  try {
    const fields = JSON.stringify(['name', 'is_default']);
    const filters = JSON.stringify([['disabled', '=', 0]]);
    const res = await apiGet(
      `/api/resource/Letter%20Head?fields=${encodeURIComponent(fields)}&filters=${encodeURIComponent(filters)}&order_by=name asc&limit_page_length=0`,
    );
    return getData(res) || [];
  } catch (e) {
    console.warn('fetchLetterHeads failed:', e.message);
    return [];
  }
}

// POS Recall / Print picker: one customer's Sales Invoices, filtered server side.
//   forRecall — only what POS can open (no returns, nothing cancelled).
//   status    — a Sales Invoice status, or '' for every non-cancelled one.
export const INVOICE_PAGE_SIZE = 50;
export async function searchCustomerSalesInvoices(customerName, {
  forRecall = false, search = '', fromDate = '', toDate = '', status = '', minAmount = '', maxAmount = '', start = 0,
} = {}) {
  if (!customerName) return [];
  const filters = [['customer', '=', customerName]];
  if (status) filters.push(['status', '=', status]);
  else filters.push(['docstatus', '!=', 2]);
  if (forRecall) filters.push(['is_return', '=', 0], ['docstatus', '!=', 2]);
  if (search.trim()) filters.push(['name', 'like', `%${search.trim()}%`]);
  if (fromDate) filters.push(['posting_date', '>=', fromDate]);
  if (toDate) filters.push(['posting_date', '<=', toDate]);
  if (minAmount !== '' && !Number.isNaN(Number(minAmount))) filters.push(['grand_total', '>=', Number(minAmount)]);
  if (maxAmount !== '' && !Number.isNaN(Number(maxAmount))) filters.push(['grand_total', '<=', Number(maxAmount)]);
  const fields = JSON.stringify(['name', 'posting_date', 'posting_time', 'grand_total', 'status', 'docstatus', 'is_return']);
  const res = await apiGet(
    `/api/resource/Sales%20Invoice?fields=${encodeURIComponent(fields)}&filters=${encodeURIComponent(JSON.stringify(filters))}` +
    `&order_by=${encodeURIComponent('posting_date desc, posting_time desc, name desc')}&limit_start=${start}&limit_page_length=${INVOICE_PAGE_SIZE}`,
  );
  return getData(res) || [];
}

/** Stub for future supplier-margin auto-fetch */
export async function fetchSupplierMargin(/* itemCode, customer */) {
  return null;
}

// ── POS Shift ──
// Backend-tracked shift lifecycle (replaces the old localStorage-only shift object) so
// opening/closing cash, timestamps, and the cashier are real, auditable records instead of
// something that only ever lived in one browser.

function toFrappeDatetime(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

const POS_SHIFT_FIELDS = ['name', 'user', 'cashier_name', 'branch', 'counter', 'shift_start_datetime', 'shift_end_datetime', 'opening_cash', 'status'];

// The `user` field isn't yet server-defaulted to the session user (no `default:"__user"` on
// the DocType field), so it's sent explicitly here as a stopgap — swap this out once that's
// configured, since a server-side default is the only way to make this tamper-proof.
export async function createPosShift({ userEmail, branch, counter, openingCash, salesTeam = [] }) {
  const payload = {
    doctype: 'POS Shift',
    user: userEmail,
    branch: branch || undefined,
    counter: counter || undefined,
    shift_start_datetime: toFrappeDatetime(),
    opening_cash: parseFloat(openingCash) || 0,
    status: 'Open',
    ...(salesTeam.length ? {
      sales_team: salesTeam.map((r) => ({
        doctype: 'Sales Team',
        sales_person: r.salesPerson,
        allocated_percentage: round2(Number(r.percentage) || 0),
      })),
    } : {}),
  };
  const res = await apiPost('/api/resource/POS Shift', payload);
  return getData(res) || res?.data || res;
}

export async function fetchPosShift(name) {
  if (!name) return null;
  try {
    const res = await apiGet(`/api/resource/POS%20Shift/${encodeURIComponent(name)}`);
    return getData(res) || null;
  } catch (e) {
    console.warn('fetchPosShift failed:', e.message);
    return null;
  }
}

// Resumes whatever shift this user left open — e.g. after a page refresh or a different
// device/browser — rather than trusting a local cache that could be stale.
export async function fetchOpenPosShift(userEmail) {
  if (!userEmail) return null;
  try {
    const fields = JSON.stringify(POS_SHIFT_FIELDS);
    const filters = JSON.stringify([['user', '=', userEmail], ['status', '=', 'Open']]);
    const res = await apiGet(
      `/api/resource/POS%20Shift?fields=${encodeURIComponent(fields)}&filters=${encodeURIComponent(filters)}&order_by=creation desc&limit_page_length=1`,
    );
    const rows = getData(res) || [];
    return rows[0] || null;
  } catch (e) {
    console.warn('fetchOpenPosShift failed:', e.message);
    return null;
  }
}

// Same "sum invoice payments by mode" pattern already used in fetchDaySummary, scoped to one
// shift's invoices (custom_pos_shift) instead of one calendar day — this is what Shift End
// reconciles the counted cash/UPI/card totals against.
export async function fetchPosShiftSalesSummary(shiftName) {
  const empty = { totalSales: 0, totalTransactions: 0, modeBreakup: {} };
  if (!shiftName) return empty;
  try {
    const fields = JSON.stringify(['name', 'grand_total']);
    const filters = JSON.stringify([['custom_pos_shift', '=', shiftName], ['docstatus', '=', 1]]);
    const res = await apiGet(
      `/api/resource/Sales%20Invoice?fields=${encodeURIComponent(fields)}&filters=${encodeURIComponent(filters)}&limit_page_length=500`,
    );
    const invoices = getData(res) || [];
    let totalSales = 0;
    const modeBreakup = {};
    for (const inv of invoices) {
      totalSales += parseFloat(inv.grand_total || 0);
      try {
        const detail = await apiGet(
          `/api/resource/Sales%20Invoice/${encodeURIComponent(inv.name)}?fields=${encodeURIComponent(JSON.stringify(['payments']))}`,
        );
        const doc = getData(detail);
        (doc?.payments || []).forEach((p) => {
          const mode = p.mode_of_payment || 'Other';
          modeBreakup[mode] = (modeBreakup[mode] || 0) + (parseFloat(p.amount) || 0);
        });
      } catch {
        // skip payment detail errors for this one invoice, keep summing the rest
      }
    }
    return {
      totalSales: Math.round(totalSales * 100) / 100,
      totalTransactions: invoices.length,
      modeBreakup,
    };
  } catch (e) {
    console.warn('fetchPosShiftSalesSummary failed:', e.message);
    return empty;
  }
}

// Closes and submits the shift in one call — paymentSummaryRows is [{mode, expected, counted}],
// Cash included alongside every other Mode of Payment used during the shift.
export async function closePosShift(name, { closingCash, expectedCash, totalSalesAmount, totalTransactions, closingRemarks, paymentSummaryRows = [] }) {
  const cashDifference = Math.round(((parseFloat(closingCash) || 0) - (parseFloat(expectedCash) || 0)) * 100) / 100;
  const payload = {
    shift_end_datetime: toFrappeDatetime(),
    closing_cash: parseFloat(closingCash) || 0,
    expected_cash: parseFloat(expectedCash) || 0,
    cash_difference: cashDifference,
    total_sales_amount: parseFloat(totalSalesAmount) || 0,
    total_transactions: parseInt(totalTransactions, 10) || 0,
    closing_remarks: closingRemarks || '',
    status: 'Closed',
    pos_shift_payment_summary: paymentSummaryRows.map((r, idx) => ({
      doctype: 'POS Shift Payment Summary',
      idx: idx + 1,
      mode_of_payment: r.mode,
      expected_amount: Math.round((parseFloat(r.expected) || 0) * 100) / 100,
      counted_amount: Math.round((parseFloat(r.counted) || 0) * 100) / 100,
      difference: Math.round(((parseFloat(r.counted) || 0) - (parseFloat(r.expected) || 0)) * 100) / 100,
    })),
  };
  await apiPut(`/api/resource/POS%20Shift/${encodeURIComponent(name)}`, payload);
  await apiPut(`/api/resource/POS%20Shift/${encodeURIComponent(name)}`, { docstatus: 1 });
}
