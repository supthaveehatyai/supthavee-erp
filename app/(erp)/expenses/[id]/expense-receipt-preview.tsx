"use client";

/**
 * Back-compat wrapper — receipt preview uses shared attachment preview.
 */

import { ExpenseAttachmentPreview } from "./expense-attachment-preview";

type ExpenseReceiptPreviewProps = {
  receiptUrl: string | null | undefined;
  documentNo: string;
};

export function ExpenseReceiptPreview({
  receiptUrl,
  documentNo,
}: ExpenseReceiptPreviewProps) {
  return (
    <ExpenseAttachmentPreview
      url={receiptUrl}
      documentNo={documentNo}
      title="ใบเสร็จ"
      emptyLabel="ไม่มีไฟล์แนบ"
      fileLabel="ไฟล์แนบใบเสร็จ"
      viewFullLabel="ดูใบเสร็จเต็มจอ"
    />
  );
}
