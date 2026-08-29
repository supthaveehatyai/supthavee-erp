import type { Metadata } from "next";
import { Suspense } from "react";
import { getMonthlyWHTReport } from "@/app/actions/tax-actions";
import type { MonthlyWHTReportData, WHTReportRow } from "@/types/tax";
import { WhtDocumentPreviewContent } from "./wht-document-preview-content";
import { parseWhtDocumentPreviewTarget } from "./wht-document-preview-utils";
import { WhtReportClient } from "./wht-report-client";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "รายงานหัก ณ ที่จ่าย | WHT Report",
  description: "สรุปรายงานภาษีหัก ณ ที่จ่ายรายเดือน — ภ.ง.ด.3 / ภ.ง.ด.53",
};

type PageProps = {
  searchParams: Promise<{
    year?: string;
    month?: string;
    view_wht_source?: string;
    view_wht_id?: string;
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

const EMPTY_WHT_ROWS: WHTReportRow[] = [];

const EMPTY_WHT_REPORT: MonthlyWHTReportData = {
  raw: EMPTY_WHT_ROWS,
  pnd3: EMPTY_WHT_ROWS,
  pnd53: EMPTY_WHT_ROWS,
  pendingValidation: EMPTY_WHT_ROWS,
  summary: {
    totalWhtBase: 0,
    totalWhtAmount: 0,
    paidWhtAmount: 0,
    issuedWhtAmount: 0,
    paidCount: 0,
    issuedCount: 0,
  },
};

function formatThaiBaht(value: number): string {
  return new Intl.NumberFormat("th-TH", {
    style: "currency",
    currency: "THB",
  }).format(Number.isFinite(value) ? value : 0);
}

function asWhtRows(value: unknown): WHTReportRow[] {
  return Array.isArray(value) ? value : EMPTY_WHT_ROWS;
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
  const params = (await searchParams) ?? {};
  const { year, month } = parsePeriod(params?.year, params?.month);
  const previewTarget = parseWhtDocumentPreviewTarget(
    params?.view_wht_source,
    params?.view_wht_id,
  );

  let result: Awaited<ReturnType<typeof getMonthlyWHTReport>>;
  try {
    result = await getMonthlyWHTReport(year, month);
  } catch (error) {
    console.error("[WHT_REPORT_ERROR] page load failed:", error);
    result = { success: true, data: EMPTY_WHT_REPORT };
  }

  const report =
    result?.success && result.data ? result.data : EMPTY_WHT_REPORT;
  const summary = report?.summary ?? EMPTY_WHT_REPORT.summary;
  const pnd3 = asWhtRows(report?.pnd3);
  const pnd53 = asWhtRows(report?.pnd53);
  const pendingValidation = asWhtRows(report?.pendingValidation);
  const loadFailed = !result?.success;
  const loadError =
    loadFailed && result && !result.success ? result.error : undefined;

  const monthLabel = THAI_MONTH_LABELS[month] ?? `เดือน ${month}`;

  return (
    <WhtReportClient
      year={year}
      month={month}
      monthLabel={monthLabel}
      pnd3={pnd3}
      pnd53={pnd53}
      pendingValidation={pendingValidation}
      totalWhtBaseFormatted={formatThaiBaht(summary?.totalWhtBase ?? 0)}
      totalWhtAmountFormatted={formatThaiBaht(summary?.totalWhtAmount ?? 0)}
      paidWhtAmountFormatted={formatThaiBaht(summary?.paidWhtAmount ?? 0)}
      issuedWhtAmountFormatted={formatThaiBaht(
        summary?.issuedWhtAmount ?? 0,
      )}
      paidCount={summary?.paidCount ?? 0}
      issuedCount={summary?.issuedCount ?? 0}
      loadFailed={loadFailed}
      loadError={loadError}
      previewTarget={previewTarget}
    >
      {previewTarget ? (
        <Suspense
          fallback={
            <div className="px-6 py-8 text-sm text-slate-500">
              กำลังโหลดรายละเอียดเอกสาร...
            </div>
          }
        >
          <WhtDocumentPreviewContent
            source={previewTarget.source}
            documentId={previewTarget.documentId}
          />
        </Suspense>
      ) : null}
    </WhtReportClient>
  );
}
