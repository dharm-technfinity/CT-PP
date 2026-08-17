import { useEffect, useState } from 'react';
import { useDebounce } from '../../hooks/useDebounce.js';
import { useToast } from '../../hooks/useToast.jsx';
import {
  searchCustomers,
  getCustomerDetails,
  createCustomerWithLinks,
  getCustomerByMobile,
} from '../../lib/api.js';
import { parseApiError } from '../../lib/format.js';
import NewCustomerModal from './NewCustomerModal.jsx';

export default function CustomerPanel({ customer, onSelect, onClear }) {
  const { showToast } = useToast();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [showList, setShowList] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [creatingCustomer, setCreatingCustomer] = useState(false);
  const [details, setDetails] = useState(null);
  const debouncedQuery = useDebounce(query, 300);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setSearching(true);
      try {
        const rows = await searchCustomers(debouncedQuery);
        if (!cancelled) setResults(rows);
      } catch (e) {
        if (!cancelled) showToast(parseApiError(e), 'error');
      } finally {
        if (!cancelled) setSearching(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, showToast]);

  useEffect(() => {
    if (!customer?.name) {
      return undefined;
    }
    let cancelled = false;
    (async () => {
      try {
        const doc = await getCustomerDetails(customer.name);
        if (!cancelled) setDetails(doc);
      } catch {
        if (!cancelled) setDetails(customer);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [customer]);

  async function selectCustomer(c) {
    onSelect({
      name: c.name,
      customer_name: c.customer_name || c.name,
      mobile_no: c.mobile_no || '',
      email_id: c.email_id || '',
    });
    setQuery(c.customer_name || c.name);
    setShowList(false);
  }

  async function handleCreate(form) {
    const mobile = (form.mobile_no || '').replace(/\D/g, '');
    const customerName = (form.customer_name || '').trim();
    if (!customerName) {
      showToast('Customer name is required', 'error');
      return;
    }
    if (mobile.length !== 10) {
      showToast('Mobile number must be 10 digits', 'error');
      return;
    }
    const country = (form.country || '').trim();
    if (country && country.toLowerCase() !== 'india' && !(form.passport_number || '').trim()) {
      showToast('Passport Number is required for customers outside India', 'error');
      return;
    }
    setCreatingCustomer(true);
    try {
      const existing = await getCustomerByMobile(mobile);
      if (existing) {
        const useExisting = window.confirm(
          `Customer with mobile ${mobile} already exists (${existing.customer_name}). Select existing customer?`,
        );
        if (useExisting) {
          await selectCustomer(existing);
          setShowModal(false);
          return;
        }
        return;
      }

      const created = await createCustomerWithLinks({
        customer_name: customerName,
        salutation: (form.salutation || '').trim(),
        first_name: (form.first_name || '').trim(),
        last_name: (form.last_name || '').trim(),
        mobile_no: mobile,
        imageFile: form.imageFile || null,
        email_id: (form.email_id || '').trim(),
        address_line1: (form.address_line1 || '').trim(),
        address_line2: (form.address_line2 || '').trim(),
        city: (form.city || '').trim(),
        state: (form.state || '').trim(),
        pincode: (form.pincode || '').trim(),
        country,
        gstin: (form.gstin || '').trim(),
        is_primary_address: !!form.is_primary_address,
        is_shipping_address: !!form.is_shipping_address,
        date_of_birth: form.date_of_birth || '',
        anniversary: form.anniversary || '',
        pan: (form.pan || '').trim(),
        aadhaar_no: (form.aadhaar_no || '').trim(),
      });
      showToast('Customer created', 'success');
      await selectCustomer(created);
      setShowModal(false);
    } catch (e) {
      showToast(parseApiError(e), 'error');
    } finally {
      setCreatingCustomer(false);
    }
  }

  return (
    <aside className="cd-pos-panel">
      <div className="cd-panel-head">
        <span>Customer</span>
        {customer && (
          <button type="button" className="cd-btn cd-btn-secondary" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => { onClear(); setQuery(''); setDetails(null); }}>
            Clear
          </button>
        )}
      </div>
      <div className="cd-panel-body">
        <div className="cd-ac">
          <label className="cd-label">Search by name or mobile number</label>
          <input
            className="cd-input"
            placeholder="Type a name or 10-digit mobile number…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setShowList(true);
            }}
            onFocus={() => setShowList(true)}
          />
          {showList && (
            <div className="cd-ac-list">
              {searching && (
                <div className="cd-ac-empty">Searching…</div>
              )}
              {!searching && !query.trim() && results.length > 0 && (
                <div className="cd-ac-hint">Recent customers</div>
              )}
              {!searching && results.length === 0 && (
                <div className="cd-ac-empty">No customer found</div>
              )}
              {results.map((c) => (
                <div
                  key={c.name}
                  className="cd-ac-item"
                  onMouseDown={() => selectCustomer(c)}
                  role="button"
                  tabIndex={0}
                >
                  <div className="cd-ac-avatar">{(c.customer_name || c.name || '?').trim().charAt(0).toUpperCase()}</div>
                  <div className="cd-ac-text">
                    <div className="main">{c.customer_name || c.name}</div>
                    <div className="sub">
                      <span className="cd-ac-mobile">{c.mobile_no || 'No mobile number'}</span>
                      {c.email_id ? ` · ${c.email_id}` : ''}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <button
          type="button"
          className="cd-btn cd-btn-secondary"
          style={{ width: '100%', marginTop: 8 }}
          onClick={() => setShowModal(true)}
        >
          + New Customer
        </button>

        {customer && (
          <div className="cd-customer-card">
            <div className="cd-customer-card-name">
              {details?.customer_name || customer.customer_name}
            </div>
            <div className="cd-customer-card-sub">
              {details?.mobile_no || customer.mobile_no || '—'}
              {(details?.email_id || customer.email_id) && (
                <>
                  <br />
                  {details?.email_id || customer.email_id}
                </>
              )}
              {details?.city && (
                <>
                  <br />
                  {details.city}
                  {details.state ? `, ${details.state}` : ''}
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {showModal && (
        <NewCustomerModal
          onClose={() => setShowModal(false)}
          onSave={handleCreate}
          saving={creatingCustomer}
        />
      )}
    </aside>
  );
}
