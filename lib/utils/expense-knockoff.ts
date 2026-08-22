/**
 * Marker stored on document_allocations.adjustment_reason
 * so PAY detail can map knock-off rows back to expenses
 * even before expense_id column exists on Cloud.
 */

export const EXPENSE_KNOCKOFF_PREFIX = "EXPENSE_KNOCKOFF:";

export type ExpenseKnockoffMeta = {
  expense_id: string;
  document_no: string;
  vendor_doc_no: string | null;
};

export function encodeExpenseKnockoffReason(
  meta: ExpenseKnockoffMeta,
): string {
  return `${EXPENSE_KNOCKOFF_PREFIX}${JSON.stringify(meta)}`;
}

export function parseExpenseKnockoffReason(
  reason: string | null | undefined,
): ExpenseKnockoffMeta | null {
  const raw = String(reason ?? "").trim();
  if (!raw.startsWith(EXPENSE_KNOCKOFF_PREFIX)) return null;
  const json = raw.slice(EXPENSE_KNOCKOFF_PREFIX.length).trim();
  try {
    const parsed = JSON.parse(json) as Partial<ExpenseKnockoffMeta>;
    const expenseId = String(parsed.expense_id ?? "").trim();
    const documentNo = String(parsed.document_no ?? "").trim();
    if (!expenseId || !documentNo) return null;
    const vendorDocNo = String(parsed.vendor_doc_no ?? "").trim();
    return {
      expense_id: expenseId,
      document_no: documentNo,
      vendor_doc_no: vendorDocNo || null,
    };
  } catch {
    return null;
  }
}
