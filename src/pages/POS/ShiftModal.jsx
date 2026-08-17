import { useEffect, useMemo, useState } from 'react';
import { fmtINR } from '../../lib/format.js';
import { fetchBranches } from '../../lib/api.js';
import SalesTeamTable from './SalesTeamTable.jsx';

const DENOMINATIONS = [500, 200, 100, 50, 20, 10, 5, 2, 1];

// Parent gives this a key tied to `mode` so it fully remounts (fresh counts/nextCashier) each
// time it's opened, instead of reusing one long-lived instance whose denomination counts from
// a previous Shift Start/End would otherwise leak into the next one.
export default function ShiftModal({ open, mode, shift, user, onClose, onSave }) {
  const [counts, setCounts] = useState({});
  const [nextCashier, setNextCashier] = useState('');
  const [branches, setBranches] = useState([]);
  const [branch, setBranch] = useState(() => localStorage.getItem('cd_branch') || '');
  // Shift-level default Sales Team — seeds every new bill during this shift (see index.jsx),
  // separate from that bill's own context-bar picker which can still override it per bill.
  const [salesTeamRows, setSalesTeamRows] = useState([{ salesPerson: '', percentage: 100 }]);
  const counted = useMemo(() => DENOMINATIONS.reduce((sum, d) => sum + d * (Number(counts[d]) || 0), 0), [counts]);

  useEffect(() => { fetchBranches().then(setBranches); }, []);

  if (!open) return null;
  const closing = mode === 'end';
  const starting = mode === 'start';
  const title = mode === 'start' ? 'Shift Start' : mode === 'change' ? 'Shift Change' : mode === 'user' ? 'User Change' : 'Shift End & Cash Drawer Close';
  function submit(e) {
    e.preventDefault();
    // Cashier always comes from the logged-in User, never typed — openingCash/countedCash are
    // both the same denomination-counted total, just used for whichever side of the shift this is.
    // Branch and Sales Team aren't required to start a shift — Branch is only enforced later,
    // before billing; Sales Team here is just this shift's default, not mandatory either.
    const salesTeam = salesTeamRows.filter((r) => r.salesPerson);
    onSave({ cashier: user?.fullName || '', nextCashier, branch, salesTeam, openingCash: counted, countedCash: counted, denominations: counts });
  }
  return <>
    <div className="cd-idialog-overlay" onClick={onClose} role="presentation" />
    <div className="cd-idialog wide shift-dialog" role="dialog" aria-modal="true">
      <div className="cd-idialog-header"><span className="cd-idialog-title">{title}</span><button className="cd-idialog-close" onClick={onClose}>×</button></div>
      <form onSubmit={submit}>
        <div className="cd-idialog-body">
          <div className="cd-shift-facts"><span>Counter <strong>{shift?.counter || 'First available (automatic)'}</strong></span><span>Current cashier <strong>{shift?.cashier || user?.fullName || '—'}</strong></span></div>
          {starting && <div className="cd-field"><label className="cd-label">Branch</label><select className="cd-select" value={branch} onChange={e => setBranch(e.target.value)}><option value="">Select branch…</option>{branches.map(b => <option key={b} value={b}>{b}</option>)}</select></div>}
          {starting && <div className="cd-field"><label className="cd-label">Sales Team (default for this shift)</label><SalesTeamTable rows={salesTeamRows} onChange={setSalesTeamRows} showAmount={false} /></div>}
          {(mode === 'change' || mode === 'user') && <div className="cd-field"><label className="cd-label">New Cashier / User</label><input className="cd-input" required value={nextCashier} onChange={e => setNextCashier(e.target.value)} placeholder="Search or enter user" /></div>}
          {(starting || closing) && <><h4>Cash denomination details</h4><div className="cd-denomination-grid compact">{DENOMINATIONS.map(d => <label key={d}><span>₹{d}</span><input className="cd-input" type="number" min="0" value={counts[d] || ''} onChange={e => setCounts(c => ({...c, [d]: e.target.value}))} /><strong>{fmtINR(d * (Number(counts[d]) || 0))}</strong></label>)}</div>
          {starting && <div className="cd-close-total"><span>Opening Cash Balance</span><strong>{fmtINR(counted)}</strong></div>}
          {closing && <div className="cd-close-total"><span>Opening Cash {fmtINR(shift?.openingCash || 0)}</span><strong>Counted Cash {fmtINR(counted)}</strong></div>}
          </>}
        </div>
        <div className="cd-idialog-footer"><button type="button" className="cd-btn cd-btn-secondary" onClick={onClose}>Cancel</button><button className="cd-btn cd-btn-primary">{closing ? 'Close Drawer & End Shift' : 'Confirm'}</button></div>
      </form>
    </div>
  </>;
}
