import { PrintLayout } from "@/components/shared/print/PrintLayout";
import { DocumentPrintSummary } from "@/components/shared/print/DocumentPrintSummary";
import { resolvePrintPaperSize } from "@/lib/constants/print-paper-size";
import type { ExpenseDetail } from "@/types/expense";
import type { PrintVatType } from "@/types/print-document";
import { cn } from "@/lib/utils";

export type PrintExpenseTemplateProps = {
  expense: ExpenseDetail;
  className?: string;
};

/**
 * Expense (OPEX) print — Shared PrintLayout A4 + DocumentPrintSummary.
 * vatType: EXCLUSIVE เมื่อมี vat_amount (โมเดล expenses = net + vat)
 */
export default async function PrintExpenseTemplate({
  expense,
  className,
}: PrintExpenseTemplateProps) {
  const netAmount = Number(expense.net_amount ?? 0);
  const vatAmount = Number(expense.vat_amount ?? 0);
  const grandTotal = Number(expense.grand_total ?? 0);
  const whtAmount = Number(expense.wht_amount ?? 0);
  const vatType: PrintVatType = vatAmount > 0 ? "EXCLUSIVE" : "NONE";
  const paperSize = resolvePrintPaperSize("EXPENSE");

  return (
    <PrintLayout
      title="เอกสารค่าใช้จ่าย (Expense Voucher)"
      documentNo={expense.document_no}
      date={expense.expense_date}
      status={expense.status}
      partyLabel="ผู้จำหน่าย / Vendor"
      customerData={{
        company_name: expense.vendor_name,
        tax_id: null,
        address: null,
        phone: null,
        branch_code: null,
      }}
      referenceNo={expense.vendor_doc_no}
      paperSize={paperSize}
      documentId="expense-print-document"
      className={cn("mt-2 print:mt-0", className)}
      footer={{
        preparedLabel: "ผู้จัดทำ",
        receivedLabel: "ผู้เกี่ยวข้อง",
        approvedLabel: "ผู้อนุมัติ",
      }}
    >
      <section className="space-y-2 text-xs text-neutral-800">
        <div className="grid gap-2 sm:grid-cols-2">
          <p>
            <span className="text-neutral-500">หมวดหมู่: </span>
            {expense.category_name || "—"}
          </p>
          <p>
            <span className="text-neutral-500">วิธีชำระ: </span>
            {expense.payment_method || "—"}
          </p>
          <p>
            <span className="text-neutral-500">บัญชีธนาคาร: </span>
            {expense.bank_account_label || "—"}
          </p>
          {expense.wht_type ? (
            <p>
              <span className="text-neutral-500">ประเภท WHT: </span>
              {expense.wht_type}
              {expense.wht_rate > 0 ? ` (${expense.wht_rate}%)` : ""}
            </p>
          ) : null}
        </div>
        {expense.remark?.trim() ? (
          <div className="rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
              หมายเหตุ
            </p>
            <p className="mt-1 whitespace-pre-wrap">{expense.remark.trim()}</p>
          </div>
        ) : null}
      </section>

      <DocumentPrintSummary
        className="mt-4"
        subtotal={netAmount}
        discountAmount={0}
        vatType={vatType}
        vatRate={7}
        grandTotal={grandTotal}
        withholdingTaxAmount={whtAmount > 0 ? whtAmount : undefined}
      />
    </PrintLayout>
  );
}
