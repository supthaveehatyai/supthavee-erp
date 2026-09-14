import { PrintLayout } from "@/components/shared/print/PrintLayout";
import { DocumentPrintSummary } from "@/components/shared/print/DocumentPrintSummary";
import { getDocumentPrintPaperSize } from "@/lib/actions/settings";
import type { DocumentDetail } from "@/types/document";
import type { DocumentAllocationRow } from "@/types/document-allocation";
import type { PrintVatType } from "@/types/print-document";
import { cn } from "@/lib/utils";
import {
  formatSignedCreditMoney,
  isAllocationCreditDocType,
  isCreditNoteDocType,
  signedAllocationAmount,
  sumSignedAllocations,
} from "@/lib/utils/rec-payment-summary";
import { roundMoney } from "@/lib/utils/payment-fifo";

function formatMoney(value: number): string {
  return value.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function isDepositAllocation(docType: string): boolean {
  return docType === "DEP_IN" || docType === "DEP_OUT";
}

function formatAllocatedAmount(row: DocumentAllocationRow): string {
  const signed = signedAllocationAmount(
    Number(row.allocated_amount ?? 0),
    row.target_doc_type,
  );
  if (isAllocationCreditDocType(row.target_doc_type)) {
    return formatSignedCreditMoney(signed);
  }
  return formatMoney(signed);
}

function normalizePrintVatType(value: string | null | undefined): PrintVatType {
  if (value === "INCLUSIVE" || value === "EXCLUSIVE" || value === "NONE") {
    return value;
  }
  return "NONE";
}

export type PrintPaymentReceiptTemplateProps = {
  document: DocumentDetail;
  allocations: DocumentAllocationRow[];
  /** REC = receive payment, PAY = vendor payment */
  mode: "REC" | "PAY";
  className?: string;
};

/**
 * REC / PAY print — Shared PrintLayout (A5-Landscape) + DocumentPrintSummary.
 */
export default async function PrintPaymentReceiptTemplate({
  document: doc,
  allocations,
  mode,
  className,
}: PrintPaymentReceiptTemplateProps) {
  const invoiceSettlement = Number(doc.grand_total ?? 0);
  const whtAmount = Number(doc.wht_amount ?? 0);
  const partyLabel =
    mode === "REC" ? "ลูกค้า / Customer" : "ผู้จำหน่าย / Vendor";
  const titleLabel =
    mode === "REC"
      ? "ใบเสร็จรับเงิน (Receipt)"
      : "ใบจ่ายชำระหนี้ (Payment Voucher)";

  const invoiceSum = allocations
    .filter((row) => !isAllocationCreditDocType(row.target_doc_type))
    .reduce((sum, row) => sum + Number(row.allocated_amount ?? 0), 0);
  const depositSum = allocations
    .filter((row) => isDepositAllocation(row.target_doc_type))
    .reduce((sum, row) => sum + Number(row.allocated_amount ?? 0), 0);
  const cnSum = allocations
    .filter((row) => isCreditNoteDocType(row.target_doc_type))
    .reduce((sum, row) => sum + Number(row.allocated_amount ?? 0), 0);
  const netFromAllocations = sumSignedAllocations(allocations);
  const allocatedWht = allocations.reduce(
    (sum, row) => sum + Number(row.wht_amount ?? 0),
    0,
  );
  const creditDiscount = roundMoney(depositSum + cnSum);
  const discountLabel =
    cnSum > 0 && depositSum > 0
      ? "ใบลดหนี้ / มัดจำ"
      : cnSum > 0
        ? "ใบลดหนี้"
        : depositSum > 0
          ? "หักมัดจำ"
          : null;

  const vatType = normalizePrintVatType(doc.vat_type);
  const vatRate = Number(doc.vat_rate ?? doc.tax_rate ?? 7);
  const paperSize = await getDocumentPrintPaperSize(mode);

  return (
    <PrintLayout
      title={titleLabel}
      documentNo={doc.doc_no}
      date={doc.doc_date}
      status={`${doc.status} · ${doc.payment_status}`}
      partyLabel={partyLabel}
      customerData={doc.contact}
      referenceNo={doc.notes?.trim() || undefined}
      paperSize={paperSize}
      documentId="payment-print-document"
      className={cn("mt-2 print:mt-0", className)}
      footer={{
        preparedLabel: "ผู้จัดทำ",
        receivedLabel: mode === "REC" ? "ผู้ชำระเงิน" : "ผู้รับเงิน",
        approvedLabel: "ผู้อนุมัติ",
      }}
    >
      <section>
        <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-neutral-700">
          รายการเอกสารที่ตัดชำระ
        </h2>
        <table className="w-full border-collapse text-left text-xs">
          <thead>
            <tr className="border-b border-neutral-400">
              <th className="py-1.5 pr-2 font-semibold text-neutral-700">#</th>
              <th className="py-1.5 pr-2 font-semibold text-neutral-700">
                เลขที่เอกสารภายใน
              </th>
              <th className="py-1.5 pr-2 font-semibold text-neutral-700">
                เลขอ้างอิงภายนอก
              </th>
              <th className="py-1.5 pr-2 text-right font-semibold text-neutral-700">
                ยอดตัดชำระ
              </th>
              <th className="py-1.5 text-right font-semibold text-neutral-700">
                WHT
              </th>
            </tr>
          </thead>
          <tbody>
            {allocations.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-6 text-center text-neutral-400">
                  ไม่พบรายการเอกสารที่ตัดชำระ
                </td>
              </tr>
            ) : (
              allocations.map((row, index) => {
                const isDeposit = isDepositAllocation(row.target_doc_type);
                const isCn = isCreditNoteDocType(row.target_doc_type);
                const isCredit = isAllocationCreditDocType(row.target_doc_type);
                const docNoLabel = isCn
                  ? `(หัก) ใบลดหนี้ ${row.target_doc_no}`
                  : isDeposit
                    ? `(หัก) มัดจำ ${row.target_doc_no}`
                    : row.target_doc_no;
                return (
                  <tr
                    key={row.id}
                    className="border-b border-neutral-200 align-top"
                  >
                    <td className="py-1.5 pr-2 tabular-nums text-neutral-500">
                      {index + 1}
                    </td>
                    <td className="py-1.5 pr-2 font-mono text-[11px] font-medium text-neutral-800">
                      {docNoLabel}
                      {row.target_doc_type ? (
                        <span className="ml-1 text-[10px] text-neutral-400">
                          ({row.target_doc_type === "EXPENSE"
                            ? "EXP"
                            : row.target_doc_type})
                        </span>
                      ) : null}
                    </td>
                    <td className="py-1.5 pr-2 font-mono text-[11px] text-neutral-700">
                      {row.reference_no?.trim() || "—"}
                    </td>
                    <td
                      className={
                        isCredit
                          ? "py-1.5 pr-2 text-right tabular-nums text-neutral-700"
                          : "py-1.5 pr-2 text-right tabular-nums text-neutral-900"
                      }
                    >
                      {formatAllocatedAmount(row)}
                    </td>
                    <td className="py-1.5 text-right tabular-nums text-neutral-700">
                      {formatMoney(row.wht_amount)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
          {allocations.length > 0 ? (
            <tfoot>
              <tr className="border-t border-neutral-200">
                <td
                  colSpan={3}
                  className="py-1.5 pr-2 text-right text-neutral-600"
                >
                  รวมบิลตั้งหนี้
                </td>
                <td className="py-1.5 pr-2 text-right tabular-nums text-neutral-800">
                  {formatMoney(invoiceSum)}
                </td>
                <td className="py-1.5 text-right tabular-nums text-neutral-800">
                  {formatMoney(allocatedWht)}
                </td>
              </tr>
              {cnSum > 0 ? (
                <tr>
                  <td
                    colSpan={3}
                    className="py-1.5 pr-2 text-right text-neutral-600"
                  >
                    หักใบลดหนี้
                  </td>
                  <td className="py-1.5 pr-2 text-right tabular-nums text-neutral-800">
                    {formatSignedCreditMoney(cnSum)}
                  </td>
                  <td className="py-1.5 text-right tabular-nums text-neutral-500">
                    —
                  </td>
                </tr>
              ) : null}
              {depositSum > 0 ? (
                <tr>
                  <td
                    colSpan={3}
                    className="py-1.5 pr-2 text-right text-neutral-600"
                  >
                    หักมัดจำ
                  </td>
                  <td className="py-1.5 pr-2 text-right tabular-nums text-neutral-800">
                    {formatSignedCreditMoney(depositSum)}
                  </td>
                  <td className="py-1.5 text-right tabular-nums text-neutral-500">
                    —
                  </td>
                </tr>
              ) : null}
              <tr className="border-t border-neutral-400">
                <td
                  colSpan={3}
                  className="py-1.5 pr-2 text-right font-semibold text-neutral-800"
                >
                  รวมสุทธิ (บิล − มัดจำ)
                </td>
                <td className="py-1.5 pr-2 text-right font-semibold tabular-nums text-neutral-950">
                  {formatMoney(netFromAllocations)}
                </td>
                <td className="py-1.5 text-right font-semibold tabular-nums text-neutral-950">
                  {formatMoney(allocatedWht)}
                </td>
              </tr>
            </tfoot>
          ) : null}
        </table>
      </section>

      <DocumentPrintSummary
        className="mt-4"
        subtotal={invoiceSettlement}
        discountAmount={creditDiscount}
        discountText={discountLabel}
        vatType={vatType}
        vatRate={vatRate}
        grandTotal={netFromAllocations}
        withholdingTaxAmount={whtAmount || allocatedWht || undefined}
      />
    </PrintLayout>
  );
}
