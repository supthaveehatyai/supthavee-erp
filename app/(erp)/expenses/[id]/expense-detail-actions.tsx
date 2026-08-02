"use client";

/**
 * Expense lifecycle actions — Client island.
 * DRAFT  → Edit / Issue / Delete Draft (hard delete)
 * ISSUED → Void only (status → VOID, row retained)
 * Mutations go through Server Actions (Zero Client-Side Fetching).
 * Confirmations use shadcn AlertDialog — never window.confirm.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  deleteDraftExpense,
  issueExpense,
  voidExpense,
} from "@/app/actions/expenses";
import { DOCUMENT_ACTIONS } from "@/lib/constants/document-actions";
import { IssueDocumentButton } from "@/components/shared/document/issue-document-button";
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

export type ExpenseDetailActionsProps = {
  expenseId: string;
  documentNo: string;
  status: string;
};

export function ExpenseDetailActions({
  expenseId,
  documentNo,
  status,
}: ExpenseDetailActionsProps) {
  const router = useRouter();
  const normalized = status.trim().toUpperCase();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [isDeleting, startDeleteTransition] = useTransition();

  function handleDeleteDraft() {
    if (isDeleting) return;

    startDeleteTransition(async () => {
      try {
        const result = await deleteDraftExpense(expenseId);
        if (result.error || !result.data) {
          toast.error(result.error ?? "ลบเอกสารร่างไม่สำเร็จ");
          setDeleteOpen(false);
          return;
        }

        toast.success(`ลบเอกสารร่าง ${result.data.document_no} แล้ว`);
        setDeleteOpen(false);
        router.refresh();
        router.push("/expenses");
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "ลบเอกสารร่างไม่สำเร็จ",
        );
        setDeleteOpen(false);
      }
    });
  }

  if (normalized === "DRAFT") {
    return (
      <div className="flex flex-wrap gap-2">
        <Link
          href={`/expenses/${expenseId}/edit`}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
        >
          <Pencil className="h-4 w-4" />
          {DOCUMENT_ACTIONS.EDIT}
        </Link>

        <IssueDocumentButton
          documentId={expenseId}
          docNo={documentNo}
          issueAction={issueExpense}
          confirmTitle="ยืนยันและออกเอกสาร"
          confirmDescription={
            <>
              ระบบจะรันเลขที่ทางการแบบ Late Numbering (
              <span className="font-mono">EXP-YYMM-XXXX</span>) และเปลี่ยนสถานะเป็น
              ISSUED การกระทำนี้ไม่สามารถย้อนกลับได้
            </>
          }
          confirmLabel="ยืนยันออกเอกสาร"
          onIssued={() => {
            router.refresh();
          }}
        />

        <Button
          type="button"
          variant="destructive"
          className="h-10 gap-2"
          disabled={isDeleting}
          onClick={() => setDeleteOpen(true)}
        >
          {isDeleting ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Trash2 className="size-4" />
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
                  {documentNo}
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
      </div>
    );
  }

  if (normalized === "ISSUED") {
    return (
      <div className="flex flex-wrap gap-2">
        <VoidDocumentButton
          documentId={expenseId}
          docNo={documentNo}
          voidAction={voidExpense}
          confirmTitle="ยืนยันยกเลิกเอกสาร"
          confirmDescription={
            <>
              เอกสารที่ออกแล้วจะเปลี่ยนสถานะเป็น VOID (ไม่ลบแถวข้อมูล)
              เพื่อคง Audit Trail การกระทำนี้ไม่สามารถย้อนกลับได้
            </>
          }
          confirmLabel="ยืนยันยกเลิกเอกสาร"
          onVoided={() => {
            router.refresh();
          }}
        />
      </div>
    );
  }

  // VOID — permanently locked, no lifecycle actions
  return null;
}
