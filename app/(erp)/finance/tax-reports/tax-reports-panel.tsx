import { Download, Eye } from "lucide-react";
import {
  BatchPdfPrintButton,
  BatchPrintTrigger,
} from "@/components/finance/batch-pdf-print-button";
import PrintDocumentTemplate from "@/components/sales/print-document-template";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { getBatchDocumentsForPrint } from "@/lib/actions/document-actions";
import {
  FINANCE_REPORT_TYPE_OPTIONS,
  type FinanceReportType,
} from "@/lib/constants/document";
import {
  OUTPUT_TAX_SUB_FILTERS,
  type OutputTaxSubFilter,
} from "@/lib/tax/output-tax-series";
import type { DocumentDetail } from "@/types/document";

const THAI_MONTHS = [
  { value: 1, label: "มกราคม" },
  { value: 2, label: "กุมภาพันธ์" },
  { value: 3, label: "มีนาคม" },
  { value: 4, label: "เมษายน" },
  { value: 5, label: "พฤษภาคม" },
  { value: 6, label: "มิถุนายน" },
  { value: 7, label: "กรกฎาคม" },
  { value: 8, label: "สิงหาคม" },
  { value: 9, label: "กันยายน" },
  { value: 10, label: "ตุลาคม" },
  { value: 11, label: "พฤศจิกายน" },
  { value: 12, label: "ธันวาคม" },
] as const;

export type ReportCenterFormProps = {
  year: number;
  month: number;
  reportType: FinanceReportType;
  yearOptions: number[];
  exportHref: string | null;
  outputSubFilter: OutputTaxSubFilter;
  showBatchPdf: boolean;
  printBatch: boolean;
  batchTick: string;
};

function outputFilterHref(
  year: number,
  month: number,
  subFilter: OutputTaxSubFilter,
): string {
  const params = new URLSearchParams({
    year: String(year),
    month: String(month),
    reportType: "OUTPUT_TAX",
    sub: subFilter,
  });
  return `/finance/tax-reports?${params.toString()}`;
}

export async function ReportCenterForm({
  year,
  month,
  reportType,
  yearOptions,
  exportHref,
  outputSubFilter,
  showBatchPdf,
  printBatch,
  batchTick,
}: ReportCenterFormProps) {
  let batchDocs: DocumentDetail[] = [];
  let batchError: string | null = null;
  if (printBatch) {
    const res = await getBatchDocumentsForPrint({
      year,
      month,
      subFilter: outputSubFilter,
    });
    if (res.error) batchError = res.error;
    else if (res.data.length === 0) {
      batchError = "ไม่พบเอกสารขายในช่วงเดือนและหมวดที่เลือก";
    } else {
      batchDocs = res.data;
    }
  }

  return (
    <>
    <div className="print:hidden">
    <form
      method="GET"
      action="/finance/tax-reports"
      className="space-y-6"
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <Label htmlFor="report-center-type">ประเภทรายงาน</Label>
          <Select
            id="report-center-type"
            name="reportType"
            defaultValue={reportType}
            required
          >
            {FINANCE_REPORT_TYPE_OPTIONS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="report-center-month">เดือน</Label>
          <Select
            id="report-center-month"
            name="month"
            defaultValue={String(month)}
            required
          >
            {THAI_MONTHS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="report-center-year">ปี (ค.ศ.)</Label>
          <Select
            id="report-center-year"
            name="year"
            defaultValue={String(year)}
            required
          >
            {yearOptions.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {reportType === "OUTPUT_TAX" ? (
        <div className="space-y-2">
          <p className="text-sm font-medium text-slate-700">หมวดเอกสารภาษีขาย</p>
          <div className="flex flex-wrap gap-2">
            {OUTPUT_TAX_SUB_FILTERS.map((item) => {
              const active = outputSubFilter === item.value;
              return (
                <a
                  key={item.value}
                  href={outputFilterHref(year, month, item.value)}
                  className={
                    active
                      ? "inline-flex h-9 items-center rounded-full bg-blue-600 px-3 text-sm font-semibold text-white"
                      : "inline-flex h-9 items-center rounded-full border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  }
                >
                  {item.label}
                </a>
              );
            })}
          </div>
          <input type="hidden" name="sub" value={outputSubFilter} />
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit">
          <Eye className="size-4" />
          ดูรายงาน (View Report)
        </Button>
        {exportHref ? (
          <a
            href={exportHref}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2"
          >
            <Download className="size-4" />
            Export to Excel
          </a>
        ) : null}
        {showBatchPdf ? <BatchPdfPrintButton /> : null}
      </div>
      {batchError ? <p className="text-sm text-red-600">{batchError}</p> : null}
    </form>
    </div>
    {batchDocs.length > 0 ? (
      <div id="batch-print-root" className="hidden print:block print:w-full">
        {batchDocs.map((doc, idx) => (
          <div
            key={doc.id}
            className={idx < batchDocs.length - 1 ? "print:break-after-page" : undefined}
            style={{
              pageBreakAfter: idx < batchDocs.length - 1 ? "always" : "auto",
              breakAfter: idx < batchDocs.length - 1 ? "page" : "auto",
            }}
          >
            <PrintDocumentTemplate
              className="mt-0 print:mt-0"
              document={doc}
              followDocumentDefaults
            />
          </div>
        ))}
      </div>
    ) : null}
    <BatchPrintTrigger active={batchDocs.length > 0} tick={batchTick} />
    </>
  );
}
