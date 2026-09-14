"use client";

/**
 * AR Write-off form — client island for remark + per-invoice amounts.
 * Data is server-fetched; persist via `createWriteOff`.
 */

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { getInvoicesByBillingNote } from "@/app/actions/billing";
import { createWriteOff } from "@/lib/actions/finance/create-writeoff";
import { PENDING_APPROVAL_TOAST_MESSAGE } from "@/lib/approval/approval-rules";
import { isArWriteoffSourceDocType } from "@/lib/constants/document";
import { formatThaiDate } from "@/lib/utils/date-formatter";
import { roundMoney } from "@/lib/utils/payment-fifo";
import {
  WRITEOFF_AMOUNT_RANGE_MESSAGE,
  arWriteoffFormSchema,
} from "@/lib/validations/ar-writeoff";
import type { OpenBillingNoteOption } from "@/types/billing";
import type { DebtorOption, UnpaidInvoice } from "@/types/payment";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertCircle,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ArrowUpDown,
  Eye,
  FileMinus2,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type ArWriteoffFormProps = {
  debtors: DebtorOption[];
  invoices: UnpaidInvoice[];
  selectedContactId: string;
  billingNotes?: OpenBillingNoteOption[];
};

function formatMoney(value: number): string {
  return value.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function emptyAmounts(invoices: UnpaidInvoice[]): Record<string, string> {
  return Object.fromEntries(invoices.map((inv) => [inv.id, ""]));
}

function parseAmount(raw: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return roundMoney(n);
}

type InvoiceSortKey = "doc_no" | "doc_date" | "remaining_amount";
type SortDirection = "asc" | "desc";
type InvoiceSortConfig = {
  key: InvoiceSortKey;
  direction: SortDirection;
};

const DEFAULT_SORT: InvoiceSortConfig = {
  key: "doc_date",
  direction: "asc",
};

const SORT_PRESETS: Array<{
  value: `${InvoiceSortKey}-${SortDirection}`;
  label: string;
}> = [
  { value: "doc_date-asc", label: "เรียงตามบิลเก่าสุด" },
  { value: "remaining_amount-desc", label: "เรียงตามยอดคงเหลือสูงสุด" },
  { value: "doc_no-asc", label: "เรียงตามเลขที่เอกสาร" },
];

function parseSortPreset(value: string): InvoiceSortConfig {
  const [key, direction] = value.split("-") as [InvoiceSortKey, SortDirection];
  if (
    (key === "doc_no" || key === "doc_date" || key === "remaining_amount") &&
    (direction === "asc" || direction === "desc")
  ) {
    return { key, direction };
  }
  return DEFAULT_SORT;
}

function defaultDirectionForKey(key: InvoiceSortKey): SortDirection {
  if (key === "remaining_amount") return "desc";
  return "asc";
}

function compareInvoices(
  a: UnpaidInvoice,
  b: UnpaidInvoice,
  config: InvoiceSortConfig,
): number {
  const dir = config.direction === "asc" ? 1 : -1;

  if (config.key === "doc_no") {
    const cmp = a.display_doc_no.localeCompare(b.display_doc_no, "th", {
      numeric: true,
      sensitivity: "base",
    });
    if (cmp !== 0) return cmp * dir;
  } else if (config.key === "remaining_amount") {
    const diff = a.remaining_balance - b.remaining_balance;
    if (diff !== 0) return diff * dir;
  } else {
    const aDate = a.document_date?.trim() ?? "";
    const bDate = b.document_date?.trim() ?? "";
    if (!aDate && !bDate) {
      return a.display_doc_no.localeCompare(b.display_doc_no, "th", {
        numeric: true,
        sensitivity: "base",
      });
    }
    if (!aDate) return 1;
    if (!bDate) return -1;
    const dateDiff = aDate.localeCompare(bDate);
    if (dateDiff !== 0) return dateDiff * dir;
  }

  return a.display_doc_no.localeCompare(b.display_doc_no, "th", {
    numeric: true,
    sensitivity: "base",
  });
}

type OutstandingSortKey = "name" | "amount" | "oldest_date";
type OutstandingSortConfig = {
  key: OutstandingSortKey;
  direction: SortDirection;
};

const DEFAULT_OUTSTANDING_SORT: OutstandingSortConfig = {
  key: "amount",
  direction: "desc",
};

const OUTSTANDING_SORT_PRESETS: Array<{
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

function parseOutstandingSortPreset(value: string): OutstandingSortConfig {
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
  return DEFAULT_OUTSTANDING_SORT;
}

function defaultOutstandingDirectionForKey(
  key: OutstandingSortKey,
): SortDirection {
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
    return a.name.localeCompare(b.name, "th", { sensitivity: "base" }) * dir;
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

export function ArWriteoffForm({
  debtors,
  invoices: initialInvoices,
  selectedContactId,
  billingNotes = [],
}: ArWriteoffFormProps) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingBn, setIsLoadingBn] = useState(false);
  const [remark, setRemark] = useState("");
  const [selectedBillingNoteId, setSelectedBillingNoteId] = useState("");
  const [invoices, setInvoices] = useState<UnpaidInvoice[]>(initialInvoices);
  const [amounts, setAmounts] = useState<Record<string, string>>(() =>
    emptyAmounts(initialInvoices),
  );
  const [sortConfig, setSortConfig] =
    useState<InvoiceSortConfig>(DEFAULT_SORT);
  const [outstandingSortConfig, setOutstandingSortConfig] =
    useState<OutstandingSortConfig>(DEFAULT_OUTSTANDING_SORT);

  useEffect(() => {
    setInvoices(initialInvoices);
    setAmounts(emptyAmounts(initialInvoices));
    setSelectedBillingNoteId("");
    setRemark("");
  }, [initialInvoices, selectedContactId]);

  function handleCustomerChange(contactId: string) {
    if (!contactId) {
      router.push("/finance/ar-writeoff");
      return;
    }
    router.push(
      `/finance/ar-writeoff?contact_id=${encodeURIComponent(contactId)}`,
    );
  }

  function applyInvoiceList(nextInvoices: UnpaidInvoice[]) {
    const filtered = nextInvoices.filter((inv) =>
      isArWriteoffSourceDocType(inv.doc_type),
    );
    setInvoices(filtered);
    setAmounts(emptyAmounts(filtered));
  }

  async function handleBillingNoteChange(noteId: string) {
    setSelectedBillingNoteId(noteId);
    if (!noteId) {
      applyInvoiceList(initialInvoices);
      return;
    }

    setIsLoadingBn(true);
    try {
      const result = await getInvoicesByBillingNote(noteId);
      if (result.error) {
        toast.error(result.error);
        setSelectedBillingNoteId("");
        applyInvoiceList(initialInvoices);
        return;
      }

      const mapped: UnpaidInvoice[] = result.data
        .filter((row) => isArWriteoffSourceDocType(row.doc_type))
        .map((row) => ({
          id: row.id,
          display_doc_no: row.doc_no,
          document_date: row.doc_date,
          doc_type: row.doc_type,
          payment_status: row.payment_status,
          net_amount_calc: row.grand_total,
          paid_amount: row.paid_amount,
          remaining_balance: row.outstanding,
          contact_id: row.contact_id || selectedContactId,
        }));

      if (mapped.length === 0) {
        toast.message("ใบวางบิลนี้ไม่มีบิลค้างชำระที่ตัดหนี้สูญได้");
      } else {
        toast.success(`โหลด ${mapped.length} บิลจากใบวางบิลแล้ว`);
      }
      applyInvoiceList(mapped);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "โหลดบิลจากใบวางบิลไม่สำเร็จ";
      toast.error(message);
      setSelectedBillingNoteId("");
      applyInvoiceList(initialInvoices);
    } finally {
      setIsLoadingBn(false);
    }
  }

  const selectedDebtor =
    debtors.find((d) => d.id === selectedContactId) ?? null;
  const remarkTrimmed = remark.trim();

  const summaryGrandTotal = useMemo(
    () => debtors.reduce((sum, row) => sum + row.outstanding_total, 0),
    [debtors],
  );

  const sortedDebtors = useMemo(
    () =>
      [...debtors].sort((a, b) =>
        compareDebtors(a, b, outstandingSortConfig),
      ),
    [debtors, outstandingSortConfig],
  );

  const sortedInvoices = useMemo(
    () => [...invoices].sort((a, b) => compareInvoices(a, b, sortConfig)),
    [invoices, sortConfig],
  );

  function handleOutstandingSort(key: OutstandingSortKey) {
    setOutstandingSortConfig((prev) =>
      prev.key === key
        ? { key, direction: prev.direction === "asc" ? "desc" : "asc" }
        : { key, direction: defaultOutstandingDirectionForKey(key) },
    );
  }

  function handleSort(key: InvoiceSortKey) {
    setSortConfig((prev) =>
      prev.key === key
        ? { key, direction: prev.direction === "asc" ? "desc" : "asc" }
        : { key, direction: defaultDirectionForKey(key) },
    );
  }

  const lineErrors = useMemo(() => {
    const errors: Record<string, string> = {};
    for (const inv of invoices) {
      const amount = parseAmount(amounts[inv.id] ?? "");
      if (amount <= 0) continue;
      if (amount > roundMoney(inv.remaining_balance) + 0.02) {
        errors[inv.id] = WRITEOFF_AMOUNT_RANGE_MESSAGE;
      }
    }
    return errors;
  }, [amounts, invoices]);

  const allocatedItems = useMemo(
    () =>
      invoices
        .map((inv) => ({
          document_id: inv.id,
          writeoff_amount: parseAmount(amounts[inv.id] ?? ""),
        }))
        .filter((row) => row.writeoff_amount > 0),
    [amounts, invoices],
  );

  const totalWriteoff = useMemo(
    () =>
      roundMoney(
        allocatedItems.reduce((sum, row) => sum + row.writeoff_amount, 0),
      ),
    [allocatedItems],
  );

  const formParsed = selectedContactId
    ? arWriteoffFormSchema.safeParse({
        contact_id: selectedContactId,
        remark: remarkTrimmed,
        lines: invoices.map((inv) => ({
          document_id: inv.id,
          remaining_balance: inv.remaining_balance,
          writeoff_amount: parseAmount(amounts[inv.id] ?? ""),
        })),
      })
    : { success: false as const };

  const canSubmit =
    Boolean(selectedContactId) &&
    remarkTrimmed.length > 0 &&
    allocatedItems.length > 0 &&
    Object.keys(lineErrors).length === 0 &&
    formParsed.success &&
    !isSubmitting &&
    !isLoadingBn;

  async function handleSubmit() {
    if (isSubmitting || !canSubmit) return;
    setIsSubmitting(true);
    try {
      const result = await createWriteOff({
        contact_id: selectedContactId,
        remark: remarkTrimmed,
        allocated_items: allocatedItems,
      });
      if (!result.success) {
        toast.error(result.error ?? "บันทึกตัดหนี้สูญไม่สำเร็จ");
        return;
      }

      const docNo = result.document_no ?? "";
      toast.success(
        result.pending_approval
          ? PENDING_APPROVAL_TOAST_MESSAGE
          : `บันทึกตัดหนี้สูญสำเร็จ${docNo ? ` · ${docNo}` : ""}`,
      );
      router.push("/sales");
      router.refresh();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "บันทึกตัดหนี้สูญไม่สำเร็จ",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {!selectedContactId ? (
        <Card className="border-blue-200 shadow-sm">
          <CardHeader className="bg-blue-50/50">
            <CardTitle className="flex items-center gap-2">
              <FileMinus2 className="h-5 w-5 text-blue-600" />
              1. เลือกผู้ติดต่อ — ตารางสรุปยอดหนี้รายตัว
            </CardTitle>
            <CardDescription>
              จัดกลุ่มบิลค้างชำระ (INV_DO / TAX_INV / CS_TAX) ตามลูกค้า · ใบวางบิล
              (BN) ใช้กรองรายการหลังเลือก · รวมยอดค้าง{" "}
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
                    htmlFor="writeoff-outstanding-sort"
                    className="text-xs font-medium text-slate-500"
                  >
                    เรียงลำดับด่วน
                  </Label>
                  <select
                    id="writeoff-outstanding-sort"
                    className="h-9 min-w-[220px] rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                    value={`${outstandingSortConfig.key}-${outstandingSortConfig.direction}`}
                    onChange={(e) =>
                      setOutstandingSortConfig(
                        parseOutstandingSortPreset(e.target.value),
                      )
                    }
                  >
                    {OUTSTANDING_SORT_PRESETS.map((preset) => (
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
                            outstandingSortConfig.key === "name"
                              ? outstandingSortConfig.direction === "asc"
                                ? "ascending"
                                : "descending"
                              : "none"
                          }
                        >
                          <button
                            type="button"
                            className={cn(
                              "inline-flex items-center gap-1.5 font-semibold uppercase tracking-wide",
                              outstandingSortConfig.key === "name"
                                ? "text-blue-700"
                                : "text-slate-400 hover:text-slate-600",
                            )}
                            onClick={() => handleOutstandingSort("name")}
                          >
                            ชื่อลูกค้า
                            <SortArrow
                              active={outstandingSortConfig.key === "name"}
                              direction={outstandingSortConfig.direction}
                            />
                          </button>
                        </TableHead>
                        <TableHead className="text-center">
                          จำนวนบิลค้าง
                        </TableHead>
                        <TableHead
                          className="text-right"
                          aria-sort={
                            outstandingSortConfig.key === "amount"
                              ? outstandingSortConfig.direction === "asc"
                                ? "ascending"
                                : "descending"
                              : "none"
                          }
                        >
                          <button
                            type="button"
                            className={cn(
                              "ml-auto inline-flex items-center gap-1.5 font-semibold uppercase tracking-wide",
                              outstandingSortConfig.key === "amount"
                                ? "text-blue-700"
                                : "text-slate-400 hover:text-slate-600",
                            )}
                            onClick={() => handleOutstandingSort("amount")}
                          >
                            ยอดหนี้รวม
                            <SortArrow
                              active={outstandingSortConfig.key === "amount"}
                              direction={outstandingSortConfig.direction}
                            />
                          </button>
                        </TableHead>
                        <TableHead
                          aria-sort={
                            outstandingSortConfig.key === "oldest_date"
                              ? outstandingSortConfig.direction === "asc"
                                ? "ascending"
                                : "descending"
                              : "none"
                          }
                        >
                          <button
                            type="button"
                            className={cn(
                              "inline-flex items-center gap-1.5 font-semibold uppercase tracking-wide",
                              outstandingSortConfig.key === "oldest_date"
                                ? "text-blue-700"
                                : "text-slate-400 hover:text-slate-600",
                            )}
                            onClick={() => handleOutstandingSort("oldest_date")}
                          >
                            บิลเก่าสุด
                            <SortArrow
                              active={
                                outstandingSortConfig.key === "oldest_date"
                              }
                              direction={outstandingSortConfig.direction}
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
                            <Badge variant="slate">
                              {debtor.invoice_count} บิล
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right font-bold text-red-600">
                            {formatMoney(debtor.outstanding_total)}
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
                              เลือก
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
        <>
          <Card className="border-blue-200 shadow-sm">
            <CardHeader className="bg-blue-50/50">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <CardTitle>1. ผู้ติดต่อที่กำลังตัดหนี้</CardTitle>
                  <CardDescription>
                    เลือกแล้วผ่าน URL (`?contact_id=`) · กดกลับไปหน้าสรุปเพื่อเปลี่ยนลูกค้า
                  </CardDescription>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  disabled={isSubmitting}
                  onClick={() => handleCustomerChange("")}
                >
                  <ArrowLeft className="h-4 w-4" />
                  เปลี่ยนลูกค้า / กลับไปหน้าสรุป
                </Button>
              </div>
            </CardHeader>
            <CardContent className="pt-6">
              <div className="rounded-xl border border-slate-200 bg-slate-50/80 px-4 py-3">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  ลูกหนี้
                </p>
                <p className="mt-1 text-lg font-semibold text-slate-900">
                  {selectedDebtor?.name ?? "ลูกค้าที่เลือก"}
                </p>
                {selectedDebtor ? (
                  <p className="mt-1 text-sm text-slate-600">
                    {selectedDebtor.invoice_count} บิลค้าง · ยอดหนี้รวม{" "}
                    <span className="font-semibold text-red-600">
                      ฿{formatMoney(selectedDebtor.outstanding_total)}
                    </span>
                    {selectedDebtor.oldest_invoice_date
                      ? ` · บิลเก่าสุด ${formatThaiDate(selectedDebtor.oldest_invoice_date, "short")}`
                      : ""}
                  </p>
                ) : null}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>2. เหตุผลการตัดหนี้ (Remark)</CardTitle>
              <CardDescription>
                บังคับกรอกตามมาตรฐานบัญชี — หากว่าง ปุ่มบันทึกจะถูกปิด
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <Label htmlFor="writeoff-remark">
                เหตุผลการตัดหนี้ <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="writeoff-remark"
                value={remark}
                disabled={isSubmitting}
                placeholder="ระบุเหตุผล เช่น ลูกหนี้ปิดกิจการ / ยอดเศษที่เรียกเก็บไม่ได้"
                onChange={(e) => setRemark(e.target.value)}
              />
              {remarkTrimmed.length === 0 ? (
                <p className="text-xs text-destructive">
                  กรุณาระบุเหตุผลการตัดหนี้สูญ
                </p>
              ) : null}
            </CardContent>
          </Card>

          <Card className="border-blue-200 shadow-sm">
            <CardHeader className="bg-blue-50/50">
              <div className="space-y-1">
                <CardTitle>3. เอกสารค้างชำระ (Outstanding Invoices)</CardTitle>
                <CardDescription>
                  {selectedDebtor
                    ? `ลูกค้า: ${selectedDebtor.name} · กรอกยอดที่ต้องการตัดหนี้ในแต่ละบิล`
                    : "กรอกยอดที่ต้องการตัดหนี้ในแต่ละบิล"}
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-4 pt-6">
              {billingNotes.length > 0 ? (
                <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50/80 p-4">
                  <Label htmlFor="writeoff-billing-note">
                    ใบวางบิล (BN) — กรองบิลในใบวางบิล
                  </Label>
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      id="writeoff-billing-note"
                      className="h-10 min-w-[280px] flex-1 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                      value={selectedBillingNoteId}
                      disabled={isLoadingBn || isSubmitting}
                      onChange={(e) => void handleBillingNoteChange(e.target.value)}
                    >
                      <option value="">
                        — ใช้บิลค้างชำระทั้งหมดของลูกค้า —
                      </option>
                      {billingNotes.map((note) => (
                        <option key={note.id} value={note.id}>
                          {note.doc_no} · {note.invoice_count} บิล · ฿
                          {formatMoney(note.grand_total)} ({note.payment_status})
                        </option>
                      ))}
                    </select>
                    {isLoadingBn ? (
                      <Loader2 className="size-4 animate-spin text-blue-600" />
                    ) : null}
                  </div>
                </div>
              ) : null}

              {invoices.length === 0 ? (
                <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 py-10 text-center text-slate-500">
                  ไม่พบบิลค้างชำระสำหรับลูกค้ารายนี้
                </div>
              ) : (
                <>
                  {Object.keys(lineErrors).length > 0 ? (
                    <Alert variant="destructive">
                      <AlertCircle className="h-4 w-4" />
                      <AlertTitle>ยอดตัดหนี้ไม่ถูกต้อง</AlertTitle>
                      <AlertDescription>
                        {WRITEOFF_AMOUNT_RANGE_MESSAGE}
                      </AlertDescription>
                    </Alert>
                  ) : null}

                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <Label
                      htmlFor="writeoff-invoice-sort"
                      className="text-xs font-medium text-slate-500"
                    >
                      เรียงลำดับด่วน
                    </Label>
                    <select
                      id="writeoff-invoice-sort"
                      className="h-9 min-w-[220px] rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                      value={`${sortConfig.key}-${sortConfig.direction}`}
                      disabled={isSubmitting}
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
                              sortConfig.key === "doc_no"
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
                                sortConfig.key === "doc_no"
                                  ? "text-blue-700"
                                  : "text-slate-400 hover:text-slate-600",
                              )}
                              onClick={() => handleSort("doc_no")}
                            >
                              เลขที่เอกสาร
                              <SortArrow
                                active={sortConfig.key === "doc_no"}
                                direction={sortConfig.direction}
                              />
                            </button>
                          </TableHead>
                          <TableHead
                            aria-sort={
                              sortConfig.key === "doc_date"
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
                                sortConfig.key === "doc_date"
                                  ? "text-blue-700"
                                  : "text-slate-400 hover:text-slate-600",
                              )}
                              onClick={() => handleSort("doc_date")}
                            >
                              วันที่
                              <SortArrow
                                active={sortConfig.key === "doc_date"}
                                direction={sortConfig.direction}
                              />
                            </button>
                          </TableHead>
                          <TableHead className="text-right">มูลค่าบิล</TableHead>
                          <TableHead
                            className="text-right"
                            aria-sort={
                              sortConfig.key === "remaining_amount"
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
                                sortConfig.key === "remaining_amount"
                                  ? "text-blue-700"
                                  : "text-slate-400 hover:text-slate-600",
                              )}
                              onClick={() => handleSort("remaining_amount")}
                            >
                              ยอดคงเหลือ
                              <SortArrow
                                active={sortConfig.key === "remaining_amount"}
                                direction={sortConfig.direction}
                              />
                            </button>
                          </TableHead>
                          <TableHead className="text-right">
                            ยอดที่ต้องการตัดหนี้
                          </TableHead>
                          <TableHead className="text-center">ดูบิล</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {sortedInvoices.map((inv) => {
                          const raw = amounts[inv.id] ?? "";
                          const amount = parseAmount(raw);
                          const hasError = Boolean(lineErrors[inv.id]);
                          const docHref = `/sales/${encodeURIComponent(inv.display_doc_no)}`;
                          return (
                            <TableRow
                              key={inv.id}
                              className={
                                hasError
                                  ? "bg-red-50/40"
                                  : amount > 0
                                    ? "bg-blue-50/40"
                                    : undefined
                              }
                            >
                              <TableCell>
                                <div className="flex flex-wrap items-center gap-2">
                                  <a
                                    href={docHref}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="font-medium text-blue-700 underline-offset-2 hover:underline"
                                  >
                                    {inv.display_doc_no}
                                  </a>
                                  <Badge variant="slate">{inv.doc_type}</Badge>
                                </div>
                              </TableCell>
                              <TableCell>
                                {inv.document_date
                                  ? formatThaiDate(inv.document_date, "short")
                                  : "—"}
                              </TableCell>
                              <TableCell className="text-right text-slate-500">
                                {formatMoney(inv.net_amount_calc)}
                              </TableCell>
                              <TableCell className="text-right font-semibold text-red-600">
                                {formatMoney(inv.remaining_balance)}
                              </TableCell>
                              <TableCell className="text-right">
                                <Input
                                  type="number"
                                  inputMode="decimal"
                                  step="0.01"
                                  min="0"
                                  max={inv.remaining_balance}
                                  disabled={isSubmitting}
                                  className="ml-auto h-9 w-36 text-right"
                                  value={raw}
                                  placeholder="0.00"
                                  aria-invalid={hasError}
                                  onChange={(e) =>
                                    setAmounts((prev) => ({
                                      ...prev,
                                      [inv.id]: e.target.value,
                                    }))
                                  }
                                />
                                {hasError ? (
                                  <p className="mt-1 text-xs text-destructive">
                                    ไม่เกิน {formatMoney(inv.remaining_balance)}
                                  </p>
                                ) : null}
                              </TableCell>
                              <TableCell className="text-center">
                                <a
                                  href={docHref}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex h-8 items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                                >
                                  <Eye className="h-3.5 w-3.5" />
                                  ดูบิล
                                </a>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                        <TableRow className="bg-slate-50/80">
                          <TableCell
                            colSpan={4}
                            className="text-right text-sm font-semibold text-slate-700"
                          >
                            ยอดรวมตัดหนี้ (Total Write-off Amount)
                          </TableCell>
                          <TableCell className="text-right text-sm font-bold tabular-nums text-blue-800">
                            {formatMoney(totalWriteoff)}
                          </TableCell>
                          <TableCell />
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>
                </>
              )}

              <div className="flex flex-wrap items-center justify-end gap-3">
                <Button
                  type="button"
                  className="gap-2"
                  disabled={!canSubmit}
                  onClick={() => void handleSubmit()}
                >
                  {isSubmitting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <FileMinus2 className="h-4 w-4" />
                  )}
                  {isSubmitting ? "กำลังบันทึก..." : "บันทึกตัดหนี้สูญ"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
