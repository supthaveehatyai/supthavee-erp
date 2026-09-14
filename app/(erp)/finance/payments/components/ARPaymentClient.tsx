"use client";

/**
 * Phase 5 — AR Payment Client island.
 * Customer selection → URL `?contact_id=` (Server re-fetch).
 * Knock-off persist via PaymentKnockoffForm Server Action.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { BankAccount } from "@/types/bank-account";
import type {
  AvailableDeposit,
  DebtorOption,
  UnpaidInvoice,
} from "@/types/payment";
import type { OpenBillingNoteOption } from "@/types/billing";
import { OutstandingPartyCombobox } from "@/components/finance/OutstandingPartyCombobox";
import { PaymentKnockoffForm } from "@/components/finance/PaymentKnockoffForm";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
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
import { formatThaiDate } from "@/lib/utils/date-formatter";
import { ArrowDown, ArrowLeft, ArrowUp, ArrowUpDown, Eye, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";

export type ARPaymentClientProps = {
  debtors: DebtorOption[];
  invoices: UnpaidInvoice[];
  availableDeposits: AvailableDeposit[];
  bankAccounts: BankAccount[];
  selectedContactId: string;
  billingNotes?: OpenBillingNoteOption[];
};

function formatMoney(value: number): string {
  return value.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function salesDocumentHref(docNo: string): string {
  return `/sales/${encodeURIComponent(docNo)}`;
}

type OutstandingSortKey = "name" | "amount" | "oldest_date";
type SortDirection = "asc" | "desc";
type OutstandingSortConfig = {
  key: OutstandingSortKey;
  direction: SortDirection;
};

const DEFAULT_SORT: OutstandingSortConfig = {
  key: "amount",
  direction: "desc",
};

const SORT_PRESETS: Array<{
  value: `${OutstandingSortKey}-${SortDirection}`;
  label: string;
}> = [
  { value: "amount-desc", label: "เรียงตามยอดหนี้สูงสุด" },
  { value: "amount-asc", label: "เรียงตามยอดหนี้ต่ำสุด" },
  { value: "oldest_date-asc", label: "เรียงตามบิลเก่าสุด" },
  { value: "oldest_date-desc", label: "เรียงตามบิลใหม่สุด" },
  { value: "name-asc", label: "เรียงตามชื่อลูกค้า (ก–ฮ)" },
  { value: "name-desc", label: "เรียงตามชื่อลูกค้า (ฮ–ก)" },
];

function parseSortPreset(
  value: string,
): OutstandingSortConfig {
  const [key, direction] = value.split("-") as [
    OutstandingSortKey,
    SortDirection,
  ];
  if (
    (key === "name" || key === "amount" || key === "oldest_date") &&
    (direction === "asc" || direction === "desc")
  ) {
    return { key, direction };
  }
  return DEFAULT_SORT;
}

function defaultDirectionForKey(key: OutstandingSortKey): SortDirection {
  if (key === "amount") return "desc";
  return "asc";
}

function compareDebtors(
  a: DebtorOption,
  b: DebtorOption,
  config: OutstandingSortConfig,
): number {
  const dir = config.direction === "asc" ? 1 : -1;

  if (config.key === "name") {
    return (
      a.name.localeCompare(b.name, "th", { sensitivity: "base" }) * dir
    );
  }

  if (config.key === "amount") {
    const diff = a.outstanding_total - b.outstanding_total;
    if (diff !== 0) return diff * dir;
    return a.name.localeCompare(b.name, "th", { sensitivity: "base" });
  }

  const aDate = a.oldest_invoice_date?.trim() ?? "";
  const bDate = b.oldest_invoice_date?.trim() ?? "";
  if (!aDate && !bDate) {
    return a.name.localeCompare(b.name, "th", { sensitivity: "base" });
  }
  if (!aDate) return 1;
  if (!bDate) return -1;
  const dateDiff = aDate.localeCompare(bDate);
  if (dateDiff !== 0) return dateDiff * dir;
  return a.name.localeCompare(b.name, "th", { sensitivity: "base" });
}

function SortArrow({
  active,
  direction,
}: {
  active: boolean;
  direction: SortDirection;
}) {
  if (!active) {
    return <ArrowUpDown className="h-3.5 w-3.5 text-slate-300" />;
  }
  return direction === "asc" ? (
    <ArrowUp className="h-3.5 w-3.5 text-blue-600" />
  ) : (
    <ArrowDown className="h-3.5 w-3.5 text-blue-600" />
  );
}

export function ARPaymentClient({
  debtors,
  invoices,
  availableDeposits,
  bankAccounts,
  selectedContactId,
  billingNotes = [],
}: ARPaymentClientProps) {
  const router = useRouter();
  const [sortConfig, setSortConfig] =
    useState<OutstandingSortConfig>(DEFAULT_SORT);

  const summaryGrandTotal = useMemo(
    () => debtors.reduce((sum, row) => sum + row.outstanding_total, 0),
    [debtors],
  );

  const sortedDebtors = useMemo(
    () =>
      [...debtors].sort((a, b) => compareDebtors(a, b, sortConfig)),
    [debtors, sortConfig],
  );

  function handleSort(key: OutstandingSortKey) {
    setSortConfig((prev) =>
      prev.key === key
        ? { key, direction: prev.direction === "asc" ? "desc" : "asc" }
        : { key, direction: defaultDirectionForKey(key) },
    );
  }

  function handleCustomerChange(contactId: string) {
    if (!contactId) {
      router.push("/finance/payments");
      return;
    }
    router.push(
      `/finance/payments?contact_id=${encodeURIComponent(contactId)}`,
    );
  }

  const selectedDebtor =
    debtors.find((d) => d.id === selectedContactId) ?? null;

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-2">
        <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight text-slate-900">
          <Wallet className="h-8 w-8 text-blue-600" />
          รับชำระเงินและตัดยอดหนี้
        </h1>
        <p className="text-slate-500">
          เลือกลูกค้าที่มียอดค้าง เพื่อทำรายการตัดยอด (Knock-off)
          หรือบันทึกภาษีหัก ณ ที่จ่าย
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>1. เลือกลูกค้า (Smart Combobox)</CardTitle>
          <CardDescription>
            แสดงเฉพาะลูกหนี้ที่ยอดค้าง &gt; 0 · ผูกสถานะกับ URL (`?contact_id=`)
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="max-w-xl space-y-2">
            <Label>ลูกหนี้ที่มียอดค้างชำระ</Label>
            <OutstandingPartyCombobox
              options={debtors}
              value={selectedContactId}
              onChange={handleCustomerChange}
              accent="blue"
              placeholder="ค้นหาลูกค้าที่มียอดค้างชำระ..."
              searchPlaceholder="พิมพ์ชื่อลูกค้า..."
              emptyMessage="ไม่มีลูกหนี้ค้างชำระในขณะนี้"
            />
          </div>
        </CardContent>
      </Card>

      {!selectedContactId ? (
        <Card className="border-blue-200 shadow-sm">
          <CardHeader className="bg-blue-50/50">
            <CardTitle className="flex items-center gap-2">
              <Wallet className="h-5 w-5 text-blue-600" />
              ตารางสรุปยอดหนี้รายตัว (Outstanding Summary)
            </CardTitle>
            <CardDescription>
              รวมยอดค้างทั้งหมด{" "}
              <strong className="text-blue-800">
                ฿{formatMoney(summaryGrandTotal)}
              </strong>{" "}
              จาก {debtors.length} ราย
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-6">
            {debtors.length === 0 ? (
              <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 py-10 text-center text-slate-500">
                ไม่มีข้อมูลลูกหนี้ค้างชำระในระบบ
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <Label
                    htmlFor="outstanding-sort-preset"
                    className="text-xs font-medium text-slate-500"
                  >
                    เรียงลำดับด่วน
                  </Label>
                  <select
                    id="outstanding-sort-preset"
                    className="h-9 min-w-[220px] rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                    value={`${sortConfig.key}-${sortConfig.direction}`}
                    onChange={(e) =>
                      setSortConfig(parseSortPreset(e.target.value))
                    }
                  >
                    {SORT_PRESETS.map((preset) => (
                      <option key={preset.value} value={preset.value}>
                        {preset.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="overflow-hidden rounded-md border border-slate-200">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-slate-50">
                        <TableHead
                          aria-sort={
                            sortConfig.key === "name"
                              ? sortConfig.direction === "asc"
                                ? "ascending"
                                : "descending"
                              : "none"
                          }
                        >
                          <button
                            type="button"
                            className={cn(
                              "inline-flex items-center gap-1.5 font-semibold uppercase tracking-wide",
                              sortConfig.key === "name"
                                ? "text-blue-700"
                                : "text-slate-400 hover:text-slate-600",
                            )}
                            onClick={() => handleSort("name")}
                          >
                            ชื่อลูกค้า
                            <SortArrow
                              active={sortConfig.key === "name"}
                              direction={sortConfig.direction}
                            />
                          </button>
                        </TableHead>
                        <TableHead className="text-center">จำนวนบิลค้าง</TableHead>
                        <TableHead
                          className="text-right"
                          aria-sort={
                            sortConfig.key === "amount"
                              ? sortConfig.direction === "asc"
                                ? "ascending"
                                : "descending"
                              : "none"
                          }
                        >
                          <button
                            type="button"
                            className={cn(
                              "ml-auto inline-flex items-center gap-1.5 font-semibold uppercase tracking-wide",
                              sortConfig.key === "amount"
                                ? "text-blue-700"
                                : "text-slate-400 hover:text-slate-600",
                            )}
                            onClick={() => handleSort("amount")}
                          >
                            ยอดหนี้รวม
                            <SortArrow
                              active={sortConfig.key === "amount"}
                              direction={sortConfig.direction}
                            />
                          </button>
                        </TableHead>
                        <TableHead className="text-right">
                          ยอดเกินกำหนด
                        </TableHead>
                        <TableHead
                          aria-sort={
                            sortConfig.key === "oldest_date"
                              ? sortConfig.direction === "asc"
                                ? "ascending"
                                : "descending"
                              : "none"
                          }
                        >
                          <button
                            type="button"
                            className={cn(
                              "inline-flex items-center gap-1.5 font-semibold uppercase tracking-wide",
                              sortConfig.key === "oldest_date"
                                ? "text-blue-700"
                                : "text-slate-400 hover:text-slate-600",
                            )}
                            onClick={() => handleSort("oldest_date")}
                          >
                            บิลเก่าสุด
                            <SortArrow
                              active={sortConfig.key === "oldest_date"}
                              direction={sortConfig.direction}
                            />
                          </button>
                        </TableHead>
                        <TableHead className="text-center">จัดการ</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sortedDebtors.map((debtor) => (
                        <TableRow key={debtor.id}>
                          <TableCell className="font-medium text-slate-900">
                            {debtor.name}
                          </TableCell>
                          <TableCell className="text-center">
                            <Badge variant="slate">{debtor.invoice_count} บิล</Badge>
                          </TableCell>
                          <TableCell className="text-right font-bold text-red-600">
                            {formatMoney(debtor.outstanding_total)}
                          </TableCell>
                          <TableCell
                            className={
                              debtor.overdue_amount > 0
                                ? "text-right font-semibold text-red-600"
                                : "text-right text-slate-400"
                            }
                          >
                            {formatMoney(debtor.overdue_amount)}
                          </TableCell>
                          <TableCell className="text-slate-600">
                            {debtor.oldest_invoice_date
                              ? formatThaiDate(
                                  debtor.oldest_invoice_date,
                                  "short",
                                )
                              : "—"}
                          </TableCell>
                          <TableCell className="text-center">
                            <Button
                              type="button"
                              size="sm"
                              className="gap-1.5"
                              onClick={() => handleCustomerChange(debtor.id)}
                            >
                              รับชำระเงิน
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card className="border-blue-200 shadow-sm">
          <CardHeader className="bg-blue-50/50">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <CardTitle>2. รายการบิลค้างชำระ (Knock-off)</CardTitle>
                <CardDescription>
                  {selectedDebtor
                    ? `ลูกค้า: ${selectedDebtor.name} · ตรวจสอบยอดแล้วตัดชำระด้านล่าง`
                    : "กรุณาตรวจสอบยอดหนี้ และทำการตัดชำระด้านล่าง"}
                </CardDescription>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => handleCustomerChange("")}
              >
                <ArrowLeft className="h-4 w-4" />
                กลับไปสรุป
              </Button>
            </div>
          </CardHeader>
          <CardContent className="pt-6">
            {invoices.length === 0 ? (
              <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 py-10 text-center text-slate-500">
                ไม่พบบิลค้างชำระสำหรับลูกค้ารายนี้
              </div>
            ) : (
              <>
                <div className="mb-6 overflow-hidden rounded-md border border-slate-200">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-slate-50">
                        <TableHead>เลขที่เอกสาร</TableHead>
                        <TableHead>วันที่</TableHead>
                        <TableHead className="text-right">มูลค่าบิลเต็ม</TableHead>
                        <TableHead className="text-right">ยอดค้างสุทธิ</TableHead>
                        <TableHead className="text-center">สถานะ</TableHead>
                        <TableHead className="text-center">ดูบิล</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {invoices.map((inv) => (
                        <TableRow key={inv.id}>
                          <TableCell>
                            <a
                              href={salesDocumentHref(inv.display_doc_no)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-medium text-blue-700 underline-offset-2 hover:underline"
                            >
                              {inv.display_doc_no}
                            </a>
                          </TableCell>
                          <TableCell>
                            {inv.document_date
                              ? formatThaiDate(inv.document_date, "short")
                              : "—"}
                          </TableCell>
                          <TableCell className="text-right text-slate-500">
                            {formatMoney(inv.net_amount_calc)}
                          </TableCell>
                          <TableCell className="text-right font-bold text-red-600">
                            {formatMoney(inv.remaining_balance)}
                          </TableCell>
                          <TableCell className="text-center">
                            <Badge variant="amber">{inv.payment_status}</Badge>
                          </TableCell>
                          <TableCell className="text-center">
                            <a
                              href={salesDocumentHref(inv.display_doc_no)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex h-8 items-center justify-center gap-1 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                            >
                              <Eye className="h-3.5 w-3.5" />
                              ดูบิล
                            </a>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                <PaymentKnockoffForm
                  key={[
                    ...invoices.map((inv) => inv.id),
                    ...availableDeposits.map((d) => d.id),
                    ...billingNotes.map((n) => n.id),
                  ].join("|")}
                  invoices={invoices}
                  availableDeposits={availableDeposits}
                  bankAccounts={bankAccounts}
                  contactId={selectedContactId}
                  billingNotes={billingNotes}
                />
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
