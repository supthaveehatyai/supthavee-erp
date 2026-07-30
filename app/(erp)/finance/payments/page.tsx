import {
  getDebtorsList,
  getUnpaidInvoicesByCustomer,
} from "@/lib/actions/finance/payment";
import { getBankAccounts } from "@/lib/actions/bank-accounts";
import { ARPaymentClient } from "@/app/(erp)/finance/payments/components/ARPaymentClient";

export const dynamic = "force-dynamic";

type PaymentsPageProps = {
  searchParams: Promise<{ contact_id?: string }>;
};

export default async function PaymentsPage({ searchParams }: PaymentsPageProps) {
  const params = await searchParams;
  const selectedContactId = params.contact_id?.trim() || "";

  const [debtors, bankAccountsResult, paymentContext] = await Promise.all([
    getDebtorsList(),
    getBankAccounts(),
    getUnpaidInvoicesByCustomer(selectedContactId),
  ]);

  const bankAccounts = bankAccountsResult.data ?? [];

  return (
    <ARPaymentClient
      key={selectedContactId || "summary"}
      debtors={debtors}
      invoices={paymentContext.invoices}
      availableDeposits={paymentContext.availableDeposits}
      bankAccounts={bankAccounts}
      selectedContactId={selectedContactId}
    />
  );
}
