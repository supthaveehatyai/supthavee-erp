"use client";

/**
 * Sales Issue Document — thin wrapper over shared AlertDialog button.
 * Calls `issueDocument` Server Action (Service Role). Never touches Supabase client.
 */

import { useRouter } from "next/navigation";
import { issueDocument } from "@/lib/actions/document-actions";
import { IssueDocumentButton } from "@/components/shared/document/issue-document-button";

export type IssueDocumentButtonProps = {
  documentId: string;
  docNo: string;
};

export default function SalesIssueDocumentButton({
  documentId,
  docNo,
}: IssueDocumentButtonProps) {
  const router = useRouter();

  return (
    <IssueDocumentButton
      documentId={documentId}
      docNo={docNo}
      issueAction={async (id) => {
        const result = await issueDocument(id);
        if (result.error || !result.data) {
          return { data: null, error: result.error ?? "ออกเอกสารไม่สำเร็จ" };
        }
        return {
          data: {
            id: result.data.document_id,
            document_no: result.data.document_no,
            successMessage:
              `ออกเอกสาร ${result.data.document_no} สำเร็จ` +
              (result.data.ledger_count > 0
                ? ` — ตัดสต็อก ${result.data.ledger_count} รายการ`
                : ""),
          },
          error: null,
        };
      }}
      confirmDescription={
        <>
          คุณต้องการยืนยันและออกเอกสารนี้ใช่หรือไม่? ระบบจะรันเลขที่ทางการ
          (Late Numbering) ตัดสต็อกหากจำเป็น และเปลี่ยนสถานะเป็น ISSUED
          การกระทำนี้ไม่สามารถย้อนกลับได้
        </>
      }
      onIssued={(data) => {
        const nextDocNo = data.document_no;
        if (nextDocNo && nextDocNo !== docNo) {
          router.replace(`/sales/${encodeURIComponent(nextDocNo)}`);
        } else {
          router.refresh();
        }
      }}
    />
  );
}
