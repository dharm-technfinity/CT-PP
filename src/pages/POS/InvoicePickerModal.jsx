import { useEffect, useMemo, useRef, useState } from 'react';
import { fmtDate, fmtINR, parseApiError, customerLabel } from '../../lib/format.js';
import { useDebounce } from '../../hooks/useDebounce.js';
import { useToast } from '../../hooks/useToast.jsx';
import { INVOICE_PAGE_SIZE, searchCustomers, searchCustomerSalesInvoices } from '../../lib/api.js';

const RECALL_STATUSES = ['Draft', 'Paid', 'Unpaid', 'Partly Paid', 'Overdue'];

const STATUS_PILL = {
  Paid: 'green',
  Unpaid: 'red',
  Overdue: 'red',
  Cancelled: 'red',
  'Partly Paid': 'amber',
  Return: 'blue',
  'Credit Note Issued': 'blue',
};

function isoDaysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const DATE_PRESETS = [
  { label: 'Today', days: 0 },
  { label: '7 days', days: 7 },
  { label: '30 days', days: 30 },
  { label: 'All', days: null },
];

function StatusPill({ status }) {
  const tone = STATUS_PILL[status];
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 8px',
      borderRadius: 6,
      fontSize: 11,
      background: tone ? `var(--pill-${tone}-bg)` : 'var(--nav-hover)',
      color: tone ? `var(--pill-${tone}-txt)` : 'var(--text-secondary)',
    }}
    >
      {status}
    </span>
  );
}

// POS Recall Invoice: pick a customer, then find one of their Sales Invoices.
// onRecall(name) opens it in POS (drafts editable, submitted read-only).
export default function InvoicePickerModal({ customer, onClose, onRecall }) {
  const { showToast } = useToast();

  const [opCustomer, setOpCustomer] = useState(customer || null);
  const [customerQuery, setCustomerQuery] = useState('');
  const [customerResults, setCustomerResults] = useState([]);
  const [customerSearching, setCustomerSearching] = useState(false);
  const [showCustomerList, setShowCustomerList] = useState(!customer);
  const debouncedCustomerQuery = useDebounce(customerQuery, 300);

  const [search, setSearch] = useState('');
  const [fromDate, setFromDate] = useState(isoDaysAgo(30));
  const [toDate, setToDate] = useState('');
  const [status, setStatus] = useState('');
  const [minAmount, setMinAmount] = useState('');
  const [maxAmount, setMaxAmount] = useState('');
  // Memoised so the debounce (and the fetch behind it) only fires when a filter actually changes.
  const filterValues = useMemo(() => ({ search, fromDate, toDate, status, minAmount, maxAmount }), [search, fromDate, toDate, status, minAmount, maxAmount]);
  const filters = useDebounce(filterValues, 300);

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [active, setActive] = useState(0);
  const listRef = useRef(null);
  const searchRef = useRef(null);
  const customerInputRef = useRef(null);

  useEffect(() => {
    if (!showCustomerList) return undefined;
    let cancelled = false;
    (async () => {
      setCustomerSearching(true);
      try {
        const res = await searchCustomers(debouncedCustomerQuery);
        if (!cancelled) setCustomerResults(res);
      } catch (e) {
        if (!cancelled) showToast(parseApiError(e), 'error');
      } finally {
        if (!cancelled) setCustomerSearching(false);
      }
    })();
    return () => { cancelled = true; };
  }, [debouncedCustomerQuery, showCustomerList, showToast]);

  useEffect(() => {
    (opCustomer ? searchRef : customerInputRef).current?.focus();
  }, [opCustomer]);

  useEffect(() => {
    if (!opCustomer?.name) return undefined;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await searchCustomerSalesInvoices(opCustomer.name, { ...filters, forRecall: true });
        if (cancelled) return;
        setRows(res);
        setHasMore(res.length === INVOICE_PAGE_SIZE);
        setActive(0);
      } catch (e) {
        if (!cancelled) showToast(parseApiError(e), 'error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [opCustomer, filters, showToast]);

  async function loadMore() {
    setLoading(true);
    try {
      const res = await searchCustomerSalesInvoices(opCustomer.name, { ...filters, forRecall: true, start: rows.length });
      setRows((r) => [...r, ...res]);
      setHasMore(res.length === INVOICE_PAGE_SIZE);
    } catch (e) {
      showToast(parseApiError(e), 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    listRef.current?.querySelector(`[data-row="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  function selectCustomer(c) {
    setOpCustomer(c);
    setCustomerQuery('');
    setShowCustomerList(false);
  }

  function choose(row) {
    if (!row) return;
    onRecall(row.name);
  }

  function handleKeyDown(e) {
    if (!rows.length || e.target.tagName === 'SELECT') return;
    if (e.target === customerInputRef.current && showCustomerList) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, rows.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(rows[active]); }
  }

  const activePreset = DATE_PRESETS.find((p) => !toDate && (p.days === null ? !fromDate : fromDate === isoDaysAgo(p.days)));

  return <>
    <div className="cd-idialog-overlay" onClick={onClose} role="presentation" />
    <div className="cd-idialog operations-dialog" role="dialog" aria-modal="true" onKeyDown={handleKeyDown}>
      <div className="cd-idialog-header">
        <span className="cd-idialog-title">Recall Sales Invoice</span>
        <button type="button" className="cd-idialog-close" onClick={onClose}>×</button>
      </div>
      <div className="cd-idialog-body">
        <div className="cd-field">
          <label className="cd-label">Customer</label>
          <div className="cd-ac">
            <input
              ref={customerInputRef}
              className="cd-input"
              placeholder="Search by name or mobile…"
              value={showCustomerList ? customerQuery : customerLabel(opCustomer)}
              onChange={(e) => { setCustomerQuery(e.target.value); setShowCustomerList(true); }}
              onFocus={() => { setCustomerQuery(''); setShowCustomerList(true); }}
              onBlur={() => setTimeout(() => setShowCustomerList(false), 150)}
            />
            {showCustomerList && (
              <div className="cd-ac-list">
                {customerSearching && <div className="cd-ac-empty">Searching…</div>}
                {!customerSearching && !customerQuery.trim() && customerResults.length > 0 && (
                  <div className="cd-ac-hint">Recent customers</div>
                )}
                {!customerSearching && customerResults.length === 0 && (
                  <div className="cd-ac-empty">No customer found</div>
                )}
                {customerResults.map((c) => (
                  <div key={c.name} className="cd-ac-item" onMouseDown={() => selectCustomer(c)} role="button" tabIndex={0}>
                    <div className="main">{c.customer_name || c.name}</div>
                    <div className="sub">ID: {c.name} · {c.mobile_no || '—'}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {opCustomer?.name && !showCustomerList && <>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
            <div className="cd-field">
              <label className="cd-label">Invoice No.</label>
              <input
                ref={searchRef}
                className="cd-input"
                placeholder="Type any part of the number, e.g. 0042"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="cd-field">
              <label className="cd-label">Status</label>
              <select className="cd-select" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">All</option>
                {RECALL_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
            {DATE_PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                className={`cd-btn ${activePreset === p ? 'cd-btn-primary' : 'cd-btn-secondary'}`}
                style={{ padding: '4px 12px', fontSize: 12 }}
                onClick={() => { setFromDate(p.days === null ? '' : isoDaysAgo(p.days)); setToDate(''); }}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12 }}>
            <div className="cd-field">
              <label className="cd-label">From Date</label>
              <input className="cd-input" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
            </div>
            <div className="cd-field">
              <label className="cd-label">To Date</label>
              <input className="cd-input" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
            </div>
            <div className="cd-field">
              <label className="cd-label">Min Amount</label>
              <input className="cd-input" type="number" min="0" value={minAmount} onChange={(e) => setMinAmount(e.target.value)} />
            </div>
            <div className="cd-field">
              <label className="cd-label">Max Amount</label>
              <input className="cd-input" type="number" min="0" value={maxAmount} onChange={(e) => setMaxAmount(e.target.value)} />
            </div>
          </div>

          <div ref={listRef} style={{ maxHeight: 320, overflowY: 'auto', borderRadius: 10 }}>
            <table className="cd-gold-table">
              <thead><tr><th>Invoice No.</th><th style={{ textAlign: 'left' }}>Date</th><th style={{ textAlign: 'left' }}>Status</th><th style={{ textAlign: 'right' }}>Grand Total</th></tr></thead>
              <tbody>
                {!rows.length && (
                  <tr><td colSpan={4} className="cd-ac-empty">{loading ? 'Loading invoices…' : 'No invoices match these filters'}</td></tr>
                )}
                {rows.map((r, i) => (
                  <tr
                    key={r.name}
                    data-row={i}
                    onClick={() => setActive(i)}
                    onDoubleClick={() => choose(r)}
                    style={{ cursor: 'pointer', background: i === active ? 'var(--pill-blue-bg)' : undefined }}
                  >
                    <td><strong>{r.name}</strong></td>
                    <td style={{ textAlign: 'left' }}>{fmtDate(r.posting_date)}</td>
                    <td style={{ textAlign: 'left' }}><StatusPill status={r.status} /></td>
                    <td style={{ textAlign: 'right' }}>{fmtINR(r.grand_total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
            <span className="cd-hint" style={{ margin: 0 }}>
              {rows.length} invoice{rows.length === 1 ? '' : 's'} · ↑/↓ to move, Enter or double-click to recall
            </span>
            {hasMore && (
              <button type="button" className="cd-btn cd-btn-secondary" style={{ padding: '4px 12px', fontSize: 12 }} disabled={loading} onClick={loadMore}>
                {loading ? 'Loading…' : 'Load more'}
              </button>
            )}
          </div>
        </>}
      </div>
      <div className="cd-idialog-footer">
        <button type="button" className="cd-btn cd-btn-secondary" onClick={onClose}>Cancel</button>
        <button type="button" className="cd-btn cd-btn-primary" disabled={!rows[active]} onClick={() => choose(rows[active])}>
          Recall
        </button>
      </div>
    </div>
  </>;
}
