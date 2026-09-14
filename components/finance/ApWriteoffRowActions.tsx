"use client";

/**
 * Global Document Actions สำหรับประวัติ AP_WRITEOFF
 * DRAFT → ลบร่าง / PENDING → Preview / ISSUED → VOID
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Eye, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  deleteApWriteoffDraft,
  voidApWriteoff,
} from "@/app/actions/ap-writeoff";
import { VoidDocumentButton } from "@/components/shared/document/void-document-button";
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
import { DOCUMENT_ACTIONS } from "@/lib/constants/document-actions";
import type { ApWriteoffListStatus } from "@/types/ap-writeoff";

export type ApWriteoffRowActionsProps = {
  documentId: string;
  docNo: string;
  listStatus: ApWriteoffListStatus;
  previewHref: string;
};

export function ApWriteoffRowActions({
  documentId,
  docNo,
  listStatus,
  previewHref,
}: ApWriteoffRowActionsProps) {
  const router = useRouter();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [isDeleting, startDeleteTransition] = useTransition();

  function handleDeleteDraft() {
    if (isDeleting) return;

    startDeleteTransition(async () => {
      try {
        const result = await deleteApWriteoffDraft(documentId);
        if (!result.success) {
          toast.error(result.error ?? "ลบเอกสารร่างไม่สำเร็จ");
          setDeleteOpen(false);
          return;
        }

        toast.success(`ลบเอกสารร่าง ${result.docNo ?? docNo} แล้ว`);
        setDeleteOpen(false);
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "ลบเอกสารร่างไม่สำเร็จ");
        setDeleteOpen(false);
      }
    });
  }

  if (listStatus === "PENDING") {
    return (
      <Link
        href={previewHref}
        className="inline-flex h-8 items-center justify-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-3 text-xs font-semibold text-amber-900 transition hover:bg-amber-100"
      >
        <Eye className="size-3.5" />
        รออนุมัติ — ดู Preview
      </Link>
    );
  }

  if (listStatus === "DRAFT") {
    return (
      <>
        <Button
          type="button"
          variant="destructive"
          size="sm"
          className="gap-1.5"
          disabled={isDeleting}
          onClick={() => setDeleteOpen(true)}
        >
          {isDeleting ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Trash2 className="size-3.5" />
          )}
          {DOCUMENT_ACTIONS.DELETE_DRAFT}
        </Button>
        <AlertDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          dismissible={!isDeleting}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>ยืนยันลบเอกสารร่าง</AlertDialogTitle>
              <AlertDialogDescription>
                เอกสารร่างจะถูกลบออกจากระบบอย่างถาวร (Hard Delete)
                และไม่สามารถกู้คืนได้
                <span className="mt-2 block font-mono text-slate-700">
                  {docNo}
                </span>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isDeleting} />
              <AlertDialogAction
                disabled={isDeleting}
                className="bg-red-600 hover:bg-red-700 disabled:bg-red-400"
                onClick={(event) => {
                  event.preventDefault();
                  handleDeleteDraft();
                }}
              >
                {isDeleting ? (
                  <>
                    <Loader2 className="mr-1 inline size-4 animate-spin" />
                    กำลังลบ...
                  </>
                ) : (
                  "ยืนยันลบเอกสารร่าง"
                )}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </>
    );
  }

  if (listStatus === "ISSUED") {
    return (
      <VoidDocumentButton
        documentId={documentId}
        docNo={docNo}
        requireReason
        voidAction={voidApWriteoff}
        confirmTitle="ยืนยันยกเลิกเอกสาร"
        confirmDescription={
          <>
            เอกสารที่ออกแล้วจะเปลี่ยนสถานะเป็น VOID (ไม่ลบแถวข้อมูล)
            เพื่อคง Audit Trail การกระทำนี้ไม่สามารถกู้คืนได้
          </>
        }
        confirmLabel="ยืนยันยกเลิกเอกสาร"
        onVoided={() => {
          router.refresh();
        }}
      />
    );
  }

  return null;
}
