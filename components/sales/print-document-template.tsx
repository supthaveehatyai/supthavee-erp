import { PrintLayout } from "@/components/shared/print/PrintLayout";
import { DocumentPrintSummary } from "@/components/shared/print/DocumentPrintSummary";
import { getDocumentPrintPaperSize } from "@/lib/actions/settings";
import { documentPartyLabel, documentPrintHeading } from "@/lib/constants/document-print-heading";
import {
  isSalesChannel,
  salesChannelLabel,
} from "@/lib/constants/document";
import {
  SalesPrintLineTable,
  SalesPrintSignaturePair,
  SalesPrintStandardFooter,
} from "@/components/sales/sales-print-controls";
import type { DocumentDetail } from "@/types/document";
import type { PrintPaperSize, PrintVatType } from "@/types/print-document";
import { receiptMethodText } from "@/lib/finance/payment-channel";
import { stripDepositNoteMetadata } from "@/lib/utils/deposit-note";
import { salesShippingMethodLabel } from "@/lib/utils/sales-shipping";
import { salesPayableTotals } from "@/lib/utils/document-summary";
import { summarizeGoodsQty } from "@/lib/sales/goods-qty-summary";
import { numberToThaiBaht } from "@/lib/utils/thai-baht-text";
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

const CONVERSION_NOTE = /^แปลงจาก\s+[A-Z0-9\-]+$/;

function customerFacingPrintNotes(value: string | null | undefined): string {
  return (value ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !CONVERSION_NOTE.test(line))
    .join("\n");
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
  const salesPaper =
    doc.doc_type === "SO" ||
    doc.doc_type === "ABB" ||
    doc.doc_type === "TAX_INV" ||
    doc.doc_type === "CS_TAX" ||
    doc.doc_type === "INV_DO";
  const salesPayable = salesPaper
    ? salesPayableTotals({
        goodsSubtotal: Number(doc.sub_total ?? subtotal),
        discountAmount,
        depositDeducted: depositGross,
        vatType,
        vatRate,
        shippingFee: Number(doc.shipping_fee ?? 0),
      })
    : null;
  const storedNet = roundMoney(Number(doc.net_before_vat ?? 0));
  const storedVat = roundMoney(Number(doc.vat_amount ?? doc.tax_amount ?? 0));
  const storedGrand = roundMoney(grandTotal);
  const storedCollectsRemainder =
    salesPayable != null &&
    storedNet > 0 &&
    Math.abs(storedNet + storedVat - salesPayable.goods_after_deposit) <= 0.05 &&
    Math.abs(
      storedGrand - (salesPayable.goods_after_deposit + salesPayable.shipping_fee),
    ) <= 0.05;
  const printedNet = storedCollectsRemainder
    ? storedNet
    : (salesPayable?.net_before_vat ?? 0);
  const printedVat = storedCollectsRemainder
    ? storedVat
    : (salesPayable?.vat_amount ?? 0);
  const printedGrand = storedCollectsRemainder
    ? storedGrand
    : (salesPayable?.grand_total ?? 0);
  const partyLabel = documentPartyLabel(doc.doc_type);
  const heading = documentPrintHeading(doc.doc_type);

  const resolvedPaperSize =
    doc.doc_type === "ABB"
      ? "A5-Portrait"
      : (paperSize ?? (await getDocumentPrintPaperSize(doc.doc_type)));
  const salesTaxPaper = salesPaper && !isDepositDoc;
  const printNotes = customerFacingPrintNotes(
    doc.doc_type === "DEP_IN"
      ? stripDepositNoteMetadata(doc.notes) || stripDepositNoteMetadata(doc.remark)
      : doc.notes,
  );
  const goodsQty = summarizeGoodsQty(doc.items);
  const qtyLine = goodsQty.buckets.length
    ? `📦 รวมจำนวนสินค้า: ${goodsQty.buckets
        .map((bucket) => `${bucket.qty.toLocaleString("th-TH")} ${bucket.uom}`)
        .join(" · ")} (${goodsQty.lineCount.toLocaleString("th-TH")} รายการ)`
    : "";
  const payableGrand = salesPayable ? printedGrand : grandTotal;
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
    ? salesChannelLabel(doc.sales_channel)
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
      headerVariant={salesTaxPaper ? "sales-tax" : "goods-receipt"}
      documentNo={doc.doc_no}
      date={doc.doc_date}
      dueDate={salesTaxPaper ? null : doc.due_date}
      status={salesTaxPaper ? null : doc.status}
      docType={salesTaxPaper ? null : doc.doc_type}
      referenceNo={salesTaxPaper ? null : printReferenceNo}
      partyLabel={partyLabel}
      customerData={printCustomer}
      contactPersonName={doc.contact_person?.name}
      customerCompact={doc.doc_type === "ABB"}
      paperSize={resolvedPaperSize}
      documentId="sales-print-document"
      showSignatureFooter={false}
      stackContent={
        doc.doc_type === "CS_TAX" ||
        doc.doc_type === "TAX_INV" ||
        doc.doc_type === "REC"
      }
      className={cn("mt-2 print:mt-0", className)}
      bottom={
        <div
          className={
            salesTaxPaper
              ? "mt-2 grid grid-cols-12 gap-3 break-inside-avoid border-t border-slate-300 pt-2"
              : undefined
          }
        >
          {salesTaxPaper ? (
            <div className="col-span-7 space-y-1.5 text-[10.5px] leading-snug text-neutral-800">
              {qtyLine ? <p className="font-semibold">{qtyLine}</p> : null}
              {printNotes ? (
                <p className="whitespace-pre-wrap">
                  <span className="font-semibold">หมายเหตุ: </span>
                  {printNotes}
                </p>
              ) : null}
              <p className="font-bold">({numberToThaiBaht(payableGrand)})</p>
              <SalesPrintSignaturePair docNo={doc.doc_no} docType={doc.doc_type} />
            </div>
          ) : null}
          <div className={salesTaxPaper ? "col-span-5" : undefined}>
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
          shippingFee={isDepositDoc ? 0 : Number(doc.shipping_fee ?? 0)}
          shippingMethodLabel={salesShippingMethodLabel(doc.shipping_method)}
          hideBahtText={salesTaxPaper}
          className={salesTaxPaper ? "ml-0 w-full max-w-none text-[10.5px]" : undefined}
          collectionGrandLabel={
            doc.doc_type === "CS_TAX" ||
            doc.doc_type === "ABB" ||
            doc.doc_type === "DEP_IN" ||
            doc.doc_type === "REC"
              ? "ยอดสุทธิ (Grand Total)"
              : "ยอดสุทธิที่ต้องชำระ (Grand Total)"
          }
          salesCollection={
            salesPayable
              ? {
                  goods: salesPayable.goods_subtotal,
                  discount: salesPayable.discount_amount,
                  deposit: salesPayable.deposit_deducted,
                  depositDocNo: depositDocs.map((row) => row.doc_no).filter(Boolean).join(", "),
                  netBeforeVat: printedNet,
                  vatAmount: printedVat,
                  vatRate: vatType === "NONE" ? 0 : vatRate,
                  shipping: salesPayable.shipping_fee,
                  grand: printedGrand,
                }
              : null
          }
        />
          </div>
          {salesTaxPaper ? null : (
            <SalesPrintStandardFooter
              docNo={doc.doc_no}
              docType={doc.doc_type}
              receivedLabel={isDepositDoc ? "ผู้รับ/จ่ายเงิน" : "ผู้รับของ"}
            />
          )}
        </div>
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
            dense={doc.doc_type === "ABB"}
            hideQtyFoot={salesTaxPaper}
          />
        )}
      </section>

      {doc.doc_type === "DEP_IN" ? (
        <section className="mt-3 space-y-1 text-xs text-neutral-800">
          <p>
            ชำระโดย (Payment Method):{" "}
            {receiptMethodText({
              payment_channel: doc.payment_channel,
              receiving_bank_label: doc.receiving_bank_label,
              is_swept_to_company: doc.is_swept_to_company,
            }) || "—"}
          </p>
          <p className="break-all">
            เลขอ้างอิงสลิป: {doc.reference_no?.trim() || "—"}
          </p>
        </section>
      ) : null}

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

      {!salesTaxPaper &&
      (doc.doc_type === "DEP_IN"
        ? stripDepositNoteMetadata(doc.notes) ||
          stripDepositNoteMetadata(doc.remark)
        : printNotes) ? (
        <section className="mt-3 rounded-md border border-neutral-300 bg-neutral-50 px-3 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
            {doc.doc_type === "CN" ? "อ้างอิงเอกสารต้นทาง" : "หมายเหตุ / Remark"}
          </p>
          <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-neutral-800">
            {doc.doc_type === "DEP_IN"
              ? stripDepositNoteMetadata(doc.notes) ||
                stripDepositNoteMetadata(doc.remark)
              : printNotes}
          </p>
        </section>
      ) : null}

      {!salesTaxPaper && doc.contact_person?.name ? (
        <p className="mt-2 text-[10px] text-neutral-500">
          ผู้ติดต่อ: {doc.contact_person.name}
        </p>
      ) : null}
    </PrintLayout>
  );
}
