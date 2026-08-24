import type { Metadata } from "next";
import { getAccountingPeriods } from "@/app/actions/accounting-period";
import { AccountingPeriodsPanel } from "./accounting-periods-panel";

export const dynamic = "force-dynamic";

/** Straight-line depreciation RPC can exceed default Server Action timeout. */
export const maxDuration = 60;

export const metadata: Metadata = {
  title: "Period Lock | ปิดงบรายเดือน",
  description:
    "Period Closing Dashboard — ล็อกงวดบัญชีรายเดือนและคำนวณค่าเสื่อมราคาตามมาตรฐาน GAAP/TFRS (Admin only)",
};

export default async function AccountingPeriodsPage() {
  const result = await getAccountingPeriods();

  if (!result.success) {
    return (
      <div className="p-6">
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {result.error}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <AccountingPeriodsPanel periods={result.data} />
    </div>
  );
}
