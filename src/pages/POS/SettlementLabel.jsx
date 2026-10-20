import { fmtDate } from '../../lib/format.js';

const TYPE_LABELS = { gold: 'Gold Purchase', kitty: 'Jewellery Scheme', return: 'Sales Return' };

// "Gold Purchase · ACC-PINV-… · 10-10-2026" for a settlement on the bill (Gold Purchase / Sales
// Return carry their transaction date; "Jewellery Scheme · JSA-… · <scheme name>" for a scheme). A Gold Purchase's number opens its Purchase Invoice details (onOpen) when given.
export default function SettlementLabel({ settlement, onOpen }) {
  const typeLabel = TYPE_LABELS[settlement.type];
  const canOpen = settlement.type === 'gold' && onOpen;
  return <>
    {typeLabel && <span className="cd-settled-scheme-type">{typeLabel} ·</span>}
    {canOpen ? (
      <button type="button" className="cd-settled-scheme-open" title="View Purchase Invoice" onClick={() => onOpen(settlement)}>
        {settlement.number}
      </button>
    ) : (
      <span>{settlement.number}</span>
    )}
    {(settlement.type === 'gold' || settlement.type === 'return') && settlement.posting_date && (
      <span className="cd-settled-scheme-name">· {fmtDate(settlement.posting_date)}</span>
    )}
    {settlement.type === 'kitty' && (settlement.scheme_name || settlement.scheme) && (
      <span className="cd-settled-scheme-name">· {settlement.scheme_name || settlement.scheme}</span>
    )}
  </>;
}
