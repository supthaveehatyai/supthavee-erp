"use client";

/**
 * Expense lifecycle actions — Client island.
 * DRAFT → Edit / Issue (ABAC ตัดสินวงเงินฝั่ง Server) / Delete Draft
 * PENDING → รอ Approval Center
 * ISSUED → Void only
 * Mutations via Server Actions only (Zero Client-Side Fetching).
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
import { EXPENSE_OVER_LIMIT_PENDING_MESSAGE } from "@/lib/approval/approval-rules";
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
  const isWaitingApproval =
    normalized === "PENDING" || approval === "PENDING";
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [isDeleting, startDeleteTransition] = useTransition();

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

  if (normalized === "PENDING" || (normalized === "DRAFT" && approval === "PENDING")) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="amber" className="h-10 gap-1.5 px-3 text-xs">
          รออนุมัติ (Approval Center)
        </Badge>
        <p className="w-full text-xs text-slate-500 sm:w-auto">
          เอกสารเกินวงเงินอนุมัติของผู้ยืนยัน — รอ Checker อนุมัติที่ศูนย์อนุมัติ
        </p>
      </div>
    );
  }

  if (normalized === "DRAFT") {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={`/expenses/${expenseId}/edit`}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
        >
          <Pencil className="h-4 w-4" />
          {DOCUMENT_ACTIONS.EDIT}
        </Link>

        {approval === "REJECTED" ? (
          <Badge
            variant="amber"
            className="h-10 bg-red-100 px-3 text-xs text-red-800"
          >
            ถูกปฏิเสธ — แก้ไขแล้วกดยืนยันอีกครั้ง
          </Badge>
        ) : null}

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
                successMessage:
                  result.successMessage ??
                  (result.pending_approval
                    ? EXPENSE_OVER_LIMIT_PENDING_MESSAGE
                    : undefined),
              },
              error: null,
            };
          }}
          confirmTitle="ยืนยันและออกเอกสาร"
          confirmDescription={
            <>
              ระบบจะตรวจวงเงินอนุมัติ (ABAC) ของคุณ — หากอยู่ในวงเงินจะรันเลขที่
              ทางการและเปลี่ยนเป็น ISSUED/PAID หากเกินวงเงินจะส่งเข้าศูนย์อนุมัติ
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
          disabled={isDeleting || isWaitingApproval}
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
