"use client";

import { useTransition } from "react";
import { Loader2, Receipt } from "lucide-react";
import { toast } from "sonner";
import { issueReceiptForTaxInvoice } from "@/lib/actions/sales-receipt-actions";

export function IssueSalesReceiptButton({ documentId }: { documentId: string }) {
  const [pending, startTransition] = useTransition();

  function issue() {
    if (pending) return;
    startTransition(async () => {
      const result = await issueReceiptForTaxInvoice({
        sourceDocumentId: documentId,
        receiptDate: new Date().toISOString().slice(0, 10),
      });
      if (result.error || !result.data?.doc_no) {
        toast.error(result.error ?? "ออกใบเสร็จรับเงินไม่สำเร็จ");
        return;
      }
      window.location.assign(`/sales/${encodeURIComponent(result.data.doc_no)}`);
    });
  }

  return (
    <button
      type="button"
      disabled={pending}
      onClick={issue}
      className="inline-flex h-10 items-center gap-2 rounded-xl bg-emerald-600 px-3 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-60"
    >
      {pending ? <Loader2 className="size-4 animate-spin" /> : <Receipt className="size-4" />}
      🧾 ออกใบเสร็จรับเงิน (REC)
    </button>
  );
}
