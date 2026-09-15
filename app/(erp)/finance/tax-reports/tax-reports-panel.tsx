"use client";

/**
 * Phase 19 — Month/Year picker + Excel download links.
 * No data fetching — href ชี้ไป API Route เท่านั้น.
 */

import { useMemo, useState } from "react";
import { Download, FileSpreadsheet } from "lucide-react";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import type { VatLedgerReportType } from "@/lib/constants/document";

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

function buildExportHref(
  year: number,
  month: number,
  reportType: VatLedgerReportType,
): string {
  const params = new URLSearchParams({
    year: String(year),
    month: String(month),
    reportType,
  });
  return `/api/finance/export-tax?${params.toString()}`;
}

export type TaxReportsPanelProps = {
  year: number;
  month: number;
};

export function TaxReportsPanel({ year, month }: TaxReportsPanelProps) {
  const [selectedYear, setSelectedYear] = useState(year);
  const [selectedMonth, setSelectedMonth] = useState(month);

  const years = useMemo(() => {
    const span = 5;
    return Array.from({ length: span * 2 + 1 }, (_, i) => year - span + i);
  }, [year]);

  const outputHref = buildExportHref(selectedYear, selectedMonth, "OUTPUT_TAX");
  const inputHref = buildExportHref(selectedYear, selectedMonth, "INPUT_TAX");

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="vat-ledger-month">เดือน</Label>
          <Select
            id="vat-ledger-month"
            value={String(selectedMonth)}
            onChange={(event) => setSelectedMonth(Number(event.target.value))}
          >
            {THAI_MONTHS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="vat-ledger-year">ปี (ค.ศ.)</Label>
          <Select
            id="vat-ledger-year"
            value={String(selectedYear)}
            onChange={(event) => setSelectedYear(Number(event.target.value))}
          >
            {years.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <a
          href={outputHref}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
        >
          <Download className="size-4" />
          ดาวน์โหลดรายงานภาษีขาย (Excel)
        </a>
        <a
          href={inputHref}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2"
        >
          <FileSpreadsheet className="size-4" />
          ดาวน์โหลดรายงานภาษีซื้อ (Excel)
        </a>
      </div>
    </div>
  );
}
