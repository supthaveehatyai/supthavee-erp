"use client";

/**
 * Expense lifecycle actions — Client island.
 * DRAFT  → Edit / Issue (≤5k) / Send for Approval (>5k) / Delete Draft
 * ISSUED → Void only
 * Mutations via Server Actions only (Zero Client-Side Fetching).
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2, Pencil, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  deleteDraftExpense,
  issueExpense,
  sendExpenseForApproval,
  voidExpense,
} from "@/app/actions/expenses";
import {
  EXPENSE_APPROVAL_THRESHOLD,
  PENDING_APPROVAL_TOAST_MESSAGE,
  requiresExpenseApproval,
} from "@/lib/approval/approval-rules";
import { DOCUMENT_ACTIONS } from "@/lib/constants/document-actions";
import { buildFixedAssetCapitalizeHref } from "@/lib/utils/expense-capitalize";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export type ExpenseDetailActionsProps = {
  expenseId: string;
  documentNo: string;
  status: string;
  grandTotal: number;
  expenseDate: string;
  approvalStatus: string;
  canCapitalize: boolean;
  hasRegisteredAsset: boolean;
};

function CapitalizeFixedAssetButton({
  expenseId,
  grandTotal,
  expenseDate,
  canCapitalize,
  hasRegisteredAsset,
}: {
  expenseId: string;
  grandTotal: number;
  expenseDate: string;
  canCapitalize: boolean;
  hasRegisteredAsset: boolean;
}) {
  if (!canCapitalize || hasRegisteredAsset) return null;

  return (
    <Link
      href={buildFixedAssetCapitalizeHref({
        expenseId,
        grandTotal,
        expenseDate,
      })}
    >
      <Button
        variant="default"
        className="bg-indigo-600 text-white hover:bg-indigo-700"
      >
        ⚡ ขึ้นทะเบียนเป็นสินทรัพย์ถาวร
      </Button>
    </Link>
  );
}

export function ExpenseDetailActions({
  expenseId,
  documentNo,
  status,
  grandTotal,
  expenseDate,
  approvalStatus,
  canCapitalize,
  hasRegisteredAsset,
}: ExpenseDetailActionsProps) {
  const router = useRouter();
  const normalized = status.trim().toUpperCase();
  const approval = approvalStatus.trim().toUpperCase();
  const needsApproval = requiresExpenseApproval(grandTotal);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [isDeleting, startDeleteTransition] = useTransition();
  const [isSending, startSendTransition] = useTransition();

  const capitalizeButton = (
    <CapitalizeFixedAssetButton
      expenseId={expenseId}
      grandTotal={grandTotal}
      expenseDate={expenseDate}
      canCapitalize={canCapitalize}
      hasRegisteredAsset={hasRegisteredAsset}
    />
  );

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

  function handleSendForApproval() {
    if (isSending) return;

    startSendTransition(async () => {
      try {
        const result = await sendExpenseForApproval(expenseId);
        if (result.error || !result.data) {
          toast.error(result.error ?? "ส่งขออนุมัติไม่สำเร็จ");
          return;
        }
        toast.success(
          result.successMessage ?? PENDING_APPROVAL_TOAST_MESSAGE,
        );
        router.refresh();
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "ส่งขออนุมัติไม่สำเร็จ",
        );
      }
    });
  }

  if (normalized === "DRAFT") {
    const showWaitingApproval = needsApproval && approval === "PENDING";
    const showSendForApproval = needsApproval && approval !== "PENDING";
    const showIssue = !needsApproval;

    return (
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={`/expenses/${expenseId}/edit`}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
        >
          <Pencil className="h-4 w-4" />
          {DOCUMENT_ACTIONS.EDIT}
        </Link>

        {showWaitingApproval ? (
          <Badge variant="amber" className="h-10 gap-1.5 px-3 text-xs">
            รออนุมัติ (Approval Center)
          </Badge>
        ) : null}

        {showSendForApproval ? (
          <Button
            type="button"
            className="h-10 gap-2 bg-amber-600 hover:bg-amber-700"
            disabled={isSending}
            onClick={handleSendForApproval}
          >
            {isSending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Send className="size-4" />
            )}
            {isSending ? "กำลังส่ง..." : "ส่งขออนุมัติ"}
          </Button>
        ) : null}

        {needsApproval && approval === "REJECTED" ? (
          <Badge
            variant="amber"
            className="h-10 bg-red-100 px-3 text-xs text-red-800"
          >
            ถูกปฏิเสธ — ส่งขออนุมัติใหม่
          </Badge>
        ) : null}

        {needsApproval ? (
          <p className="w-full text-xs text-slate-500 sm:w-auto">
            ยอดเกิน ฿{EXPENSE_APPROVAL_THRESHOLD.toLocaleString("th-TH")} —
            ต้องผ่าน Approval Center ก่อนออกเอกสาร
          </p>
        ) : null}

        {showIssue ? (
          <IssueDocumentButton
            documentId={expenseId}
            docNo={documentNo}
            issueAction={async (id) => {
              const result = await issueExpense(id);
              if (result.error || !result.data) {
                return { data: null, error: result.error };
              }
              return {
                data: {
                  id: result.data.id,
                  document_no: result.data.document_no,
                  successMessage: result.successMessage,
                },
                error: null,
              };
            }}
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
        ) : null}

        <Button
          type="button"
          variant="destructive"
          className="h-10 gap-2"
          disabled={isDeleting || approval === "PENDING"}
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
        {capitalizeButton}
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

  if (normalized === "PAID") {
    return (
      <div className="flex flex-wrap gap-2">{capitalizeButton}</div>
    );
  }

  return null;
}
