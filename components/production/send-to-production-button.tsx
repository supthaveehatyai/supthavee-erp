"use client";

/**
 * Send to Production — Sales document detail.
 * - SO + is_manufactured → BatchProductionModal (1 mockup / model)
 * - อื่นๆ (สกรีน/ปัก legacy) → CreateJobModal
 */

import { useMemo, useState } from "react";
import { CheckCircle2, Factory } from "lucide-react";
import { toast } from "sonner";
import type { ManufacturedSendGroup } from "@/types/production";
import { BatchProductionModal } from "@/components/sales/batch-production-modal";
import { CreateJobModal } from "@/components/production/create-job-modal";
import { Button } from "@/components/ui/button";

export type SendToProductionButtonProps = {
  documentId: string;
  documentNo: string;
  /** Extra lock (e.g. parent still resolving) — page already gates ISSUED */
  disabled?: boolean;
  /**
   * กลุ่มรุ่น is_manufactured บน SO — ถ้ามี → ใช้ Batch MTO flow
   * ถ้าว่าง → เปิด CreateJobModal (งานสกรีน/ปัก เดิม)
   */
  manufacturedGroups?: ManufacturedSendGroup[];
  remark?: string | null;
};

export function SendToProductionButton({
  documentId,
  documentNo,
  disabled = false,
  manufacturedGroups = [],
}: SendToProductionButtonProps) {
  const [legacyOpen, setLegacyOpen] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);

  const pendingGroups = useMemo(
    () => manufacturedGroups.filter((group) => !group.already_sent),
    [manufacturedGroups],
  );
  const sentGroups = useMemo(
    () => manufacturedGroups.filter((group) => group.already_sent),
    [manufacturedGroups],
  );
  const isMtoMode = manufacturedGroups.length > 0;
  const allSent = isMtoMode && pendingGroups.length === 0;

  function handleClick() {
    if (isMtoMode) {
      if (allSent) {
        toast.info("เอกสารนี้ส่งงานผลิตครบทุกรุ่นแล้ว");
        return;
      }
      setBatchOpen(true);
      return;
    }
    setLegacyOpen(true);
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        disabled={disabled || !documentId || allSent}
        onClick={handleClick}
        className={
          allSent
            ? "h-10 gap-2 border-emerald-200 bg-emerald-50 font-semibold text-emerald-800 hover:bg-emerald-50 disabled:opacity-100"
            : "h-10 gap-2 border-violet-200 bg-violet-50 font-semibold text-violet-800 hover:bg-violet-100 disabled:opacity-60"
        }
      >
        {allSent ? (
          <>
            <CheckCircle2 className="size-4" />
            ส่งงานผลิตแล้ว
          </>
        ) : (
          <>
            <Factory className="size-4" />
            ส่งงานผลิต (Send to Production)
          </>
        )}
      </Button>

      {isMtoMode ? (
        <BatchProductionModal
          open={batchOpen}
          onOpenChange={setBatchOpen}
          documentId={documentId}
          documentNo={documentNo}
          pendingGroups={pendingGroups}
          sentCount={sentGroups.length}
        />
      ) : (
        <CreateJobModal
          documentId={documentId}
          documentNo={documentNo}
          open={legacyOpen}
          onOpenChange={setLegacyOpen}
        />
      )}
    </>
  );
}

export default SendToProductionButton;
