"use client";

/**
 * Delete DRAFT document — Client island only.
 * Calls `deleteDraftDocument` Server Action. Never touches Supabase client.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { deleteDraftDocument } from "@/app/actions/documents";
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

export type DeleteDraftDocumentButtonProps = {
  documentId: string;
  docNo: string;
};

export default function DeleteDraftDocumentButton({
  documentId,
  docNo,
}: DeleteDraftDocumentButtonProps) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleConfirm() {
    startTransition(async () => {
      const result = await deleteDraftDocument(documentId);
      if (!result.success) {
        toast.error(result.error ?? "ลบเอกสารร่างไม่สำเร็จ");
        setConfirmOpen(false);
        return;
      }

      toast.success(`ลบเอกสารร่าง ${result.docNo ?? docNo} แล้ว`);
      setConfirmOpen(false);
      router.push("/sales");
      router.refresh();
    });
  }

  return (
    <>
      <Button
        type="button"
        variant="destructive"
        className="h-10 gap-2"
        disabled={isPending}
        onClick={() => setConfirmOpen(true)}
      >
        {isPending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Trash2 className="size-4" />
        )}
        ลบเอกสาร
        <span className="sr-only">{docNo}</span>
      </Button>

      <AlertDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        dismissible={!isPending}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>ยืนยันการลบเอกสารร่าง</AlertDialogTitle>
            <AlertDialogDescription>
              คุณต้องการลบเอกสารร่างนี้ใช่หรือไม่? การกระทำนี้ไม่สามารถย้อนกลับได้
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
              onClick={handleConfirm}
            >
              {isPending ? "กำลังลบ..." : "ยืนยันลบ"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
