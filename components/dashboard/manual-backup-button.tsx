"use client";

/**
 * Phase 9 — Manual Backup button (Client island).
 * Calls Server Action `triggerManualBackup` only — Zero Client-Side Fetching.
 * Toast via sonner (project standard; no window.alert).
 */

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Database, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { triggerManualBackup } from "@/lib/actions/backup-actions";

export function ManualBackupButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    if (isPending) return;

    startTransition(async () => {
      try {
        const result = await triggerManualBackup();

        if (!result.success) {
          toast.error(result.error ?? "สำรองข้อมูลไม่สำเร็จ");
          return;
        }

        if (result.error) {
          toast.warning(result.error);
        } else {
          toast.success("สำรองข้อมูลสำเร็จ (Database + Storage)");
        }

        router.refresh();
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "สำรองข้อมูลไม่สำเร็จ",
        );
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
      {isPending ? "กำลังสำรองข้อมูล…" : "Manual Backup"}
    </Button>
  );
}
