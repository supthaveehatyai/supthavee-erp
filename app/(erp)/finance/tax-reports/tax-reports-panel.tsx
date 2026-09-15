import { Download, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  FINANCE_REPORT_TYPE_OPTIONS,
  type FinanceReportType,
} from "@/lib/constants/document";

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
};

export function ReportCenterForm({
  year,
  month,
  reportType,
  yearOptions,
  exportHref,
}: ReportCenterFormProps) {
  return (
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
      </div>
    </form>
  );
}
