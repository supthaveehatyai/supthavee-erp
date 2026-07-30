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
import {
  checkedDepositIdsFromAmounts,
  redistributeCheckedDeposits,
} from "@/lib/utils/deposit-apply";
import type { BankAccount } from "@/types/bank-account";
import type { AvailableDeposit, UnpaidInvoice } from "@/types/payment";
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
import { Wand2, CheckCircle2, Eye, FileUp, HandCoins } from "lucide-react";

export type PaymentKnockoffFormProps = {
  invoices: UnpaidInvoice[];
  availableDeposits?: AvailableDeposit[];
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
  availableDeposits = [],
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
  const [depositAmounts, setDepositAmounts] = useState<Record<string, string>>(
    {},
  );

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

  const depositTotal = useMemo(
    () =>
      roundMoney(
        availableDeposits.reduce((sum, dep) => {
          const n = Number(depositAmounts[dep.id] || 0);
          return Number.isFinite(n) && n > 0 ? sum + n : sum;
        }, 0),
      ),
    [availableDeposits, depositAmounts],
  );

  const netPaymentAmount = roundMoney(Math.max(0, sumAllocated - depositTotal));

  const allocationsJson = useMemo(() => JSON.stringify(lines), [lines]);
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

  function syncNetCash(nextAllocated: number, nextDepositTotal: number) {
    const net = roundMoney(Math.max(0, nextAllocated - nextDepositTotal));
    setAmount(net > 0 ? String(net) : net === 0 && nextAllocated > 0 ? "0" : "");
  }

  function currentDepositTotal(next: Record<string, string>): number {
    return roundMoney(
      availableDeposits.reduce((sum, dep) => {
        const n = Number(next[dep.id] || 0);
        return Number.isFinite(n) && n > 0 ? sum + n : sum;
      }, 0),
    );
  }

  /** Auto-fill checked deposits = min(invoiceTotal leftover FIFO, remaining). */
  function syncDepositsToInvoiceTotal(
    invoiceTotal: number,
    baseAmounts: Record<string, string>,
    checkedIds: string[],
  ): Record<string, string> {
    if (checkedIds.length === 0) return {};
    return redistributeCheckedDeposits(
      invoiceTotal,
      availableDeposits,
      checkedIds,
    );
  }

  function applyInvoiceTotalAndDeposits(
    nextLines: LineState[],
    baseDepositAmounts: Record<string, string> = depositAmounts,
  ) {
    const nextAllocated = roundMoney(
      nextLines.reduce((sum, line) => sum + line.allocated_amount, 0),
    );
    const checkedIds = checkedDepositIdsFromAmounts(baseDepositAmounts);
    const nextDeposits = syncDepositsToInvoiceTotal(
      nextAllocated,
      baseDepositAmounts,
      checkedIds,
    );
    setLines(nextLines);
    setDepositAmounts(nextDeposits);
    syncNetCash(nextAllocated, currentDepositTotal(nextDeposits));
  }

  function handleAutoAllocate() {
    if (poolTotal <= 0 && depositTotal <= 0) {
      toast.error("กรุณาระบุยอดเงินโอนจริง และ/หรือ ยอด WHT ก่อน Auto-Allocate");
      return;
    }

    const sorted = [...invoices].sort((a, b) => {
      const da = a.document_date || "";
      const db = b.document_date || "";
      if (da !== db) return da.localeCompare(db);
      return a.display_doc_no.localeCompare(b.display_doc_no);
    });

    // Allocate cash+deposit pool against invoices (FIFO), WHT separate
    const fifo = allocateFifo(
      sorted.map((inv) => ({
        id: inv.id,
        remaining_balance: inv.remaining_balance,
      })),
      roundMoney(cash + depositTotal),
      wht,
    );

    const byId = new Map(fifo.map((row) => [row.invoice_id, row]));
    const next = invoices.map((inv) => {
      const row = byId.get(inv.id);
      return {
        invoice_id: inv.id,
        allocated_amount: row?.allocated_amount ?? 0,
        wht_amount: row?.wht_amount ?? 0,
      };
    });
    applyInvoiceTotalAndDeposits(next);
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
    if (field === "allocated_amount") {
      applyInvoiceTotalAndDeposits(next);
      return;
    }
    setLines(next);
    const nextAllocated = roundMoney(
      next.reduce((sum, line) => sum + line.allocated_amount, 0),
    );
    syncNetCash(nextAllocated, depositTotal);
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
    applyInvoiceTotalAndDeposits(next);
  }

  function handleSelectAll(checked: boolean) {
    if (!checked) {
      setLines(emptyLines(invoices));
      setAmount("");
      setWhtAmount("");
      // Keep deposits checked but recalc against 0 invoice total
      const checkedIds = checkedDepositIdsFromAmounts(depositAmounts);
      const nextDeposits = syncDepositsToInvoiceTotal(0, depositAmounts, checkedIds);
      setDepositAmounts(nextDeposits);
      return;
    }
    const next = invoices.map((inv) => ({
      invoice_id: inv.id,
      allocated_amount: roundMoney(inv.remaining_balance),
      wht_amount: 0,
    }));
    applyInvoiceTotalAndDeposits(next);
  }

  function handleDepositCheck(depositId: string, checked: boolean) {
    const deposit = availableDeposits.find((d) => d.id === depositId);
    if (!deposit) return;

    const prevChecked = checkedDepositIdsFromAmounts(depositAmounts);
    const nextChecked = checked
      ? Array.from(new Set([...prevChecked, depositId]))
      : prevChecked.filter((id) => id !== depositId);

    const next = syncDepositsToInvoiceTotal(
      sumAllocated,
      depositAmounts,
      nextChecked,
    );
    setDepositAmounts(next);
    syncNetCash(sumAllocated, currentDepositTotal(next));
  }

  function handleDepositSelectAll(checked: boolean) {
    if (!checked) {
      setDepositAmounts({});
      syncNetCash(sumAllocated, 0);
      return;
    }
    const next = redistributeCheckedDeposits(
      sumAllocated,
      availableDeposits,
      availableDeposits.map((d) => d.id),
    );
    setDepositAmounts(next);
    syncNetCash(sumAllocated, currentDepositTotal(next));
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

  const selectedDepositCount = useMemo(
    () => checkedDepositIdsFromAmounts(depositAmounts).length,
    [depositAmounts],
  );
  const allDepositsSelected =
    availableDeposits.length > 0 &&
    selectedDepositCount === availableDeposits.length;
  const someDepositsSelected =
    selectedDepositCount > 0 && !allDepositsSelected;

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
      setDepositAmounts({});
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
          เลือกบิล + มัดจำ → ยอดรับจริง = บิล − มัดจำ (ไม่ติดลบ) · หรือ Auto-Allocate
          (FIFO)
        </p>
      </div>

      <form action={handleSubmit} className="space-y-4">
        <input type="hidden" name="contact_id" value={contactId} />
        <input type="hidden" name="allocations_json" value={allocationsJson} />
        <input type="hidden" name="deposits_json" value={depositsJson} />

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="amount">
              ยอดรับชำระจริง (Net) <span className="text-red-500">*</span>
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
            <p className="text-xs text-slate-500">
              คำนวณอัตโนมัติ = บิลที่เลือก − มัดจำที่เลือก (฿
              {netPaymentAmount.toLocaleString("th-TH", {
                minimumFractionDigits: 2,
              })}
              )
            </p>
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
              บิลที่ตัด:{" "}
              <strong className="text-slate-900">
                {sumAllocated.toLocaleString("th-TH", {
                  minimumFractionDigits: 2,
                })}
              </strong>
            </span>
            <span>
              มัดจำใช้:{" "}
              <strong className="text-emerald-700">
                {depositTotal.toLocaleString("th-TH", {
                  minimumFractionDigits: 2,
                })}
              </strong>
            </span>
            <span>
              ยอดรับจริง:{" "}
              <strong className="text-blue-800">
                {netPaymentAmount.toLocaleString("th-TH", {
                  minimumFractionDigits: 2,
                })}
              </strong>
            </span>
            <span>
              WHT:{" "}
              <strong className="text-slate-900">
                {sumWht.toLocaleString("th-TH", {
                  minimumFractionDigits: 2,
                })}
              </strong>
            </span>
            <span>
              ตัดรวม:{" "}
              <strong
                className={
                  Math.abs(sumApplied - roundMoney(cash + depositTotal + wht)) >
                  0.02
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
            {allSelected ? " · เลือกทั้งหมด" : ""} · ยอดตัดบิล = ยอดรับจริง + มัดจำ
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

        {availableDeposits.length > 0 ? (
          <div className="space-y-3 rounded-lg border border-emerald-200 bg-emerald-50/40 p-4">
            <div className="flex items-center gap-2">
              <HandCoins className="h-5 w-5 text-emerald-700" />
              <div>
                <h4 className="font-semibold text-slate-900">
                  เงินมัดจำที่สามารถใช้ได้ (DEP_IN)
                </h4>
                <p className="text-xs text-slate-500">
                  ติ๊กเลือกมัดจำเพื่อหักจากยอดรับชำระจริง
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
                            if (el) el.indeterminate = someDepositsSelected;
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
                    <TableHead className="text-right">ยอดมัดจำเต็ม</TableHead>
                    <TableHead className="text-right">คงเหลือใช้ได้</TableHead>
                    <TableHead className="text-right">ยอดที่ใช้</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {availableDeposits.map((dep) => {
                    const raw = depositAmounts[dep.id];
                    const isChecked = raw !== undefined && raw !== "";
                    const used = Number(raw || 0);
                    const overLimit =
                      Number.isFinite(used) &&
                      used > dep.remaining_balance + 0.02;
                    return (
                      <TableRow
                        key={dep.id}
                        className={isChecked ? "bg-emerald-50/50" : undefined}
                      >
                        <TableCell className="text-center">
                          <input
                            type="checkbox"
                            className="size-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                            checked={isChecked}
                            onChange={(e) =>
                              handleDepositCheck(dep.id, e.target.checked)
                            }
                            aria-label={`เลือกมัดจำ ${dep.doc_no}`}
                          />
                        </TableCell>
                        <TableCell className="font-mono text-sm font-semibold">
                          {dep.doc_no}
                        </TableCell>
                        <TableCell>
                          {dep.document_date
                            ? new Date(dep.document_date).toLocaleDateString(
                                "th-TH",
                              )
                            : "—"}
                        </TableCell>
                        <TableCell className="text-right text-slate-500">
                          {dep.grand_total.toLocaleString("th-TH", {
                            minimumFractionDigits: 2,
                          })}
                        </TableCell>
                        <TableCell className="text-right font-semibold text-emerald-700">
                          {dep.remaining_balance.toLocaleString("th-TH", {
                            minimumFractionDigits: 2,
                          })}
                        </TableCell>
                        <TableCell className="text-right">
                          <Input
                            type="number"
                            inputMode="decimal"
                            step="0.01"
                            min="0"
                            max={dep.remaining_balance}
                            className={
                              overLimit
                                ? "ml-auto h-9 w-32 border-red-300 text-right"
                                : "ml-auto h-9 w-32 text-right"
                            }
                            value={raw ?? ""}
                            onChange={(e) => {
                              const next = {
                                ...depositAmounts,
                                [dep.id]: e.target.value,
                              };
                              setDepositAmounts(next);
                              syncNetCash(
                                sumAllocated,
                                currentDepositTotal(next),
                              );
                            }}
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            <div className="flex flex-wrap justify-between gap-2 text-sm text-slate-600">
              <span>
                เลือกมัดจำ {selectedDepositCount}/{availableDeposits.length} ใบ
              </span>
              <span>
                รวมมัดจำที่ใช้:{" "}
                <strong className="text-emerald-800">
                  ฿
                  {depositTotal.toLocaleString("th-TH", {
                    minimumFractionDigits: 2,
                  })}
                </strong>
              </span>
            </div>
          </div>
        ) : null}

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
