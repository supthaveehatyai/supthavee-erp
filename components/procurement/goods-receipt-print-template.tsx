import { PrintLayout } from "@/components/shared/print/PrintLayout";
import { DocumentPrintSummary } from "@/components/shared/print/DocumentPrintSummary";
import { numberToThaiBaht } from "@/lib/utils/thai-baht-text";
import { displayDocumentItemDescription } from "@/lib/utils/credit-note-line";
import type { DocumentDetail } from "@/types/document";
import type { PrintVatType } from "@/types/print-document";
import { cn } from "@/lib/utils";

function formatMoney(value: number): string {
  return value.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatQty(value: number): string {
  return value.toLocaleString("th-TH", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  });
}

function normalizePrintVatType(value: string | null | undefined): PrintVatType {
  if (value === "INCLUSIVE" || value === "EXCLUSIVE" || value === "NONE") {
    return value;
  }
  return "NONE";
}

export default function GoodsReceiptPrintTemplate({
  document: doc,
  className,
}: {
  document: DocumentDetail;
  className?: string;
}) {
  const freightCost = Math.max(0, Number(doc.freight_cost ?? 0));
  const destFreight = Math.max(0, Number(doc.dest_freight_cost ?? 0));
  const subtotal = Number(doc.sub_total ?? doc.total_amount ?? 0);
  const discountAmount = Number(doc.discount_amount ?? 0);
  const vatRate = Number(doc.vat_rate ?? doc.tax_rate ?? 7);
  const vatType = normalizePrintVatType(doc.vat_type);
  const grandTotal = Number(doc.grand_total ?? 0);
  const totalQty = doc.items.reduce((sum, item) => sum + Number(item.qty || 0), 0);

  return (
    <PrintLayout
      title="ใบรับสินค้า / ใบสำคัญตั้งหนี้การค้า (GOODS RECEIPT & AP VOUCHER)"
      documentNo={doc.doc_no}
      date={doc.doc_date}
      status={doc.status}
      docType={doc.doc_type}
      partyLabel="ผู้จำหน่าย / Vendor"
      customerData={doc.contact}
      paperSize="A4"
      documentId="goods-receipt-print-document"
      className={cn("print:mt-0", className)}
      footer={{
        preparedLabel: "ผู้รับสินค้า / คลังสินค้า",
        receivedLabel: "ผู้ตรวจสอบ / บัญชี",
        approvedLabel: "ผู้อนุมัติ",
      }}
    >
      <p className="text-[11px] text-neutral-800">
        <span className="font-semibold uppercase tracking-wide text-neutral-500">
          เลขที่บิลผู้จำหน่ายอ้างอิง (Reference No.)
        </span>
        <span className="ml-2 font-mono font-semibold">
          {doc.reference_no?.trim() || "—"}
        </span>
      </p>

      <table className="mt-3 w-full border-collapse text-left text-xs">
        <thead>
          <tr className="border-y border-neutral-400 bg-neutral-50">
            <th className="px-1.5 py-1.5 font-semibold text-neutral-700">#</th>
            <th className="px-1.5 py-1.5 font-semibold text-neutral-700">SKU</th>
            <th className="px-1.5 py-1.5 font-semibold text-neutral-700">Description</th>
            <th className="px-1.5 py-1.5 text-right font-semibold text-neutral-700">Qty</th>
            <th className="px-1.5 py-1.5 text-center font-semibold text-neutral-700">UOM</th>
            <th className="px-1.5 py-1.5 text-right font-semibold text-neutral-700">Unit Cost</th>
            <th className="px-1.5 py-1.5 text-right font-semibold text-neutral-700">Amount</th>
          </tr>
        </thead>
        <tbody>
          {doc.items.length === 0 ? (
            <tr>
              <td colSpan={7} className="py-6 text-center text-neutral-400">
                ไม่มีรายการสินค้า
              </td>
            </tr>
          ) : (
            doc.items.map((item, index) => (
              <tr key={item.id} className="border-b border-neutral-200 align-top">
                <td className="px-1.5 py-1.5 tabular-nums text-neutral-500">{index + 1}</td>
                <td className="px-1.5 py-1.5 font-mono text-[11px] font-medium">
                  {item.sku ?? "—"}
                </td>
                <td className="px-1.5 py-1.5 text-neutral-800">
                  {displayDocumentItemDescription(item.description, item.product_name)}
                </td>
                <td className="px-1.5 py-1.5 text-right tabular-nums">{formatQty(item.qty)}</td>
                <td className="px-1.5 py-1.5 text-center">{item.uom_used ?? "—"}</td>
                <td className="px-1.5 py-1.5 text-right tabular-nums">
                  {formatMoney(item.unit_price)}
                </td>
                <td className="px-1.5 py-1.5 text-right font-medium tabular-nums">
                  {formatMoney(item.line_total)}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      <div className="mt-4 flex items-start justify-between gap-6">
        <div className="min-w-0 flex-1 space-y-2 text-[11px] leading-relaxed text-neutral-800">
          <p>
            จำนวนรวมทั้งหมด{" "}
            <span className="font-semibold tabular-nums">{formatQty(totalQty)}</span>
          </p>
          <p className="font-medium">({numberToThaiBaht(grandTotal)})</p>
          <p className="text-neutral-600">
            หมายเหตุต้นทุนแฝงตามมาตรฐาน TAS 2 — ค่าขนส่งต้นทาง{" "}
            {formatMoney(freightCost)} บาท เข้าต้นทุนสินค้าและหนี้ผู้ขาย
            {destFreight > 0
              ? ` · ค่าขนส่งปลายทาง ${formatMoney(destFreight)} บาท จ่ายแยกให้บริษัทขนส่ง ไม่รวมในหนี้ผู้ขาย แต่เข้าฐานต้นทุนคลัง`
              : ""}
          </p>
        </div>
        <DocumentPrintSummary
          className="shrink-0"
          subtotal={subtotal}
          freightCost={freightCost}
          discountAmount={discountAmount}
          vatType={vatType}
          vatRate={vatType === "NONE" ? 0 : vatRate}
          vatAmount={doc.vat_amount}
          vatLabel={vatType === "NONE" ? "ภาษีมูลค่าเพิ่ม 7% (VAT)" : `ภาษีมูลค่าเพิ่ม ${vatRate}% (VAT)`}
          grandTotal={grandTotal}
          discountText={doc.discount_text}
          docType={doc.doc_type}
          hideBahtText
          showEmptyRows
        />
      </div>
    </PrintLayout>
  );
}
