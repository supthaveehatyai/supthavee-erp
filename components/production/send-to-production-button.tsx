"use client";

/**
 * ส่งทั้งบิลเข้า Production Kanban — 1 บรรทัดบริการ/ผลิตเอง = 1 การ์ด
 */

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Factory, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { sendDocumentToKanban } from "@/lib/actions/production/send-to-production-action";
import { Button } from "@/components/ui/button";

export type SendToProductionButtonProps = {
  documentId: string;
  documentNo?: string;
  disabled?: boolean;
};

export function SendToProductionButton({
  documentId,
  disabled = false,
}: SendToProductionButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    if (!documentId || isPending || disabled) return;
    startTransition(async () => {
      const result = await sendDocumentToKanban(documentId);
      if (!result.success || !result.data) {
        toast.error(result.error ?? "ส่งงานเข้า Production Kanban ไม่สำเร็จ");
        return;
      }
      const jobNos = result.data.job_nos.filter(Boolean);
      toast.success(
        jobNos.length > 0
          ? `ส่งงานเข้า Production Kanban แล้ว: ${jobNos.join(", ")}`
          : "ส่งงานเข้า Production Kanban แล้ว",
      );
      if (result.error) toast.error(result.error);
      router.push("/production/kanban");
    });
  }

  return (
    <Button
      type="button"
      variant="outline"
      disabled={disabled || !documentId || isPending}
      onClick={handleClick}
      className="h-10 gap-2 border-violet-200 bg-violet-50 font-semibold text-violet-800 hover:bg-violet-100 disabled:opacity-60"
    >
      {isPending ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <Factory className="size-4" />
      )}
      🏭 ส่งงานเข้า Production Kanban
    </Button>
  );
}

export default SendToProductionButton;
