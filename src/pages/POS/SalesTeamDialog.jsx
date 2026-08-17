import { useEffect, useState } from 'react';
import SalesTeamTable from './SalesTeamTable.jsx';

export default function SalesTeamDialog({ open, salesTeam, grandTotal, onClose, onSave }) {
  const [rows, setRows] = useState([]);

  // Re-seeds from the parent's saved selection every time the dialog opens, so re-opening
  // to tweak a split doesn't lose what was picked last time.
  useEffect(() => {
    if (!open) return;
    queueMicrotask(() => {
      setRows(salesTeam?.length ? salesTeam.map((r) => ({ ...r })) : [{ salesPerson: '', percentage: 100 }]);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  function save() {
    onSave(rows.filter((r) => r.salesPerson));
    onClose();
  }

  return (
    <>
      <div className="cd-idialog-overlay" onClick={onClose} role="presentation" />
      <div className="cd-idialog xwide" role="dialog" aria-modal="true">
        <div className="cd-idialog-header">
          <span className="cd-idialog-title">Select Sales Team</span>
          <button type="button" className="cd-idialog-close" onClick={onClose}>×</button>
        </div>
        <div className="cd-idialog-body">
          <SalesTeamTable rows={rows} onChange={setRows} grandTotal={grandTotal} />
        </div>
        <div className="cd-idialog-footer">
          <button type="button" className="cd-btn cd-btn-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="cd-btn cd-btn-primary" onClick={save}>Done</button>
        </div>
      </div>
    </>
  );
}
