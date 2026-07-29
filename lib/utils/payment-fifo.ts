/**
 * FIFO knock-off allocation — shared by client Auto-Allocate and server validation.
 */

export type FifoInvoiceInput = {
  id: string;
  remaining_balance: number;
};

export type FifoAllocationLine = {
  invoice_id: string;
  allocated_amount: number;
  wht_amount: number;
};

export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Distribute cash + WHT against invoices oldest-first (FIFO).
 * Cash is applied first on each invoice; remaining need comes from WHT pool.
 */
export function allocateFifo(
  invoices: FifoInvoiceInput[],
  cashAmount: number,
  whtAmount: number,
): FifoAllocationLine[] {
  let cash = roundMoney(Math.max(0, cashAmount));
  let wht = roundMoney(Math.max(0, whtAmount));
  const result: FifoAllocationLine[] = [];

  for (const inv of invoices) {
    const need = roundMoney(Math.max(0, inv.remaining_balance));
    if (need <= 0 || (cash <= 0 && wht <= 0)) {
      result.push({
        invoice_id: inv.id,
        allocated_amount: 0,
        wht_amount: 0,
      });
      continue;
    }

    const apply = roundMoney(Math.min(need, cash + wht));
    const cashPart = roundMoney(Math.min(apply, cash));
    const whtPart = roundMoney(Math.min(apply - cashPart, wht));

    cash = roundMoney(cash - cashPart);
    wht = roundMoney(wht - whtPart);

    result.push({
      invoice_id: inv.id,
      allocated_amount: cashPart,
      wht_amount: whtPart,
    });
  }

  return result;
}
