/**
 * A4 print layout for deposit settlement vouchers (REFUND / WRITE_OFF).
 * Screen: white card with shadow. Print: full page, no chrome/shadow.
 */

import Link from "next/link";
import type { DocumentDetail } from "@/types/document";
import type { DocumentAllocationRow } from "@/types/document-allocation";
import { cn } from "@/lib/utils";

export type PrintSettlementVoucherTemplateProps = {
  document: DocumentDetail;
  /** Source deposits / invoices linked via document_allocations. */
  allocations: DocumentAllocationRow[];
  /** Base path for source document links. */
  detailBasePath: "/sales" | "/purchases";
  className?: string;
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

function extractRemark(notes: string | null | undefined): string | null {
  const raw = String(notes ?? "").trim();
  if (!raw) return null;
  const match = raw.match(/remark=([^|]+)/i);
  const fromFlag = match?.[1]?.trim() ?? "";
  if (fromFlag) return fromFlag;
  // Fallback: strip known system tokens
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

export default function PrintSettlementVoucherTemplate({
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
  const netBeforeVat = Number(
    doc.net_before_vat ?? doc.total_amount ?? doc.sub_total ?? grandTotal,
  );
  const vatAmount = Number(doc.vat_amount ?? doc.tax_amount ?? 0);
  const vatRate = Number(doc.vat_rate ?? doc.tax_rate ?? 0);
  const vatType = doc.vat_type ?? "NONE";
  const hasVat = vatType !== "NONE" && vatAmount > 0;
  const slipUrl =
    doc.attachment_url?.trim() || doc.attached_file_url?.trim() || "";
  const remark = extractRemark(doc.notes);

  return (
    <article
      id="settlement-print-document"
      className={cn(
        "mx-auto w-[210mm] min-h-[297mm] bg-white p-8 text-black shadow-lg",
        "print:m-0 print:w-full print:min-h-0 print:p-0 print:shadow-none",
        className,
      )}
    >
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
                ระบบ ERP — เอกสารการเงิน (Deposit Settlement)
              </p>
            </div>
          </div>

          <div className="text-right">
            <p className="max-w-[16rem] text-base font-bold leading-snug text-neutral-950">
              {title}
            </p>
            <p className="mt-2 font-mono text-sm font-semibold text-neutral-900">
              เลขที่ {doc.doc_no}
            </p>
            <p className="mt-1 text-xs text-neutral-600">
              วันที่เอกสาร: {formatDate(doc.doc_date)}
            </p>
            <p className="mt-2 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
              สถานะ: {doc.status}
            </p>
          </div>
        </div>

        <div className="mt-5 grid gap-4 border-t border-neutral-200 pt-4 sm:grid-cols-2">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
              {partyLabel}
            </p>
            <p className="mt-1 text-sm font-semibold text-neutral-900">
              {doc.contact?.company_name ?? "—"}
            </p>
            {doc.contact?.tax_id ? (
              <p className="mt-0.5 text-xs text-neutral-600">
                เลขผู้เสียภาษี: {doc.contact.tax_id}
              </p>
            ) : null}
            {doc.contact?.address ? (
              <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-neutral-600">
                {doc.contact.address}
              </p>
            ) : null}
            {doc.contact?.phone ? (
              <p className="text-xs text-neutral-600">
                โทร: {doc.contact.phone}
              </p>
            ) : null}
          </div>

          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
              รายละเอียดเอกสาร
            </p>
            <p className="mt-1 text-xs text-neutral-700">
              ประเภท: {doc.doc_type}
              {vatType !== "NONE"
                ? ` · VAT ${vatType} ${vatRate}%`
                : " · Non-VAT"}
            </p>
            <p className="mt-1 text-xs text-neutral-700">
              หมายเหตุ: {remark || "—"}
            </p>
            {slipUrl ? (
              <p className="mt-2 text-xs text-neutral-600 print:hidden">
                สลิปแนบ: มีหลักฐานในระบบ
              </p>
            ) : null}
          </div>
        </div>
      </header>

      <section className="mt-6">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
          เอกสารต้นทางที่อ้างอิง (Source Deposit)
        </p>
        <table className="w-full border-collapse text-left text-xs">
          <thead>
            <tr className="border-b border-neutral-400">
              <th className="py-2 pr-2 font-semibold text-neutral-700">#</th>
              <th className="py-2 pr-2 font-semibold text-neutral-700">
                เลขที่เอกสารต้นทาง
              </th>
              <th className="py-2 pr-2 font-semibold text-neutral-700">
                ประเภท
              </th>
              <th className="py-2 text-right font-semibold text-neutral-700">
                ยอดที่ใช้
              </th>
            </tr>
          </thead>
          <tbody>
            {allocations.length === 0 ? (
              <tr>
                <td
                  colSpan={4}
                  className="py-8 text-center text-neutral-400"
                >
                  ไม่พบเอกสารต้นทางจาก document_allocations
                </td>
              </tr>
            ) : (
              allocations.map((row, index) => (
                <tr
                  key={row.id}
                  className="border-b border-neutral-200 align-top"
                >
                  <td className="py-2 pr-2 tabular-nums text-neutral-500">
                    {index + 1}
                  </td>
                  <td className="py-2 pr-2 font-mono font-semibold text-neutral-900">
                    <Link
                      href={`${detailBasePath}/${encodeURIComponent(row.target_doc_no)}`}
                      className="underline-offset-2 hover:underline print:no-underline"
                    >
                      {row.target_doc_no}
                    </Link>
                  </td>
                  <td className="py-2 pr-2 text-neutral-700">
                    {row.target_doc_type || "—"}
                  </td>
                  <td className="py-2 text-right font-medium tabular-nums text-neutral-900">
                    {formatMoney(row.allocated_amount)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>

      <footer className="mt-8 flex flex-col gap-8 sm:flex-row sm:items-start sm:justify-between">
        <div className="grid flex-1 grid-cols-2 gap-8 pt-6 text-center text-xs text-neutral-700">
          <div>
            <div className="mx-auto mb-10 h-16 w-40 border-b border-neutral-400" />
            <p className="font-semibold">ผู้จัดทำ</p>
            <p className="mt-1 text-[10px] text-neutral-500">ลายเซ็น / วันที่</p>
          </div>
          <div>
            <div className="mx-auto mb-10 h-16 w-40 border-b border-neutral-400" />
            <p className="font-semibold">ผู้อนุมัติ</p>
            <p className="mt-1 text-[10px] text-neutral-500">
              ในนามบริษัท ทรัพย์ทวี หาดใหญ่ จำกัด
            </p>
          </div>
        </div>

        <div className="w-full max-w-xs space-y-1.5 border border-neutral-300 p-3 text-xs sm:ml-auto">
          <div className="flex justify-between gap-4">
            <span className="text-neutral-600">ยอดก่อนภาษี (Net Total)</span>
            <span className="tabular-nums text-neutral-900">
              {formatMoney(netBeforeVat)}
            </span>
          </div>
          {hasVat || vatType !== "NONE" ? (
            <div className="flex justify-between gap-4">
              <span className="text-neutral-600">
                ภาษีมูลค่าเพิ่ม {vatRate}% ({vatType})
              </span>
              <span className="tabular-nums text-neutral-900">
                {formatMoney(vatAmount)}
              </span>
            </div>
          ) : (
            <div className="flex justify-between gap-4">
              <span className="text-neutral-600">ภาษีมูลค่าเพิ่ม</span>
              <span className="tabular-nums text-neutral-900">
                {formatMoney(0)}
              </span>
            </div>
          )}
          <div className="flex justify-between gap-4 border-t border-neutral-400 pt-2">
            <span className="font-bold text-neutral-950">
              ยอดรวมสุทธิ (Grand Total)
            </span>
            <span className="font-bold tabular-nums text-neutral-950">
              {formatMoney(grandTotal)}
            </span>
          </div>
          <p className="pt-1 text-[10px] text-neutral-500">
            {isRefund
              ? "ยอดคืนเงินมัดจำให้คู่ค้า"
              : "ยอดตัดเศษบัญชีมัดจำ (ไม่มีการจ่ายเงินจริง)"}
          </p>
        </div>
      </footer>

      <p className="mt-10 text-center text-[10px] text-neutral-400">
        เอกสารนี้ออกจากระบบ Supthavee ERP — บริษัท ทรัพย์ทวี หาดใหญ่ จำกัด
      </p>
    </article>
  );
}
