"use client";

/**
 * Phase 9 — Manual Backup request button (Client island).
 * Calls Server Action `triggerManualBackup` → audit_logs only (Zero Client-Side Fetching).
 * Toast via sonner — แจ้งเตือนให้รัน backup ที่ Server สาขาหาดใหญ่
 */

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Database, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { triggerManualBackup } from "@/lib/actions/backup-actions";

const FALLBACK_DR_WARNING =
  "แจ้งเตือน: การสำรองข้อมูลระดับ Database (Disaster Recovery) ไม่สามารถรันบน Cloud ได้ กรุณารันสคริปต์ npm run backup:db และ npm run backup:storage ที่เครื่อง Server สาขาหาดใหญ่โดยตรง เพื่อความปลอดภัยของข้อมูล";

export function ManualBackupButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    if (isPending) return;

    startTransition(async () => {
      try {
        const result = await triggerManualBackup();

        if (!result.success) {
          const err = result.error ?? "บันทึกคำขอ Backup ไม่สำเร็จ";
          toast.error(
            err === "Forbidden"
              ? "Forbidden: ไม่มีสิทธิ์ Manual Backup (ต้องเป็น Admin หรือมีโมดูล settings)"
              : err,
          );
          return;
        }

        toast.warning(result.message ?? FALLBACK_DR_WARNING, {
          duration: 15000,
          description: "บันทึกคำขอลง Audit Log เรียบร้อยแล้ว",
        });

        router.refresh();
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "บันทึกคำขอ Backup ไม่สำเร็จ";
        toast.error(msg);
      }
    });
  }

  return (
    <Button
      type="button"
      variant="outline"
      className="h-10 gap-2"
      disabled={isPending}
      onClick={handleClick}
      aria-busy={isPending}
    >
      {isPending ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <Database className="size-4" />
      )}
      {isPending ? "กำลังบันทึกคำขอ…" : "Manual Backup"}
    </Button>
  );
}
