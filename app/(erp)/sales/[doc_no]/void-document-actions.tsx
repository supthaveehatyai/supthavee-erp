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
  voidDocumentAction,
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

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
  const [voidReason, setVoidReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);

  function closeConfirm(force = false) {
    if (isSaving && !force) return;
    setConfirmMode(null);
    setVoidReason("");
    setReasonError(null);
  }

  function openConfirm(mode: ConfirmMode) {
    if (isSaving) return;
    setVoidReason("");
    setReasonError(null);
    setConfirmMode(mode);
  }

  function requireReason(): string | null {
    const reason = voidReason.trim();
    if (!reason) {
      setReasonError("กรุณาระบุเหตุผลการยกเลิกเอกสาร");
      return null;
    }
    setReasonError(null);
    return reason;
  }

  async function handleVoidOnly() {
    if (isSaving) return;
    const reason = requireReason();
    if (!reason) return;

    setIsSaving(true);
    try {
      const result = await voidDocumentAction(documentId, reason);
      if (result.error || !result.data) {
        toast.error(result.error ?? "ยกเลิกเอกสารไม่สำเร็จ");
        return;
      }

      toast.success(
        `ยกเลิกเอกสาร ${result.data.document_no} แล้ว` +
          (result.data.reversed_ledger_count > 0
            ? ` — คืนสต็อก ${result.data.reversed_ledger_count} รายการ`
            : ""),
      );
      closeConfirm(true);
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "ยกเลิกเอกสารไม่สำเร็จ",
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function handleCancelAndReplace() {
    if (isSaving) return;
    const reason = requireReason();
    if (!reason) return;

    setIsSaving(true);
    try {
      const voidResult = await voidDocumentAction(documentId, reason);
      if (voidResult.error || !voidResult.data) {
        toast.error(voidResult.error ?? "ยกเลิกเอกสารไม่สำเร็จ");
        return;
      }

      const cloneResult = await cloneDocumentToNewDraft(documentId);
      if (cloneResult.error || !cloneResult.data) {
        toast.error(
          cloneResult.error ??
            "ยกเลิกเอกสารแล้ว แต่สร้างเอกสารร่างทดแทนไม่สำเร็จ",
        );
        closeConfirm(true);
        router.refresh();
        return;
      }

      toast.success(
        `ยกเลิก ${voidResult.data.document_no} และสร้างร่างทดแทน ${cloneResult.data.document_no}`,
      );
      closeConfirm(true);
      router.push(
        `/sales/${encodeURIComponent(cloneResult.data.document_no)}`,
      );
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "ออกเอกสารทดแทนไม่สำเร็จ",
      );
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
        onClick={() => openConfirm("void")}
      >
        {isSaving && confirmMode === "void" ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Ban className="size-4" />
        )}
        {isSaving && confirmMode === "void"
          ? "กำลังดำเนินการ..."
          : DOCUMENT_ACTIONS.VOID}
      </Button>

      <Button
        type="button"
        variant="outline"
        className="h-10 gap-2 border-amber-200 bg-amber-50 text-amber-900 hover:bg-amber-100"
        disabled={isSaving}
        onClick={() => openConfirm("replace")}
      >
        {isSaving && confirmMode === "replace" ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <FilePlus2 className="size-4" />
        )}
        {isSaving && confirmMode === "replace"
          ? "กำลังดำเนินการ..."
          : "ออกเอกสารทดแทน"}
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
                  ระบบจะยกเลิกเอกสารนี้ (สถานะ VOID) คืนสต็อกถ้ามี
                  แล้วสร้างเอกสารร่างใหม่พร้อมคัดลอกรายการสินค้า
                  การยกเลิกไม่สามารถย้อนกลับได้
                </>
              ) : (
                <>
                  คุณต้องการยกเลิกเอกสารที่ออกแล้วใช่หรือไม่?
                  สต็อกจะถูกคืนด้วยรายการกลับ หากมี
                  สถานะจะเปลี่ยนเป็น VOID และการกระทำนี้ไม่สามารถย้อนกลับได้
                </>
              )}
              <span className="mt-2 block font-mono text-slate-700">
                {docNo}
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="sales-void-reason">
              เหตุผลการยกเลิก <span className="text-red-600">*</span>
            </Label>
            <Textarea
              id="sales-void-reason"
              value={voidReason}
              disabled={isSaving}
              placeholder="ระบุเหตุผลการยกเลิกเอกสาร..."
              onChange={(event) => {
                setVoidReason(event.target.value);
                if (reasonError) setReasonError(null);
              }}
            />
            {reasonError ? (
              <p className="text-xs font-medium text-red-600">{reasonError}</p>
            ) : null}
          </div>
          <AlertDialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={isSaving}
              onClick={() => closeConfirm()}
            >
              ยกเลิก
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={isSaving || !voidReason.trim()}
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
