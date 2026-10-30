import {
  getOutstandingAP,
  getVendors,
} from "@/app/actions/finance/ap-actions";
import { getInvoicesByBillingNote, getOpenBillingNotesForContact, getPendingBillReceipts } from "@/app/actions/billing";
import { getBankAccounts } from "@/lib/actions/bank-accounts";
import { APPaymentClient } from "@/app/(erp)/finance/ap-payment/components/APPaymentClient";
import { PaymentReceiptRegister } from "@/components/finance/payment-receipt-register";
import {
  PageModeTabs,
  PAYMENT_TABS,
} from "@/components/shared/page-mode-tabs";
import type { OpenBillingNoteOption, PendingBillReceipt } from "@/types/billing";
import type { ApVendorOption, AvailableDeposit, OutstandingApInvoice } from "@/types/ap-payment";
import type { BankAccount } from "@/types/bank-account";

export const dynamic = "force-dynamic";

type ApPaymentPageProps = {
  searchParams: Promise<{ vendor_id?: string; billing_note_id?: string }>;
};

async function loadSafe<T>(label: string, task: () => Promise<T>, fallback: T): Promise<T> {
  try {
    const value = await task();
    return JSON.parse(JSON.stringify(value ?? fallback)) as T;
  } catch (err) {
    console.error(label, err);
    return fallback;
  }
}

function noteInvoices(
  rows: Array<{
    id?: string;
    contact_id?: string;
    doc_no?: string;
    doc_date?: string;
    grand_total?: number;
    paid_amount?: number;
    outstanding?: number;
    payment_status?: string;
    doc_type?: string;
  }>,
  vendorId: string,
): OutstandingApInvoice[] {
  return rows
    .filter((row) => row.id && row.doc_no)
    .map((row) => {
      const grand = Number(row.grand_total ?? 0);
      const outstanding = Number(row.outstanding ?? 0);
      const paid = Number(row.paid_amount ?? 0);
      return {
        id: String(row.id),
        contact_id: String(row.contact_id || vendorId),
        document_no: String(row.doc_no),
        reference_no: null,
        document_date: String(row.doc_date ?? ""),
        grand_total: Number.isFinite(grand) ? grand : 0,
        paid_amount: Number.isFinite(paid) ? paid : 0,
        allocated_amount: Number.isFinite(grand - outstanding) ? Math.max(0, grand - outstanding) : 0,
        allocation_sources: [],
        remaining_balance: Number.isFinite(outstanding) ? outstanding : 0,
        payment_status: String(row.payment_status ?? "UNPAID"),
        doc_type: String(row.doc_type ?? ""),
      };
    });
}

export default async function ApPaymentPage({
  searchParams,
}: ApPaymentPageProps) {
  const params = await searchParams;
  const selectedVendorId = params.vendor_id?.trim() || "";
  const billingNoteId = params.billing_note_id?.trim() || "";

  const [vendors, paymentContext, bankAccountsResult, billingNotesResult, pendingReceipts, linkedNote] =
    await Promise.all([
      loadSafe<ApVendorOption[]>("ap-payment vendors", () => getVendors(), []),
      loadSafe<{ invoices: OutstandingApInvoice[]; availableDeposits: AvailableDeposit[] }>(
        "ap-payment outstanding",
        () => getOutstandingAP(selectedVendorId),
        { invoices: [], availableDeposits: [] },
      ),
      loadSafe<{ data: BankAccount[]; error: string | null }>(
        "ap-payment banks",
        () => getBankAccounts(),
        { data: [], error: null },
      ),
      loadSafe<{ data: OpenBillingNoteOption[]; error: string | null }>(
        "ap-payment billing notes",
        () =>
          selectedVendorId
            ? getOpenBillingNotesForContact(selectedVendorId, "AP")
            : Promise.resolve({ data: [], error: null }),
        { data: [], error: null },
      ),
      loadSafe<{ data: PendingBillReceipt[]; error: string | null }>(
        "ap-payment pending receipts",
        () => getPendingBillReceipts(),
        { data: [], error: null },
      ),
      loadSafe(
        "ap-payment billing note invoices",
        () =>
          billingNoteId
            ? getInvoicesByBillingNote(billingNoteId)
            : Promise.resolve({ data: [], error: null, billing_note: null }),
        { data: [], error: null, billing_note: null },
      ),
    ]);

  const vendorInvoices = Array.isArray(paymentContext.invoices) ? paymentContext.invoices : [];
  const linkedRows = Array.isArray(linkedNote.data) ? linkedNote.data : [];
  const invoices =
    billingNoteId && !linkedNote.error ? noteInvoices(linkedRows, selectedVendorId) : vendorInvoices;
  let billingNotes = Array.isArray(billingNotesResult.data) ? billingNotesResult.data : [];
  if (
    billingNoteId &&
    linkedNote.billing_note?.id &&
    !billingNotes.some((note) => note.id === linkedNote.billing_note?.id)
  ) {
    billingNotes = [
      {
        id: linkedNote.billing_note.id,
        doc_no: linkedNote.billing_note.doc_no || "ใบวางบิล",
        doc_type: linkedNote.billing_note.doc_type === "BN" ? "BN" : "BR",
        doc_date: "",
        due_date: null,
        grand_total: invoices.reduce((sum, row) => sum + Number(row.remaining_balance || 0), 0),
        payment_status: "PENDING",
        invoice_count: invoices.length,
      },
      ...billingNotes,
    ];
  }

  return (
    <>
      <div className="px-6 pt-6">
        <PageModeTabs
          tabs={PAYMENT_TABS}
          activeKey="ap"
          ariaLabel="รับและจ่ายชำระหนี้"
        />
      </div>
      <APPaymentClient
      key={`${selectedVendorId || "none"}-${billingNoteId || "none"}`}
      vendors={Array.isArray(vendors) ? vendors : []}
      invoices={invoices}
      availableDeposits={Array.isArray(paymentContext.availableDeposits) ? paymentContext.availableDeposits : []}
      bankAccounts={Array.isArray(bankAccountsResult.data) ? bankAccountsResult.data : []}
      selectedVendorId={selectedVendorId}
      billingNotes={billingNotes}
      pendingReceipts={Array.isArray(pendingReceipts.data) ? pendingReceipts.data : []}
      initialBillingNoteId={billingNoteId}
    />
      <div className="px-6 pb-6">
        <PaymentReceiptRegister />
      </div>
    </>
  );
}
