"use client";

/**
 * Void / Cancel & Replace — Client island only.
 * Calls Server Actions; never touches Supabase from the browser.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FilePlus2, Loader2, Ban } from "lucide-react";
import { toast } from "sonner";
import {
  cloneDocumentToNewDraft,
  voidDocument,
} from "@/lib/actions/document-actions";
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

export type VoidDocumentActionsProps = {
  documentId: string;
  docNo: string;
};

type ConfirmMode = "void" | "replace" | null;

export default function VoidDocumentActions({
  documentId,
  docNo,
}: VoidDocumentActionsProps) {
  const router = useRouter();
  const [confirmMode, setConfirmMode] = useState<ConfirmMode>(null);
  const [isSaving, setIsSaving] = useState(false);

  function closeConfirm() {
    if (isSaving) return;
    setConfirmMode(null);
  }

  async function handleVoidOnly() {
    if (isSaving) return;
    setIsSaving(true);
    try {
      const result = await voidDocument(documentId);
      if (result.error || !result.data) {
        toast.error(result.error ?? "ยกเลิกเอกสารไม่สำเร็จ");
        setConfirmMode(null);
        return;
      }

      toast.success(
        `ยกเลิกเอกสาร ${result.data.document_no} แล้ว` +
          (result.data.reversed_ledger_count > 0
            ? ` — คืนสต็อก ${result.data.reversed_ledger_count} รายการ`
            : ""),
      );
      setConfirmMode(null);
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "ยกเลิกเอกสารไม่สำเร็จ",
      );
      setConfirmMode(null);
    } finally {
      setIsSaving(false);
    }
  }

  async function handleCancelAndReplace() {
    if (isSaving) return;
    setIsSaving(true);
    try {
      const voidResult = await voidDocument(documentId);
      if (voidResult.error || !voidResult.data) {
        toast.error(voidResult.error ?? "ยกเลิกเอกสารไม่สำเร็จ");
        setConfirmMode(null);
        return;
      }

      const cloneResult = await cloneDocumentToNewDraft(documentId);
      if (cloneResult.error || !cloneResult.data) {
        toast.error(
          cloneResult.error ??
            "ยกเลิกเอกสารแล้ว แต่สร้างเอกสารร่างทดแทนไม่สำเร็จ",
        );
        setConfirmMode(null);
        router.refresh();
        return;
      }

      toast.success(
        `ยกเลิก ${voidResult.data.document_no} และสร้างร่างทดแทน ${cloneResult.data.document_no}`,
      );
      setConfirmMode(null);
      router.push(
        `/sales/${encodeURIComponent(cloneResult.data.document_no)}`,
      );
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "ออกเอกสารทดแทนไม่สำเร็จ",
      );
      setConfirmMode(null);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="destructive"
        className="h-10 gap-2"
        disabled={isSaving}
        onClick={() => setConfirmMode("void")}
      >
        <Ban className="size-4" />
        {DOCUMENT_ACTIONS.VOID}
      </Button>

      <Button
        type="button"
        variant="outline"
        className="h-10 gap-2 border-amber-200 bg-amber-50 text-amber-900 hover:bg-amber-100"
        disabled={isSaving}
        onClick={() => setConfirmMode("replace")}
      >
        <FilePlus2 className="size-4" />
        ออกเอกสารทดแทน
      </Button>

      <AlertDialog
        open={confirmMode != null}
        onOpenChange={(open) => {
          if (!open) closeConfirm();
        }}
        dismissible={!isSaving}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmMode === "replace"
                ? "ยืนยันออกเอกสารทดแทน"
                : "ยืนยันยกเลิกเอกสาร"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmMode === "replace" ? (
                <>
                  ระบบจะยกเลิกเอกสารนี้ (สถานะ CANCELLED) คืนสต็อกถ้ามี
                  แล้วสร้างเอกสารร่างใหม่พร้อมคัดลอกรายการสินค้า
                  การยกเลิกไม่สามารถย้อนกลับได้
                </>
              ) : (
                <>
                  คุณต้องการยกเลิกเอกสารที่ออกแล้วใช่หรือไม่?
                  สต็อกจะถูกคืนด้วยรายการกลับ (OUT↔IN) หากมี
                  การกระทำนี้ไม่สามารถย้อนกลับได้
                </>
              )}
              <span className="mt-2 block font-mono text-slate-700">
                {docNo}
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={isSaving}
              onClick={closeConfirm}
            >
              ยกเลิก
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={isSaving}
              onClick={() => {
                if (confirmMode === "replace") {
                  void handleCancelAndReplace();
                } else {
                  void handleVoidOnly();
                }
              }}
            >
              {isSaving ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  กำลังดำเนินการ...
                </>
              ) : confirmMode === "replace" ? (
                "ยืนยันยกเลิกและสร้างร่างใหม่"
              ) : (
                "ยืนยันยกเลิกเอกสาร"
              )}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
