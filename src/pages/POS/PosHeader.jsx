import { useEffect, useState } from 'react';
import { formatDateTime } from '../../lib/format.js';
import { loadMetalRates, formatGoldRateChip, getMetalTouches } from '../../lib/metalRates.js';
import { fetchBranches } from '../../lib/api.js';
import { POS_SHIFT_KEY } from '../../lib/constants.js';

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="m4.93 4.93 1.41 1.41" />
      <path d="m17.66 17.66 1.41 1.41" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="m6.34 17.66-1.41 1.41" />
      <path d="m19.07 4.93-1.41 1.41" />
    </svg>
  );
}

export default function PosHeader({ user }) {
  const [now, setNow] = useState(new Date());
  const [rates, setRates] = useState({});
  const [touches, setTouches] = useState({});
  const [loadingRates, setLoadingRates] = useState(true);
  const [theme, setTheme] = useState(
    () => localStorage.getItem('cdTheme') || 'light',
  );

  // Branch is a Link to the Branch doctype, same short/static-list pattern as Country in
  // NewCustomerModal. Trigger button reuses .cd-pos-context-btn (the same class "Select
  // customer" uses) so it's visually identical — see the matching CSS override in
  // caratdesk.css that gives it the same clamped size despite living in the header instead
  // of .cd-pos-context. Persisted to localStorage (cd_branch), same as theme/cdTheme above;
  // posInvoice.js and index.jsx's POS Shift creation already read cd_branch from localStorage.
  // Only rehydrated from localStorage while a shift is actually active (a reload mid-shift
  // shouldn't lose it) — with no shift running it always starts blank, so branch always gets
  // picked fresh at the next Shift Start rather than silently carrying over a stale value.
  const [branches, setBranches] = useState([]);
  const [branch, setBranch] = useState(() => {
    if (!localStorage.getItem(POS_SHIFT_KEY)) {
      localStorage.removeItem('cd_branch');
      return '';
    }
    return localStorage.getItem('cd_branch') || '';
  });
  const [branchQuery, setBranchQuery] = useState('');
  const [showBranchList, setShowBranchList] = useState(false);

  useEffect(() => { fetchBranches().then(setBranches); }, []);

  // index.jsx sets/clears cd_branch on Shift Start/End (localStorage alone won't re-render
  // this component's own local state, so it dispatches this event with the new value).
  useEffect(() => {
    function handleChanged(e) { setBranch(e.detail || ''); }
    window.addEventListener('cd-branch-changed', handleChanged);
    return () => window.removeEventListener('cd-branch-changed', handleChanged);
  }, []);

  const branchResults = (branchQuery.trim()
    ? branches.filter((b) => b.toLowerCase().includes(branchQuery.trim().toLowerCase()))
    : branches
  ).slice(0, 20);

  function selectBranch(name) {
    setBranch(name);
    localStorage.setItem('cd_branch', name);
    setBranchQuery('');
    setShowBranchList(false);
  }

  useEffect(() => {
    const isDark = theme === 'dark';
    document.documentElement.classList.toggle('dark', isDark);
    localStorage.setItem('cdTheme', isDark ? 'dark' : 'light');
  }, [theme]);

  useEffect(() => {
    loadMetalRates()
      .then((r) => { setRates(r); setTouches(getMetalTouches()); })
      .finally(() => setLoadingRates(false));
  }, []);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const chip = formatGoldRateChip(rates, touches);
  const isDark = theme === 'dark';

  return (
    <header className="cd-pos-header">
      <div className="cd-pos-header-left">
        <a href="/caratdesk-selling" className="cd-link-back">
          ← Back
        </a>
        <span className="cd-pos-logo">CaratDesk POS</span>
        <div className="cd-ac cd-pos-branch">
          <button
            type="button"
            className="cd-pos-context-btn"
            onClick={() => setShowBranchList((v) => !v)}
          >
            {branch || 'Select branch'}
          </button>
          {showBranchList && (
            <div className="cd-ac-list cd-pos-branch-list">
              <input
                className="cd-input"
                autoFocus
                placeholder="Search branch…"
                autoComplete="off"
                value={branchQuery}
                onChange={(e) => setBranchQuery(e.target.value)}
                onBlur={() => setTimeout(() => setShowBranchList(false), 150)}
              />
              {branchResults.length === 0 && <div className="cd-ac-empty">No branch found</div>}
              {branchResults.map((b) => (
                <div key={b} className="cd-ac-item" onMouseDown={() => selectBranch(b)} role="button" tabIndex={0}>
                  <div className="main">{b}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="cd-pos-header-right">
        <span className="cd-chip">
          {loadingRates ? (
            'Loading rates…'
          ) : (
            <>
              Gold: <strong>{chip.gold}</strong>
              &nbsp;·&nbsp; Silver: <strong>{chip.silver}</strong>
            </>
          )}
        </span>
        <span>{formatDateTime(now)}</span>
        <span style={{ fontWeight: 500, color: 'var(--text-primary)' }}>
          {user?.fullName || 'User'}
        </span>
        <button
          type="button"
          className="cd-icon-btn"
          title="Toggle theme"
          aria-label="Toggle theme"
          onClick={() => setTheme(isDark ? 'light' : 'dark')}
        >
          {isDark ? <SunIcon /> : <MoonIcon />}
        </button>
      </div>
    </header>
  );
}
