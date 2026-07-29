"use client";

/**
 * Toggle original-receipt / issued-document status on a document_allocations row.
 * Labels are contextual by parent doc_type (REC vs PAY).
 */

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { updateReceiptStatus } from "@/lib/actions/finance/allocations";
import { Button } from "@/components/ui/button";

export type ReceiptStatusLabelMode = "REC" | "PAY";

export type OriginalReceiptStatusToggleProps = {
  allocationId: string;
  isReceived: boolean;
  /** REC = sales wording · PAY = purchase wording (default). */
  labelMode?: ReceiptStatusLabelMode;
};

function labelsFor(mode: ReceiptStatusLabelMode) {
  if (mode === "REC") {
    return {
      pending: "รอออกเอกสาร",
      done: "ออกเอกสารแล้ว",
      toastPending: "อัปเดตเป็น «รอออกเอกสาร»",
      toastDone: "อัปเดตเป็น «ออกเอกสารแล้ว»",
    };
  }
  return {
    pending: "รอเอกสาร",
    done: "ได้รับแล้ว",
    toastPending: "อัปเดตเป็น «รอเอกสาร»",
    toastDone: "อัปเดตเป็น «ได้รับแล้ว»",
  };
}

export function OriginalReceiptStatusToggle({
  allocationId,
  isReceived,
  labelMode = "PAY",
}: OriginalReceiptStatusToggleProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const labels = labelsFor(labelMode);

  function handleToggle() {
    const nextReceived = !isReceived;
    startTransition(async () => {
      const result = await updateReceiptStatus(allocationId, nextReceived);
      if (!result.success) {
        toast.error(result.error ?? "อัปเดตสถานะเอกสารไม่สำเร็จ");
        return;
      }
      toast.success(nextReceived ? labels.toastDone : labels.toastPending);
      router.refresh();
    });
  }

  if (isReceived) {
    return (
      <Button
        type="button"
        size="sm"
        disabled={isPending}
        onClick={handleToggle}
        className="h-8 border border-emerald-200 bg-emerald-50 px-3 text-xs font-semibold text-emerald-800 hover:bg-emerald-100"
      >
        {isPending ? "กำลังบันทึก..." : labels.done}
      </Button>
    );
  }

  return (
    <Button
      type="button"
      size="sm"
      disabled={isPending}
      onClick={handleToggle}
      className="h-8 bg-orange-500 px-3 text-xs font-semibold text-white hover:bg-orange-600"
    >
      {isPending ? "กำลังบันทึก..." : labels.pending}
    </Button>
  );
}
