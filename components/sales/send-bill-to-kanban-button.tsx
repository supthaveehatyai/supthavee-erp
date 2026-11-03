"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Factory, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { sendToProduction } from "@/lib/actions/production/send-to-production-action";
import { Button } from "@/components/ui/button";

export type KanbanTargetLine = {
  id: string;
  label: string;
  sent: boolean;
};

export function SendBillToKanbanButton({
  lines,
}: {
  lines: KanbanTargetLine[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [sentIds, setSentIds] = useState<string[]>([]);
  const pending = lines.filter((line) => !line.sent && !sentIds.includes(line.id));

  function handleSend() {
    if (pending.length === 0 || isPending) return;
    startTransition(async () => {
      const done: string[] = [];
      const errors: string[] = [];
      for (const line of pending) {
        const result = await sendToProduction(line.id);
        if (result.success) done.push(line.id);
        else errors.push(`${line.label}: ${result.error ?? "ส่งไม่สำเร็จ"}`);
      }
      if (done.length > 0) {
        setSentIds((current) => [...current, ...done]);
        toast.success(`ส่งงานเข้า Production Kanban ${done.length} รายการ`);
        router.refresh();
      }
      if (errors.length > 0) toast.error(errors[0]);
    });
  }

  return (
    <Button
      type="button"
      variant="outline"
      disabled={isPending || pending.length === 0}
      onClick={handleSend}
      className="h-10 gap-2 border-violet-200 bg-violet-50 font-semibold text-violet-800 hover:bg-violet-100"
    >
      {isPending ? <Loader2 className="size-4 animate-spin" /> : <Factory className="size-4" />}
      🏭 ส่งงานเข้า Production Kanban
    </Button>
  );
}
