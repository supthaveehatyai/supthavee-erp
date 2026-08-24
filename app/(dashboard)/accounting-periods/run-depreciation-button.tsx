"use client";

/**
 * Phase 14 — Run Straight-line Depreciation (Client island).
 * Calls `calculateDepreciationAction` only — Zero Client-Side Fetching.
 */

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Calculator, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { calculateDepreciationAction } from "@/app/actions/depreciation";
import { Button } from "@/components/ui/button";

export type RunDepreciationButtonProps = {
  periodId: string;
  periodLabel?: string;
  disabled?: boolean;
};

function formatBaht(amount: number): string {
  return new Intl.NumberFormat("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function RunDepreciationButton({
  periodId,
  periodLabel,
  disabled = false,
}: RunDepreciationButtonProps) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submitLockRef = useRef(false);

  async function handleClick() {
    if (submitLockRef.current || isSubmitting || disabled) return;
    if (!periodId.trim()) {
      toast.error("ไม่พบรหัสงวดบัญชี");
      return;
    }

    submitLockRef.current = true;
    setIsSubmitting(true);

    try {
      const result = await calculateDepreciationAction(periodId);

      if (!result.success) {
        toast.error(result.error ?? "คำนวณค่าเสื่อมราคาไม่สำเร็จ");
        return;
      }

      const parts: string[] = [
        periodLabel
          ? `คำนวณค่าเสื่อม ${periodLabel} สำเร็จ`
          : (result.message ?? "คำนวณค่าเสื่อมราคาสำเร็จ"),
      ];
      if (result.processedCount != null) {
        parts.push(`${result.processedCount} รายการ`);
      }
      if (result.totalAmount != null) {
        parts.push(`${formatBaht(result.totalAmount)} บาท`);
      }
      toast.success(parts.join(" · "));
      router.refresh();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "คำนวณค่าเสื่อมราคาไม่สำเร็จ",
      );
    } finally {
      submitLockRef.current = false;
      setIsSubmitting(false);
    }
  }

  const busy = isSubmitting;

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className="h-8 gap-1.5"
      disabled={disabled || busy}
      onClick={() => {
        void handleClick();
      }}
      aria-busy={busy}
      aria-label={
        periodLabel
          ? `คำนวณค่าเสื่อมราคา ${periodLabel}`
          : "คำนวณค่าเสื่อมราคา"
      }
      title={
        disabled
          ? "งวดนี้ปิดงบแล้ว — ไม่สามารถโพสต์ค่าเสื่อมได้"
          : undefined
      }
    >
      {busy ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : (
        <Calculator className="size-3.5" />
      )}
      {busy ? "กำลังคำนวณ…" : "คำนวณค่าเสื่อม"}
    </Button>
  );
}
