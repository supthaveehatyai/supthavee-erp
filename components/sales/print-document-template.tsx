import { PrintLayout } from "@/components/shared/print/PrintLayout";
import { DocumentPrintSummary } from "@/components/shared/print/DocumentPrintSummary";
import { getDocumentPrintPaperSize } from "@/lib/actions/settings";
import { documentPartyLabel, documentPrintHeading } from "@/lib/constants/document-print-heading";
import {
  isSalesChannel,
  SALES_CHANNEL_LABELS,
} from "@/lib/constants/document";
import { SalesPrintLineTable } from "@/components/sales/sales-print-controls";
import type { DocumentDetail } from "@/types/document";
import type { PrintPaperSize, PrintVatType } from "@/types/print-document";
import { stripDepositNoteMetadata } from "@/lib/utils/deposit-note";
import { cn } from "@/lib/utils";

function formatMoney(value: number): string {
  return value.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function roundMoney(value: number): number {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
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
  /**
   * หน้าขาย: ชื่อย่อ/ยุบรวม และซ่อนบริการ 0 บาท ตามประเภทเอกสาร
   * หน้าซื้อไม่ส่งค่านี้ จึงพิมพ์รายละเอียดเต็มทุกบรรทัด
   */
  followDocumentDefaults?: boolean;
};

/**
 * Sales/Purchase document print — Shared PrintLayout (TFRS / company SSOT).
 * Paper size: lib/constants/print-paper-size.ts
 * Sales detail page toggles the line table; purchases keep full SKU defaults.
 */
export default async function PrintDocumentTemplate({
  document: doc,
  className,
  paperSize,
  followDocumentDefaults = false,
}: PrintDocumentTemplateProps) {
  const isDepositDoc = doc.doc_type === "DEP_IN" || doc.doc_type === "DEP_OUT";
  const freightCost = roundMoney(Math.max(0, Number(doc.freight_cost ?? 0)));
  const subtotal = Number(doc.total_amount ?? doc.sub_total ?? 0);
  const discountAmount = Number(doc.discount_amount ?? 0);
  const vatRate = Number(doc.vat_rate ?? doc.tax_rate ?? 7);
  const vatType = normalizePrintVatType(doc.vat_type);
  const hasVat = vatType !== "NONE" && vatType !== undefined;
  const grandTotal = Number(doc.grand_total ?? 0);
  const depositGross = Number(doc.deposit_deducted ?? 0);
  const depositDocs = doc.linked_deposits ?? [];
  const showDepositOnPaper =
    depositGross > 0 &&
    (doc.doc_type === "ABB" ||
      doc.doc_type === "TAX_INV" ||
      doc.doc_type === "CS_TAX" ||
      doc.doc_type === "INV_DO");
  const depositReference =
    depositDocs.map((row) => row.doc_no).filter(Boolean).join(", ") ||
    "อ้างอิงใบมัดจำ";
  const partyLabel = documentPartyLabel(doc.doc_type);
  const heading = documentPrintHeading(doc.doc_type);

  const resolvedPaperSize =
    paperSize ?? (await getDocumentPrintPaperSize(doc.doc_type));
  const compact = resolvedPaperSize !== "A4";
  const buyerName = doc.ecommerce_buyer_name?.trim() || "";
  const oneTimeAddress = doc.one_time_address?.trim() || "";
  const printCustomer = doc.contact
    ? {
        ...doc.contact,
        company_name: buyerName || doc.contact.company_name,
        address: oneTimeAddress || doc.contact.address,
      }
    : buyerName || oneTimeAddress
      ? {
          company_name: buyerName || "ลูกค้าขาจร",
          address: oneTimeAddress || null,
        }
      : null;
  const channelLabel = isSalesChannel(doc.sales_channel)
    ? SALES_CHANNEL_LABELS[doc.sales_channel]
    : null;
  const orderNo = doc.ecommerce_order_no?.trim() || "";
  const handwrittenRef = doc.reference_no?.trim() || "";
  const printReferenceNo =
    doc.doc_type === "ABB"
      ? [
          channelLabel,
          orderNo ? `คำสั่งซื้อ ${orderNo}` : null,
          handwrittenRef ? `บิลมือ ${handwrittenRef}` : null,
        ]
          .filter(Boolean)
          .join(" · ") || null
      : [orderNo, doc.tracking_no?.trim(), handwrittenRef]
          .filter(Boolean)
          .join(" · ") || null;

  return (
    <PrintLayout
      title={heading.title}
      titleSubtitle={heading.subtitle}
      headerVariant="goods-receipt"
      documentNo={doc.doc_no}
      date={doc.doc_date}
      dueDate={doc.due_date}
      status={doc.status}
      docType={doc.doc_type}
      referenceNo={printReferenceNo}
      partyLabel={partyLabel}
      customerData={printCustomer}
      paperSize={resolvedPaperSize}
      documentId="sales-print-document"
      className={cn("mt-2 print:mt-0", className)}
      footer={{
        preparedLabel: "ผู้จัดทำ",
        receivedLabel: isDepositDoc ? "ผู้รับ/จ่ายเงิน" : "ผู้รับของ",
        approvedLabel: "ผู้อนุมัติ",
        compact: true,
      }}
      bottom={
        <DocumentPrintSummary
          subtotal={isDepositDoc ? grandTotal : subtotal}
          freightCost={isDepositDoc ? 0 : freightCost}
          discountAmount={isDepositDoc ? 0 : discountAmount}
          vatType={vatType}
          vatRate={vatRate}
          grandTotal={grandTotal}
          docType={doc.doc_type}
          discountText={doc.discount_text}
          withholdingTaxAmount={
            doc.doc_type === "PAY" || doc.doc_type === "REC"
              ? Number(doc.wht_amount ?? 0)
              : undefined
          }
          vatAmount={showDepositOnPaper ? Number(doc.vat_amount ?? 0) : undefined}
          netBeforeVat={
            showDepositOnPaper ? Number(doc.net_before_vat ?? 0) : undefined
          }
          depositDeduction={
            showDepositOnPaper
              ? {
                  gross: depositGross,
                  net: Number(doc.deposit_net_deducted ?? 0),
                  vat: Number(doc.deposit_vat_deducted ?? 0),
                  reference: depositReference,
                }
              : null
          }
        />
      }
    >
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
          <SalesPrintLineTable
            docNo={doc.doc_no}
            docType={doc.doc_type}
            items={doc.items}
            followDocumentDefaults={followDocumentDefaults}
          />
        )}
      </section>

      {doc.doc_type === "CN" && doc.status !== "VOID" && doc.remark?.trim() ? (
        <section className="mt-3 rounded-md border border-neutral-300 bg-neutral-50 px-3 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
            เหตุผลการลดหนี้
          </p>
          <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-neutral-800">
            {doc.remark.trim()}
          </p>
        </section>
      ) : null}

      {(doc.doc_type === "DEP_IN"
        ? stripDepositNoteMetadata(doc.notes) ||
          stripDepositNoteMetadata(doc.remark)
        : doc.notes?.trim()) ? (
        <section className="mt-3 rounded-md border border-neutral-300 bg-neutral-50 px-3 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
            {doc.doc_type === "CN" ? "อ้างอิงเอกสารต้นทาง" : "หมายเหตุ / Remark"}
          </p>
          <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-neutral-800">
            {doc.doc_type === "DEP_IN"
              ? stripDepositNoteMetadata(doc.notes) ||
                stripDepositNoteMetadata(doc.remark)
              : doc.notes?.trim()}
          </p>
        </section>
      ) : null}

      {doc.contact_person?.name ? (
        <p className="mt-2 text-[10px] text-neutral-500">
          ผู้ติดต่อ: {doc.contact_person.name}
        </p>
      ) : null}
    </PrintLayout>
  );
}
