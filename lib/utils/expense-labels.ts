type ExpenseCategorySource = {
  category_id?: string | null;
  category_name?: string | null;
  category?: string | null;
  expense_category?: string | null;
};

type ExpenseRemarkSource = {
  remark?: string | null;
  description?: string | null;
};

function text(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

/** Category column: master name when category_id is linked, otherwise the text columns saved by the expense RPC. */
export function expenseCategoryLabel(row: ExpenseCategorySource): string {
  const joined = text(row.category_name);
  if (row.category_id && joined && joined !== "—") return joined;
  return text(row.category) || text(row.expense_category) || "ค่าใช้จ่ายทั่วไป";
}

/** Remark column: free-text remark, then the description stored with the bill. */
export function expenseRemarkLabel(row: ExpenseRemarkSource): string {
  return text(row.remark) || text(row.description) || "—";
}
