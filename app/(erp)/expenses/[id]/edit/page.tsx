import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Pencil } from "lucide-react";
import {
  getBankAccounts,
  getExpenseById,
  getExpenseCategories,
  getExpenseVendors,
} from "@/app/actions/expenses";
import { ExpenseCreateWorkspace } from "../../create/expense-create-workspace";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
};

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { id } = await params;
  const result = await getExpenseById(id);
  return {
    title: result.data
      ? `แก้ไข ${result.data.document_no} | ค่าใช้จ่าย`
      : "แก้ไขค่าใช้จ่าย",
  };
}

/**
 * Server Component — load DRAFT expense + masters, then Client edit form.
 * Zero Client-Side Fetching for all data.
 */
export default async function EditExpensePage({ params }: PageProps) {
  const { id: rawId } = await params;
  const expenseId = decodeURIComponent(rawId ?? "").trim();
  if (!expenseId) {
    notFound();
  }

  const [expenseResult, categoriesResult, vendorsResult, bankAccountsResult] =
    await Promise.all([
      getExpenseById(expenseId),
      getExpenseCategories(),
      getExpenseVendors(),
      getBankAccounts(),
    ]);

  if (expenseResult.error && !expenseResult.data) {
    return (
      <div className="flex flex-col gap-4 p-6">
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {expenseResult.error}
        </div>
        <Link
          href="/expenses"
          className="inline-flex h-10 w-fit items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700"
        >
          <ArrowLeft className="h-4 w-4" />
          กลับรายการ
        </Link>
      </div>
    );
  }

  const expense = expenseResult.data;
  if (!expense) {
    notFound();
  }

  if (expense.status.trim().toUpperCase() !== "DRAFT") {
    redirect(`/expenses/${expense.id}`);
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-2">
          <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight text-slate-900">
            <Pencil className="h-8 w-8 text-blue-600" />
            แก้ไข Draft
          </h1>
          <p className="text-slate-500">
            {expense.document_no} · อัปเดตได้เฉพาะสถานะ DRAFT · ข้อมูลโหลดฝั่งเซิร์ฟเวอร์
          </p>
        </div>

        <Link
          href={`/expenses/${expense.id}`}
          className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
        >
          <ArrowLeft className="h-4 w-4" />
          กลับรายละเอียด
        </Link>
      </div>

      <ExpenseCreateWorkspace
        mode="edit"
        expenseId={expense.id}
        documentNo={expense.document_no}
        categories={categoriesResult.data}
        categoriesError={categoriesResult.error}
        vendors={vendorsResult.data}
        vendorsError={vendorsResult.error}
        bankAccounts={bankAccountsResult.data}
        bankAccountsError={bankAccountsResult.error}
        defaultDate={expense.expense_date}
        defaultTab="manual"
        initialValues={{
          expense_date: expense.expense_date,
          vendor_id: expense.vendor_id,
          category_id: expense.category_id,
          net_amount: expense.net_amount,
          vat_amount: expense.vat_amount,
          grand_total: expense.grand_total,
          payment_method: expense.payment_method,
          bank_account_id: expense.bank_account_id,
          remark: expense.remark,
        }}
      />
    </div>
  );
}
