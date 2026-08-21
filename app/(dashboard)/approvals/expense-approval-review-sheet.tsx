"use client";

/**
 * URL-driven slide-over for Expense review in Approval Center.
 * Opens when `?view_expense=<uuid>` is present — close clears the param.
 */

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { Receipt } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

const VIEW_EXPENSE_PARAM = "view_expense";

export type ExpenseApprovalReviewSheetProps = {
  expenseId: string | null;
  children: ReactNode;
};

export function ExpenseApprovalReviewSheet({
  expenseId,
  children,
}: ExpenseApprovalReviewSheetProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const open = Boolean(expenseId);

  function closeSheet() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete(VIEW_EXPENSE_PARAM);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) closeSheet();
      }}
    >
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Receipt className="h-5 w-5 text-blue-600" />
            รีวิวค่าใช้จ่ายก่อนอนุมัติ
          </SheetTitle>
          <SheetDescription>
            Read-only — ตรวจสอบรายละเอียดและสลิปก่อนกดอนุมัติ/ปฏิเสธ
          </SheetDescription>
        </SheetHeader>
        {children}
      </SheetContent>
    </Sheet>
  );
}

/** Set `view_expense` while preserving other search params (e.g. tab). */
export function buildViewExpenseHref(
  pathname: string,
  currentSearch: string,
  expenseId: string,
): string {
  const params = new URLSearchParams(currentSearch);
  params.set("tab", "expenses");
  params.set(VIEW_EXPENSE_PARAM, expenseId);
  return `${pathname}?${params.toString()}`;
}
