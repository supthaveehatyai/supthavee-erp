"use client";

/**
 * Record payout for one expense installment.
 * Mutations via Server Actions only (Zero Client-Side Fetching).
 */

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ExternalLink, HardDrive, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { payExpenseInstallment } from "@/app/actions/expenses";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import type {
  ExpenseBankAccountOption,
  ExpenseInstallmentRow,
} from "@/types/expense";

function todayIsoDate(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatPaidDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("th-TH", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}

export type ExpenseInstallmentPayCellProps = {
  installment: ExpenseInstallmentRow;
  bankAccounts: ExpenseBankAccountOption[];
  canPay: boolean;
};

export function ExpenseInstallmentPayCell({
  installment,
  bankAccounts,
  canPay,
}: ExpenseInstallmentPayCellProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [paidDate, setPaidDate] = useState(todayIsoDate);
  const [bankAccountId, setBankAccountId] = useState(
    bankAccounts[0]?.id ?? "",
  );
  const [slipFile, setSlipFile] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (installment.is_paid) {
    return (
      <div className="flex flex-col items-center gap-1">
        <Badge variant="emerald">ชำระแล้ว (Paid)</Badge>
        <span className="text-[11px] text-slate-500">
          {formatPaidDate(installment.paid_date)}
        </span>
        {installment.storage_tier === "NAS" ? (
          <span
            className="inline-flex max-w-[140px] flex-col items-center gap-0.5 text-[11px] font-semibold text-amber-800"
            title={installment.slip_nas_path ?? installment.nas_archive_url ?? undefined}
          >
            <HardDrive className="h-3.5 w-3.5" />
            เก็บบน NAS
          </span>
        ) : installment.slip_url ? (
          <a
            href={installment.slip_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-600 hover:underline"
            title="ดูสลิปโอนเงิน"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            ดูสลิป
          </a>
        ) : null}
      </div>
    );
  }

  if (!canPay) {
    return <Badge variant="slate">ยังไม่จ่าย</Badge>;
  }

  function resetForm() {
    setPaidDate(todayIsoDate());
    setBankAccountId(bankAccounts[0]?.id ?? "");
    setSlipFile(null);
  }

  async function handleSubmit() {
    if (isSubmitting) return;
    if (!paidDate) {
      toast.error("กรุณาเลือกวันที่จ่าย");
      return;
    }
    if (!bankAccountId) {
      toast.error("กรุณาเลือกสมุดบัญชีธนาคาร");
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await payExpenseInstallment(installment.id, {
        paid_date: paidDate,
        bank_account_id: bankAccountId,
        slip_file: slipFile,
      });

      if (!result.success) {
        toast.error(result.error ?? "บันทึกจ่ายไม่สำเร็จ");
        return;
      }

      toast.success(`บันทึกจ่ายงวดที่ ${installment.installment_period} แล้ว`);
      setOpen(false);
      resetForm();
      router.refresh();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "บันทึกจ่ายไม่สำเร็จ",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => {
          resetForm();
          setOpen(true);
        }}
      >
        บันทึกจ่าย (Pay)
      </Button>

      <Dialog open={open} onOpenChange={(next) => !isSubmitting && setOpen(next)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>บันทึกจ่ายงวดที่ {installment.installment_period}</DialogTitle>
            <DialogDescription>
              บันทึก PAYOUT ลง payment_transactions แล้วยกสถานะงวดเป็นชำระแล้ว
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div>
              <Label htmlFor={`paid-date-${installment.id}`}>วันที่จ่าย</Label>
              <Input
                id={`paid-date-${installment.id}`}
                type="date"
                value={paidDate}
                onChange={(event) => setPaidDate(event.target.value)}
                disabled={isSubmitting}
              />
            </div>

            <div>
              <Label htmlFor={`bank-${installment.id}`}>สมุดบัญชีธนาคาร</Label>
              <Select
                id={`bank-${installment.id}`}
                value={bankAccountId}
                onChange={(event) => setBankAccountId(event.target.value)}
                disabled={isSubmitting || bankAccounts.length === 0}
              >
                {bankAccounts.length === 0 ? (
                  <option value="">ไม่พบบัญชีธนาคารที่ใช้งาน</option>
                ) : (
                  bankAccounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.label}
                    </option>
                  ))
                )}
              </Select>
            </div>

            <div>
              <Label htmlFor={`slip-${installment.id}`}>สลิปโอนเงิน</Label>
              <Input
                id={`slip-${installment.id}`}
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                disabled={isSubmitting}
                onChange={(event) => {
                  const file = event.target.files?.[0] ?? null;
                  setSlipFile(file);
                }}
              />
              <p className="mt-1 text-[11px] text-slate-500">
                ไม่บังคับ · JPG / PNG / WEBP / PDF ไม่เกิน 10MB
                {slipFile ? ` · เลือกแล้ว: ${slipFile.name}` : ""}
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={isSubmitting}
              onClick={() => setOpen(false)}
            >
              ยกเลิก
            </Button>
            <Button
              type="button"
              disabled={isSubmitting || bankAccounts.length === 0}
              onClick={() => void handleSubmit()}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  กำลังบันทึก...
                </>
              ) : (
                "ยืนยันจ่าย"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
