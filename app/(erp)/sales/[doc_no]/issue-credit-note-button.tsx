"use client";

/**
 * Credit Note ISSUE — Client island only.
 * Calls `issueCreditNoteAction` Server Action. Never touches Supabase client.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { issueCreditNoteAction } from "@/lib/actions/document-actions";
import { DOCUMENT_ACTIONS } from "@/lib/constants/document-actions";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

export type IssueCreditNoteButtonProps = {
  documentId: string;
  docNo: string;
};

export default function IssueCreditNoteButton({
  documentId,
  docNo,
}: IssueCreditNoteButtonProps) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function closeConfirm() {
    if (isSubmitting) return;
    setConfirmOpen(false);
  }

  async function handleConfirm() {
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      const result = await issueCreditNoteAction(documentId);
      if (result.error || !result.data) {
        toast.error(result.error ?? "ออกใบลดหนี้ไม่สำเร็จ");
        return;
      }

      toast.success(
        result.data.successMessage ??
          `ออกใบลดหนี้ ${result.data.document_no} สำเร็จ`,
      );
      setConfirmOpen(false);

      const nextDocNo = result.data.document_no;
      if (nextDocNo && nextDocNo !== docNo) {
        router.replace(`/sales/${encodeURIComponent(nextDocNo)}`);
      } else {
        router.refresh();
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "ออกใบลดหนี้ไม่สำเร็จ",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        className="h-10 gap-2"
        disabled={isSubmitting}
        onClick={() => setConfirmOpen(true)}
      >
        {isSubmitting ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <CheckCircle2 className="size-4" />
        )}
        {isSubmitting ? "กำลังออกเอกสาร..." : DOCUMENT_ACTIONS.ISSUE}
        <span className="sr-only">{docNo}</span>
      </Button>

      <AlertDialog
        open={confirmOpen}
        onOpenChange={(open) => {
          if (!open) closeConfirm();
          else setConfirmOpen(true);
        }}
        dismissible={!isSubmitting}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>ยืนยันเอกสาร (ISSUE)</AlertDialogTitle>
            <AlertDialogDescription>
              ระบบจะรันเลขที่ใบลดหนี้จริง (Late Numbering) ลดยอดลูกหนี้
              และรับคืนสต็อกตามบรรทัดที่เลือกไว้
              สถานะจะเปลี่ยนเป็น ISSUED การกระทำนี้ไม่สามารถย้อนกลับได้
              <span className="mt-2 block font-mono text-slate-700">
                {docNo}
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={isSubmitting}
              onClick={closeConfirm}
            >
              ยกเลิก
            </Button>
            <Button
              type="button"
              disabled={isSubmitting}
              onClick={() => void handleConfirm()}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  กำลังออกเอกสาร...
                </>
              ) : (
                "ยืนยันออกเอกสาร"
              )}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
