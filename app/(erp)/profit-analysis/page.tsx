import type { Metadata } from "next";
import { Suspense } from "react";
import { ChartColumnIncreasing } from "lucide-react";
import { getProfitAnalysisDashboard } from "@/lib/actions/profit-analysis.actions";
import { ProfitAnalysisDashboard } from "./profit-analysis-dashboard";
import { ProfitAnalysisMonthPicker } from "./profit-analysis-month-picker";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "วิเคราะห์กำไร | Profit Analysis",
  description:
    "สรุปกำไรขั้นต้นและกำไรสุทธิรายเดือน พร้อมรายการกำไรแยกตามบิลขาย",
};

type PageProps = {
  searchParams: Promise<{
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

function parseMonthParam(raw?: string): string {
  const now = new Date();
  const fallback = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const trimmed = raw?.trim() ?? "";
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(trimmed)) {
    return fallback;
  }
  return trimmed;
}

function formatMonthLabel(month: string): string {
  const [yearStr, monthStr] = month.split("-");
  const monthNum = Number(monthStr);
  const label = THAI_MONTH_LABELS[monthNum] ?? `เดือน ${monthStr}`;
  return `${label} ${yearStr}`;
}

export default async function ProfitAnalysisPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const month = parseMonthParam(params.month);
  const result = await getProfitAnalysisDashboard(month);

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex flex-col gap-2">
          <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight text-slate-900">
            <ChartColumnIncreasing className="h-8 w-8 text-blue-600" />
            วิเคราะห์กำไร (Profit Analysis)
          </h1>
          <p className="text-slate-500">
            KPI รายเดือน + กำไรแยกตามบิลขาย · Actual Cost = เสื้อเปล่า + ค่าแรง
            งานบริการ
          </p>
        </div>

        <Suspense
          fallback={
            <div className="h-16 w-52 animate-pulse rounded-xl bg-slate-100" />
          }
        >
          <ProfitAnalysisMonthPicker month={month} />
        </Suspense>
      </div>

      {!result.success ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          ไม่สามารถโหลดข้อมูลวิเคราะห์กำไรได้: {result.error}
        </div>
      ) : (
        <ProfitAnalysisDashboard
          monthLabel={formatMonthLabel(result.month)}
          kpi={result.kpi}
          rows={result.rows}
          formatted={{
            revenue: formatThaiBaht(result.kpi.revenue),
            cogs: formatThaiBaht(result.kpi.cogs),
            grossProfit: formatThaiBaht(result.kpi.grossProfit),
            opex: formatThaiBaht(result.kpi.opex),
            netProfit: formatThaiBaht(result.kpi.netProfit),
          }}
        />
      )}
    </div>
  );
}
