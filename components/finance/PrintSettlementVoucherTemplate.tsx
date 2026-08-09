/**
 * Deposit settlement vouchers (REFUND / WRITE_OFF) — Shared PrintLayout.
 */

import Link from "next/link";
import { PrintLayout } from "@/components/shared/print/PrintLayout";
import { DocumentPrintSummary } from "@/components/shared/print/DocumentPrintSummary";
import { resolvePrintPaperSize } from "@/lib/constants/print-paper-size";
import type { DocumentDetail } from "@/types/document";
import type { DocumentAllocationRow } from "@/types/document-allocation";
import type { PrintVatType } from "@/types/print-document";
import { cn } from "@/lib/utils";

export type PrintSettlementVoucherTemplateProps = {
  document: DocumentDetail;
  allocations: DocumentAllocationRow[];
  detailBasePath: "/sales" | "/purchases";
  className?: string;
};

function formatMoney(value: number): string {
  return value.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function extractRemark(notes: string | null | undefined): string | null {
  const raw = String(notes ?? "").trim();
  if (!raw) return null;
  const match = raw.match(/remark=([^|]+)/i);
  const fromFlag = match?.[1]?.trim() ?? "";
  if (fromFlag) return fromFlag;
  const cleaned = raw
    .split("|")
    .map((part) => part.trim())
    .filter(
      (part) =>
        part &&
        !/^amount=/i.test(part) &&
        !/^slip=/i.test(part) &&
        !/จาก\s+(DIN|DOUT|DEP)/i.test(part),
    )
    .join(" · ");
  return cleaned || null;
}

function normalizePrintVatType(value: string | null | undefined): PrintVatType {
  if (value === "INCLUSIVE" || value === "EXCLUSIVE" || value === "NONE") {
    return value;
  }
  return "NONE";
}

export default async function PrintSettlementVoucherTemplate({
  document: doc,
  allocations,
  detailBasePath,
  className,
}: PrintSettlementVoucherTemplateProps) {
  const isRefund =
    doc.doc_type === "AR_REFUND" ||
    doc.doc_type === "AP_REFUND" ||
    doc.doc_type === "REFUND";
  const isWriteOff =
    doc.doc_type === "AR_WRITEOFF" ||
    doc.doc_type === "AP_WRITEOFF" ||
    doc.doc_type === "WRITE_OFF";
  const isPurchasesSide =
    detailBasePath === "/purchases" ||
    doc.doc_type === "AP_REFUND" ||
    doc.doc_type === "AP_WRITEOFF";
  const title = isPurchasesSide
    ? isRefund
      ? "ใบสำคัญรับเงินคืน (Refund Receipt)"
      : isWriteOff
        ? "ใบสำคัญปรับปรุงบัญชี - ตัดเป็นค่าใช้จ่าย (Write-off Expense)"
        : "ใบสำคัญปรับปรุงบัญชี"
    : isRefund
      ? "ใบสำคัญจ่ายเงินคืน (Refund Payment)"
      : isWriteOff
        ? "ใบสำคัญปรับปรุงบัญชี - รับรู้รายได้ (Write-off Income)"
        : "ใบสำคัญปรับปรุงบัญชี";
  const partyLabel = isPurchasesSide
    ? "ซัพพลายเออร์ / Vendor"
    : "ลูกค้า / Customer";
  const grandTotal = Number(doc.grand_total ?? 0);
  const subtotal = Number(
    doc.total_amount ?? doc.sub_total ?? doc.net_before_vat ?? grandTotal,
  );
  const discountAmount = Number(doc.discount_amount ?? 0);
  const vatRate = Number(doc.vat_rate ?? doc.tax_rate ?? 0);
  const vatType = normalizePrintVatType(doc.vat_type);
  const remark = extractRemark(doc.notes);
  const paperSize = resolvePrintPaperSize(doc.doc_type);

  return (
    <PrintLayout
      title={title}
      documentNo={doc.doc_no}
      date={doc.doc_date}
      status={doc.status}
      partyLabel={partyLabel}
      customerData={doc.contact}
      referenceNo={remark || undefined}
      paperSize={paperSize}
      documentId="settlement-print-document"
      className={cn("mt-2 print:mt-0", className)}
      footer={{
        preparedLabel: "ผู้จัดทำ",
        receivedLabel: "ผู้เกี่ยวข้อง",
        approvedLabel: "ผู้อนุมัติ",
      }}
    >
      <section>
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
          เอกสารต้นทางที่อ้างอิง (Source Deposit)
        </p>
        <table className="w-full border-collapse text-left text-xs">
          <thead>
            <tr className="border-b border-neutral-400">
              <th className="py-1.5 pr-2 font-semibold text-neutral-700">#</th>
              <th className="py-1.5 pr-2 font-semibold text-neutral-700">
                เลขที่เอกสารต้นทาง
              </th>
              <th className="py-1.5 pr-2 font-semibold text-neutral-700">
                ประเภท
              </th>
              <th className="py-1.5 text-right font-semibold text-neutral-700">
                ยอดที่ใช้
              </th>
            </tr>
          </thead>
          <tbody>
            {allocations.length === 0 ? (
              <tr>
                <td colSpan={4} className="py-6 text-center text-neutral-400">
                  ไม่พบเอกสารต้นทางจาก document_allocations
                </td>
              </tr>
            ) : (
              allocations.map((row, index) => (
                <tr
                  key={row.id}
                  className="border-b border-neutral-200 align-top"
                >
                  <td className="py-1.5 pr-2 tabular-nums text-neutral-500">
                    {index + 1}
                  </td>
                  <td className="py-1.5 pr-2 font-mono font-semibold text-neutral-900">
                    <Link
                      href={`${detailBasePath}/${encodeURIComponent(row.target_doc_no)}`}
                      className="underline-offset-2 hover:underline print:no-underline"
                    >
                      {row.target_doc_no}
                    </Link>
                  </td>
                  <td className="py-1.5 pr-2 text-neutral-700">
                    {row.target_doc_type || "—"}
                  </td>
                  <td className="py-1.5 text-right font-medium tabular-nums text-neutral-900">
                    {formatMoney(row.allocated_amount)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <p className="mt-2 text-[10px] text-neutral-500">
          {isRefund
            ? "ยอดคืนเงินมัดจำให้คู่ค้า"
            : "ยอดตัดเศษบัญชีมัดจำ (ไม่มีการจ่ายเงินจริง)"}
        </p>
      </section>

      <DocumentPrintSummary
        className="mt-4"
        subtotal={subtotal}
        discountAmount={discountAmount}
        vatType={vatType}
        vatRate={vatRate || 7}
        grandTotal={grandTotal}
      />
    </PrintLayout>
  );
}
