import { ExpenseApprovalReviewContent } from "@/app/(dashboard)/approvals/expense-approval-review-content";
import type { WHTReportSource } from "@/types/tax";
import { WhtTbPreviewContent } from "./wht-tb-preview-content";

/**
 * Server Component — routes WHT preview to EXP or TB content.
 * Zero Client-Side Fetching: Service Role actions only.
 */
export async function WhtDocumentPreviewContent({
  source,
  documentId,
}: {
  source: WHTReportSource;
  documentId: string;
}) {
  if (source === "EXP") {
    return <ExpenseApprovalReviewContent expenseId={documentId} />;
  }

  return <WhtTbPreviewContent documentId={documentId} />;
}
