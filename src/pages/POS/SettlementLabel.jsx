const TYPE_LABELS = { gold: 'Gold Purchase', kitty: 'Jewellery Scheme', return: 'Sales Return' };

// "Gold Purchase · ACC-PINV-…" for a settlement on the bill. A Gold Purchase's number opens its
// Purchase Invoice details (onOpen) when given.
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
  </>;
}
