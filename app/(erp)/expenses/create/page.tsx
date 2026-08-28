import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Receipt } from "lucide-react";
import {
  getBankAccounts,
  getExpenseCategories,
  getExpenseVendors,
} from "@/app/actions/expenses";
import { getSystemParameter } from "@/lib/actions/parameter-actions";
import { todayIsoDate } from "@/lib/utils/outstanding-summary";
import {
  ExpenseCreateWorkspace,
  type ExpenseCreateTab,
} from "./expense-create-workspace";

export const dynamic = "force-dynamic";

/** Vercel Serverless — OCR Server Action may run up to 60s on this route. */
export const maxDuration = 60;

export const metadata: Metadata = {
  title: "เพิ่มค่าใช้จ่าย | Create Expense",
  description: "บันทึกค่าใช้จ่ายแบบ Manual หรือเตรียมสแกนบิลด้วย AI",
};

type PageProps = {
  searchParams: Promise<{
    tab?: string;
  }>;
};

function resolveTab(raw: string | undefined): ExpenseCreateTab {
  return raw === "manual" ? "manual" : "ocr";
}

export default async function CreateExpensePage({ searchParams }: PageProps) {
  const params = await searchParams;
  const defaultTab = resolveTab(params.tab);

  const [categoriesResult, vendorsResult, bankAccountsResult, defaultWhtRate] =
    await Promise.all([
      getExpenseCategories(),
      getExpenseVendors(),
      getBankAccounts(),
      getSystemParameter("WHT_RATE"),
    ]);

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-2">
          <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight text-slate-900">
            <Receipt className="h-8 w-8 text-blue-600" />
            เพิ่มค่าใช้จ่าย
          </h1>
          <p className="text-slate-500">
            Entity-Based Navigation{" "}
            <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">
              ?tab=ocr|manual
            </code>{" "}
            · Vendor / Category / Bank โหลดฝั่งเซิร์ฟเวอร์
          </p>
        </div>

        <Link
          href="/expenses"
          className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
        >
          <ArrowLeft className="h-4 w-4" />
          กลับรายการ
        </Link>
      </div>

      <ExpenseCreateWorkspace
        categories={categoriesResult.data}
        categoriesError={categoriesResult.error}
        vendors={vendorsResult.data}
        vendorsError={vendorsResult.error}
        bankAccounts={bankAccountsResult.data}
        bankAccountsError={bankAccountsResult.error}
        defaultDate={todayIsoDate()}
        defaultTab={defaultTab}
        defaultWhtRate={defaultWhtRate}
      />
    </div>
  );
}
