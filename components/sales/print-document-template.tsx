import { PrintLayout } from "@/components/shared/print/PrintLayout";
import { DocumentPrintSummary } from "@/components/shared/print/DocumentPrintSummary";
import { getDocumentPrintPaperSize } from "@/lib/actions/settings";
import type { DocumentDetail, DocumentType } from "@/types/document";
import type { PrintPaperSize, PrintVatType } from "@/types/print-document";
import { cn } from "@/lib/utils";

const DOC_TYPE_LABELS: Record<DocumentType, string> = {
  QT: "ใบเสนอราคา (Quotation)",
  SO: "ใบสั่งขาย (Sales Order)",
  INV_DO: "ใบส่งของ / Delivery Order",
  TAX_INV: "ใบกำกับภาษี / ใบส่งของ (Tax Invoice)",
  CS_TAX: "ใบกำกับเงินสด (Cash Tax Invoice)",
  ABB: "ใบเสร็จอย่างย่อ (ABB)",
  DEP_IN: "ใบมัดจำรับ (Deposit In)",
  REC: "ใบเสร็จรับเงิน (Receipt)",
  CN: "ใบลดหนี้ (Credit Note)",
  PO: "ใบสั่งซื้อ (Purchase Order)",
  AP_TAX: "ใบส่งของ/ใบกำกับภาษีซื้อ (AP Tax)",
  AP_INV: "บิลซื้อธรรมดา (AP Invoice)",
  AP_CASH: "บิลเงินสดซื้อ (AP Cash)",
  DEP_OUT: "มัดจำจ่าย (Deposit Out)",
  PAY: "ใบจ่ายชำระ (Payment)",
  AR_REFUND: "ใบสำคัญจ่ายเงินคืน (Refund Payment)",
  AR_WRITEOFF: "ใบสำคัญปรับปรุงบัญชี - รับรู้รายได้ (Write-off Income)",
  AP_REFUND: "ใบสำคัญรับเงินคืน (Refund Receipt)",
  AP_WRITEOFF: "ใบสำคัญปรับปรุงบัญชี - ตัดเป็นค่าใช้จ่าย (Write-off Expense)",
  REFUND: "ใบสำคัญคืนเงิน (Refund — legacy)",
  WRITE_OFF: "ใบสำคัญตัดเศษ (Write-off — legacy)",
  DEP: "ใบมัดจำ (Deposit — legacy)",
  INT_REC: "ใบรับภายใน (Internal Receipt — legacy)",
};

function formatMoney(value: number): string {
  return value.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function normalizePrintVatType(value: string | null | undefined): PrintVatType {
  if (value === "INCLUSIVE" || value === "EXCLUSIVE" || value === "NONE") {
    return value;
  }
  return "NONE";
}

export type PrintDocumentTemplateProps = {
  document: DocumentDetail;
  className?: string;
  /** override ขนาดกระดาษ — default ตามประเภทเอกสาร */
  paperSize?: PrintPaperSize;
};

/**
 * Sales/Purchase document print — Shared PrintLayout (TFRS / company SSOT).
 * Paper size: lib/constants/print-paper-size.ts
 */
export default async function PrintDocumentTemplate({
  document: doc,
  className,
  paperSize,
}: PrintDocumentTemplateProps) {
  const isDepositDoc =
    doc.doc_type === "DEP_IN" || doc.doc_type === "DEP_OUT";
  const subtotal = Number(doc.total_amount ?? doc.sub_total ?? 0);
  const discountAmount = Number(doc.discount_amount ?? 0);
  const vatRate = Number(doc.vat_rate ?? doc.tax_rate ?? 7);
  const vatType = normalizePrintVatType(doc.vat_type);
  const grandTotal = Number(doc.grand_total ?? 0);
  const docTypeLabel = DOC_TYPE_LABELS[doc.doc_type] ?? doc.doc_type;
  const partyLabel =
    doc.doc_type === "DEP_OUT" ||
    doc.doc_type === "PO" ||
    doc.doc_type === "AP_TAX" ||
    doc.doc_type === "AP_INV" ||
    doc.doc_type === "AP_CASH" ||
    doc.doc_type === "PAY" ||
    doc.doc_type === "AP_REFUND" ||
    doc.doc_type === "AP_WRITEOFF"
      ? "ซัพพลายเออร์ / Vendor"
      : "ลูกค้า / Customer";

  const resolvedPaperSize =
    paperSize ?? (await getDocumentPrintPaperSize(doc.doc_type));
  const compact = resolvedPaperSize !== "A4";

  return (
    <PrintLayout
      title={docTypeLabel}
      documentNo={doc.doc_no}
      date={doc.doc_date}
      dueDate={doc.due_date}
      status={doc.status}
      referenceNo={doc.reference_no}
      partyLabel={partyLabel}
      customerData={doc.contact}
      paperSize={resolvedPaperSize}
      documentId="sales-print-document"
      className={cn("mt-2 print:mt-0", className)}
      footer={{
        preparedLabel: "ผู้จัดทำ",
        receivedLabel: isDepositDoc ? "ผู้รับ/จ่ายเงิน" : "ผู้รับของ",
        approvedLabel: "ผู้อนุมัติ",
      }}
    >
      {/* ตารางสินค้า / มัดจำ */}
      <section className={compact ? "mt-2" : "mt-1"}>
        {isDepositDoc ? (
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-neutral-400">
                <th className="py-1.5 pr-2 font-semibold text-neutral-700">#</th>
                <th className="py-1.5 pr-2 font-semibold text-neutral-700">
                  รายละเอียด
                </th>
                <th className="py-1.5 text-right font-semibold text-neutral-700">
                  ยอดเงิน
                </th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-neutral-200">
                <td className="py-2 pr-2 tabular-nums text-neutral-500">1</td>
                <td className="py-2 pr-2 text-neutral-800">
                  {doc.doc_type === "DEP_IN"
                    ? "เงินมัดจำรับจากลูกค้า"
                    : "เงินมัดจำจ่ายให้ซัพพลายเออร์"}
                  {hasVat ? (
                    <span className="mt-0.5 block text-[10px] text-neutral-500">
                      รวมภาษีมูลค่าเพิ่ม {vatRate}% ({vatType})
                    </span>
                  ) : null}
                </td>
                <td className="py-2 text-right font-medium tabular-nums text-neutral-900">
                  {formatMoney(grandTotal)}
                </td>
              </tr>
            </tbody>
          </table>
        ) : (
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-neutral-400">
                <th className="py-1.5 pr-2 font-semibold text-neutral-700">#</th>
                <th className="py-1.5 pr-2 font-semibold text-neutral-700">SKU</th>
                <th className="py-1.5 pr-2 font-semibold text-neutral-700">
                  รายละเอียด
                </th>
                <th className="py-1.5 pr-2 text-right font-semibold text-neutral-700">
                  จำนวน
                </th>
                <th className="py-1.5 pr-2 text-center font-semibold text-neutral-700">
                  หน่วย
                </th>
                <th className="py-1.5 pr-2 text-right font-semibold text-neutral-700">
                  ราคา/หน่วย
                </th>
                <th className="py-1.5 text-right font-semibold text-neutral-700">
                  รวม
                </th>
              </tr>
            </thead>
            <tbody>
              {doc.items.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="py-6 text-center text-neutral-400"
                  >
                    ไม่มีรายการสินค้า
                  </td>
                </tr>
              ) : (
                doc.items.map((item, index) => (
                  <tr
                    key={item.id}
                    className="border-b border-neutral-200 align-top"
                  >
                    <td className="py-1.5 pr-2 tabular-nums text-neutral-500">
                      {index + 1}
                    </td>
                    <td className="py-1.5 pr-2 font-mono text-[11px] font-medium text-neutral-800">
                      {item.sku ?? "—"}
                    </td>
                    <td className="max-w-[12rem] py-1.5 pr-2 text-neutral-800">
                      {item.description || item.product_name || "—"}
                    </td>
                    <td className="py-1.5 pr-2 text-right tabular-nums text-neutral-800">
                      {item.qty}
                    </td>
                    <td className="py-1.5 pr-2 text-center text-neutral-600">
                      {item.uom_used ?? "—"}
                    </td>
                    <td className="py-1.5 pr-2 text-right tabular-nums text-neutral-800">
                      {formatMoney(item.unit_price)}
                    </td>
                    <td className="py-1.5 text-right font-medium tabular-nums text-neutral-900">
                      {formatMoney(item.line_total)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </section>

      {doc.notes?.trim() ? (
        <section className="mt-3 rounded-md border border-neutral-300 bg-neutral-50 px-3 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
            หมายเหตุ / Remark
          </p>
          <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-neutral-800">
            {doc.notes.trim()}
          </p>
        </section>
      ) : null}

      <DocumentPrintSummary
        className={cn("mt-4", compact && "max-w-[14rem]")}
        subtotal={isDepositDoc ? grandTotal : subtotal}
        discountAmount={isDepositDoc ? 0 : discountAmount}
        vatType={vatType}
        vatRate={vatRate}
        grandTotal={grandTotal}
        discountText={doc.discount_text}
        withholdingTaxAmount={
          doc.doc_type === "PAY" || doc.doc_type === "REC"
            ? Number(doc.wht_amount ?? 0)
            : undefined
        }
      />

      {doc.contact_person?.name ? (
        <p className="mt-2 text-[10px] text-neutral-500">
          ผู้ติดต่อ: {doc.contact_person.name}
        </p>
      ) : null}
    </PrintLayout>
  );
}
