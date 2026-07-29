"use client";

/**
 * Phase 5 — Knock-off allocation form (client island for number state only).
 * Persist via Server Action `processPaymentKnockoff` + FormData.
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
import { Wand2, Save } from "lucide-react";

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
  const [bankAccountId, setBankAccountId] = useState(
    activeBanks[0]?.id ?? "",
  );
  const [referenceNo, setReferenceNo] = useState("");
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
    setLines((prev) =>
      prev.map((line) =>
        line.invoice_id === invoiceId ? { ...line, [field]: value } : line,
      ),
    );
  }

  function handleSubmit(formData: FormData) {
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

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
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

          <div className="space-y-2">
            <Label htmlFor="bank_account_id">
              สมุดบัญชีธนาคาร <span className="text-red-500">*</span>
            </Label>
            <select
              id="bank_account_id"
              name="bank_account_id"
              value={bankAccountId}
              onChange={(e) => setBankAccountId(e.target.value)}
              required
              className="flex h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 shadow-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            >
              <option value="">-- เลือกบัญชีรับเงิน --</option>
              {activeBanks.map((bank) => (
                <option key={bank.id} value={bank.id}>
                  {bank.bank_name} · {bank.account_no}
                </option>
              ))}
            </select>
            {activeBanks.length === 0 ? (
              <p className="text-xs text-amber-700">
                ยังไม่มีสมุดบัญชีที่เปิดใช้งาน — ไปเพิ่มที่เมนูสมุดบัญชีธนาคารก่อน
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="reference_no">เลขที่สลิป / อ้างอิง</Label>
            <Input
              id="reference_no"
              name="reference_no"
              placeholder="เช่น สลิปโอน / เลขเช็ค"
              value={referenceNo}
              onChange={(e) => setReferenceNo(e.target.value)}
            />
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
          <Button
            type="button"
            variant="secondary"
            onClick={handleAutoAllocate}
            disabled={isPending}
            className="gap-2"
          >
            <Wand2 className="h-4 w-4" />
            Auto-Allocate (FIFO)
          </Button>
        </div>

        <div className="overflow-hidden rounded-md border border-slate-200">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50">
                <TableHead>เลขที่บิล</TableHead>
                <TableHead>วันที่</TableHead>
                <TableHead className="text-right">ยอดค้าง</TableHead>
                <TableHead className="text-right">Allocated (เงินโอน)</TableHead>
                <TableHead className="text-right">WHT</TableHead>
                <TableHead className="text-right">ตัดรวม</TableHead>
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
                return (
                  <TableRow key={inv.id}>
                    <TableCell className="font-medium">
                      {inv.display_doc_no}
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
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

        <div className="flex justify-end">
          <Button
            type="submit"
            disabled={isPending || activeBanks.length === 0}
            className="gap-2"
          >
            <Save className="h-4 w-4" />
            {isPending ? "กำลังบันทึก..." : "บันทึกตัดยอดชำระเงิน"}
          </Button>
        </div>
      </form>
    </div>
  );
}
