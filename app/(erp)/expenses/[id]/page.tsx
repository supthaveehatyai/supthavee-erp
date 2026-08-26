import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Receipt } from "lucide-react";
import { getBankAccounts, getExpenseById } from "@/app/actions/expenses";
import { getPaymentSlipStorageMeta } from "@/app/actions/payment-slips";
import { hasFixedAssetForExpense } from "@/app/actions/fixed-assets";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import PrintExpenseTemplate from "@/components/expenses/PrintExpenseTemplate";
import { ExpensePrintButton } from "@/components/expenses/expense-print-button";
import { isAssetClearingCategory } from "@/lib/utils/expense-capitalize";
import { ExpenseAttachmentPreview } from "./expense-attachment-preview";
import { ExpenseDetailActions } from "./expense-detail-actions";
import { ExpenseInstallmentPayCell } from "./pay-installment-dialog";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
};

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

function StatusBadge({ status }: { status: string }) {
  const normalized = status.trim().toUpperCase();
  if (normalized === "ISSUED") {
    return <Badge variant="emerald">ISSUED</Badge>;
  }
  if (normalized === "PAID") {
    return <Badge variant="emerald">ชำระครบแล้ว (PAID)</Badge>;
  }
  if (normalized === "PENDING") {
    return <Badge variant="amber">รออนุมัติ (PENDING)</Badge>;
  }
  if (normalized === "VOID") {
    return (
      <Badge variant="amber" className="bg-red-100 text-red-700">
        VOID
      </Badge>
    );
  }
  return <Badge variant="slate">DRAFT</Badge>;
}

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
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

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { id } = await params;
  const result = await getExpenseById(id);
  return {
    title: result.data
      ? `${result.data.document_no} | ค่าใช้จ่าย`
      : "รายละเอียดค่าใช้จ่าย",
  };
}

export default async function ExpenseDetailPage({ params }: PageProps) {
  const { id } = await params;
  const [{ data: expense, error }, bankAccountsResult, assetLinkResult] =
    await Promise.all([
      getExpenseById(id),
      getBankAccounts(),
      hasFixedAssetForExpense(id),
    ]);
  const bankAccounts = bankAccountsResult.data ?? [];
  const hasRegisteredAsset = assetLinkResult.hasRegisteredAsset;

  if (!expense) {
    if (error) {
      return (
        <div className="flex flex-col gap-4 p-6">
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
          <Link
            href="/expenses"
            className="inline-flex h-10 w-fit items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700"
          >
            <ArrowLeft className="h-4 w-4" />
            กลับรายการ
          </Link>
        </div>
      );
    }
    notFound();
  }

  const statusNormalized = expense.status.trim().toUpperCase();
  const installments = expense.installments ?? [];
  const canCapitalize =
    (statusNormalized === "ISSUED" || statusNormalized === "PAID") &&
    isAssetClearingCategory(expense.category_name);

  const paymentSlipMeta = await getPaymentSlipStorageMeta(
    expense.payment_slip_url,
  );

  return (
    <div className="flex flex-col gap-6 p-6 print:gap-0 print:p-0">
      <div className="flex flex-col gap-4 print:hidden lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight text-slate-900">
              <Receipt className="h-8 w-8 text-blue-600" />
              {expense.document_no}
            </h1>
            <StatusBadge status={expense.status} />
          </div>
          <p className="text-slate-500">
            รายละเอียดเอกสารค่าใช้จ่าย — อ่านอย่างเดียว · DRAFT = ลบได้ ·
            ISSUED = ยกเลิก (Void) ได้ · พิมพ์ A4
          </p>
        </div>

        <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
          <ExpensePrintButton />
          {Number(expense.wht_amount) > 0 ? (
            <Link
              href={`/expenses/${expense.id}/print-wht`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 text-sm font-semibold text-amber-900 transition hover:bg-amber-100"
            >
              พิมพ์ 50 ทวิ (WHT)
            </Link>
          ) : null}
          <ExpenseDetailActions
            expenseId={expense.id}
            documentNo={expense.document_no}
            status={expense.status}
            grandTotal={Number(expense.grand_total ?? 0)}
            expenseDate={expense.expense_date}
            approvalStatus={String(expense.approval_status ?? "APPROVED")}
            canCapitalize={canCapitalize}
            hasRegisteredAsset={hasRegisteredAsset}
          />
          <Link
            href="/expenses"
            className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            <ArrowLeft className="h-4 w-4" />
            กลับรายการ
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 print:hidden xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">ข้อมูลเอกสาร</CardTitle>
            <CardDescription>Read-only document header</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <Field label="Document No">{expense.document_no}</Field>
            <Field label="Expense Date">
              {formatDate(expense.expense_date)}
            </Field>
            <Field label="เลขที่บิลผู้จำหน่าย">
              {expense.vendor_doc_no?.trim() || "—"}
            </Field>
            <Field label="Vendor / ผู้ให้บริการ">{expense.vendor_name}</Field>
            <Field label="Category / หมวดหมู่">{expense.category_name}</Field>
            <Field label="Payment Method">
              {expense.payment_method || "—"}
            </Field>
            <Field label="Bank Account">
              {expense.bank_account_label || "—"}
            </Field>
            <Field label="Remark">
              <span className="whitespace-pre-wrap font-normal text-slate-700">
                {expense.remark?.trim() || "—"}
              </span>
            </Field>
            <Field label="Status">
              <StatusBadge status={expense.status} />
            </Field>
            <Field label="ผ่อนชำระ">
              {expense.is_installment ? (
                <Badge variant="blue">Installment Plan</Badge>
              ) : (
                "—"
              )}
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">สรุปยอดเงิน</CardTitle>
            <CardDescription>Net / VAT / Grand Total</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-500">Net Amount</span>
              <span className="font-semibold tabular-nums">
                {formatThaiBaht(expense.net_amount)}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-500">VAT Amount</span>
              <span className="font-semibold tabular-nums">
                {formatThaiBaht(expense.vat_amount)}
              </span>
            </div>
            <div className="border-t border-slate-100 pt-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-700">
                  Grand Total
                </span>
                <span className="text-2xl font-bold tabular-nums text-slate-900">
                  {formatThaiBaht(expense.grand_total)}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {expense.is_installment ? (
        <Card className="print:hidden">
          <CardHeader>
            <CardTitle className="text-base">
              ตารางการผ่อนชำระ (Installment Plan)
            </CardTitle>
            <CardDescription>
              งวดผ่อนจากตาราง expense_installments · ISSUED สามารถบันทึกจ่ายรายงวดได้
            </CardDescription>
          </CardHeader>
          <CardContent>
            {installments.length === 0 ? (
              <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                ไม่พบรายการงวดผ่อนชำระ
              </p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-3 py-2.5">งวดที่</th>
                      <th className="px-3 py-2.5">วันครบกำหนด</th>
                      <th className="px-3 py-2.5 text-right">เงินต้น</th>
                      <th className="px-3 py-2.5 text-right">ดอกเบี้ย</th>
                      <th className="px-3 py-2.5 text-right">ยอดรวม</th>
                      <th className="px-3 py-2.5 text-center">สถานะการจ่าย</th>
                    </tr>
                  </thead>
                  <tbody>
                    {installments.map((row) => (
                      <tr
                        key={row.id}
                        className="border-t border-slate-100"
                      >
                        <td className="px-3 py-2.5 font-semibold tabular-nums text-slate-900">
                          {row.installment_period}
                        </td>
                        <td className="px-3 py-2.5 text-slate-700">
                          {formatDate(row.due_date)}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums">
                          {formatThaiBaht(row.principal_amount)}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums">
                          {formatThaiBaht(row.interest_amount)}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums font-medium text-slate-900">
                          {formatThaiBaht(row.total_installment)}
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          <ExpenseInstallmentPayCell
                            installment={row}
                            bankAccounts={bankAccounts}
                            canPay={
                              expense.status.trim().toUpperCase() === "ISSUED"
                            }
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-slate-200 bg-slate-50/80">
                      <td
                        colSpan={2}
                        className="px-3 py-2.5 text-xs font-semibold text-slate-600"
                      >
                        รวม
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums font-semibold">
                        {formatThaiBaht(
                          installments.reduce(
                            (sum, row) => sum + Number(row.principal_amount),
                            0,
                          ),
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums font-semibold">
                        {formatThaiBaht(
                          installments.reduce(
                            (sum, row) => sum + Number(row.interest_amount),
                            0,
                          ),
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums font-bold text-slate-900">
                        {formatThaiBaht(
                          installments.reduce(
                            (sum, row) => sum + Number(row.total_installment),
                            0,
                          ),
                        )}
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      <div className="grid grid-cols-1 gap-4 print:hidden md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">ใบเสร็จแนบ (Receipt)</CardTitle>
            <CardDescription>
              ไฟล์จาก Storage bucket expense_documents
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ExpenseAttachmentPreview
              url={expense.receipt_url}
              documentNo={expense.document_no}
              title="ใบเสร็จ"
              emptyLabel="ไม่มีไฟล์แนบ"
              fileLabel="ไฟล์แนบใบเสร็จ"
              viewFullLabel="ดูใบเสร็จเต็มจอ"
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              สลิปโอนเงิน (Payment Slip)
            </CardTitle>
            <CardDescription>
              หลักฐานการโอน (Optional) · bucket expense_documents
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ExpenseAttachmentPreview
              url={expense.payment_slip_url}
              documentNo={expense.document_no}
              title="สลิปโอนเงิน"
              emptyLabel="ไม่มีสลิปโอนเงินแนบ"
              fileLabel="ไฟล์แนบสลิปโอนเงิน"
              viewFullLabel="ดูสลิปเต็มจอ"
              storageTier={paymentSlipMeta.storage_tier}
              nasArchiveUrl={paymentSlipMeta.nas_archive_url}
            />
          </CardContent>
        </Card>
      </div>

      <PrintExpenseTemplate expense={expense} />
    </div>
  );
}
