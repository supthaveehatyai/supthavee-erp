"use client";

/**
 * Send to Production — Sales document detail.
 * - SO + is_manufactured → createProductionJobFromSO (MTO Kanban)
 * - อื่นๆ (สกรีน/ปัก legacy) → CreateJobModal
 */

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Factory, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { createProductionJobFromSO } from "@/lib/actions/production-actions";
import type { ManufacturedSendGroup } from "@/types/production";
import { CreateJobModal } from "@/components/production/create-job-modal";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type SendToProductionButtonProps = {
  documentId: string;
  documentNo: string;
  /** Extra lock (e.g. parent still resolving) — page already gates ISSUED */
  disabled?: boolean;
  /**
   * กลุ่มรุ่น is_manufactured บน SO — ถ้ามี → ใช้ MTO flow
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
  remark = null,
}: SendToProductionButtonProps) {
  const router = useRouter();
  const [legacyOpen, setLegacyOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isSubmitting, startSubmit] = useTransition();

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
      setConfirmOpen(true);
      return;
    }
    setLegacyOpen(true);
  }

  function handleConfirmSend() {
    if (pendingGroups.length === 0) return;

    startSubmit(async () => {
      let successCount = 0;
      let lastJobNo = "";
      const errors: string[] = [];

      for (const group of pendingGroups) {
        const result = await createProductionJobFromSO({
          so_id: documentId,
          finished_model_id: group.finished_model_id,
          mockup_image_url: group.mockup_image_url,
          remark,
          items: group.items,
        });

        if (!result.success || !result.data) {
          errors.push(
            `${group.model_code || group.model_name}: ${result.error ?? "ไม่สำเร็จ"}`,
          );
          continue;
        }

        successCount += 1;
        lastJobNo = result.data.job_no;
      }

      if (successCount > 0) {
        toast.success(
          successCount === 1 && lastJobNo
            ? `ยิงงานเข้า Kanban ผลิตเรียบร้อยแล้ว (${lastJobNo})`
            : `ยิงงานเข้า Kanban ผลิตเรียบร้อยแล้ว (${successCount} รุ่น)`,
        );
        setConfirmOpen(false);
        router.refresh();
      }

      if (errors.length > 0) {
        toast.error(errors[0] ?? "ส่งงานผลิตไม่สำเร็จ");
      }
    });
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        disabled={disabled || !documentId || isSubmitting || allSent}
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

      {/* MTO confirm */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>ยืนยันส่งงานผลิต (MTO)</DialogTitle>
            <DialogDescription>
              ระบบจะสร้างใบสั่งผลิตจาก SO{" "}
              <span className="font-mono font-semibold text-slate-700">
                {documentNo}
              </span>{" "}
              พร้อม Snapshot BOM และรายการไซส์อัตโนมัติ
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-64 space-y-2 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50/80 p-3">
            {pendingGroups.map((group) => {
              const qty = group.items.reduce(
                (sum, item) => sum + Number(item.quantity ?? 0),
                0,
              );
              return (
                <div
                  key={group.finished_model_id}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                >
                  <p className="font-medium text-slate-900">
                    <span className="font-mono text-xs text-slate-500">
                      {group.model_code}
                    </span>{" "}
                    {group.model_name}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {group.items.length} SKU · รวม {qty.toLocaleString("th-TH")}{" "}
                    ชิ้น
                    {group.mockup_image_url ? " · มี Mockup" : ""}
                  </p>
                </div>
              );
            })}
            {sentGroups.length > 0 ? (
              <p className="px-1 text-xs text-emerald-700">
                ส่งแล้ว {sentGroups.length} รุ่น — จะข้ามไม่สร้างซ้ำ
              </p>
            ) : null}
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              disabled={isSubmitting}
              onClick={() => setConfirmOpen(false)}
            >
              ยกเลิก
            </Button>
            <Button
              type="button"
              disabled={isSubmitting || pendingGroups.length === 0}
              onClick={handleConfirmSend}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-1.5 size-4 animate-spin" />
                  กำลังส่ง...
                </>
              ) : (
                `ยืนยันส่ง ${pendingGroups.length} รุ่น`
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Legacy screen / embroidery modal */}
      {!isMtoMode ? (
        <CreateJobModal
          documentId={documentId}
          documentNo={documentNo}
          open={legacyOpen}
          onOpenChange={setLegacyOpen}
        />
      ) : null}
    </>
  );
}

export default SendToProductionButton;
