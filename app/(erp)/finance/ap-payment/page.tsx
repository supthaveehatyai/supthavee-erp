import {
  getOutstandingAP,
  getVendors,
} from "@/app/actions/finance/ap-actions";
import { getOpenBillingNotesForContact, getPendingBillReceipts } from "@/app/actions/billing";
import { getBankAccounts } from "@/lib/actions/bank-accounts";
import { APPaymentClient } from "@/app/(erp)/finance/ap-payment/components/APPaymentClient";
import { PaymentReceiptRegister } from "@/components/finance/payment-receipt-register";
import {
  PageModeTabs,
  PAYMENT_TABS,
} from "@/components/shared/page-mode-tabs";

export const dynamic = "force-dynamic";

type ApPaymentPageProps = {
  searchParams: Promise<{ vendor_id?: string; billing_note_id?: string }>;
};

export default async function ApPaymentPage({
  searchParams,
}: ApPaymentPageProps) {
  const params = await searchParams;
  const selectedVendorId = params.vendor_id?.trim() || "";
  const billingNoteId = params.billing_note_id?.trim() || "";

  const [vendors, paymentContext, bankAccountsResult, billingNotesResult, pendingReceipts] =
    await Promise.all([
      getVendors(),
      getOutstandingAP(selectedVendorId),
      getBankAccounts(),
      selectedVendorId
        ? getOpenBillingNotesForContact(selectedVendorId, "AP")
        : Promise.resolve({ data: [], error: null }),
      getPendingBillReceipts(),
    ]);

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
      vendors={vendors}
      invoices={paymentContext.invoices}
      availableDeposits={paymentContext.availableDeposits}
      bankAccounts={bankAccountsResult.data ?? []}
      selectedVendorId={selectedVendorId}
      billingNotes={billingNotesResult.data}
      pendingReceipts={pendingReceipts.data}
      initialBillingNoteId={billingNoteId}
    />
      <div className="px-6 pb-6">
        <PaymentReceiptRegister />
      </div>
    </>
  );
}
