"use client";

/**
 * WHT Report — client island (period picker, dashboard, document preview sheet).
 * Server parent loads data via Server Action and passes serializable props only.
 */

import { Suspense, type ReactNode } from "react";
import { Landmark } from "lucide-react";
import type { WHTReportRow } from "@/types/tax";
import { WhtDocumentPreviewSheet } from "./wht-document-preview-sheet";
import type { WhtDocumentPreviewTarget } from "./wht-document-preview-utils";
import { WhtPeriodPicker } from "./wht-period-picker";
import { WhtReportDashboard } from "./wht-report-dashboard";

export type WhtReportClientProps = {
  year: number;
  month: number;
  monthLabel: string;
  pnd3: WHTReportRow[];
  pnd53: WHTReportRow[];
  pendingValidation: WHTReportRow[];
  totalWhtBaseFormatted: string;
  totalWhtAmountFormatted: string;
  paidWhtAmountFormatted: string;
  issuedWhtAmountFormatted: string;
  paidCount: number;
  issuedCount: number;
  loadFailed: boolean;
  loadError?: string;
  previewTarget: WhtDocumentPreviewTarget;
  children?: ReactNode;
};

export function WhtReportClient({
  year,
  month,
  monthLabel,
  pnd3 = [],
  pnd53 = [],
  pendingValidation = [],
  totalWhtBaseFormatted,
  totalWhtAmountFormatted,
  paidWhtAmountFormatted,
  issuedWhtAmountFormatted,
  paidCount = 0,
  issuedCount = 0,
  loadFailed,
  loadError,
  previewTarget,
  children,
}: WhtReportClientProps) {
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

      {loadFailed ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          ไม่สามารถโหลดรายงาน WHT ได้ครบถ้วน — แสดงตารางว่างชั่วคราว
          {loadError ? ` (${loadError})` : ""}
        </div>
      ) : null}

      <Suspense
        fallback={
          <div className="h-64 animate-pulse rounded-xl bg-slate-100" />
        }
      >
        <WhtReportDashboard
          year={year}
          month={month}
          monthLabel={monthLabel}
          pnd3={pnd3}
          pnd53={pnd53}
          pendingValidation={pendingValidation}
          totalWhtBaseFormatted={totalWhtBaseFormatted}
          totalWhtAmountFormatted={totalWhtAmountFormatted}
          paidWhtAmountFormatted={paidWhtAmountFormatted}
          issuedWhtAmountFormatted={issuedWhtAmountFormatted}
          paidCount={paidCount}
          issuedCount={issuedCount}
        />
      </Suspense>

      <WhtDocumentPreviewSheet target={previewTarget}>
        {children}
      </WhtDocumentPreviewSheet>
    </div>
  );
}
