"use client";

/**
 * Expense lifecycle actions — Client island.
 * Issue / Void use shared AlertDialog buttons (Phase 4/5 UI standard).
 * Mutations go through Server Actions (Zero Client-Side Fetching).
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { issueExpense, voidExpense } from "@/app/actions/expenses";
import { DOCUMENT_ACTIONS } from "@/lib/constants/document-actions";
import { IssueDocumentButton } from "@/components/shared/document/issue-document-button";
import { VoidDocumentButton } from "@/components/shared/document/void-document-button";

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

  if (status.trim().toUpperCase() !== "DRAFT") {
    return null;
  }

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
          // Expense detail is keyed by UUID — refresh in place after Issue.
          router.refresh();
        }}
      />

      <VoidDocumentButton
        documentId={expenseId}
        docNo={documentNo}
        voidAction={voidExpense}
        confirmTitle="ยืนยันยกเลิกเอกสาร"
        confirmDescription={
          <>
            คุณต้องการยกเลิกเอกสารร่างนี้ใช่หรือไม่? สถานะจะเปลี่ยนเป็น VOID
            และจะไม่สามารถออกเอกสารได้อีก การกระทำนี้ไม่สามารถย้อนกลับได้
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
