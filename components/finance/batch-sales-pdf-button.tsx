"use client";

import { useState } from "react";
import { Printer } from "lucide-react";
import { getBatchSalesDocumentsForPdf } from "@/lib/actions/tax-reports";
import { buildBatchSalesPrintHtml } from "@/lib/tax/batch-sales-print-html";

type BatchSalesPdfButtonProps = {
  year: number;
  month: number;
  subFilter: string;
};

export function BatchSalesPdfButton({
  year,
  month,
  subFilter,
}: BatchSalesPdfButtonProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function printBatch() {
    setPending(true);
    setError(null);
    try {
      const result = await getBatchSalesDocumentsForPdf(year, month, subFilter);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (result.documents.length === 0) {
        setError("ไม่พบเอกสารขายในช่วงเดือนและหมวดที่เลือก");
        return;
      }
      const frame = document.createElement("iframe");
      frame.setAttribute("title", "Batch PDF");
      frame.style.position = "fixed";
      frame.style.right = "0";
      frame.style.bottom = "0";
      frame.style.width = "0";
      frame.style.height = "0";
      frame.style.border = "0";
      document.body.appendChild(frame);
      const doc = frame.contentDocument;
      const view = frame.contentWindow;
      if (!doc || !view) {
        frame.remove();
        setError("เปิดหน้าพิมพ์ไม่สำเร็จ");
        return;
      }
      doc.open();
      doc.write(buildBatchSalesPrintHtml(result.documents));
      doc.close();
      window.setTimeout(() => {
        view.focus();
        view.print();
        window.setTimeout(() => frame.remove(), 1000);
      }, 300);
    } catch (err) {
      setError(err instanceof Error ? err.message : "สร้างไฟล์ PDF ไม่สำเร็จ");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={() => void printBatch()}
        disabled={pending}
        className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 shadow-sm transition hover:bg-slate-50 disabled:cursor-wait disabled:opacity-60"
      >
        <Printer className="size-4" />
        {pending ? "กำลังเตรียมเอกสาร..." : "🖨️ Export เอกสารเป็น PDF (Batch PDF)"}
      </button>
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </div>
  );
}
