import {
  getOutstandingAP,
  getVendors,
} from "@/app/actions/finance/ap-actions";
import { getOpenBillingNotesForContact } from "@/app/actions/billing";
import { getBankAccounts } from "@/lib/actions/bank-accounts";
import { APPaymentClient } from "@/app/(erp)/finance/ap-payment/components/APPaymentClient";

export const dynamic = "force-dynamic";

type ApPaymentPageProps = {
  searchParams: Promise<{ vendor_id?: string }>;
};

export default async function ApPaymentPage({
  searchParams,
}: ApPaymentPageProps) {
  const params = await searchParams;
  const selectedVendorId = params.vendor_id?.trim() || "";

  const [vendors, paymentContext, bankAccountsResult, billingNotesResult] =
    await Promise.all([
      getVendors(),
      getOutstandingAP(selectedVendorId),
      getBankAccounts(),
      selectedVendorId
        ? getOpenBillingNotesForContact(selectedVendorId, "AP")
        : Promise.resolve({ data: [], error: null }),
    ]);

  return (
    <APPaymentClient
      key={selectedVendorId || "none"}
      vendors={vendors}
      invoices={paymentContext.invoices}
      availableDeposits={paymentContext.availableDeposits}
      bankAccounts={bankAccountsResult.data ?? []}
      selectedVendorId={selectedVendorId}
      billingNotes={billingNotesResult.data}
    />
  );
}
