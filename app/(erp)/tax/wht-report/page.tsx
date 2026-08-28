import type { Metadata } from "next";
import { Suspense } from "react";
import { Landmark } from "lucide-react";
import { getMonthlyWHTReport } from "@/app/actions/tax-actions";
import { WhtPeriodPicker } from "./wht-period-picker";
import { WhtReportDashboard } from "./wht-report-dashboard";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "รายงานหัก ณ ที่จ่าย | WHT Report",
  description: "สรุปรายงานภาษีหัก ณ ที่จ่ายรายเดือน — ภ.ง.ด.3 / ภ.ง.ด.53",
};

type PageProps = {
  searchParams: Promise<{
    year?: string;
    month?: string;
  }>;
};

const THAI_MONTH_LABELS: Record<number, string> = {
  1: "มกราคม",
  2: "กุมภาพันธ์",
  3: "มีนาคม",
  4: "เมษายน",
  5: "พฤษภาคม",
  6: "มิถุนายน",
  7: "กรกฎาคม",
  8: "สิงหาคม",
  9: "กันยายน",
  10: "ตุลาคม",
  11: "พฤศจิกายน",
  12: "ธันวาคม",
};

function formatThaiBaht(value: number): string {
  return new Intl.NumberFormat("th-TH", {
    style: "currency",
    currency: "THB",
  }).format(Number.isFinite(value) ? value : 0);
}

function parsePeriod(rawYear?: string, rawMonth?: string): {
  year: number;
  month: number;
} {
  const now = new Date();
  const fallbackYear = now.getFullYear();
  const fallbackMonth = now.getMonth() + 1;

  const yearNum = Number(rawYear);
  const monthNum = Number(rawMonth);

  const year =
    Number.isInteger(yearNum) && yearNum >= 2000 && yearNum <= 2100
      ? yearNum
      : fallbackYear;
  const month =
    Number.isInteger(monthNum) && monthNum >= 1 && monthNum <= 12
      ? monthNum
      : fallbackMonth;

  return { year, month };
}

export default async function WhtReportPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const { year, month } = parsePeriod(params.year, params.month);
  const result = await getMonthlyWHTReport(year, month);

  const monthLabel = THAI_MONTH_LABELS[month] ?? `เดือน ${month}`;

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex flex-col gap-2">
          <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight text-slate-900">
            <Landmark className="h-8 w-8 text-blue-600" />
            รายงานหัก ณ ที่จ่าย (WHT Report)
          </h1>
          <p className="text-slate-500">
            สรุปรายเดือนสำหรับเตรียมยื่น ภ.ง.ด.3 / ภ.ง.ด.53 · Phase 8.5 · Zero
            Client-Side Fetching
          </p>
        </div>

        <Suspense
          fallback={
            <div className="h-10 w-64 animate-pulse rounded-xl bg-slate-100" />
          }
        >
          <WhtPeriodPicker year={year} month={month} />
        </Suspense>
      </div>

      {!result.success ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          ไม่สามารถโหลดรายงาน WHT ได้: {result.error}
        </div>
      ) : (
        <WhtReportDashboard
          year={year}
          month={month}
          monthLabel={monthLabel}
          pnd3={result.data.pnd3}
          pnd53={result.data.pnd53}
          pendingValidation={result.data.pendingValidation}
          totalWhtBaseFormatted={formatThaiBaht(result.data.summary.totalWhtBase)}
          totalWhtAmountFormatted={formatThaiBaht(
            result.data.summary.totalWhtAmount,
          )}
          paidWhtAmountFormatted={formatThaiBaht(
            result.data.summary.paidWhtAmount,
          )}
          issuedWhtAmountFormatted={formatThaiBaht(
            result.data.summary.issuedWhtAmount,
          )}
          paidCount={result.data.summary.paidCount}
          issuedCount={result.data.summary.issuedCount}
        />
      )}
    </div>
  );
}
