/**
 * Auto-apply deposit amounts against selected invoice total (FIFO by deposit list order).
 * Each checked deposit gets: Math.min(remaining_balance, leftover_invoice_total).
 */

import { roundMoney } from "@/lib/utils/payment-fifo";

export type DepositBalanceInput = {
  id: string;
  remaining_balance: number;
};

/**
 * Redistribute `invoiceTotal` across checked deposits (list order = FIFO).
 * Unchecked deposits are omitted from the result (empty string / not present).
 */
export function redistributeCheckedDeposits(
  invoiceTotal: number,
  deposits: DepositBalanceInput[],
  checkedIds: Iterable<string>,
): Record<string, string> {
  const checked = new Set(
    [...checkedIds].map((id) => id.trim()).filter(Boolean),
  );
  let leftover = roundMoney(Math.max(0, invoiceTotal));
  const next: Record<string, string> = {};

  for (const dep of deposits) {
    if (!checked.has(dep.id)) continue;
    const cap = roundMoney(Math.max(0, dep.remaining_balance));
    const apply = roundMoney(Math.min(cap, leftover));
    next[dep.id] = apply > 0 ? String(apply) : "0";
    leftover = roundMoney(Math.max(0, leftover - apply));
  }

  return next;
}

/** Currently-checked deposit ids (amount > 0 OR explicitly tracked as checked). */
export function checkedDepositIdsFromAmounts(
  amounts: Record<string, string>,
): string[] {
  return Object.entries(amounts)
    .filter(([, raw]) => {
      // Keep deposits that user checked even if amount was edited to 0 briefly
      return raw !== "" && raw != null;
    })
    .map(([id]) => id);
}
