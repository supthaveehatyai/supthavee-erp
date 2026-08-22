"use client";

/**
 * Direct Capitalization — navigate to Fixed Asset register with URL pre-fill.
 */

import Link from "next/link";

export type ExpenseCapitalizeButtonProps = {
  expenseId: string;
  grandTotal: number;
  expenseDate: string;
};

function buildCapitalizeHref(
  expenseId: string,
  grandTotal: number,
  expenseDate: string,
): string {
  const params = new URLSearchParams({
    create: "1",
    linked_expense_id: expenseId,
    cost: String(grandTotal),
    date: expenseDate,
  });
  return `/fixed-assets?${params.toString()}`;
}

export function ExpenseCapitalizeButton({
  expenseId,
  grandTotal,
  expenseDate,
}: ExpenseCapitalizeButtonProps) {
  return (
    <Link
      href={buildCapitalizeHref(expenseId, grandTotal, expenseDate)}
      className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-violet-200 bg-violet-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-violet-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-2"
    >
      ⚡ ขึ้นทะเบียนเป็นสินทรัพย์ถาวร (Capitalize)
    </Link>
  );
}

export function isAssetClearingCategory(categoryName: string): boolean {
  const normalized = categoryName.trim().toLowerCase();
  return (
    normalized.includes("พักสินทรัพย์") ||
    normalized.includes("asset clearing")
  );
}
