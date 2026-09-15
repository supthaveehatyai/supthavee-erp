import type { Metadata } from "next";
import { FileSpreadsheet } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  FINANCE_REPORT_TYPE_OPTIONS,
  isFinanceReportType,
  type FinanceReportType,
} from "@/lib/constants/document";
import { loadReportCenterPreview } from "@/lib/tax/report-center-data";
import { parseVatLedgerPeriod } from "@/lib/tax/vat-ledger-data";
import { formatThaiCurrency } from "@/lib/utils/currency";
import type { ReportCenterPreview } from "@/types/finance-report";
import { ReportCenterForm } from "./tax-reports-panel";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "ศูนย์รายงาน | Report Center",
  description:
    "พรีวิวและส่งออกสมุดภาษีซื้อ-ขาย พร้อมทะเบียนใบส่งของ ค่าใช้จ่าย และใบสำคัญจ่าย",
};

type PageProps = {
  searchParams: Promise<{
    month?: string;
    year?: string;
    reportType?: string;
  }>;
};

const DEFAULT_REPORT_TYPE: FinanceReportType = "OUTPUT_TAX";

function buildYearOptions(anchorYear: number): number[] {
  const span = 5;
  return Array.from({ length: span * 2 + 1 }, (_, i) => anchorYear - span + i);
}

function reportTypeLabel(reportType: FinanceReportType): string {
  return (
    FINANCE_REPORT_TYPE_OPTIONS.find((item) => item.value === reportType)
      ?.label ?? reportType
  );
}

function buildExportHref(
  year: number,
  month: number,
  reportType: FinanceReportType,
): string {
  const params = new URLSearchParams({
    year: String(year),
    month: String(month),
    reportType,
  });
  return `/api/finance/export-tax?${params.toString()}`;
}

/**
 * Server query — ดึง Preview ตาม searchParams (Zero Client-Side Fetching)
 */
async function queryReportPreview(input: {
  year: number;
  month: number;
  reportType: FinanceReportType;
}): Promise<{ data: ReportCenterPreview | null; error: string | null }> {
  try {
    const data = await loadReportCenterPreview(input);
    return { data, error: null };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "โหลดรายงานไม่สำเร็จ";
    console.error("[REPORT_CENTER_PREVIEW]", err);
    return { data: null, error: message };
  }
}

export default async function TaxReportsPage({ searchParams }: PageProps) {
  const params = (await searchParams) ?? {};
  const now = new Date();
  const fallbackYear = now.getFullYear();
  const fallbackMonth = now.getMonth() + 1;

  const hasRequested = Boolean(
    params.month?.trim() && params.year?.trim() && params.reportType?.trim(),
  );

  const parsedPeriod = parseVatLedgerPeriod(
    params.year ?? String(fallbackYear),
    params.month ?? String(fallbackMonth),
  );
  const year = parsedPeriod?.year ?? fallbackYear;
  const month = parsedPeriod?.month ?? fallbackMonth;

  const reportTypeRaw = (params.reportType ?? DEFAULT_REPORT_TYPE).toUpperCase();
  const reportType = isFinanceReportType(reportTypeRaw)
    ? reportTypeRaw
    : DEFAULT_REPORT_TYPE;

  const invalidReportType =
    hasRequested && !isFinanceReportType(reportTypeRaw);
  const invalidPeriod =
    hasRequested &&
    parseVatLedgerPeriod(params.year ?? null, params.month ?? null) == null;

  let preview: ReportCenterPreview | null = null;
  let loadError: string | null = null;

  if (hasRequested && !invalidReportType && !invalidPeriod) {
    const result = await queryReportPreview({ year, month, reportType });
    preview = result.data;
    loadError = result.error;
  } else if (invalidReportType) {
    loadError =
      "reportType ต้องเป็น OUTPUT_TAX, INPUT_TAX, INV_DO, EXP หรือ PAY";
  } else if (invalidPeriod) {
    loadError = "year/month ไม่ถูกต้อง (month ต้องเป็น 1–12)";
  }

  const hasRows = (preview?.rows.length ?? 0) > 0;
  const exportHref = hasRows
    ? buildExportHref(year, month, reportType)
    : null;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-slate-900">
          <FileSpreadsheet className="size-7 text-blue-600" />
          ศูนย์รายงาน (Report Center)
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          พรีวิวข้อมูลก่อนดาวน์โหลด Excel — ภาษีขาย (TAX_INV / CS_TAX / ABB),
          ภาษีซื้อ (AP_TAX), ทะเบียนใบส่งของ (INV_DO), ค่าใช้จ่าย (expenses)
          และใบสำคัญจ่าย (PAY)
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">เลือกเงื่อนไขรายงาน</CardTitle>
          <CardDescription>
            กด &quot;ดูรายงาน&quot; เพื่อโหลดตารางพรีวิวตามงวดบัญชี —
            ปุ่ม Export จะแสดงเมื่อมีข้อมูลในตารางเท่านั้น
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ReportCenterForm
            year={year}
            month={month}
            reportType={reportType}
            yearOptions={buildYearOptions(fallbackYear)}
            exportHref={exportHref}
          />
        </CardContent>
      </Card>

      {hasRequested ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {preview?.title ?? reportTypeLabel(reportType)}
            </CardTitle>
            <CardDescription>
              {preview
                ? `ประจำเดือน ${preview.periodLabel} · ${preview.rows.length} รายการ`
                : "ผลการค้นหาตามเงื่อนไขที่เลือก"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loadError ? (
              <p className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
                {loadError}
              </p>
            ) : preview && preview.rows.length === 0 ? (
              <p className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
                ไม่พบข้อมูลในช่วงเวลาที่เลือก
              </p>
            ) : preview ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-16">ลำดับ</TableHead>
                    <TableHead>วันที่</TableHead>
                    <TableHead>เลขเอกสาร</TableHead>
                    <TableHead>{preview.partyColumnLabel}</TableHead>
                    <TableHead className="text-right">ยอดก่อนภาษี</TableHead>
                    <TableHead className="text-right">ภาษี</TableHead>
                    <TableHead className="text-right">ยอดสุทธิ</TableHead>
                    <TableHead>สถานะ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.rows.map((row) => (
                    <TableRow
                      key={`${row.doc_no}-${row.seq}`}
                      className={row.is_void ? "text-red-700" : undefined}
                    >
                      <TableCell className="tabular-nums text-slate-500">
                        {row.seq}
                      </TableCell>
                      <TableCell>{row.doc_date}</TableCell>
                      <TableCell className="font-medium">{row.doc_no}</TableCell>
                      <TableCell>{row.party_name}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatThaiCurrency(row.net_before_vat)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatThaiCurrency(row.vat_amount)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatThaiCurrency(row.grand_total)}
                      </TableCell>
                      <TableCell>{row.status_label}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell colSpan={4} className="text-right font-semibold">
                      รวมทั้งสิ้น
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-semibold">
                      {formatThaiCurrency(preview.totals.net_before_vat)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-semibold">
                      {formatThaiCurrency(preview.totals.vat_amount)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-semibold">
                      {formatThaiCurrency(preview.totals.grand_total)}
                    </TableCell>
                    <TableCell />
                  </TableRow>
                </TableFooter>
              </Table>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
