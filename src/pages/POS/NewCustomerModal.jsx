import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { fetchCountries } from '../../lib/api.js';

const SALUTATIONS = ['Mr', 'Mrs', 'Ms', 'Miss', 'Dr', 'Prof', 'Madam', 'Master'];

export default function NewCustomerModal({ onClose, onSave, saving = false }) {
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState('');
  const fileInputRef = useRef(null);

  // Country is a Link to the Country doctype — Passport Number only applies (and is
  // mandatory) once the picked country isn't India.
  const [countries, setCountries] = useState([]);
  const [country, setCountry] = useState('India');
  const [countryQuery, setCountryQuery] = useState('');
  const [showCountryList, setShowCountryList] = useState(false);
  useEffect(() => { fetchCountries().then(setCountries); }, []);
  const isIndia = country.trim().toLowerCase() === 'india';
  const countryResults = (countryQuery.trim()
    ? countries.filter((c) => c.toLowerCase().includes(countryQuery.trim().toLowerCase()))
    : countries
  ).slice(0, 20);
  function selectCountry(name) {
    setCountry(name);
    setCountryQuery('');
    setShowCountryList(false);
  }

  function handleImageChange(e) {
    const file = e.target.files?.[0] || null;
    setImageFile(file);
    setImagePreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return file ? URL.createObjectURL(file) : '';
    });
  }

  function handleSubmit(e) {
    e.preventDefault();
    const fd = new FormData(e.target);
    const firstName = (fd.get('first_name') || '').trim();
    const lastName = (fd.get('last_name') || '').trim();
    onSave({
      salutation: fd.get('salutation'),
      customer_name: [firstName, lastName].filter(Boolean).join(' '),
      first_name: firstName,
      last_name: lastName,
      mobile_no: fd.get('mobile_no'),
      email_id: fd.get('email_id'),
      date_of_birth: fd.get('date_of_birth'),
      anniversary: fd.get('anniversary'),
      pan: fd.get('pan'),
      aadhaar_no: fd.get('aadhaar_no'),
      passport_number: fd.get('passport_number'),
      gstin: fd.get('gstin'),
      is_primary_address: fd.get('is_primary_address') === 'on',
      is_shipping_address: fd.get('is_shipping_address') === 'on',
      pincode: fd.get('pincode'),
      city: fd.get('city'),
      address_line1: fd.get('address_line1'),
      state: fd.get('state'),
      address_line2: fd.get('address_line2'),
      country,
      imageFile,
    });
  }

  return createPortal(
    <>
      <div className="cd-idialog-overlay" onClick={onClose} role="presentation" />
      <div className="cd-idialog xwide" role="dialog" aria-modal="true">
        <div className="cd-idialog-header">
          <span className="cd-idialog-title">New Customer</span>
          <button type="button" className="cd-idialog-close" onClick={onClose}>
            ×
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="cd-idialog-body">
            <div className="cd-dsec" style={{ marginTop: 0 }}>Primary Contact Details</div>
            <div className="cd-field">
              <label className="cd-label">Customer Image</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  title="Click to upload photo"
                  style={{ width: 48, height: 48, borderRadius: '50%', flexShrink: 0, padding: 0, border: '0.5px solid var(--border-strong)', cursor: 'pointer', overflow: 'hidden', background: 'var(--accent-light)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  {imagePreview
                    ? <img src={imagePreview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="var(--text-muted)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" /><circle cx="12" cy="13" r="4" /></svg>}
                </button>
                <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={handleImageChange} />
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Click the circle to upload a photo</span>
              </div>
            </div>
            <div className="cd-name-row">
              <div className="cd-field">
                <label className="cd-label">Salutation</label>
                <select className="cd-select" name="salutation" defaultValue="">
                  <option value=""></option>
                  {SALUTATIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div className="cd-field">
                <label className="cd-label">First Name <span className="req">*</span></label>
                <input className="cd-input" name="first_name" required placeholder="First name" />
              </div>
              <div className="cd-field">
                <label className="cd-label">Last Name</label>
                <input className="cd-input" name="last_name" placeholder="Last name" />
              </div>
            </div>
            <div className="cd-grid-3">
              <div className="cd-field">
                <label className="cd-label">Email ID</label>
                <input className="cd-input" name="email_id" type="email" placeholder="name@example.com" />
              </div>
              <div className="cd-field">
                <label className="cd-label">Mobile Number <span className="req">*</span></label>
                <input
                  className="cd-input"
                  name="mobile_no"
                  required
                  pattern="[0-9]{10}"
                  maxLength={10}
                  placeholder="10-digit mobile"
                />
              </div>
              <div className="cd-field"><label className="cd-label">GST Number</label><input className="cd-input" name="gstin" /></div>
            </div>
            <div className="cd-grid-2" style={{ marginBottom: 16 }}>
              <div className="cd-field"><label className="cd-label">PAN No</label><input className="cd-input" name="pan" placeholder="ABCDE1234F" /></div>
              <div className="cd-field"><label className="cd-label">Aadhaar No</label><input className="cd-input" name="aadhaar_no" placeholder="12-digit Aadhaar" /></div>
            </div>
            <div className="cd-grid-2">
              <div className="cd-field"><label className="cd-label">Date of Birth</label><input className="cd-input" name="date_of_birth" type="date" /></div>
              <div className="cd-field"><label className="cd-label">Date of Anniversary</label><input className="cd-input" name="anniversary" type="date" /></div>
            </div>

            <div className="cd-dsec">Primary Address Details</div>
            <div className="cd-grid-2" style={{ marginBottom: 16 }}>
              <label className="cd-check-lbl"><input type="checkbox" name="is_primary_address" defaultChecked />Preferred Billing Address</label>
              <label className="cd-check-lbl"><input type="checkbox" name="is_shipping_address" />Preferred Shipping Address</label>
            </div>
            <div className="cd-grid-2">
              <div className="cd-field"><label className="cd-label">Address Line 1</label><input className="cd-input" name="address_line1" /></div>
              <div className="cd-field"><label className="cd-label">Address Line 2</label><input className="cd-input" name="address_line2" /></div>
            </div>
            <div className="cd-grid-4">
              <div className="cd-field"><label className="cd-label">Postal Code</label><input className="cd-input" name="pincode" /></div>
              <div className="cd-field"><label className="cd-label">City/Town</label><input className="cd-input" name="city" /></div>
              <div className="cd-field"><label className="cd-label">State/Province</label><input className="cd-input" name="state" /></div>
              <div className="cd-field">
                <label className="cd-label">Country</label>
                <div className="cd-ac">
                  <input
                    className="cd-input"
                    autoComplete="off"
                    value={showCountryList ? countryQuery : country}
                    onChange={(e) => { setCountryQuery(e.target.value); setShowCountryList(true); }}
                    onFocus={() => { setCountryQuery(''); setShowCountryList(true); }}
                    onBlur={() => setTimeout(() => setShowCountryList(false), 150)}
                  />
                  {showCountryList && (
                    <div className="cd-ac-list">
                      {countryResults.length === 0 && <div className="cd-ac-empty">No country found</div>}
                      {countryResults.map((c) => (
                        <div key={c} className="cd-ac-item" onMouseDown={() => selectCountry(c)} role="button" tabIndex={0}>
                          <div className="main">{c}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
            {!isIndia && (
              <div className="cd-grid-2">
                <div className="cd-field">
                  <label className="cd-label">Passport Number <span className="req">*</span></label>
                  <input className="cd-input" name="passport_number" required placeholder="Passport number" />
                </div>
              </div>
            )}
          </div>
          <div className="cd-idialog-footer">
            <button
              type="button"
              className="cd-btn cd-btn-secondary"
              onClick={onClose}
              disabled={saving}
            >
              Cancel
            </button>
            <button type="submit" className="cd-btn cd-btn-primary" disabled={saving}>
              {saving ? 'Saving...' : 'Save Customer'}
            </button>
          </div>
        </form>
      </div>
    </>,
    document.body,
  );
}
