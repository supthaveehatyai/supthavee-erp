"use client";

/**
 * Shared Issue Document button — Phase 4/5 AlertDialog standard.
 * Inject a Server Action via `issueAction` (Zero Client-Side Fetching).
 */

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2 } from "lucide-react";
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

export type IssueDocumentActionResult = {
  data: {
    id?: string;
    document_no: string;
    /** Optional toast override (e.g. include ledger cut count). */
    successMessage?: string;
  } | null;
  error: string | null;
};

export type IssueDocumentButtonProps = {
  documentId: string;
  docNo: string;
  /** Server Action: issueExpense / issueDocument / etc. */
  issueAction: (id: string) => Promise<IssueDocumentActionResult>;
  /** Override success navigation (default: router.refresh). */
  onIssued?: (data: { id?: string; document_no: string }) => void;
  confirmTitle?: string;
  confirmDescription?: ReactNode;
  confirmLabel?: string;
  disabled?: boolean;
};

export function IssueDocumentButton({
  documentId,
  docNo,
  issueAction,
  onIssued,
  confirmTitle = "ยืนยันและออกเอกสาร",
  confirmDescription,
  confirmLabel = "ยืนยันออกเอกสาร",
  disabled = false,
}: IssueDocumentButtonProps) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleConfirm() {
    if (isPending) return;

    startTransition(async () => {
      try {
        const result = await issueAction(documentId);
        if (result.error || !result.data) {
          toast.error(result.error ?? "ออกเอกสารไม่สำเร็จ");
          setConfirmOpen(false);
          return;
        }

        toast.success(
          result.data.successMessage ??
            `ออกเอกสาร ${result.data.document_no} สำเร็จ`,
        );
        setConfirmOpen(false);

        if (onIssued) {
          onIssued(result.data);
        } else {
          router.refresh();
        }
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "ออกเอกสารไม่สำเร็จ",
        );
        setConfirmOpen(false);
      }
    });
  }

  return (
    <>
      <Button
        type="button"
        className="h-10 gap-2"
        disabled={disabled || isPending}
        onClick={() => setConfirmOpen(true)}
      >
        {isPending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <CheckCircle2 className="size-4" />
        )}
        {isPending ? "กำลังออกเอกสาร..." : DOCUMENT_ACTIONS.ISSUE}
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
                  คุณต้องการยืนยันและออกเอกสารนี้ใช่หรือไม่?
                  สถานะจะเปลี่ยนเป็น ISSUED และการกระทำนี้ไม่สามารถย้อนกลับได้
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
              onClick={(event) => {
                event.preventDefault();
                handleConfirm();
              }}
            >
              {isPending ? (
                <>
                  <Loader2 className="mr-1 inline size-4 animate-spin" />
                  กำลังออกเอกสาร...
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

export default IssueDocumentButton;
