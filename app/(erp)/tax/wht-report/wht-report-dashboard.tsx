"use client";

/**
 * Phase 8.5 — WHT Report client island (Tabs + table presentation only).
 * All rows/KPIs are preloaded by the Server Component parent.
 */

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  CircleDollarSign,
  Download,
  FileSpreadsheet,
  Percent,
  Printer,
} from "lucide-react";
import type { WHTReportRow } from "@/types/tax";
import { buildWht50TawiPrintHref } from "@/lib/tax/wht-50tawi-format";
import { TaxValidationModal } from "@/components/tax/TaxValidationModal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { buildViewWhtHref } from "./wht-document-preview-utils";

export type WhtReportDashboardProps = {
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
};

type ModalTarget = {
  contactId: string;
  companyName: string;
  initial: WHTReportRow["contacts"];
};

function sourceBadgeLabel(source: WHTReportRow["source"]): string {
  return source === "TB" ? "TB" : "EXP";
}

function paymentStatusLabel(row: WHTReportRow): string {
  if (row?.source === "EXP") {
    return (row?.status ?? "").trim().toUpperCase() === "PAID" ? "PAID" : "ISSUED";
  }
  const paymentStatus = (row?.payment_status ?? "").trim().toUpperCase();
  const docStatus = (row?.status ?? "").trim().toUpperCase();
  if (
    paymentStatus === "PAID" ||
    docStatus === "PAID" ||
    docStatus === "COMPLETED"
  ) {
    return "PAID";
  }
  return "ISSUED";
}

function formatDocDate(value: string): string {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("th-TH", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

function formatBaht(value: number): string {
  return new Intl.NumberFormat("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(value) ? value : 0);
}

function pendingReason(row: WHTReportRow): string {
  if (!row.contact_id || !row.contacts) return "ไม่มีผู้จำหน่าย";
  if (
    row.contacts.entity_type == null ||
    String(row.contacts.entity_type).trim() === ""
  ) {
    return "ยังไม่ระบุประเภท (entity_type)";
  }
  if (row.contacts.is_tax_validated !== true) return "รอตรวจ Tax ID";
  return "รอดำเนินการ";
}

function buildExportHref(
  year: number,
  month: number,
  formType: "PND3" | "PND53",
): string {
  const params = new URLSearchParams({
    year: String(year),
    month: String(month),
    formType,
  });
  return `/api/tax/export-wht?${params.toString()}`;
}

function TabExportBar({
  title,
  href,
  disabled,
}: {
  title: string;
  href: string;
  disabled?: boolean;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <p className="text-sm text-slate-500">{title}</p>
      {disabled ? (
        <Button type="button" size="sm" variant="outline" disabled>
          <Download className="mr-1.5 h-3.5 w-3.5" />
          Export Excel
        </Button>
      ) : (
        <a
          href={href}
          className="inline-flex h-8 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 focus-visible:ring-offset-2"
        >
          <Download className="h-3.5 w-3.5" />
          Export Excel
        </a>
      )}
    </div>
  );
}

function WhtTable({
  rows = [],
  year,
  month,
  showAction,
  onUpdateVendor,
  onViewDocument,
}: {
  rows?: WHTReportRow[];
  year: number;
  month: number;
  showAction?: boolean;
  onUpdateVendor?: (row: WHTReportRow) => void;
  onViewDocument?: (row: WHTReportRow) => void;
}) {
  const safeRows = Array.isArray(rows) ? rows : [];

  if (safeRows.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 py-12 text-center text-sm text-slate-500">
        ไม่พบรายการหัก ณ ที่จ่ายในกลุ่มนี้
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <Table>
        <TableHeader>
          <TableRow className="bg-slate-50/80">
            <TableHead className="whitespace-nowrap">วันที่จ่ายเงิน</TableHead>
            <TableHead className="whitespace-nowrap">ประเภท</TableHead>
            <TableHead className="whitespace-nowrap">เลขที่เอกสาร</TableHead>
            <TableHead>ชื่อผู้จำหน่าย / ช่าง</TableHead>
            <TableHead className="whitespace-nowrap">
              เลขประจำตัวผู้เสียภาษี
            </TableHead>
            <TableHead className="text-right whitespace-nowrap">ฐานภาษี</TableHead>
            <TableHead className="text-right whitespace-nowrap">อัตรา (%)</TableHead>
            <TableHead className="text-right whitespace-nowrap">ยอดภาษี</TableHead>
            <TableHead className="whitespace-nowrap text-right">การจัดการ</TableHead>
            {showAction ? (
              <TableHead className="whitespace-nowrap text-right">Action</TableHead>
            ) : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {safeRows.map((row) => {
            const reason = showAction ? pendingReason(row) : null;
            const payStatus = paymentStatusLabel(row);
            return (
              <TableRow key={`${row.source}-${row.id}`}>
                <TableCell className="whitespace-nowrap text-slate-700">
                  {formatDocDate(row.expense_date)}
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  <Badge variant={row.source === "TB" ? "blue" : "slate"}>
                    {sourceBadgeLabel(row.source)}
                  </Badge>
                </TableCell>
                <TableCell className="whitespace-nowrap font-medium">
                  <button
                    type="button"
                    onClick={() => onViewDocument?.(row)}
                    className="text-left text-blue-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-1"
                  >
                    {row.document_no || "—"}
                  </button>
                  <span className="mt-0.5 block text-[10px] font-normal text-slate-400">
                    {payStatus === "PAID" ? "ชำระแล้ว" : "รอดำเนินการ"}
                  </span>
                </TableCell>
                <TableCell>
                  <div className="flex flex-col gap-1">
                    <span className="text-slate-800">
                      {row.contacts?.company_name?.trim() ||
                        "— ไม่ระบุผู้จำหน่าย"}
                    </span>
                    {reason ? (
                      <Badge
                        variant="amber"
                        className="w-fit text-[10px] font-medium"
                      >
                        {reason}
                      </Badge>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell className="font-mono text-sm whitespace-nowrap text-slate-700">
                  {row.contacts?.tax_id?.trim() || "—"}
                  {row.contacts?.tax_branch_code ? (
                    <span className="ml-1 text-xs text-slate-400">
                      / {row.contacts.tax_branch_code}
                    </span>
                  ) : null}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatBaht(row.wht_base_amount)}
                </TableCell>
                <TableCell className="text-right tabular-nums text-slate-600">
                  {formatBaht(row.wht_rate)}
                </TableCell>
                <TableCell className="text-right font-semibold tabular-nums text-slate-900">
                  {formatBaht(row.wht_amount)}
                </TableCell>
                <TableCell className="text-right">
                  <a
                    href={buildWht50TawiPrintHref(
                      row.source,
                      row.id,
                      year,
                      month,
                    )}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex h-8 items-center justify-center gap-1 rounded-lg border border-amber-200 bg-amber-50 px-2.5 text-[11px] font-semibold text-amber-900 transition hover:bg-amber-100"
                    title="พิมพ์หนังสือรับรองการหักภาษี ณ ที่จ่าย (50 ทวิ)"
                  >
                    <Printer className="h-3.5 w-3.5" />
                    พิมพ์ 50 ทวิ
                  </a>
                </TableCell>
                {showAction ? (
                  <TableCell className="text-right">
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={!row.contact_id}
                      onClick={() => onUpdateVendor?.(row)}
                      title={
                        row.contact_id
                          ? "อัปเดตข้อมูลภาษีผู้จำหน่าย"
                          : "เอกสารนี้ไม่มีผู้จำหน่าย — แก้ไขที่หน้า Expense"
                      }
                    >
                      อัปเดตข้อมูลผู้จำหน่าย
                    </Button>
                  </TableCell>
                ) : null}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

export function WhtReportDashboard({
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
}: WhtReportDashboardProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [modalTarget, setModalTarget] = useState<ModalTarget | null>(null);

  const safePnd3 = Array.isArray(pnd3) ? pnd3 : [];
  const safePnd53 = Array.isArray(pnd53) ? pnd53 : [];
  const safePending = Array.isArray(pendingValidation) ? pendingValidation : [];

  const pendingCount = safePending.length;
  const defaultTab =
    pendingCount > 0
      ? "pending"
      : safePnd3.length >= safePnd53.length
        ? "pnd3"
        : "pnd53";

  function openTaxModal(row: WHTReportRow) {
    if (!row.contact_id) return;
    setModalTarget({
      contactId: row.contact_id,
      companyName: row.contacts?.company_name?.trim() || "ผู้จำหน่าย",
      initial: row.contacts,
    });
  }

  function openDocumentPreview(row: WHTReportRow) {
    router.push(
      buildViewWhtHref(pathname, searchParams.toString(), row.source, row.id),
      { scroll: false },
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
            <div>
              <CardDescription>ยอดรวมฐานภาษี</CardDescription>
              <CardTitle className="mt-1 text-2xl font-bold tracking-tight text-slate-900">
                {totalWhtBaseFormatted}
              </CardTitle>
            </div>
            <div className="rounded-lg bg-blue-50 p-2 text-blue-600">
              <CircleDollarSign className="h-5 w-5" />
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-slate-500">
              {monthLabel} {year} · EXP + TB
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
            <div>
              <CardDescription>ยอดรวมภาษีหัก ณ ที่จ่าย</CardDescription>
              <CardTitle className="mt-1 text-2xl font-bold tracking-tight text-slate-900">
                {totalWhtAmountFormatted}
              </CardTitle>
            </div>
            <div className="rounded-lg bg-slate-100 p-2 text-slate-600">
              <Percent className="h-5 w-5" />
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-slate-500">
              รวมทุกอัตรา · เดือน {String(month).padStart(2, "0")}/{year}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
            <div>
              <CardDescription>ชำระแล้ว (PAID)</CardDescription>
              <CardTitle className="mt-1 text-2xl font-bold tracking-tight text-emerald-700">
                {paidWhtAmountFormatted}
              </CardTitle>
            </div>
            <div className="rounded-lg bg-emerald-50 p-2 text-emerald-600">
              <Percent className="h-5 w-5" />
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-slate-500">
              {paidCount.toLocaleString("th-TH")} รายการ · ยอด WHT ที่จ่ายแล้ว
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
            <div>
              <CardDescription>รอดำเนินการ (ISSUED)</CardDescription>
              <CardTitle className="mt-1 text-2xl font-bold tracking-tight text-amber-700">
                {issuedWhtAmountFormatted}
              </CardTitle>
            </div>
            <div className="rounded-lg bg-amber-50 p-2 text-amber-600">
              <AlertTriangle className="h-5 w-5" />
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-slate-500">
              {issuedCount.toLocaleString("th-TH")} รายการ · ยังไม่ตัดจ่าย WHT
            </p>
          </CardContent>
        </Card>
      </div>

      {pendingCount > 0 ? (
        <Card className="border-amber-200 bg-amber-50/40">
          <CardHeader className="pb-2">
            <CardDescription className="text-amber-800">
              รอตรวจสอบข้อมูลภาษี
            </CardDescription>
            <CardTitle className="text-lg font-semibold text-amber-900">
              {pendingCount.toLocaleString("th-TH")} รายการ
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-amber-800/80">
              entity_type ว่าง หรือยังไม่ผ่าน Tax Validation — ดูในแท็บรอดำเนินการ
            </p>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FileSpreadsheet className="h-4 w-4 text-blue-600" />
            รายการหัก ณ ที่จ่าย
          </CardTitle>
          <CardDescription>
            รวม EXP (ค่าใช้จ่าย) + TB (สรุปวางบิลช่าง) · แยกแบบฟอร์ม ภ.ง.ด.3 / ภ.ง.ด.53
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue={defaultTab} className="space-y-4">
            <TabsList className="flex h-auto flex-wrap gap-1">
              <TabsTrigger value="pnd3">
                ภ.ง.ด. 3
                <Badge variant="slate" className="ml-2">
                  {safePnd3.length}
                </Badge>
              </TabsTrigger>
              <TabsTrigger value="pnd53">
                ภ.ง.ด. 53
                <Badge variant="slate" className="ml-2">
                  {safePnd53.length}
                </Badge>
              </TabsTrigger>
              <TabsTrigger value="pending" className="gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
                รอดำเนินการ (Pending)
                <Badge variant="amber" className="ml-1">
                  {pendingCount}
                </Badge>
              </TabsTrigger>
            </TabsList>

            <TabsContent value="pnd3">
              <TabExportBar
                title="แบบฟอร์ม ภ.ง.ด.3 — บุคคลธรรมดา"
                href={buildExportHref(year, month, "PND3")}
                disabled={safePnd3.length === 0}
              />
              <WhtTable
                rows={safePnd3}
                year={year}
                month={month}
                onViewDocument={openDocumentPreview}
              />
            </TabsContent>
            <TabsContent value="pnd53">
              <TabExportBar
                title="แบบฟอร์ม ภ.ง.ด.53 — นิติบุคคล"
                href={buildExportHref(year, month, "PND53")}
                disabled={safePnd53.length === 0}
              />
              <WhtTable
                rows={safePnd53}
                year={year}
                month={month}
                onViewDocument={openDocumentPreview}
              />
            </TabsContent>
            <TabsContent value="pending">
              <WhtTable
                rows={safePending}
                year={year}
                month={month}
                showAction
                onUpdateVendor={openTaxModal}
                onViewDocument={openDocumentPreview}
              />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <TaxValidationModal
        open={modalTarget != null}
        onOpenChange={(open) => {
          if (!open) setModalTarget(null);
        }}
        contactId={modalTarget?.contactId ?? null}
        companyName={modalTarget?.companyName}
        initial={modalTarget?.initial}
      />
    </div>
  );
}
