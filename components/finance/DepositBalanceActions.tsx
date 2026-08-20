"use client";

/**
 * Deposit balance actions — Refund / Write-off modal with slip upload.
 * Mutation via Server Action + FormData only (Zero Client-Side Fetching).
 */

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  BanknoteArrowDown,
  Eraser,
  FileUp,
  Loader2,
} from "lucide-react";
import {
  manageDepositBalance,
  type DepositBalanceActionType,
} from "@/app/actions/finance/deposit-actions";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export type DepositBalanceActionsProps = {
  documentId: string;
  docNo: string;
  availableBalance: number;
};

function formatMoney(value: number): string {
  return value.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

const ACTION_COPY: Record<
  DepositBalanceActionType,
  {
    title: string;
    description: string;
    confirm: string;
    tone: string;
    slipHint: string;
  }
> = {
  REFUND: {
    title: "คืนเงินมัดจำ (Refund)",
    description: "สร้างเอกสาร REFUND จริง พร้อมแนบสลิปโอนเงินคืน",
    confirm: "ยืนยันคืนเงิน",
    tone: "bg-sky-600 hover:bg-sky-700",
    slipHint: "แนะนำให้แนบสลิปโอนเงินคืนเป็นหลักฐาน",
  },
  WRITE_OFF: {
    title: "ตัดเศษบัญชี (Write-off)",
    description: "สร้างเอกสาร WRITE_OFF เพื่อตัดยอดมัดจำคงเหลือออกจากบัญชี",
    confirm: "ยืนยันตัดเศษ",
    tone: "bg-amber-600 hover:bg-amber-700",
    slipHint: "แนบหลักฐานได้ถ้ามี (ไม่บังคับ)",
  },
};

export function DepositBalanceActions({
  documentId,
  docNo,
  availableBalance,
}: DepositBalanceActionsProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [actionType, setActionType] =
    useState<DepositBalanceActionType>("REFUND");
  const [amount, setAmount] = useState(String(availableBalance));
  const [remark, setRemark] = useState("");
  const [slipFile, setSlipFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!(availableBalance > 0.02)) return null;

  function openModal(next: DepositBalanceActionType) {
    setActionType(next);
    setAmount(String(availableBalance));
    setRemark("");
    setSlipFile(null);
    setError(null);
    setOpen(true);
  }

  function handleSlipChange(files: FileList | null) {
    const file = files?.[0] ?? null;
    setSlipFile(file && file.size > 0 ? file : null);
  }

  function handleConfirm() {
    setError(null);
    const parsed = Number(amount);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setError("กรุณาระบุยอดเงินที่มากกว่า 0");
      return;
    }
    if (parsed > availableBalance + 0.02) {
      setError(
        `ยอดทำรายการเกินยอดคงเหลือ (฿${formatMoney(availableBalance)})`,
      );
      return;
    }

    const formData = new FormData();
    formData.set("document_id", documentId);
    formData.set("action_type", actionType);
    formData.set("amount", String(parsed));
    formData.set("remark", remark.trim());
    if (slipFile) {
      formData.set("slip_file", slipFile);
    }

    startTransition(async () => {
      const result = await manageDepositBalance(formData);
      if (!result.success) {
        setError(result.error ?? "ทำรายการไม่สำเร็จ");
        return;
      }
      toast.success(
        result.successMessage ??
          `ทำรายการสำเร็จ — ${result.action_doc_no ?? docNo}`,
      );
      setOpen(false);
      router.refresh();
    });
  }

  const copy = ACTION_COPY[actionType];
  const isRefund = actionType === "REFUND";

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          className="h-10 gap-2 border-sky-200 bg-sky-50 text-sky-800 hover:bg-sky-100"
          onClick={() => openModal("REFUND")}
        >
          <BanknoteArrowDown className="size-4" />
          คืนเงินมัดจำ (Refund)
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-10 gap-2 border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100"
          onClick={() => openModal("WRITE_OFF")}
        >
          <Eraser className="size-4" />
          ตัดเศษบัญชี (Write-off)
        </Button>
      </div>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (isPending) return;
          setOpen(next);
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{copy.title}</DialogTitle>
            <DialogDescription>
              {copy.description} · เอกสาร {docNo}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {error ? (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            ) : null}

            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                ยอดคงเหลือปัจจุบัน
              </p>
              <p className="mt-1 text-xl font-bold tabular-nums text-slate-900">
                ฿{formatMoney(availableBalance)}
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="deposit-action-amount">
                ยอดเงินที่ต้องการทำรายการ{" "}
                <span className="text-red-500">*</span>
              </Label>
              <Input
                id="deposit-action-amount"
                type="number"
                inputMode="decimal"
                min="0.01"
                step="0.01"
                max={availableBalance}
                disabled={isPending}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="deposit-action-remark">หมายเหตุ</Label>
              <Input
                id="deposit-action-remark"
                disabled={isPending}
                placeholder="เหตุผล / เลขอ้างอิง (ถ้ามี)"
                value={remark}
                onChange={(e) => setRemark(e.target.value)}
              />
            </div>

            {/* Slip Attachment — same UX as REC/PAY / Deposit create */}
            <div className="space-y-2">
              <Label htmlFor="deposit-action-slip">
                อัปโหลดสลิปโอนเงิน (Slip Attachment)
                {isRefund ? (
                  <span className="ml-1 text-xs font-normal text-slate-400">
                    — แนะนำ
                  </span>
                ) : null}
              </Label>
              <div className="flex flex-col gap-2 rounded-md border border-dashed border-slate-300 bg-slate-50 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3 text-sm text-slate-600">
                  <FileUp
                    className={cn(
                      "mt-0.5 h-5 w-5 shrink-0",
                      isRefund ? "text-sky-600" : "text-amber-700",
                    )}
                  />
                  <div>
                    <p className="font-medium text-slate-800">
                      แนบไฟล์รูปภาพ หรือ PDF (สูงสุด 10MB)
                    </p>
                    <p className="text-xs text-slate-500">
                      {slipFile
                        ? `เลือกแล้ว: ${slipFile.name}`
                        : copy.slipHint}
                    </p>
                  </div>
                </div>
                <Input
                  id="deposit-action-slip"
                  name="slip_file"
                  type="file"
                  accept="image/*,application/pdf,.pdf"
                  disabled={isPending}
                  className="max-w-xs cursor-pointer bg-white"
                  onChange={(e) => handleSlipChange(e.target.files)}
                />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={isPending}
              onClick={() => setOpen(false)}
            >
              ยกเลิก
            </Button>
            <Button
              type="button"
              disabled={isPending}
              className={copy.tone}
              onClick={handleConfirm}
            >
              {isPending ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : null}
              {isPending ? "กำลังบันทึก..." : copy.confirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
