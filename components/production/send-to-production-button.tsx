"use client";

/**
 * Shared "Send to Production" action for Sales document detail pages.
 * Opens CreateJobModal — eligible only when status === ISSUED (page gates visibility).
 */

import { useState } from "react";
import { Factory } from "lucide-react";
import { CreateJobModal } from "@/components/production/create-job-modal";
import { Button } from "@/components/ui/button";

export type SendToProductionButtonProps = {
  documentId: string;
  documentNo: string;
  /** Extra lock (e.g. parent still resolving) — page already gates ISSUED */
  disabled?: boolean;
};

export function SendToProductionButton({
  documentId,
  documentNo,
  disabled = false,
}: SendToProductionButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        type="button"
        variant="outline"
        disabled={disabled || !documentId}
        onClick={() => setOpen(true)}
        className="h-10 gap-2 border-violet-200 bg-violet-50 font-semibold text-violet-800 hover:bg-violet-100 disabled:opacity-60"
      >
        <Factory className="size-4" />
        ส่งงานผลิต (Send to Production)
      </Button>

      <CreateJobModal
        documentId={documentId}
        documentNo={documentNo}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  );
}

export default SendToProductionButton;
