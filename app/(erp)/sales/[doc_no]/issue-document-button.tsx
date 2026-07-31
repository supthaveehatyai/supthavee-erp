"use client";

/**
 * Issue Document action bar — Client island only.
 * Calls `issueDocument` Server Action (Service Role). Never touches Supabase client.
 */

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { issueDocument } from "@/lib/actions/document-actions";
import { Button } from "@/components/ui/button";

export type IssueDocumentButtonProps = {
  documentId: string;
  docNo: string;
};

export default function IssueDocumentButton({
  documentId,
  docNo,
}: IssueDocumentButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleIssue() {
    startTransition(async () => {
      const result = await issueDocument(documentId);
      if (result.error || !result.data) {
        toast.error(result.error ?? "ออกเอกสารไม่สำเร็จ");
        return;
      }

      toast.success(
        `ออกเอกสาร ${result.data.document_no} สำเร็จ` +
          (result.data.ledger_count > 0
            ? ` — ตัดสต็อก ${result.data.ledger_count} รายการ`
            : ""),
      );

      // Late Numbering may replace DRAFT-* with the official running number.
      const nextDocNo = result.data.document_no;
      if (nextDocNo && nextDocNo !== docNo) {
        router.replace(`/sales/${encodeURIComponent(nextDocNo)}`);
      } else {
        router.refresh();
      }
    });
  }

  return (
    <Button
      type="button"
      onClick={handleIssue}
      disabled={isPending}
      className="h-10 gap-2"
    >
      {isPending ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <CheckCircle2 className="size-4" />
      )}
      {isPending ? "กำลังออกเอกสาร..." : "ยืนยันและออกเอกสาร"}
      <span className="sr-only">{docNo}</span>
    </Button>
  );
}
