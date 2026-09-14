import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, FileMinus2 } from "lucide-react";
import { getOutstandingAP } from "@/app/actions/ap-writeoff";
import { getOpenBillingNotesForContact } from "@/app/actions/billing";
import { ApWriteoffForm } from "@/components/finance/ApWriteoffForm";
import { roundMoney } from "@/lib/utils/payment-fifo";
import type { ApVendorOption } from "@/types/ap-payment";
import type { OutstandingApDocument } from "@/types/ap-writeoff";
import type { UnpaidInvoice } from "@/types/payment";

export const metadata: Metadata = {
  title: "เปิดบิลตัดหนี้สูญ | AP Write-off",
  description: "บันทึกใบสำคัญตัดหนี้สูญ / ตัดเศษบัญชีเจ้าหนี้การค้า",
};

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type ApWriteoffCreatePageProps = {
  searchParams: Promise<{ contact_id?: string }>;
};

function groupVendors(rows: OutstandingApDocument[]): ApVendorOption[] {
  const grouped = new Map<
    string,
    {
      name: string;
      outstanding_total: number;
      invoice_count: number;
      oldest_invoice_date: string | null;
    }
  >();

  for (const row of rows) {
    const existing = grouped.get(row.contact_id);
    if (!existing) {
      grouped.set(row.contact_id, {
        name: row.contact_name,
        outstanding_total: row.remaining_balance,
        invoice_count: 1,
        oldest_invoice_date: row.doc_date || null,
      });
      continue;
    }
    existing.outstanding_total = roundMoney(
      existing.outstanding_total + row.remaining_balance,
    );
    existing.invoice_count += 1;
    if (
      row.doc_date &&
      (!existing.oldest_invoice_date ||
        row.doc_date < existing.oldest_invoice_date)
    ) {
      existing.oldest_invoice_date = row.doc_date;
    }
  }

  return Array.from(grouped.entries())
    .map(([id, row]) => ({
      id,
      name: row.name,
      outstanding_total: row.outstanding_total,
      invoice_count: row.invoice_count,
      overdue_amount: 0,
      oldest_invoice_date: row.oldest_invoice_date,
    }))
    .sort((a, b) => b.outstanding_total - a.outstanding_total);
}

function toUnpaidInvoice(row: OutstandingApDocument): UnpaidInvoice {
  return {
    id: row.id,
    display_doc_no: row.doc_no,
    document_date: row.doc_date,
    doc_type: row.doc_type,
    payment_status: row.payment_status,
    grand_total: row.grand_total,
    net_amount_calc: row.grand_total,
    paid_amount: row.allocated_amount,
    allocated_amount: row.allocated_amount,
    allocation_source_doc_nos: [],
    remaining_balance: row.remaining_balance,
    contact_id: row.contact_id,
  };
}

export default async function ApWriteoffCreatePage({
  searchParams,
}: ApWriteoffCreatePageProps) {
  const params = await searchParams;
  const selectedContactId = params.contact_id?.trim() || "";

  const [outstandingResult, billingNotesResult] = await Promise.all([
    getOutstandingAP(),
    selectedContactId
      ? getOpenBillingNotesForContact(selectedContactId, "AP")
      : Promise.resolve({ data: [], error: null }),
  ]);

  const outstandingRows = outstandingResult.data;
  const vendors = groupVendors(outstandingRows);
  const invoices = selectedContactId
    ? outstandingRows
        .filter((row) => row.contact_id === selectedContactId)
        .map(toUnpaidInvoice)
    : [];

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-2">
        <Link
          href="/finance/ap-writeoff"
          className="inline-flex w-fit items-center gap-1.5 text-sm font-semibold text-slate-600 transition hover:text-blue-700"
        >
          <ArrowLeft className="h-4 w-4" />
          กลับไปประวัติตัดหนี้สูญ
        </Link>
        <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight text-slate-900">
          <FileMinus2 className="h-8 w-8 text-blue-600" />
          เปิดบิลตัดหนี้สูญ / ตัดเศษบัญชีเจ้าหนี้
        </h1>
        <p className="text-slate-500">
          เลือกผู้จำหน่ายจากตารางสรุปยอดหนี้ แล้วระบุยอดตัดหนี้ต่อบิล
          (AP_INV / AP_TAX / AP_CASH) · ใบรับวางบิล (BR) ใช้กรองรายการ · ไม่มีการจ่ายเงินสด
        </p>
      </div>

      <ApWriteoffForm
        key={selectedContactId || "empty"}
        vendors={vendors}
        invoices={invoices}
        selectedContactId={selectedContactId}
        billingNotes={billingNotesResult.data}
      />
    </div>
  );
}
