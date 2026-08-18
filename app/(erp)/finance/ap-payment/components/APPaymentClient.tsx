"use client";

/**
 * Phase 5 — AP Payment Client island.
 * Vendor selection → URL `?vendor_id=` (Server re-fetch).
 * Submit via Server Action `submitAPPayment` + FormData (Zero Client-Side Fetching).
 */

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { submitAPPayment } from "@/app/actions/finance/ap-actions";
import {
  getInvoicesByBillingNote,
  type OpenBillingNoteOption,
} from "@/app/actions/billing";
import type {
  ApVendorOption,
  AvailableDeposit,
  OutstandingApInvoice,
} from "@/types/ap-payment";
import type { BankAccount } from "@/types/bank-account";
import {
  checkedDepositIdsFromAmounts,
  redistributeCheckedDeposits,
} from "@/lib/utils/deposit-apply";
import { compressImage } from "@/lib/utils/image-compression";
import { OutstandingPartyCombobox } from "@/components/finance/OutstandingPartyCombobox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import {
  ArrowLeft,
  Banknote,
  CheckCircle2,
  Eye,
  FileUp,
  HandCoins,
  Loader2,
  Wallet,
} from "lucide-react";

export type APPaymentClientProps = {
  vendors: ApVendorOption[];
  invoices: OutstandingApInvoice[];
  availableDeposits: AvailableDeposit[];
  bankAccounts: BankAccount[];
  selectedVendorId: string;
  billingNotes?: OpenBillingNoteOption[];
};

function formatMoney(value: number): string {
  return value.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDate(value: string): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("th-TH");
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function todayIsoLocal(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function documentHistoryHref(documentNo: string): string {
  return `/purchases/${encodeURIComponent(documentNo)}`;
}

function formatDocLabel(documentNo: string, referenceNo: string | null): string {
  if (referenceNo && referenceNo !== documentNo) {
    return `${documentNo} (Ref: ${referenceNo})`;
  }
  return documentNo;
}

function docTypeBadgeLabel(docType: string): string {
  if (docType === "TB") return "TB · สรุปวางบิลช่าง";
  if (docType === "AP_TAX") return "AP_TAX";
  if (docType === "AP_INV") return "AP_INV";
  return docType || "—";
}

export function APPaymentClient({
  vendors,
  invoices: initialInvoices,
  availableDeposits,
  bankAccounts,
  selectedVendorId,
  billingNotes = [],
}: APPaymentClientProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isLoadingBn, setIsLoadingBn] = useState(false);
  const activeBanks = bankAccounts.filter((b) => b.is_active);

  const [selectedBillingNoteId, setSelectedBillingNoteId] = useState("");
  const [invoices, setInvoices] =
    useState<OutstandingApInvoice[]>(initialInvoices);

  const [paymentAmounts, setPaymentAmounts] = useState<Record<string, string>>(
    {},
  );
  const [depositAmounts, setDepositAmounts] = useState<Record<string, string>>(
    {},
  );
  const [paymentDate, setPaymentDate] = useState(todayIsoLocal);
  const [bankAccountId, setBankAccountId] = useState(
    activeBanks[0]?.id ?? "CASH",
  );
  const [referenceNo, setReferenceNo] = useState("");
  const [slipFile, setSlipFile] = useState<File | null>(null);

  useEffect(() => {
    setInvoices(initialInvoices);
    setSelectedBillingNoteId("");
    setPaymentAmounts({});
    setDepositAmounts({});
  }, [initialInvoices]);

  async function handleBillingNoteChange(noteId: string) {
    setSelectedBillingNoteId(noteId);
    setPaymentAmounts({});
    setDepositAmounts({});
    if (!noteId) {
      setInvoices(initialInvoices);
      return;
    }

    setIsLoadingBn(true);
    try {
      const result = await getInvoicesByBillingNote(noteId);
      if (result.error) {
        toast.error(result.error);
        setSelectedBillingNoteId("");
        setInvoices(initialInvoices);
        return;
      }

      const mapped: OutstandingApInvoice[] = result.data.map((row) => ({
        id: row.id,
        contact_id: row.contact_id || selectedVendorId,
        document_no: row.doc_no,
        reference_no: null,
        document_date: row.doc_date,
        grand_total: row.grand_total,
        paid_amount: row.paid_amount,
        remaining_balance: row.outstanding,
        payment_status: row.payment_status,
        doc_type: row.doc_type,
      }));

      if (mapped.length === 0) {
        toast.message("ใบรับวางบิลนี้ไม่มีบิลค้างชำระแล้ว");
      } else {
        toast.success(`โหลด ${mapped.length} บิลจากใบรับวางบิลแล้ว`);
      }
      setInvoices(mapped);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "โหลดบิลจากใบรับวางบิลไม่สำเร็จ";
      toast.error(message);
      setSelectedBillingNoteId("");
      setInvoices(initialInvoices);
    } finally {
      setIsLoadingBn(false);
    }
  }

  const totalInvoiceAmount = useMemo(() => {
    return roundMoney(
      invoices.reduce((sum, inv) => {
        const raw = paymentAmounts[inv.id] ?? "";
        const amount = Number(raw);
        if (!Number.isFinite(amount) || amount <= 0) return sum;
        return sum + amount;
      }, 0),
    );
  }, [invoices, paymentAmounts]);

  const depositTotal = useMemo(() => {
    return roundMoney(
      availableDeposits.reduce((sum, dep) => {
        const raw = depositAmounts[dep.id] ?? "";
        const amount = Number(raw);
        if (!Number.isFinite(amount) || amount <= 0) return sum;
        return sum + amount;
      }, 0),
    );
  }, [availableDeposits, depositAmounts]);

  /** Net cash to pay = invoices − deposits (never negative). */
  const totalPaymentAmount = roundMoney(
    Math.max(0, totalInvoiceAmount - depositTotal),
  );

  const allocationsJson = useMemo(
    () =>
      JSON.stringify(
        invoices.map((inv) => ({
          invoice_id: inv.id,
          allocated_amount: roundMoney(Number(paymentAmounts[inv.id] || 0)),
        })),
      ),
    [invoices, paymentAmounts],
  );

  const depositsJson = useMemo(
    () =>
      JSON.stringify(
        availableDeposits
          .map((dep) => ({
            deposit_id: dep.id,
            allocated_amount: roundMoney(Number(depositAmounts[dep.id] || 0)),
          }))
          .filter((row) => row.allocated_amount > 0),
      ),
    [availableDeposits, depositAmounts],
  );

  const summaryGrandTotal = useMemo(
    () =>
      roundMoney(vendors.reduce((sum, row) => sum + row.outstanding_total, 0)),
    [vendors],
  );

  function handleVendorChange(vendorId: string) {
    setPaymentAmounts({});
    setDepositAmounts({});
    setSlipFile(null);
    setReferenceNo("");
    if (!vendorId) {
      router.push("/finance/ap-payment");
      return;
    }
    router.push(
      `/finance/ap-payment?vendor_id=${encodeURIComponent(vendorId)}`,
    );
  }

  function syncDepositsToInvoiceTotal(
    invoiceTotal: number,
    checkedIds: string[],
  ): Record<string, string> {
    if (checkedIds.length === 0) return {};
    return redistributeCheckedDeposits(
      invoiceTotal,
      availableDeposits,
      checkedIds,
    );
  }

  function invoiceTotalFromAmounts(amounts: Record<string, string>): number {
    return roundMoney(
      invoices.reduce((sum, inv) => {
        const n = Number(amounts[inv.id] || 0);
        return Number.isFinite(n) && n > 0 ? sum + n : sum;
      }, 0),
    );
  }

  function handlePaymentAmountChange(invoiceId: string, raw: string) {
    const nextPayments = { ...paymentAmounts, [invoiceId]: raw };
    const invTotal = invoiceTotalFromAmounts(nextPayments);
    const checkedIds = checkedDepositIdsFromAmounts(depositAmounts);
    setPaymentAmounts(nextPayments);
    setDepositAmounts(syncDepositsToInvoiceTotal(invTotal, checkedIds));
  }

  function handleRowCheck(invoiceId: string, checked: boolean) {
    const invoice = invoices.find((inv) => inv.id === invoiceId);
    if (!invoice) return;
    const nextPayments = {
      ...paymentAmounts,
      [invoiceId]: checked
        ? String(roundMoney(invoice.remaining_balance))
        : "",
    };
    const invTotal = invoiceTotalFromAmounts(nextPayments);
    const checkedIds = checkedDepositIdsFromAmounts(depositAmounts);
    setPaymentAmounts(nextPayments);
    setDepositAmounts(syncDepositsToInvoiceTotal(invTotal, checkedIds));
  }

  function handleSelectAll(checked: boolean) {
    if (!checked) {
      setPaymentAmounts({});
      const checkedIds = checkedDepositIdsFromAmounts(depositAmounts);
      setDepositAmounts(syncDepositsToInvoiceTotal(0, checkedIds));
      return;
    }
    const next: Record<string, string> = {};
    for (const inv of invoices) {
      next[inv.id] = String(roundMoney(inv.remaining_balance));
    }
    setPaymentAmounts(next);
    const invTotal = invoiceTotalFromAmounts(next);
    const checkedIds = checkedDepositIdsFromAmounts(depositAmounts);
    setDepositAmounts(syncDepositsToInvoiceTotal(invTotal, checkedIds));
  }

  const selectedCount = useMemo(
    () =>
      invoices.filter((inv) => {
        const amount = Number(paymentAmounts[inv.id] || 0);
        return Number.isFinite(amount) && amount > 0;
      }).length,
    [invoices, paymentAmounts],
  );
  const allSelected =
    invoices.length > 0 && selectedCount === invoices.length;
  const someSelected = selectedCount > 0 && !allSelected;

  const selectedDepositCount = useMemo(
    () => checkedDepositIdsFromAmounts(depositAmounts).length,
    [depositAmounts],
  );
  const allDepositsSelected =
    availableDeposits.length > 0 &&
    selectedDepositCount === availableDeposits.length;
  const someDepositsSelected =
    selectedDepositCount > 0 && !allDepositsSelected;

  function handleDepositCheck(depositId: string, checked: boolean) {
    const deposit = availableDeposits.find((d) => d.id === depositId);
    if (!deposit) return;

    const prevChecked = checkedDepositIdsFromAmounts(depositAmounts);
    const nextChecked = checked
      ? Array.from(new Set([...prevChecked, depositId]))
      : prevChecked.filter((id) => id !== depositId);

    setDepositAmounts(
      syncDepositsToInvoiceTotal(totalInvoiceAmount, nextChecked),
    );
  }

  function handleDepositSelectAll(checked: boolean) {
    if (!checked) {
      setDepositAmounts({});
      return;
    }
    setDepositAmounts(
      redistributeCheckedDeposits(
        totalInvoiceAmount,
        availableDeposits,
        availableDeposits.map((d) => d.id),
      ),
    );
  }

  async function handleSlipChange(fileList: FileList | null) {
    const file = fileList?.[0] ?? null;
    if (!file) {
      setSlipFile(null);
      return;
    }
    const mime = (file.type || "").toLowerCase();
    const allowed =
      mime.startsWith("image/") || mime === "application/pdf" || !mime;
    if (!allowed) {
      toast.error("แนบได้เฉพาะไฟล์รูปภาพ หรือ PDF");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("ไฟล์สลิปใหญ่เกิน 10MB");
      return;
    }

    if (mime.startsWith("image/")) {
      try {
        const compressed = await compressImage(file);
        setSlipFile(compressed);
      } catch (err) {
        toast.error(
          err instanceof Error
            ? `บีบอัดสลิปไม่สำเร็จ: ${err.message}`
            : "บีบอัดสลิปไม่สำเร็จ",
        );
        setSlipFile(null);
      }
      return;
    }

    setSlipFile(file);
  }

  function handleSubmit(formData: FormData) {
    if (totalInvoiceAmount <= 0) {
      toast.error("ห้ามบันทึก — ผลรวมยอดตัดหนี้ต้องมากกว่า 0");
      return;
    }
    if (depositTotal > totalInvoiceAmount + 0.02) {
      toast.error("ยอดมัดจำที่ใช้เกินยอดตัดหนี้ของบิล");
      return;
    }

    if (slipFile) {
      formData.set("slip_file", slipFile);
    } else {
      formData.delete("slip_file");
    }

    startTransition(async () => {
      const result = await submitAPPayment(formData);
      if (!result.success) {
        toast.error(result.error ?? "บันทึกการจ่ายชำระไม่สำเร็จ");
        return;
      }
      toast.success(
        result.payment_doc_no
          ? `บันทึกจ่ายชำระสำเร็จ — ${result.payment_doc_no}`
          : "บันทึกจ่ายชำระสำเร็จ",
      );
      setPaymentAmounts({});
      setDepositAmounts({});
      setSlipFile(null);
      setReferenceNo("");
      router.refresh();
    });
  }

  const selectedVendor = vendors.find((v) => v.id === selectedVendorId) ?? null;

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-2">
        <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight text-slate-900">
          <Banknote className="h-8 w-8 text-orange-600" />
          จ่ายชำระหนี้ซัพพลายเออร์ (AP Payment)
        </h1>
        <p className="text-slate-500">
          เลือกผู้จำหน่ายหรือช่างรับเหมาที่มียอดค้าง เพื่อตัดยอดแบบ Knock-off
          (FIFO) — รองรับ AP_TAX / AP_INV / TB
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>1. เลือกเจ้าหนี้ (Smart Combobox)</CardTitle>
          <CardDescription>
            แสดงเฉพาะเจ้าหนี้ที่ยอดค้าง &gt; 0 (ซัพพลายเออร์ + ช่างรับเหมา) ·
            ผูกสถานะกับ URL (`?vendor_id=`)
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="max-w-xl space-y-2">
            <Label>เจ้าหนี้ / ซัพพลายเออร์</Label>
            <OutstandingPartyCombobox
              options={vendors}
              value={selectedVendorId}
              onChange={handleVendorChange}
              accent="orange"
              placeholder="ค้นหาเจ้าหนี้หรือช่างที่มียอดค้างชำระ..."
              searchPlaceholder="พิมพ์ชื่อผู้จำหน่าย / ช่าง..."
              emptyMessage="ไม่มีเจ้าหนี้หรือช่างค้างชำระในขณะนี้"
            />
          </div>
        </CardContent>
      </Card>

      {!selectedVendorId ? (
        <Card className="border-orange-200 shadow-sm">
          <CardHeader className="bg-orange-50/50">
            <CardTitle className="flex items-center gap-2">
              <Wallet className="h-5 w-5 text-orange-600" />
              ตารางสรุปยอดหนี้รายตัว (Outstanding Summary)
            </CardTitle>
            <CardDescription>
              รวมยอดค้างทั้งหมด{" "}
              <strong className="text-orange-800">
                ฿{formatMoney(summaryGrandTotal)}
              </strong>{" "}
              จาก {vendors.length} ราย
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-6">
            {vendors.length === 0 ? (
              <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 py-10 text-center text-slate-500">
                ไม่มีข้อมูลเจ้าหนี้หรือช่างค้างชำระในระบบ
              </div>
            ) : (
              <div className="overflow-hidden rounded-md border border-slate-200">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50">
                      <TableHead>ชื่อผู้จำหน่าย</TableHead>
                      <TableHead className="text-center">จำนวนบิลค้าง</TableHead>
                      <TableHead className="text-right">ยอดหนี้รวม</TableHead>
                      <TableHead className="text-right">
                        ยอดเกินกำหนด
                      </TableHead>
                      <TableHead>บิลเก่าสุด</TableHead>
                      <TableHead className="text-center">จัดการ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {vendors.map((vendor) => (
                      <TableRow key={vendor.id}>
                        <TableCell className="font-medium text-slate-900">
                          {vendor.name}
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge variant="slate">{vendor.invoice_count} บิล</Badge>
                        </TableCell>
                        <TableCell className="text-right font-bold text-red-600">
                          {formatMoney(vendor.outstanding_total)}
                        </TableCell>
                        <TableCell
                          className={
                            vendor.overdue_amount > 0
                              ? "text-right font-semibold text-red-600"
                              : "text-right text-slate-400"
                          }
                        >
                          {formatMoney(vendor.overdue_amount)}
                        </TableCell>
                        <TableCell className="text-slate-600">
                          {formatDate(vendor.oldest_invoice_date ?? "")}
                        </TableCell>
                        <TableCell className="text-center">
                          <Button
                            type="button"
                            size="sm"
                            className="gap-1.5 bg-orange-600 hover:bg-orange-700"
                            onClick={() => handleVendorChange(vendor.id)}
                          >
                            ชำระเงิน
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card className="border-orange-200 shadow-sm">
          <CardHeader className="bg-orange-50/50">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <CardTitle>2. รายการบิลค้างชำระ (Knock-off Table)</CardTitle>
                <CardDescription>
                  {selectedVendor
                    ? `ผู้จำหน่าย: ${selectedVendor.name} · เรียงวันที่เก่า → ใหม่ (FIFO)`
                    : "เรียงวันที่เอกสารเก่า → ใหม่ สำหรับ FIFO"}
                </CardDescription>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => handleVendorChange("")}
              >
                <ArrowLeft className="h-4 w-4" />
                กลับไปสรุป
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 pt-6">
            {billingNotes.length > 0 ? (
              <div className="space-y-2 rounded-xl border border-orange-100 bg-orange-50/40 p-4">
                <Label htmlFor="ap_billing_note_id">
                  ใบรับวางบิล (Bill Receipt / BR) — โหลดบิลอัตโนมัติ
                </Label>
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    id="ap_billing_note_id"
                    className="h-10 min-w-[280px] flex-1 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20"
                    value={selectedBillingNoteId}
                    disabled={isLoadingBn || isPending}
                    onChange={(e) => void handleBillingNoteChange(e.target.value)}
                  >
                    <option value="">
                      — ใช้บิลค้างชำระทั้งหมดของผู้จำหน่าย —
                    </option>
                    {billingNotes.map((note) => (
                      <option key={note.id} value={note.id}>
                        {note.doc_no} · {note.invoice_count} บิล · ฿
                        {note.grand_total.toLocaleString("th-TH", {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}{" "}
                        ({note.payment_status})
                      </option>
                    ))}
                  </select>
                  {isLoadingBn ? (
                    <Loader2 className="size-4 animate-spin text-orange-600" />
                  ) : null}
                </div>
              </div>
            ) : null}

            {invoices.length === 0 ? (
              <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 py-10 text-center text-slate-500">
                ไม่พบบิลค้างชำระ
                {selectedBillingNoteId
                  ? " ในใบรับวางบิลที่เลือก"
                  : " สำหรับเจ้าหนี้รายนี้"}
              </div>
            ) : (
              <form action={handleSubmit} className="space-y-4">
                <input type="hidden" name="vendor_id" value={selectedVendorId} />
                <input
                  type="hidden"
                  name="allocations_json"
                  value={allocationsJson}
                />
                <input type="hidden" name="deposits_json" value={depositsJson} />

                <div className="overflow-hidden rounded-md border border-slate-200">
                  <div className="border-b border-slate-200 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-800">
                    เอกสารค้างชำระ (Outstanding Invoices)
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-slate-50">
                        <TableHead className="w-14 px-2 text-center">
                          <div className="flex flex-col items-center gap-1">
                            <input
                              type="checkbox"
                              className="size-4 rounded border-slate-300 text-orange-600 focus:ring-orange-500"
                              checked={allSelected}
                              ref={(el) => {
                                if (el) el.indeterminate = someSelected;
                              }}
                              onChange={(e) =>
                                handleSelectAll(e.target.checked)
                              }
                              aria-label="เลือกทั้งหมด"
                            />
                            <span className="text-[10px] font-medium leading-none text-slate-500">
                              ทั้งหมด
                            </span>
                          </div>
                        </TableHead>
                        <TableHead>วันที่เอกสาร</TableHead>
                        <TableHead>เลขที่เอกสาร</TableHead>
                        <TableHead>ประเภท</TableHead>
                        <TableHead className="text-right">ยอดค้างสุทธิ</TableHead>
                        <TableHead className="text-center">สถานะ</TableHead>
                        <TableHead className="min-w-[150px] text-right">
                          ยอดที่ต้องการจ่าย
                        </TableHead>
                        <TableHead className="text-center">ดูบิล</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {invoices.map((inv) => {
                        const paymentRaw = paymentAmounts[inv.id] ?? "";
                        const paymentNum = Number(paymentRaw);
                        const isChecked =
                          Number.isFinite(paymentNum) && paymentNum > 0;
                        const debtCap = inv.remaining_balance;
                        const overLimit =
                          Number.isFinite(paymentNum) &&
                          paymentNum > debtCap + 0.02;
                        const docHref = documentHistoryHref(inv.document_no);

                        return (
                          <TableRow
                            key={inv.id}
                            className={isChecked ? "bg-orange-50/40" : undefined}
                          >
                            <TableCell className="text-center">
                              <input
                                type="checkbox"
                                className="size-4 rounded border-slate-300 text-orange-600 focus:ring-orange-500"
                                checked={isChecked}
                                onChange={(e) =>
                                  handleRowCheck(inv.id, e.target.checked)
                                }
                                aria-label={`เลือกบิล ${inv.document_no}`}
                              />
                            </TableCell>
                            <TableCell>
                              {formatDate(inv.document_date)}
                            </TableCell>
                            <TableCell>
                              <a
                                href={docHref}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-medium text-orange-700 underline-offset-2 hover:underline"
                              >
                                {formatDocLabel(
                                  inv.document_no,
                                  inv.reference_no,
                                )}
                              </a>
                            </TableCell>
                            <TableCell>
                              <Badge variant="slate">
                                {docTypeBadgeLabel(inv.doc_type)}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right font-semibold text-red-600">
                              {formatMoney(inv.remaining_balance)}
                            </TableCell>
                            <TableCell className="text-center">
                              <Badge variant="amber">
                                {inv.payment_status}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <Input
                                type="number"
                                inputMode="decimal"
                                step="0.01"
                                min="0"
                                max={debtCap}
                                placeholder="0.00"
                                value={paymentRaw}
                                onChange={(e) =>
                                  handlePaymentAmountChange(
                                    inv.id,
                                    e.target.value,
                                  )
                                }
                                className={
                                  overLimit
                                    ? "text-right border-red-300 focus-visible:ring-red-200"
                                    : "text-right"
                                }
                              />
                              {overLimit ? (
                                <p className="mt-1 text-xs text-red-600">
                                  เกินยอดหนี้ของบิล
                                </p>
                              ) : null}
                            </TableCell>
                            <TableCell className="text-center">
                              <a
                                href={docHref}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex h-8 items-center justify-center gap-1 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                              >
                                <Eye className="h-3.5 w-3.5" />
                                ดูบิล
                              </a>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-orange-200 bg-orange-50/60 px-4 py-3 text-sm">
                  <span className="text-slate-600">
                    เลือกแล้ว {selectedCount}/{invoices.length} บิล
                    {allSelected ? " · เลือกทั้งหมด" : ""}
                  </span>
                  <div className="flex flex-wrap gap-4 text-slate-700">
                    <span>
                      ยอดบิล:{" "}
                      <strong>฿{formatMoney(totalInvoiceAmount)}</strong>
                    </span>
                    <span>
                      มัดจำ:{" "}
                      <strong className="text-emerald-700">
                        ฿{formatMoney(depositTotal)}
                      </strong>
                    </span>
                    <span>
                      ยอดจ่ายจริง (Net):{" "}
                      <strong className="text-lg text-orange-800">
                        ฿{formatMoney(totalPaymentAmount)}
                      </strong>
                    </span>
                  </div>
                </div>

                {availableDeposits.length > 0 ? (
                  <div className="space-y-3 rounded-lg border border-emerald-200 bg-emerald-50/40 p-4">
                    <div className="flex items-center gap-2">
                      <HandCoins className="h-5 w-5 text-emerald-700" />
                      <div>
                        <h4 className="font-semibold text-slate-900">
                          เงินมัดจำที่สามารถใช้ได้ (DEP_OUT)
                        </h4>
                        <p className="text-xs text-slate-500">
                          ติ๊กเลือกมัดจำเพื่อหักจากยอดจ่ายจริง
                        </p>
                      </div>
                    </div>
                    <div className="overflow-hidden rounded-md border border-emerald-200 bg-white">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-emerald-50/80">
                            <TableHead className="w-14 px-2 text-center">
                              <div className="flex flex-col items-center gap-1">
                                <input
                                  type="checkbox"
                                  className="size-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                                  checked={allDepositsSelected}
                                  ref={(el) => {
                                    if (el)
                                      el.indeterminate = someDepositsSelected;
                                  }}
                                  onChange={(e) =>
                                    handleDepositSelectAll(e.target.checked)
                                  }
                                  aria-label="เลือกมัดจำทั้งหมด"
                                />
                                <span className="text-[10px] font-medium leading-none text-slate-500">
                                  ทั้งหมด
                                </span>
                              </div>
                            </TableHead>
                            <TableHead>เลขที่มัดจำ</TableHead>
                            <TableHead>วันที่</TableHead>
                            <TableHead className="text-right">
                              คงเหลือใช้ได้
                            </TableHead>
                            <TableHead className="text-right">ยอดที่ใช้</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {availableDeposits.map((dep) => {
                            const raw = depositAmounts[dep.id];
                            const isChecked = raw !== undefined && raw !== "";
                            const used = Number(raw || 0);
                            return (
                              <TableRow
                                key={dep.id}
                                className={
                                  isChecked ? "bg-emerald-50/50" : undefined
                                }
                              >
                                <TableCell className="text-center">
                                  <input
                                    type="checkbox"
                                    className="size-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                                    checked={isChecked}
                                    onChange={(e) =>
                                      handleDepositCheck(
                                        dep.id,
                                        e.target.checked,
                                      )
                                    }
                                    aria-label={`เลือกมัดจำ ${dep.doc_no}`}
                                  />
                                </TableCell>
                                <TableCell className="font-mono text-sm font-semibold">
                                  {dep.doc_no}
                                </TableCell>
                                <TableCell>
                                  {formatDate(dep.document_date)}
                                </TableCell>
                                <TableCell className="text-right font-semibold text-emerald-700">
                                  {formatMoney(dep.remaining_balance)}
                                </TableCell>
                                <TableCell className="text-right">
                                  <Input
                                    type="number"
                                    inputMode="decimal"
                                    step="0.01"
                                    min="0"
                                    max={dep.remaining_balance}
                                    className="ml-auto h-9 w-32 text-right"
                                    value={raw ?? ""}
                                    onChange={(e) =>
                                      setDepositAmounts((prev) => ({
                                        ...prev,
                                        [dep.id]: e.target.value,
                                      }))
                                    }
                                  />
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                    <div className="flex justify-between text-sm text-slate-600">
                      <span>
                        เลือกมัดจำ {selectedDepositCount}/
                        {availableDeposits.length} ใบ
                      </span>
                      <span>
                        รวมมัดจำ:{" "}
                        <strong className="text-emerald-800">
                          ฿{formatMoney(depositTotal)}
                        </strong>
                      </span>
                    </div>
                  </div>
                ) : null}

                <div className="space-y-4 rounded-lg border border-orange-200 bg-white p-4">
                  <div>
                    <h3 className="text-lg font-semibold text-slate-900">
                      3. รายละเอียดการชำระเงิน (Payment Details)
                    </h3>
                    <p className="text-sm text-slate-500">
                      ระบุวันที่จ่าย บัญชี/เงินสด เลขอ้างอิง และแนบสลิปโอนเงิน
                    </p>
                  </div>

                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                    <div className="space-y-2">
                      <Label htmlFor="payment_date">
                        วันที่จ่าย (Payment Date){" "}
                        <span className="text-red-500">*</span>
                      </Label>
                      <Input
                        id="payment_date"
                        name="payment_date"
                        type="date"
                        required
                        value={paymentDate}
                        onChange={(e) => setPaymentDate(e.target.value)}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="bank_account_id">
                        บัญชี / เงินสด{" "}
                        <span className="text-red-500">*</span>
                      </Label>
                      <select
                        id="bank_account_id"
                        name="bank_account_id"
                        required
                        value={bankAccountId}
                        onChange={(e) => setBankAccountId(e.target.value)}
                        className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none focus-visible:border-orange-500 focus-visible:ring-2 focus-visible:ring-orange-500/20"
                      >
                        <option value="CASH">เงินสด (Cash)</option>
                        {activeBanks.map((bank) => (
                          <option key={bank.id} value={bank.id}>
                            {bank.bank_name} · {bank.account_no}
                          </option>
                        ))}
                      </select>
                      {activeBanks.length === 0 ? (
                        <p className="text-xs text-amber-700">
                          ยังไม่มีสมุดบัญชี — ใช้เงินสดได้ หรือไปเพิ่มที่เมนูสมุดบัญชีธนาคาร
                        </p>
                      ) : null}
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="reference_no">
                        Reference / Cheque No.
                      </Label>
                      <Input
                        id="reference_no"
                        name="reference_no"
                        placeholder="เลขสลิป / เลขเช็ค"
                        value={referenceNo}
                        onChange={(e) => setReferenceNo(e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="slip_file">
                      อัปโหลดสลิปโอนเงิน (Slip Attachment)
                    </Label>
                    <div className="flex flex-col gap-2 rounded-md border border-dashed border-slate-300 bg-slate-50 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex items-start gap-3 text-sm text-slate-600">
                        <FileUp className="mt-0.5 h-5 w-5 shrink-0 text-orange-600" />
                        <div>
                          <p className="font-medium text-slate-800">
                            แนบไฟล์รูปภาพ หรือ PDF (สูงสุด 10MB)
                          </p>
                          <p className="text-xs text-slate-500">
                            {slipFile
                              ? `เลือกแล้ว: ${slipFile.name}`
                              : "ยังไม่ได้เลือกไฟล์ — ไม่บังคับ แต่แนะนำให้แนบหลักฐาน"}
                          </p>
                        </div>
                      </div>
                      <Input
                        id="slip_file"
                        name="slip_file"
                        type="file"
                        accept="image/*,application/pdf,.pdf"
                        className="max-w-xs cursor-pointer bg-white"
                        onChange={(e) => void handleSlipChange(e.target.files)}
                      />
                    </div>
                  </div>
                </div>

                <div className="flex justify-end border-t border-slate-100 pt-4">
                  <Button
                    type="submit"
                    size="lg"
                    disabled={isPending || totalInvoiceAmount <= 0}
                    className="h-12 gap-2 bg-orange-600 px-8 text-base font-semibold shadow-md hover:bg-orange-700"
                  >
                    <CheckCircle2 className="h-5 w-5" />
                    {isPending
                      ? "กำลังบันทึก..."
                      : `ยืนยันจ่าย ฿${formatMoney(totalPaymentAmount)}`}
                  </Button>
                </div>
              </form>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
