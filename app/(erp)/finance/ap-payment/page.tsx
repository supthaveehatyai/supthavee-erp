import {
  getOutstandingAP,
  getVendors,
} from "@/app/actions/finance/ap-actions";
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

  const [vendors, invoices, bankAccountsResult] = await Promise.all([
    getVendors(),
    getOutstandingAP(selectedVendorId),
    getBankAccounts(),
  ]);

  return (
    <APPaymentClient
      key={selectedVendorId || "none"}
      vendors={vendors}
      invoices={invoices}
      bankAccounts={bankAccountsResult.data ?? []}
      selectedVendorId={selectedVendorId}
    />
  );
}
