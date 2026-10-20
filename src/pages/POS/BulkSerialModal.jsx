import { useEffect, useMemo, useRef, useState } from 'react';
import { parseApiError } from '../../lib/format.js';
import { createLimiter } from '../../lib/limit.js';
import { lookupLinesByTag } from '../../lib/api.js';

// Lookups running at once while checking a pasted/uploaded list.
const CHECK_CONCURRENCY = 5;

const STATUS = {
  ready: { label: 'Ready', tone: 'green' },
  setPiece: { label: 'Breaks set', tone: 'amber' },
  withSet: { label: 'With its set', tone: 'blue' },
  inBill: { label: 'Already in bill', tone: 'amber' },
  skipped: { label: 'Skipped', tone: 'amber' },
  error: { label: 'Not added', tone: 'red' },
  pending: { label: 'Checking…', tone: '' },
};

// Serials separated by new lines, commas, semicolons, tabs or spaces.
function splitSerials(text) {
  return String(text || '').split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
}

// A cell as the user sees it in Excel — but a long number shown as "1.23E+12" comes back in full.
function cellText(cell) {
  if (!cell || cell.v == null) return '';
  if (cell.t === 'n' && (!cell.w || /e\+/i.test(cell.w))) return String(cell.v);
  return String(cell.w ?? cell.v).trim();
}

// First sheet → serials. Uses the column headed "Serial No" / "Tag" when there is one (header in
// the first few rows), otherwise the first column.
async function readSerialsFromFile(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.txt')) return splitSerials(await file.text());
  const XLSX = await import('xlsx');
  // CSV is read as plain text so serials like 000123 keep their leading zeros.
  const workbook = name.endsWith('.csv')
    ? XLSX.read(await file.text(), { type: 'string', raw: true })
    : XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet?.['!ref']) return [];
  const range = XLSX.utils.decode_range(sheet['!ref']);
  const at = (r, c) => cellText(sheet[XLSX.utils.encode_cell({ r, c })]);

  let column = range.s.c;
  let startRow = range.s.r;
  findHeader:
  for (let r = range.s.r; r <= Math.min(range.e.r, range.s.r + 4); r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      if (/serial|tag/i.test(at(r, c))) {
        column = c;
        startRow = r + 1;
        break findHeader;
      }
    }
  }
  const serials = [];
  for (let r = startRow; r <= range.e.r; r++) {
    const value = at(r, column);
    if (value) serials.push(value);
  }
  return serials;
}

function Pill({ status }) {
  const { label, tone } = STATUS[status] || STATUS.pending;
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 8px',
      borderRadius: 6,
      fontSize: 11,
      whiteSpace: 'nowrap',
      background: tone ? `var(--pill-${tone}-bg)` : 'var(--nav-hover)',
      color: tone ? `var(--pill-${tone}-txt)` : 'var(--text-secondary)',
    }}
    >
      {label}
    </span>
  );
}

/**
 * POS Bulk Add: paste or upload (Excel / CSV / TXT) a list of serial numbers, check each one the
 * same way a scan does, then add the good ones to the bill in one go. Serial numbers only — a
 * Batch ID needs a Qty, so it is skipped here and scanned on its own.
 * existingKeys: lowercased tags/serials already in the bill. onAdd(items) gets the cart lines.
 */
export default function BulkSerialModal({ existingKeys, onClose, onAdd }) {
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState('');
  const [reading, setReading] = useState(false);
  const [rows, setRows] = useState(null);
  const [checking, setChecking] = useState(false);
  const [selected, setSelected] = useState({});
  const [error, setError] = useState('');
  // Bumped on Back / close so a check still running stops writing into the table.
  const runRef = useRef(0);
  const textRef = useRef(null);

  useEffect(() => {
    textRef.current?.focus();
    const runs = runRef;
    return () => { runs.current++; };
  }, []);

  const parsed = useMemo(() => {
    const seen = new Set();
    const unique = [];
    splitSerials(text).forEach((s) => {
      const key = s.toLowerCase();
      if (!seen.has(key)) { seen.add(key); unique.push(s); }
    });
    return { unique, total: splitSerials(text).length };
  }, [text]);

  async function handleFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError('');
    setReading(true);
    try {
      const serials = await readSerialsFromFile(file);
      if (!serials.length) {
        setError(`No serial numbers found in ${file.name}`);
        return;
      }
      setFileName(file.name);
      setText(serials.join('\n'));
    } catch (err) {
      setError(`Could not read ${file.name}: ${err.message}`);
    } finally {
      setReading(false);
    }
  }

  async function check() {
    const serials = parsed.unique;
    if (!serials.length) return;
    const listed = new Set(serials.map((s) => s.toLowerCase()));
    const initial = serials.map((serial) => (
      existingKeys.has(serial.toLowerCase())
        ? { serial, status: 'inBill', message: 'Already scanned into this bill' }
        : { serial, status: 'pending', message: '' }
    ));
    setRows(initial);
    setSelected({});
    setChecking(true);
    const run = ++runRef.current;
    const stale = () => runRef.current !== run;

    const limit = createLimiter(CHECK_CONCURRENCY);
    const update = (serial, patch) => {
      if (stale()) return;
      setRows((prev) => prev.map((r) => (r.serial === serial ? { ...r, ...patch } : r)));
      if (patch.status === 'ready') setSelected((prev) => ({ ...prev, [serial]: true }));
    };

    await Promise.all(initial.filter((r) => r.status === 'pending').map((row) => limit(async () => {
      if (stale()) return;
      try {
        const items = await lookupLinesByTag(row.serial);
        const [first] = items;
        if (!first) return update(row.serial, { status: 'error', message: 'No serial number found' });
        if (first.is_batch) return update(row.serial, { status: 'skipped', message: 'Batch ID — scan it on its own to enter Qty' });
        if (!first.serial_no) return update(row.serial, { status: 'error', message: 'Not a serial number (item code / barcode)' });
        const warning = items.find((i) => i.pricing_warning)?.pricing_warning || '';
        if (first.is_set_tag) {
          return update(row.serial, { status: 'ready', items, message: `Set with ${items.length - 1} piece(s)${warning ? ` · ${warning}` : ''}` });
        }
        if (first.set_serial) {
          const setKey = first.set_serial.toLowerCase();
          if (listed.has(setKey) || existingKeys.has(setKey)) {
            return update(row.serial, { status: 'withSet', message: `Comes in with set ${first.set_serial}` });
          }
          return update(row.serial, { status: 'setPiece', items, message: `Part of set ${first.set_serial} — selling it alone breaks the set` });
        }
        return update(row.serial, { status: 'ready', items, message: [first.item_name || first.item_code, warning].filter(Boolean).join(' · ') });
      } catch (err) {
        return update(row.serial, { status: 'error', message: parseApiError(err) });
      }
    })));
    if (!stale()) setChecking(false);
  }

  const counts = useMemo(() => {
    const c = {};
    (rows || []).forEach((r) => { c[r.status] = (c[r.status] || 0) + 1; });
    return c;
  }, [rows]);
  const done = rows ? rows.length - (counts.pending || 0) : 0;
  const addable = (rows || []).filter((r) => r.items && selected[r.serial]);
  const problems = (rows || []).filter((r) => ['error', 'skipped', 'inBill'].includes(r.status));

  function problemsAsText() {
    return problems.map((r) => `${r.serial}\t${STATUS[r.status].label}\t${r.message}`).join('\n');
  }

  async function copyProblems() {
    try {
      await navigator.clipboard.writeText(problemsAsText());
      setError('');
    } catch {
      setError('Could not copy — use Download instead');
    }
  }

  function downloadProblems() {
    const quote = (v) => `"${String(v).replace(/"/g, '""')}"`;
    const csv = ['Serial No,Status,Reason', ...problems.map((r) => [r.serial, STATUS[r.status].label, r.message].map(quote).join(','))].join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'pos-bulk-add-not-added.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleAdd() {
    onAdd(addable.flatMap((r) => r.items));
  }

  function backToList() {
    runRef.current++;
    setRows(null);
    setChecking(false);
  }

  return <>
    <div className="cd-idialog-overlay" onClick={onClose} role="presentation" />
    <div className="cd-idialog operations-dialog" role="dialog" aria-modal="true">
      <div className="cd-idialog-header">
        <span className="cd-idialog-title">Bulk Add Serial Numbers</span>
        <button type="button" className="cd-idialog-close" onClick={onClose}>×</button>
      </div>
      <div className="cd-idialog-body">
        {!rows ? <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
            <label className="cd-btn cd-btn-secondary" style={{ cursor: reading ? 'wait' : 'pointer' }}>
              {reading ? 'Reading…' : 'Upload Excel / CSV'}
              <input type="file" accept=".xlsx,.xls,.csv,.txt" hidden disabled={reading} onChange={handleFile} />
            </label>
            <span className="cd-hint" style={{ margin: 0 }}>
              {fileName ? `Loaded ${fileName}` : 'Uses the "Serial No" column, or the first column if there is no header'}
            </span>
          </div>
          <div className="cd-field">
            <label className="cd-label">Serial numbers — or paste them here</label>
            <textarea
              ref={textRef}
              className="cd-input"
              rows={10}
              style={{ fontFamily: 'monospace', resize: 'vertical' }}
              placeholder={'One per line, or separated by commas / spaces\nSN0001\nSN0002'}
              value={text}
              onChange={(e) => { setText(e.target.value); setFileName(''); }}
            />
          </div>
          <span className="cd-hint" style={{ margin: 0 }}>
            {parsed.unique.length} serial number{parsed.unique.length === 1 ? '' : 's'}
            {parsed.total > parsed.unique.length ? ` · ${parsed.total - parsed.unique.length} duplicate(s) removed` : ''}
          </span>
        </> : <>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
            <strong>{checking ? `Checking ${done} / ${rows.length}…` : `Checked ${rows.length}`}</strong>
            {Object.keys(STATUS).filter((s) => counts[s]).map((s) => (
              <span key={s} style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}><Pill status={s} /> {counts[s]}</span>
            ))}
          </div>
          <div style={{ maxHeight: 360, overflowY: 'auto', borderRadius: 10 }}>
            <table className="cd-gold-table">
              <thead><tr><th style={{ width: 36 }} /><th style={{ textAlign: 'left' }}>Serial No</th><th style={{ textAlign: 'left' }}>Status</th><th style={{ textAlign: 'left' }}>Details</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.serial}>
                    <td>
                      {r.items && (
                        <input
                          type="checkbox"
                          checked={Boolean(selected[r.serial])}
                          onChange={(e) => setSelected((prev) => ({ ...prev, [r.serial]: e.target.checked }))}
                        />
                      )}
                    </td>
                    <td style={{ textAlign: 'left' }}><strong>{r.serial}</strong></td>
                    <td style={{ textAlign: 'left' }}><Pill status={r.status} /></td>
                    <td style={{ textAlign: 'left' }}>{r.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!checking && problems.length > 0 && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
              <span className="cd-hint" style={{ margin: 0 }}>{problems.length} serial(s) won&apos;t be added</span>
              <button type="button" className="cd-btn cd-btn-secondary" style={{ padding: '4px 12px', fontSize: 12 }} onClick={copyProblems}>Copy list</button>
              <button type="button" className="cd-btn cd-btn-secondary" style={{ padding: '4px 12px', fontSize: 12 }} onClick={downloadProblems}>Download CSV</button>
            </div>
          )}
        </>}
        {error && <div className="cd-hint" style={{ color: 'var(--pill-red-txt)', marginTop: 8 }}>{error}</div>}
      </div>
      <div className="cd-idialog-footer">
        {rows ? <>
          <button type="button" className="cd-btn cd-btn-secondary" onClick={backToList}>Back</button>
          <button type="button" className="cd-btn cd-btn-primary" disabled={checking || !addable.length} onClick={handleAdd}>
            Add {addable.length} serial{addable.length === 1 ? '' : 's'}
          </button>
        </> : <>
          <button type="button" className="cd-btn cd-btn-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="cd-btn cd-btn-primary" disabled={!parsed.unique.length || reading} onClick={check}>
            Check {parsed.unique.length || ''} serial{parsed.unique.length === 1 ? '' : 's'}
          </button>
        </>}
      </div>
    </div>
  </>;
}
