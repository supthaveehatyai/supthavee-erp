import type { Metadata } from "next";
import { Suspense } from "react";
import { getPendingApprovals } from "@/app/actions/approval";
import { DocumentPreviewSheet } from "@/components/finance/DocumentPreviewSheet";
import type { ApprovalTab } from "@/types/approval";
import { ApprovalCenterPanel } from "./approval-center-panel";
import { DocumentPreviewContent } from "./document-preview-content";
import { ExpenseApprovalReviewContent } from "./expense-approval-review-content";
import { ExpenseApprovalReviewSheet } from "./expense-approval-review-sheet";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Approval Center | Maker-Checker",
  description:
    "ศูนย์อนุมัติเอกสารและค่าใช้จ่าย — Maker-Checker Workflow (Admin only)",
};

type PageProps = {
  searchParams: Promise<{
    tab?: string;
    view_expense?: string;
    preview_doc_id?: string;
  }>;
};

function resolveTab(raw: string | undefined): ApprovalTab {
  return raw === "expenses" ? "expenses" : "documents";
}

function ApprovalCenterFallback() {
  return (
    <div className="flex min-h-[240px] items-center justify-center text-sm text-slate-500">
      กำลังโหลดรายการรออนุมัติ...
    </div>
  );
}

async function ApprovalCenterContent({ searchParams }: PageProps) {
  const params = await searchParams;
  const tab = resolveTab(params.tab);
  const viewExpenseId = params.view_expense?.trim() || null;
  const previewDocId = params.preview_doc_id?.trim() || null;
  const result = await getPendingApprovals();

  if (!result.success) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        {result.error}
      </div>
    );
  }

  return (
    <>
      <ApprovalCenterPanel data={result.data} initialTab={tab} />
      <DocumentPreviewSheet previewDocId={previewDocId}>
        {previewDocId ? (
          <Suspense
            fallback={
              <div className="px-6 py-8 text-sm text-slate-500">
                กำลังโหลดรายละเอียดเอกสาร...
              </div>
            }
          >
            <DocumentPreviewContent documentId={previewDocId} />
          </Suspense>
        ) : null}
      </DocumentPreviewSheet>
      <ExpenseApprovalReviewSheet expenseId={viewExpenseId}>
        {viewExpenseId ? (
          <Suspense
            fallback={
              <div className="px-6 py-8 text-sm text-slate-500">
                กำลังโหลดรายละเอียดค่าใช้จ่าย...
              </div>
            }
          >
            <ExpenseApprovalReviewContent expenseId={viewExpenseId} />
          </Suspense>
        ) : null}
      </ExpenseApprovalReviewSheet>
    </>
  );
}

export default async function ApprovalsPage(props: PageProps) {
  return (
    <div className="p-6">
      <Suspense fallback={<ApprovalCenterFallback />}>
        <ApprovalCenterContent searchParams={props.searchParams} />
      </Suspense>
    </div>
  );
}
