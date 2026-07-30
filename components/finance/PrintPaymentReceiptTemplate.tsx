import type { DocumentDetail } from "@/types/document";
import type { DocumentAllocationRow } from "@/types/document-allocation";
import { cn } from "@/lib/utils";

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

function isDepositAllocation(docType: string): boolean {
  return docType === "DEP_IN" || docType === "DEP_OUT";
}

function signedAllocatedAmount(row: DocumentAllocationRow): number {
  const amount = Number(row.allocated_amount ?? 0);
  return isDepositAllocation(row.target_doc_type) ? -amount : amount;
}

export type PrintPaymentReceiptTemplateProps = {
  document: DocumentDetail;
  allocations: DocumentAllocationRow[];
  /** REC = receive payment, PAY = vendor payment */
  mode: "REC" | "PAY";
  className?: string;
};

/**
 * A4 print layout for REC / PAY (finance knock-off receipts).
 * Screen: preview card. Print: sole visible content via #payment-print-document.
 *
 * Accounting display:
 * - Invoice allocations = positive
 * - Deposit allocations = negative deduction
 * - Table net = invoices − deposits (= Net Cash)
 * - Header grand_total on document = invoice settlement value (not net cash)
 */
export default function PrintPaymentReceiptTemplate({
  document: doc,
  allocations,
  mode,
  className,
}: PrintPaymentReceiptTemplateProps) {
  const invoiceSettlement = Number(doc.grand_total ?? 0);
  const whtAmount = Number(doc.wht_amount ?? 0);
  const netCash = Number(doc.total_amount ?? doc.sub_total ?? 0);
  const partyLabel = mode === "REC" ? "ลูกค้า / Customer" : "ผู้จำหน่าย / Vendor";
  const titleLabel =
    mode === "REC"
      ? "ใบเสร็จรับเงิน (Receipt)"
      : "ใบจ่ายชำระหนี้ (Payment Voucher)";
  const totalLabel =
    mode === "REC" ? "ยอดรับชำระสุทธิ" : "ยอดจ่ายชำระสุทธิ";

  const invoiceSum = allocations
    .filter((row) => !isDepositAllocation(row.target_doc_type))
    .reduce((sum, row) => sum + Number(row.allocated_amount ?? 0), 0);
  const depositSum = allocations
    .filter((row) => isDepositAllocation(row.target_doc_type))
    .reduce((sum, row) => sum + Number(row.allocated_amount ?? 0), 0);
  const netFromAllocations = allocations.reduce(
    (sum, row) => sum + signedAllocatedAmount(row),
    0,
  );
  const allocatedWht = allocations.reduce(
    (sum, row) => sum + Number(row.wht_amount ?? 0),
    0,
  );

  return (
    <article
      id="payment-print-document"
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
                ระบบ ERP — เอกสารรับ/จ่ายชำระเงิน
              </p>
            </div>
          </div>

          <div className="text-right">
            <p className="text-base font-bold text-neutral-950">{titleLabel}</p>
            <p className="mt-2 font-mono text-sm font-semibold text-neutral-900">
              เลขที่ {doc.doc_no}
            </p>
            <p className="mt-1 text-xs text-neutral-600">
              วันที่เอกสาร: {formatDate(doc.doc_date)}
            </p>
            <p className="mt-2 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
              สถานะ: {doc.status} · {doc.payment_status}
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
            {doc.contact?.branch_code ? (
              <p className="text-xs text-neutral-600">
                สาขา: {doc.contact.branch_code}
              </p>
            ) : null}
            {doc.contact?.address ? (
              <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-neutral-600">
                {doc.contact.address}
              </p>
            ) : null}
            {doc.contact?.phone ? (
              <p className="text-xs text-neutral-600">โทร: {doc.contact.phone}</p>
            ) : null}
          </div>

          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
              หมายเหตุ / อ้างอิง
            </p>
            <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-neutral-700">
              {doc.notes?.trim() || "—"}
            </p>
          </div>
        </div>
      </header>

      <section className="mt-6">
        <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-neutral-700">
          รายการเอกสารที่ตัดชำระ
        </h2>
        <table className="w-full border-collapse text-left text-xs">
          <thead>
            <tr className="border-b border-neutral-400">
              <th className="py-2 pr-2 font-semibold text-neutral-700">#</th>
              <th className="py-2 pr-2 font-semibold text-neutral-700">
                เลขที่เอกสารภายใน
              </th>
              <th className="py-2 pr-2 font-semibold text-neutral-700">
                เลขอ้างอิงภายนอก
              </th>
              <th className="py-2 pr-2 text-right font-semibold text-neutral-700">
                ยอดตัดชำระ
              </th>
              <th className="py-2 text-right font-semibold text-neutral-700">
                WHT
              </th>
            </tr>
          </thead>
          <tbody>
            {allocations.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className="py-8 text-center text-neutral-400"
                >
                  ไม่พบรายการเอกสารที่ตัดชำระ
                </td>
              </tr>
            ) : (
              allocations.map((row, index) => {
                const isDeposit = isDepositAllocation(row.target_doc_type);
                const signed = signedAllocatedAmount(row);
                return (
                  <tr
                    key={row.id}
                    className="border-b border-neutral-200 align-top"
                  >
                    <td className="py-2 pr-2 tabular-nums text-neutral-500">
                      {index + 1}
                    </td>
                    <td className="py-2 pr-2 font-mono text-[11px] font-medium text-neutral-800">
                      {isDeposit
                        ? `(หัก) มัดจำ ${row.target_doc_no}`
                        : row.target_doc_no}
                      {row.target_doc_type ? (
                        <span className="ml-1 text-[10px] text-neutral-400">
                          ({row.target_doc_type})
                        </span>
                      ) : null}
                    </td>
                    <td className="py-2 pr-2 font-mono text-[11px] text-neutral-700">
                      {row.reference_no?.trim() || "—"}
                    </td>
                    <td
                      className={
                        isDeposit
                          ? "py-2 pr-2 text-right tabular-nums text-neutral-700"
                          : "py-2 pr-2 text-right tabular-nums text-neutral-900"
                      }
                    >
                      {isDeposit
                        ? `(${formatMoney(Math.abs(signed))})`
                        : formatMoney(signed)}
                    </td>
                    <td className="py-2 text-right tabular-nums text-neutral-700">
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
              {depositSum > 0 ? (
                <tr>
                  <td
                    colSpan={3}
                    className="py-1.5 pr-2 text-right text-neutral-600"
                  >
                    หักมัดจำ
                  </td>
                  <td className="py-1.5 pr-2 text-right tabular-nums text-neutral-800">
                    ({formatMoney(depositSum)})
                  </td>
                  <td className="py-1.5 text-right tabular-nums text-neutral-500">
                    —
                  </td>
                </tr>
              ) : null}
              <tr className="border-t border-neutral-400">
                <td
                  colSpan={3}
                  className="py-2 pr-2 text-right font-semibold text-neutral-800"
                >
                  รวมสุทธิ (บิล − มัดจำ)
                </td>
                <td className="py-2 pr-2 text-right font-semibold tabular-nums text-neutral-950">
                  {formatMoney(netFromAllocations)}
                </td>
                <td className="py-2 text-right font-semibold tabular-nums text-neutral-950">
                  {formatMoney(allocatedWht)}
                </td>
              </tr>
            </tfoot>
          ) : null}
        </table>
      </section>

      <footer className="mt-8 flex flex-col gap-8 sm:flex-row sm:items-start sm:justify-between">
        <div className="grid flex-1 grid-cols-2 gap-8 pt-6 text-center text-xs text-neutral-700">
          <div>
            <div className="mx-auto mb-10 h-16 w-40 border-b border-neutral-400" />
            <p className="font-semibold">
              {mode === "REC" ? "ผู้ชำระเงิน" : "ผู้รับเงิน"}
            </p>
            <p className="mt-1 text-[10px] text-neutral-500">ลายเซ็น / วันที่</p>
          </div>
          <div>
            <div className="mx-auto mb-10 h-16 w-40 border-b border-neutral-400" />
            <p className="font-semibold">ผู้มีอำนาจ</p>
            <p className="mt-1 text-[10px] text-neutral-500">
              ในนามบริษัท ทรัพย์ทวี หาดใหญ่ จำกัด
            </p>
          </div>
        </div>

        <div className="w-full max-w-xs space-y-1.5 border border-neutral-300 p-3 text-xs sm:ml-auto">
          <div className="flex justify-between gap-4">
            <span className="text-neutral-600">มูลค่าบิลที่ตัดยอด</span>
            <span className="tabular-nums text-neutral-900">
              {formatMoney(invoiceSettlement)}
            </span>
          </div>
          {depositSum > 0 ? (
            <div className="flex justify-between gap-4">
              <span className="text-neutral-600">หักมัดจำ</span>
              <span className="tabular-nums text-neutral-900">
                ({formatMoney(depositSum)})
              </span>
            </div>
          ) : null}
          <div className="flex justify-between gap-4">
            <span className="text-neutral-600">
              {mode === "REC" ? "ยอดเงินโอน/รับจริง" : "ยอดเงินโอน/จ่ายจริง"}
            </span>
            <span className="tabular-nums text-neutral-900">
              {formatMoney(netCash)}
            </span>
          </div>
          {whtAmount > 0 || allocatedWht > 0 ? (
            <div className="flex justify-between gap-4">
              <span className="text-neutral-600">ภาษีหัก ณ ที่จ่าย (WHT)</span>
              <span className="tabular-nums text-neutral-900">
                {formatMoney(whtAmount || allocatedWht)}
              </span>
            </div>
          ) : null}
          <div className="flex justify-between gap-4 border-t border-neutral-400 pt-2">
            <span className="font-bold text-neutral-950">{totalLabel}</span>
            <span className="font-bold tabular-nums text-neutral-950">
              {formatMoney(netFromAllocations)}
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
