export function isAssetClearingCategory(categoryName: string): boolean {
  const normalized = categoryName.trim().toLowerCase();
  return (
    normalized.includes("พักสินทรัพย์") ||
    normalized.includes("asset clearing")
  );
}

export function buildFixedAssetCapitalizeHref(input: {
  expenseId: string;
  grandTotal: number;
  expenseDate: string;
}): string {
  const params = new URLSearchParams({
    create: "1",
    linked_expense_id: input.expenseId,
    cost: String(input.grandTotal),
    date: input.expenseDate,
  });
  return `/fixed-assets?${params.toString()}`;
}
