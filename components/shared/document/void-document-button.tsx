"use client";

/**
 * Shared Void Document button — Phase 4/5 AlertDialog standard.
 * Inject a Server Action via `voidAction` (Zero Client-Side Fetching).
 * (Sales Cancel & Replace stays in the Sales-specific VoidDocumentActions.)
 */

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Ban, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { DOCUMENT_ACTIONS } from "@/lib/constants/document-actions";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

export type VoidDocumentActionResult = {
  data: { id?: string; document_no: string } | null;
  error: string | null;
};

export type VoidDocumentButtonProps = {
  documentId: string;
  docNo: string;
  /** Server Action: voidExpense / voidDocument / etc. */
  voidAction: (id: string) => Promise<VoidDocumentActionResult>;
  onVoided?: (data: { id?: string; document_no: string }) => void;
  confirmTitle?: string;
  confirmDescription?: ReactNode;
  confirmLabel?: string;
  disabled?: boolean;
};

export function VoidDocumentButton({
  documentId,
  docNo,
  voidAction,
  onVoided,
  confirmTitle = "ยืนยันยกเลิกเอกสาร",
  confirmDescription,
  confirmLabel = "ยืนยันยกเลิกเอกสาร",
  disabled = false,
}: VoidDocumentButtonProps) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleConfirm() {
    if (isPending) return;

    startTransition(async () => {
      try {
        const result = await voidAction(documentId);
        if (result.error || !result.data) {
          toast.error(result.error ?? "ยกเลิกเอกสารไม่สำเร็จ");
          setConfirmOpen(false);
          return;
        }

        toast.success(`ยกเลิกเอกสาร ${result.data.document_no} แล้ว`);
        setConfirmOpen(false);

        if (onVoided) {
          onVoided(result.data);
        } else {
          router.refresh();
        }
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "ยกเลิกเอกสารไม่สำเร็จ",
        );
        setConfirmOpen(false);
      }
    });
  }

  return (
    <>
      <Button
        type="button"
        variant="destructive"
        className="h-10 gap-2"
        disabled={disabled || isPending}
        onClick={() => setConfirmOpen(true)}
      >
        {isPending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Ban className="size-4" />
        )}
        {DOCUMENT_ACTIONS.VOID}
        <span className="sr-only">{docNo}</span>
      </Button>

      <AlertDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        dismissible={!isPending}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDescription ?? (
                <>
                  คุณต้องการยกเลิกเอกสารนี้ใช่หรือไม่?
                  สถานะจะเปลี่ยนเป็น VOID และการกระทำนี้ไม่สามารถย้อนกลับได้
                </>
              )}
              <span className="mt-2 block font-mono text-slate-700">
                {docNo}
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending} />
            <AlertDialogAction
              disabled={isPending}
              className="bg-red-600 hover:bg-red-700 disabled:bg-red-400"
              onClick={(event) => {
                event.preventDefault();
                handleConfirm();
              }}
            >
              {isPending ? (
                <>
                  <Loader2 className="mr-1 inline size-4 animate-spin" />
                  กำลังดำเนินการ...
                </>
              ) : (
                confirmLabel
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export default VoidDocumentButton;
