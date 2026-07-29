import type { DocumentDetail, DocumentType } from "@/types/document";
import { cn } from "@/lib/utils";

const DOC_TYPE_LABELS: Record<DocumentType, string> = {
  QT: "ใบเสนอราคา (Quotation)",
  SO: "ใบสั่งขาย (Sales Order)",
  INV_DO: "ใบส่งของ / แจ้งหนี้ (Invoice / DO)",
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
  DEP: "ใบมัดจำ (Deposit — legacy)",
  INT_REC: "ใบรับภายใน (Internal Receipt — legacy)",
};

function formatMoney(value: number): string {
  return value.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("th-TH", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export type PrintDocumentTemplateProps = {
  document: DocumentDetail;
  className?: string;
};

/**
 * A4 print layout for sales documents (Phase 4).
 * Screen: white card with shadow. Print: full page, no chrome/shadow.
 */
export default function PrintDocumentTemplate({
  document: doc,
  className,
}: PrintDocumentTemplateProps) {
  const subtotal = Number(doc.total_amount ?? doc.sub_total ?? 0);
  const discountAmount = Number(doc.discount_amount ?? 0);
  const netBeforeVat = Number(doc.net_before_vat ?? subtotal - discountAmount);
  const vatAmount = Number(doc.vat_amount ?? doc.tax_amount ?? 0);
  const vatRate = Number(doc.vat_rate ?? doc.tax_rate ?? 7);
  const grandTotal = Number(doc.grand_total ?? 0);
  const docTypeLabel = DOC_TYPE_LABELS[doc.doc_type] ?? doc.doc_type;

  return (
    <article
      id="sales-print-document"
      className={cn(
        "mx-auto w-[210mm] min-h-[297mm] bg-white p-8 text-black shadow-lg",
        "print:m-0 print:w-full print:min-h-0 print:p-0 print:shadow-none",
        className,
      )}
    >
      {/* Header */}
      <header className="border-b border-neutral-300 pb-5">
        <div className="flex items-start justify-between gap-6">
          <div className="flex items-start gap-3">
            <div className="grid size-12 place-items-center rounded-md border border-neutral-300 bg-neutral-50 text-sm font-black tracking-tight text-neutral-800">
              ST
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight text-neutral-950">
                บริษัท ทรัพย์ทวี หาดใหญ่ จำกัด
              </h1>
              <p className="mt-0.5 text-xs text-neutral-600">
                Supthavee Hatyai Co., Ltd.
              </p>
              <p className="mt-2 max-w-sm text-[11px] leading-relaxed text-neutral-500">
                ระบบ ERP — เอกสารทางการค้า
              </p>
            </div>
          </div>

          <div className="text-right">
            <p className="text-base font-bold text-neutral-950">{docTypeLabel}</p>
            <p className="mt-2 font-mono text-sm font-semibold text-neutral-900">
              เลขที่ {doc.doc_no}
            </p>
            <p className="mt-1 text-xs text-neutral-600">
              วันที่เอกสาร: {formatDate(doc.doc_date)}
            </p>
            {doc.due_date && (
              <p className="text-xs text-neutral-600">
                วันครบกำหนด: {formatDate(doc.due_date)}
              </p>
            )}
            <p className="mt-2 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
              สถานะ: {doc.status}
            </p>
          </div>
        </div>

        <div className="mt-5 grid gap-4 border-t border-neutral-200 pt-4 sm:grid-cols-2">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
              ลูกค้า / Customer
            </p>
            <p className="mt-1 text-sm font-semibold text-neutral-900">
              {doc.contact?.company_name ?? "—"}
            </p>
            {doc.contact?.tax_id && (
              <p className="mt-0.5 text-xs text-neutral-600">
                เลขผู้เสียภาษี: {doc.contact.tax_id}
              </p>
            )}
            {doc.contact?.branch_code && (
              <p className="text-xs text-neutral-600">
                สาขา: {doc.contact.branch_code}
              </p>
            )}
            {doc.contact?.address && (
              <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-neutral-600">
                {doc.contact.address}
              </p>
            )}
            {doc.contact?.phone && (
              <p className="text-xs text-neutral-600">โทร: {doc.contact.phone}</p>
            )}
          </div>

          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
              ผู้ติดต่อ
            </p>
            {doc.contact_person ? (
              <>
                <p className="mt-1 text-sm font-semibold text-neutral-900">
                  {doc.contact_person.name}
                </p>
                <p className="mt-0.5 text-xs text-neutral-600">
                  {[
                    doc.contact_person.department_or_role,
                    doc.contact_person.phone,
                    doc.contact_person.email,
                  ]
                    .filter(Boolean)
                    .join(" · ") || "—"}
                </p>
              </>
            ) : (
              <p className="mt-1 text-xs text-neutral-500">—</p>
            )}
            {doc.vat_type && (
              <p className="mt-3 text-xs text-neutral-600">
                ประเภท VAT: {doc.vat_type} · อัตรา {vatRate}%
              </p>
            )}
          </div>
        </div>
      </header>

      {/* Body — line items */}
      <section className="mt-6">
        <table className="w-full border-collapse text-left text-xs">
          <thead>
            <tr className="border-b border-neutral-400">
              <th className="py-2 pr-2 font-semibold text-neutral-700">#</th>
              <th className="py-2 pr-2 font-semibold text-neutral-700">SKU</th>
              <th className="py-2 pr-2 font-semibold text-neutral-700">
                รายละเอียด
              </th>
              <th className="py-2 pr-2 text-right font-semibold text-neutral-700">
                จำนวน
              </th>
              <th className="py-2 pr-2 text-center font-semibold text-neutral-700">
                หน่วย
              </th>
              <th className="py-2 pr-2 text-right font-semibold text-neutral-700">
                ราคา/หน่วย
              </th>
              <th className="py-2 text-right font-semibold text-neutral-700">
                รวม
              </th>
            </tr>
          </thead>
          <tbody>
            {doc.items.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  className="py-8 text-center text-neutral-400"
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
                  <td className="py-2 pr-2 tabular-nums text-neutral-500">
                    {index + 1}
                  </td>
                  <td className="py-2 pr-2 font-mono text-[11px] font-medium text-neutral-800">
                    {item.sku ?? "—"}
                  </td>
                  <td className="max-w-[12rem] py-2 pr-2 text-neutral-800">
                    {item.description || item.product_name || "—"}
                  </td>
                  <td className="py-2 pr-2 text-right tabular-nums text-neutral-800">
                    {item.qty}
                  </td>
                  <td className="py-2 pr-2 text-center text-neutral-600">
                    {item.uom_used ?? "—"}
                  </td>
                  <td className="py-2 pr-2 text-right tabular-nums text-neutral-800">
                    {formatMoney(item.unit_price)}
                  </td>
                  <td className="py-2 text-right font-medium tabular-nums text-neutral-900">
                    {formatMoney(item.line_total)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>

      {/* Footer — totals + signatures */}
      <footer className="mt-8 flex flex-col gap-8 sm:flex-row sm:items-start sm:justify-between">
        <div className="grid flex-1 grid-cols-2 gap-8 pt-6 text-center text-xs text-neutral-700">
          <div>
            <div className="mx-auto mb-10 h-16 w-40 border-b border-neutral-400" />
            <p className="font-semibold">ผู้รับของ</p>
            <p className="mt-1 text-[10px] text-neutral-500">
              ลายเซ็น / วันที่
            </p>
          </div>
          <div>
            <div className="mx-auto mb-10 h-16 w-40 border-b border-neutral-400" />
            <p className="font-semibold">ผู้มอบอำนาจ</p>
            <p className="mt-1 text-[10px] text-neutral-500">
              ในนามบริษัท ทรัพย์ทวี หาดใหญ่ จำกัด
            </p>
          </div>
        </div>

        <div className="w-full max-w-xs space-y-1.5 border border-neutral-300 p-3 text-xs sm:ml-auto">
          <div className="flex justify-between gap-4">
            <span className="text-neutral-600">ยอดรวมสินค้า</span>
            <span className="tabular-nums text-neutral-900">
              {formatMoney(subtotal)}
            </span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-neutral-600">
              ส่วนลดท้ายบิล
              {doc.discount_text ? ` (${doc.discount_text})` : ""}
            </span>
            <span className="tabular-nums text-neutral-900">
              −{formatMoney(discountAmount)}
            </span>
          </div>
          <div className="flex justify-between gap-4 border-t border-neutral-200 pt-1.5">
            <span className="text-neutral-600">ยอดหลังหักส่วนลด</span>
            <span className="tabular-nums text-neutral-900">
              {formatMoney(netBeforeVat)}
            </span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-neutral-600">
              ภาษีมูลค่าเพิ่ม {vatRate}%
            </span>
            <span className="tabular-nums text-neutral-900">
              {formatMoney(vatAmount)}
            </span>
          </div>
          <div className="flex justify-between gap-4 border-t border-neutral-400 pt-2">
            <span className="font-bold text-neutral-950">ยอดสุทธิ</span>
            <span className="font-bold tabular-nums text-neutral-950">
              {formatMoney(grandTotal)}
            </span>
          </div>
        </div>
      </footer>

      <p className="mt-10 text-center text-[10px] text-neutral-400">
        เอกสารนี้ออกจากระบบ Supthavee ERP — บริษัท ทรัพย์ทวี หาดใหญ่ จำกัด
      </p>
    </article>
  );
}
