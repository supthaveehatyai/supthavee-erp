"use client";

/**
 * Phase 5 — Knock-off allocation form (client island for number state only).
 * Persist via Server Action `processPaymentKnockoff` + FormData.
 * Payment Details (date / bank / ref / slip) mirrors AP Payment layout.
 */

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { processPaymentKnockoff } from "@/lib/actions/finance/payment";
import { allocateFifo, roundMoney } from "@/lib/utils/payment-fifo";
import type { BankAccount } from "@/types/bank-account";
import type { UnpaidInvoice } from "@/types/payment";
import { Button } from "@/components/ui/button";
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
import { Wand2, CheckCircle2, Eye, FileUp } from "lucide-react";

export type PaymentKnockoffFormProps = {
  invoices: UnpaidInvoice[];
  bankAccounts: BankAccount[];
  contactId: string;
};

type LineState = {
  invoice_id: string;
  allocated_amount: number;
  wht_amount: number;
};

function emptyLines(invoices: UnpaidInvoice[]): LineState[] {
  return invoices.map((inv) => ({
    invoice_id: inv.id,
    allocated_amount: 0,
    wht_amount: 0,
  }));
}

function todayIsoLocal(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function PaymentKnockoffForm({
  invoices,
  bankAccounts,
  contactId,
}: PaymentKnockoffFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const activeBanks = bankAccounts.filter((b) => b.is_active);

  const [amount, setAmount] = useState("");
  const [whtAmount, setWhtAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(todayIsoLocal);
  const [bankAccountId, setBankAccountId] = useState(
    activeBanks[0]?.id ?? "CASH",
  );
  const [referenceNo, setReferenceNo] = useState("");
  const [slipFile, setSlipFile] = useState<File | null>(null);
  const [lines, setLines] = useState<LineState[]>(() => emptyLines(invoices));

  const cash = roundMoney(Number(amount) || 0);
  const wht = roundMoney(Number(whtAmount) || 0);
  const poolTotal = roundMoney(cash + wht);

  const sumAllocated = useMemo(
    () => roundMoney(lines.reduce((s, l) => s + l.allocated_amount, 0)),
    [lines],
  );
  const sumWht = useMemo(
    () => roundMoney(lines.reduce((s, l) => s + l.wht_amount, 0)),
    [lines],
  );
  const sumApplied = roundMoney(sumAllocated + sumWht);

  const allocationsJson = useMemo(() => JSON.stringify(lines), [lines]);

  function handleAutoAllocate() {
    if (poolTotal <= 0) {
      toast.error("กรุณาระบุยอดเงินโอนจริง และ/หรือ ยอด WHT ก่อน Auto-Allocate");
      return;
    }

    const sorted = [...invoices].sort((a, b) => {
      const da = a.document_date || "";
      const db = b.document_date || "";
      if (da !== db) return da.localeCompare(db);
      return a.display_doc_no.localeCompare(b.display_doc_no);
    });

    const fifo = allocateFifo(
      sorted.map((inv) => ({
        id: inv.id,
        remaining_balance: inv.remaining_balance,
      })),
      cash,
      wht,
    );

    const byId = new Map(fifo.map((row) => [row.invoice_id, row]));
    setLines(
      invoices.map((inv) => {
        const row = byId.get(inv.id);
        return {
          invoice_id: inv.id,
          allocated_amount: row?.allocated_amount ?? 0,
          wht_amount: row?.wht_amount ?? 0,
        };
      }),
    );
    toast.success("กระจายยอดแบบ FIFO เรียบร้อย — แก้ไขรายบิลได้ก่อนบันทึก");
  }

  function updateLine(
    invoiceId: string,
    field: "allocated_amount" | "wht_amount",
    raw: string,
  ) {
    const value = roundMoney(Math.max(0, Number(raw) || 0));
    const next = lines.map((line) =>
      line.invoice_id === invoiceId ? { ...line, [field]: value } : line,
    );
    setLines(next);
    const nextAllocated = roundMoney(
      next.reduce((sum, line) => sum + line.allocated_amount, 0),
    );
    setAmount(nextAllocated > 0 ? String(nextAllocated) : "");
  }

  function handleRowCheck(invoiceId: string, checked: boolean) {
    const invoice = invoices.find((inv) => inv.id === invoiceId);
    if (!invoice) return;
    const next = lines.map((line) => {
      if (line.invoice_id !== invoiceId) return line;
      if (!checked) {
        return { ...line, allocated_amount: 0, wht_amount: 0 };
      }
      return {
        ...line,
        allocated_amount: roundMoney(invoice.remaining_balance),
      };
    });
    setLines(next);
    const nextAllocated = roundMoney(
      next.reduce((sum, line) => sum + line.allocated_amount, 0),
    );
    setAmount(nextAllocated > 0 ? String(nextAllocated) : "");
  }

  function handleSelectAll(checked: boolean) {
    if (!checked) {
      setLines(emptyLines(invoices));
      setAmount("");
      setWhtAmount("");
      return;
    }
    const next = invoices.map((inv) => ({
      invoice_id: inv.id,
      allocated_amount: roundMoney(inv.remaining_balance),
      wht_amount: 0,
    }));
    setLines(next);
    const total = roundMoney(
      next.reduce((sum, line) => sum + line.allocated_amount, 0),
    );
    setAmount(String(total));
  }

  const selectedCount = useMemo(
    () =>
      lines.filter(
        (line) => line.allocated_amount > 0 || line.wht_amount > 0,
      ).length,
    [lines],
  );
  const allSelected =
    invoices.length > 0 && selectedCount === invoices.length;
  const someSelected = selectedCount > 0 && !allSelected;

  function handleSlipChange(fileList: FileList | null) {
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
    setSlipFile(file);
  }

  function handleSubmit(formData: FormData) {
    if (sumApplied <= 0) {
      toast.error("ห้ามบันทึก — ผลรวมยอดตัดหนี้ต้องมากกว่า 0");
      return;
    }

    if (slipFile) {
      formData.set("slip_file", slipFile);
    } else {
      formData.delete("slip_file");
    }

    startTransition(async () => {
      const result = await processPaymentKnockoff(formData);
      if (!result.success) {
        toast.error(result.error ?? "ตัดยอดไม่สำเร็จ");
        return;
      }
      toast.success(
        result.receipt_doc_no
          ? `บันทึกตัดยอดสำเร็จ — ใบเสร็จ ${result.receipt_doc_no}`
          : "บันทึกตัดยอดสำเร็จ",
      );
      setAmount("");
      setWhtAmount("");
      setReferenceNo("");
      setSlipFile(null);
      setLines(emptyLines(invoices));
      router.refresh();
    });
  }

  if (invoices.length === 0) return null;

  return (
    <div className="space-y-4 rounded-lg border border-blue-200 bg-white p-4">
      <div className="flex flex-col gap-1">
        <h3 className="text-lg font-semibold text-slate-900">
          3. ฟอร์มตัดยอดชำระเงิน (Knock-off)
        </h3>
        <p className="text-sm text-slate-500">
          กรอกยอดโอน + WHT แล้วกด Auto-Allocate (FIFO) หรือแก้ไขยอดรายบิลเองก่อนบันทึก
        </p>
      </div>

      <form action={handleSubmit} className="space-y-4">
        <input type="hidden" name="contact_id" value={contactId} />
        <input type="hidden" name="allocations_json" value={allocationsJson} />

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="amount">
              ยอดเงินที่โอนจริง <span className="text-red-500">*</span>
            </Label>
            <Input
              id="amount"
              name="amount"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="wht_amount">ยอดหัก ณ ที่จ่าย (WHT)</Label>
            <Input
              id="wht_amount"
              name="wht_amount"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              placeholder="0.00"
              value={whtAmount}
              onChange={(e) => setWhtAmount(e.target.value)}
            />
          </div>

          <div className="flex items-end">
            <Button
              type="button"
              variant="secondary"
              onClick={handleAutoAllocate}
              disabled={isPending}
              className="w-full gap-2 md:w-auto"
            >
              <Wand2 className="h-4 w-4" />
              Auto-Allocate (FIFO)
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
          <div className="flex flex-wrap gap-4 text-slate-600">
            <span>
              Pool รวม:{" "}
              <strong className="text-slate-900">
                {poolTotal.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
              </strong>
            </span>
            <span>
              Allocated:{" "}
              <strong className="text-slate-900">
                {sumAllocated.toLocaleString("th-TH", {
                  minimumFractionDigits: 2,
                })}
              </strong>
            </span>
            <span>
              WHT กระจาย:{" "}
              <strong className="text-slate-900">
                {sumWht.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
              </strong>
            </span>
            <span>
              ตัดรวม:{" "}
              <strong
                className={
                  Math.abs(sumApplied - poolTotal) > 0.02
                    ? "text-amber-700"
                    : "text-emerald-700"
                }
              >
                {sumApplied.toLocaleString("th-TH", {
                  minimumFractionDigits: 2,
                })}
              </strong>
            </span>
          </div>
        </div>

        <div className="overflow-hidden rounded-md border border-slate-200">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50">
                <TableHead className="w-14 px-2 text-center">
                  <div className="flex flex-col items-center gap-1">
                    <input
                      type="checkbox"
                      className="size-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                      checked={allSelected}
                      ref={(el) => {
                        if (el) el.indeterminate = someSelected;
                      }}
                      onChange={(e) => handleSelectAll(e.target.checked)}
                      aria-label="เลือกทั้งหมด"
                    />
                    <span className="text-[10px] font-medium leading-none text-slate-500">
                      ทั้งหมด
                    </span>
                  </div>
                </TableHead>
                <TableHead>เลขที่บิล</TableHead>
                <TableHead>วันที่</TableHead>
                <TableHead className="text-right">ยอดค้าง</TableHead>
                <TableHead className="text-right">Allocated (เงินโอน)</TableHead>
                <TableHead className="text-right">WHT</TableHead>
                <TableHead className="text-right">ตัดรวม</TableHead>
                <TableHead className="text-center">ดูบิล</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoices.map((inv) => {
                const line = lines.find((l) => l.invoice_id === inv.id) ?? {
                  invoice_id: inv.id,
                  allocated_amount: 0,
                  wht_amount: 0,
                };
                const applied = roundMoney(
                  line.allocated_amount + line.wht_amount,
                );
                const isChecked =
                  line.allocated_amount > 0 || line.wht_amount > 0;
                const docHref = `/sales/${encodeURIComponent(inv.display_doc_no)}`;
                return (
                  <TableRow
                    key={inv.id}
                    className={isChecked ? "bg-blue-50/40" : undefined}
                  >
                    <TableCell className="text-center">
                      <input
                        type="checkbox"
                        className="size-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                        checked={isChecked}
                        onChange={(e) =>
                          handleRowCheck(inv.id, e.target.checked)
                        }
                        aria-label={`เลือกบิล ${inv.display_doc_no}`}
                      />
                    </TableCell>
                    <TableCell>
                      <a
                        href={docHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-blue-700 underline-offset-2 hover:underline"
                      >
                        {inv.display_doc_no}
                      </a>
                    </TableCell>
                    <TableCell>
                      {inv.document_date
                        ? new Date(inv.document_date).toLocaleDateString(
                            "th-TH",
                          )
                        : "—"}
                    </TableCell>
                    <TableCell className="text-right font-semibold text-red-600">
                      {inv.remaining_balance.toLocaleString("th-TH", {
                        minimumFractionDigits: 2,
                      })}
                    </TableCell>
                    <TableCell className="text-right">
                      <Input
                        type="number"
                        inputMode="decimal"
                        step="0.01"
                        min="0"
                        className="ml-auto h-9 w-32 text-right"
                        value={line.allocated_amount || ""}
                        onChange={(e) =>
                          updateLine(
                            inv.id,
                            "allocated_amount",
                            e.target.value,
                          )
                        }
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <Input
                        type="number"
                        inputMode="decimal"
                        step="0.01"
                        min="0"
                        className="ml-auto h-9 w-28 text-right"
                        value={line.wht_amount || ""}
                        onChange={(e) =>
                          updateLine(inv.id, "wht_amount", e.target.value)
                        }
                      />
                    </TableCell>
                    <TableCell className="text-right font-medium text-slate-900">
                      {applied.toLocaleString("th-TH", {
                        minimumFractionDigits: 2,
                      })}
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

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-blue-200 bg-blue-50/60 px-4 py-3 text-sm">
          <span className="text-slate-600">
            เลือกแล้ว {selectedCount}/{invoices.length} บิล
            {allSelected ? " · เลือกทั้งหมด" : ""} · ยอด Allocated ต้องตรงกับยอดโอน +
            WHT
          </span>
          <span className="text-slate-700">
            ตัดรวม:{" "}
            <strong className="text-lg text-blue-800">
              ฿
              {sumApplied.toLocaleString("th-TH", {
                minimumFractionDigits: 2,
              })}
            </strong>
          </span>
        </div>

        <div className="space-y-4 rounded-lg border border-blue-200 bg-white p-4">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">
              4. รายละเอียดการชำระเงิน (Payment Details)
            </h3>
            <p className="text-sm text-slate-500">
              ระบุวันที่รับ บัญชี/เงินสด เลขอ้างอิง และแนบสลิปโอนเงิน
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="payment_date">
                วันที่รับเงิน (Payment Date){" "}
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
                บัญชีรับเงิน / เงินสด{" "}
                <span className="text-red-500">*</span>
              </Label>
              <select
                id="bank_account_id"
                name="bank_account_id"
                required
                value={bankAccountId}
                onChange={(e) => setBankAccountId(e.target.value)}
                className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none focus-visible:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-500/20"
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
              <Label htmlFor="reference_no">Reference / Cheque No.</Label>
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
                <FileUp className="mt-0.5 h-5 w-5 shrink-0 text-blue-600" />
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
                onChange={(e) => handleSlipChange(e.target.files)}
              />
            </div>
          </div>
        </div>

        <div className="flex justify-end border-t border-slate-100 pt-4">
          <Button
            type="submit"
            size="lg"
            disabled={isPending || sumApplied <= 0}
            className="h-12 gap-2 bg-blue-600 px-8 text-base font-semibold shadow-md hover:bg-blue-700"
          >
            <CheckCircle2 className="h-5 w-5" />
            {isPending
              ? "กำลังบันทึก..."
              : "ยืนยันการชำระเงิน (Submit Payment)"}
          </Button>
        </div>
      </form>
    </div>
  );
}
