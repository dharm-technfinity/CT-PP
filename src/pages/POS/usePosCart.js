import { useCallback, useMemo, useState } from 'react';
import { getGoldRate } from '../../lib/metalRates.js';
import { calcCartTotals, newCartLine } from './posCalculations.js';

export function usePosCart(goldRateProp, gstSplit = [], schemeBonusAmount = 0, schemeComponentDiscounts = []) {
  const [lines, setLines] = useState([]);
  const [draftInvoiceName, setDraftInvoiceName] = useState(null);
  const [billDiscount, setBillDiscount] = useState({ mode: 'amount', value: '' });
  const [billComponentDiscounts, setBillComponentDiscounts] = useState({});

  const goldRate =
    typeof goldRateProp === 'number' && goldRateProp > 0
      ? goldRateProp
      : getGoldRate();

  const totals = useMemo(
    () => calcCartTotals(lines, goldRate, billDiscount, gstSplit, billComponentDiscounts, schemeBonusAmount, schemeComponentDiscounts),
    [lines, goldRate, billDiscount, gstSplit, billComponentDiscounts, schemeBonusAmount, schemeComponentDiscounts],
  );

  const addLine = useCallback((partial) => {
    setLines((prev) => [...prev, newCartLine(partial)]);
  }, []);

  const addUniqueLine = useCallback((partial) => {
    setLines((prev) => {
      const tagKey = (partial.tag || partial.serial_no || partial.item_code || '').toLowerCase();
      const existing = prev.find(
        (l) =>
          (l.tag || l.serial_no || l.item_code || '').toLowerCase() === tagKey &&
          tagKey,
      );
      if (existing) return prev;
      return [...prev, newCartLine({ ...partial, qty: 1 })];
    });
  }, []);

  const updateLine = useCallback((id, patch) => {
    setLines((prev) =>
      prev.map((l) => (l.id === id ? { ...l, ...patch } : l)),
    );
  }, []);

  const removeLine = useCallback((id) => {
    setLines((prev) => prev.filter((l) => l.id !== id));
  }, []);

  const clearCart = useCallback(() => {
    setLines([]);
    setDraftInvoiceName(null);
    setBillDiscount({ mode: 'amount', value: '' });
    setBillComponentDiscounts({});
  }, []);

  const loadCart = useCallback((snapshot) => {
    setLines(snapshot.lines || []);
    setDraftInvoiceName(snapshot.draftInvoiceName || null);
    setBillDiscount(snapshot.billDiscount || { mode: 'amount', value: '' });
    setBillComponentDiscounts(snapshot.billComponentDiscounts || {});
  }, []);

  const getSnapshot = useCallback(
    () => ({ lines, draftInvoiceName, billDiscount, billComponentDiscounts }),
    [lines, draftInvoiceName, billDiscount, billComponentDiscounts],
  );

  return {
    lines,
    totals,
    goldRate,
    billDiscount,
    setBillDiscount,
    billComponentDiscounts,
    setBillComponentDiscounts,
    draftInvoiceName,
    setDraftInvoiceName,
    addLine,
    addUniqueLine,
    updateLine,
    removeLine,
    clearCart,
    loadCart,
    getSnapshot,
  };
}
