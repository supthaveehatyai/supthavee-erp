import { getExpenseById } from "@/app/actions/expenses";
import type { ExpenseDetail } from "@/types/expense";
import { ExpenseAttachmentPreview } from "@/app/(erp)/expenses/[id]/expense-attachment-preview";
import { Badge } from "@/components/ui/badge";

function formatThaiBaht(value: number): string {
  return new Intl.NumberFormat("th-TH", {
    style: "currency",
    currency: "THB",
  }).format(Number.isFinite(value) ? value : 0);
}

function formatDate(value: string): string {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("th-TH", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        {label}
      </p>
      <div className="text-sm font-medium text-slate-900">{children}</div>
    </div>
  );
}

function ExpenseReviewBody({ expense }: { expense: ExpenseDetail }) {
  return (
    <div className="flex flex-col gap-6 px-6 pb-8 pt-2">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="slate">{expense.status}</Badge>
        <Badge
          variant={
            expense.approval_status === "PENDING"
              ? "amber"
              : expense.approval_status === "REJECTED"
                ? "amber"
                : "emerald"
          }
        >
          {expense.approval_status}
        </Badge>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Document No">{expense.document_no}</Field>
        <Field label="Expense Date">{formatDate(expense.expense_date)}</Field>
        <Field label="Vendor">{expense.vendor_name}</Field>
        <Field label="Category">{expense.category_name}</Field>
        <Field label="เลขที่บิลผู้จำหน่าย">
          {expense.vendor_doc_no?.trim() || "—"}
        </Field>
        <Field label="Payment Method">
          {expense.payment_method || "—"}
        </Field>
        <Field label="Bank Account">
          {expense.bank_account_label || "—"}
        </Field>
        <Field label="Net Amount">{formatThaiBaht(expense.net_amount)}</Field>
        <Field label="VAT">{formatThaiBaht(expense.vat_amount)}</Field>
        <Field label="Grand Total">
          <span className="text-base font-semibold text-blue-700">
            {formatThaiBaht(expense.grand_total)}
          </span>
        </Field>
        <Field label="WHT">{formatThaiBaht(expense.wht_amount)}</Field>
        <Field label="Net Payable">{formatThaiBaht(expense.net_payable)}</Field>
      </div>

      <Field label="Remark">
        <span className="whitespace-pre-wrap font-normal text-slate-700">
          {expense.remark?.trim() || "—"}
        </span>
      </Field>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            ใบเสร็จ (Receipt)
          </p>
          <ExpenseAttachmentPreview
            url={expense.receipt_url}
            documentNo={expense.document_no}
            title="ใบเสร็จ"
            emptyLabel="ไม่มีไฟล์ใบเสร็จ"
          />
        </div>
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            สลิปโอนเงิน (Payment Slip)
          </p>
          <ExpenseAttachmentPreview
            url={expense.payment_slip_url}
            documentNo={expense.document_no}
            title="สลิปโอนเงิน"
            emptyLabel="ไม่มีสลิปโอนเงิน"
          />
        </div>
      </div>
    </div>
  );
}

/**
 * Server Component — fetch expense by id for Approval Center slide-over.
 * Zero Client-Side Fetching: getExpenseById (Service Role) only.
 */
export async function ExpenseApprovalReviewContent({
  expenseId,
}: {
  expenseId: string;
}) {
  const result = await getExpenseById(expenseId);

  if (result.error || !result.data) {
    return (
      <div className="mx-6 mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        {result.error ?? "ไม่พบเอกสารค่าใช้จ่าย"}
      </div>
    );
  }

  return <ExpenseReviewBody expense={result.data} />;
}
