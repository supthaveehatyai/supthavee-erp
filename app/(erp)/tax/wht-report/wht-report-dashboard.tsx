"use client";

/**
 * Phase 8.5 — WHT Report client island (Tabs + table presentation only).
 * All rows/KPIs are preloaded by the Server Component parent.
 */

import { useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CircleDollarSign,
  Download,
  FileSpreadsheet,
  Percent,
} from "lucide-react";
import type { WHTReportExpenseRow } from "@/types/tax";
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

export type WhtReportDashboardProps = {
  year: number;
  month: number;
  monthLabel: string;
  pnd3: WHTReportExpenseRow[];
  pnd53: WHTReportExpenseRow[];
  pendingValidation: WHTReportExpenseRow[];
  totalWhtBaseFormatted: string;
  totalWhtAmountFormatted: string;
};

type ModalTarget = {
  contactId: string;
  companyName: string;
  initial: WHTReportExpenseRow["contacts"];
};

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

function pendingReason(row: WHTReportExpenseRow): string {
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
  rows,
  showAction,
  onUpdateVendor,
}: {
  rows: WHTReportExpenseRow[];
  showAction?: boolean;
  onUpdateVendor?: (row: WHTReportExpenseRow) => void;
}) {
  if (rows.length === 0) {
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
            <TableHead className="whitespace-nowrap">เลขที่เอกสาร</TableHead>
            <TableHead>ชื่อผู้จำหน่าย</TableHead>
            <TableHead className="whitespace-nowrap">
              เลขประจำตัวผู้เสียภาษี
            </TableHead>
            <TableHead className="text-right whitespace-nowrap">ฐานภาษี</TableHead>
            <TableHead className="text-right whitespace-nowrap">อัตรา (%)</TableHead>
            <TableHead className="text-right whitespace-nowrap">ยอดภาษี</TableHead>
            {showAction ? (
              <TableHead className="whitespace-nowrap text-right">Action</TableHead>
            ) : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const reason = showAction ? pendingReason(row) : null;
            return (
              <TableRow key={row.id}>
                <TableCell className="whitespace-nowrap text-slate-700">
                  {formatDocDate(row.expense_date)}
                </TableCell>
                <TableCell className="whitespace-nowrap font-medium">
                  <Link
                    href={`/expenses/${row.id}`}
                    className="text-blue-600 hover:underline"
                  >
                    {row.document_no || "—"}
                  </Link>
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
  pnd3,
  pnd53,
  pendingValidation,
  totalWhtBaseFormatted,
  totalWhtAmountFormatted,
}: WhtReportDashboardProps) {
  const [modalTarget, setModalTarget] = useState<ModalTarget | null>(null);

  const pendingCount = pendingValidation.length;
  const defaultTab =
    pendingCount > 0
      ? "pending"
      : pnd3.length >= pnd53.length
        ? "pnd3"
        : "pnd53";

  function openTaxModal(row: WHTReportExpenseRow) {
    if (!row.contact_id) return;
    setModalTarget({
      contactId: row.contact_id,
      companyName: row.contacts?.company_name?.trim() || "ผู้จำหน่าย",
      initial: row.contacts,
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
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
              {monthLabel} {year} · ฐานก่อนหัก ณ ที่จ่าย
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
            <div className="rounded-lg bg-emerald-50 p-2 text-emerald-600">
              <Percent className="h-5 w-5" />
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-slate-500">
              รวมทุกอัตรา · เดือน {String(month).padStart(2, "0")}/{year}
            </p>
          </CardContent>
        </Card>

        <Card className="sm:col-span-2 xl:col-span-1">
          <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
            <div>
              <CardDescription>รอดำเนินการ (Pending)</CardDescription>
              <CardTitle className="mt-1 text-2xl font-bold tracking-tight text-amber-700">
                {pendingCount.toLocaleString("th-TH")} รายการ
              </CardTitle>
            </div>
            <div className="rounded-lg bg-amber-50 p-2 text-amber-600">
              <AlertTriangle className="h-5 w-5" />
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-slate-500">
              entity_type ว่าง หรือยังไม่ผ่าน Tax Validation
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FileSpreadsheet className="h-4 w-4 text-blue-600" />
            รายการหัก ณ ที่จ่าย
          </CardTitle>
          <CardDescription>
            แยกแบบฟอร์ม ภ.ง.ด.3 / ภ.ง.ด.53 และแท็บรอดำเนินการสำหรับข้อมูลภาษีที่ไม่ครบ
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue={defaultTab} className="space-y-4">
            <TabsList className="flex h-auto flex-wrap gap-1">
              <TabsTrigger value="pnd3">
                ภ.ง.ด. 3
                <Badge variant="slate" className="ml-2">
                  {pnd3.length}
                </Badge>
              </TabsTrigger>
              <TabsTrigger value="pnd53">
                ภ.ง.ด. 53
                <Badge variant="slate" className="ml-2">
                  {pnd53.length}
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
                disabled={pnd3.length === 0}
              />
              <WhtTable rows={pnd3} />
            </TabsContent>
            <TabsContent value="pnd53">
              <TabExportBar
                title="แบบฟอร์ม ภ.ง.ด.53 — นิติบุคคล"
                href={buildExportHref(year, month, "PND53")}
                disabled={pnd53.length === 0}
              />
              <WhtTable rows={pnd53} />
            </TabsContent>
            <TabsContent value="pending">
              <WhtTable
                rows={pendingValidation}
                showAction
                onUpdateVendor={openTaxModal}
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
