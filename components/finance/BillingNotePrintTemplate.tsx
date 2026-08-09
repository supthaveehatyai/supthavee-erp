import { PrintLayout } from "@/components/shared/print/PrintLayout";
import { DocumentPrintSummary } from "@/components/shared/print/DocumentPrintSummary";
import { resolvePrintPaperSize } from "@/lib/constants/print-paper-size";
import type { BillingNoteDetailData } from "@/app/actions/billing";
import { cn } from "@/lib/utils";

export type BillingNotePrintTemplateProps = {
  document: BillingNoteDetailData;
  className?: string;
};

function formatMoney(value: number): string {
  return value.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDateShort(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("th-TH", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * BN / BR print — Shared PrintLayout (A5-Landscape).
 */
export default async function BillingNotePrintTemplate({
  document: doc,
  className,
}: BillingNotePrintTemplateProps) {
  const isBN = doc.doc_type === "BN";
  const titleTh = isBN ? "ใบวางบิล" : "ใบรับวางบิล";
  const titleEn = isBN ? "Billing Note" : "Bill Receipt";
  const partyLabel = isBN ? "ลูกค้า / Bill To" : "คู่ค้า / Bill From";
  const lineTotal = doc.invoices.reduce(
    (sum, line) => sum + line.billed_amount,
    0,
  );
  const grandTotal = Number(doc.grand_total || lineTotal);
  const paperSize = resolvePrintPaperSize(doc.doc_type);

  return (
    <PrintLayout
      title={`${titleTh} / ${titleEn}`}
      documentNo={doc.doc_no}
      date={doc.doc_date}
      dueDate={doc.due_date}
      status={doc.payment_status}
      partyLabel={partyLabel}
      customerData={doc.contact}
      paperSize={paperSize}
      documentId="billing-note-print-document"
      className={cn("mt-2 print:mt-0", className)}
      footer={{
        preparedLabel: "ผู้จัดทำ",
        receivedLabel: "ผู้รับเอกสาร",
        approvedLabel: "ผู้อนุมัติ",
      }}
    >
      <section>
        <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-neutral-700">
          รายการเอกสารในใบวางบิล
        </h2>
        <table className="w-full border-collapse text-left text-xs">
          <thead>
            <tr className="border-b border-neutral-400">
              <th className="py-1.5 pr-2 font-semibold text-neutral-700">#</th>
              <th className="py-1.5 pr-2 font-semibold text-neutral-700">
                เลขที่เอกสาร
              </th>
              <th className="py-1.5 pr-2 font-semibold text-neutral-700">
                วันที่
              </th>
              <th className="py-1.5 pr-2 font-semibold text-neutral-700">
                ครบกำหนด
              </th>
              <th className="py-1.5 text-right font-semibold text-neutral-700">
                ยอดวางบิล
              </th>
            </tr>
          </thead>
          <tbody>
            {doc.invoices.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-6 text-center text-neutral-400">
                  ไม่พบรายการบิลในเอกสารนี้
                </td>
              </tr>
            ) : (
              doc.invoices.map((line, index) => (
                <tr
                  key={line.id}
                  className="border-b border-neutral-200 align-top"
                >
                  <td className="py-1.5 pr-2 tabular-nums text-neutral-500">
                    {index + 1}
                  </td>
                  <td className="py-1.5 pr-2 font-mono text-[11px] font-medium text-neutral-800">
                    {line.invoice_doc_no}
                    <span className="ml-1 text-[10px] text-neutral-400">
                      ({line.invoice_doc_type})
                    </span>
                  </td>
                  <td className="py-1.5 pr-2 text-neutral-700">
                    {formatDateShort(line.invoice_doc_date)}
                  </td>
                  <td className="py-1.5 pr-2 text-neutral-700">
                    {formatDateShort(line.invoice_due_date)}
                  </td>
                  <td className="py-1.5 text-right tabular-nums text-neutral-900">
                    {formatMoney(line.billed_amount)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>

      <DocumentPrintSummary
        className="mt-4"
        subtotal={grandTotal}
        discountAmount={0}
        vatType="NONE"
        vatRate={7}
        grandTotal={grandTotal}
      />
    </PrintLayout>
  );
}
