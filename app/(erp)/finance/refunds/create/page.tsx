import type { Metadata } from "next";
import { BanknoteArrowDown } from "lucide-react";
import { getAvailableDeposits, getRefundParties } from "@/app/actions/refunds";
import { getBankAccounts } from "@/lib/actions/bank-accounts";
import { todayIsoDate } from "@/lib/utils/outstanding-summary";
import type { RefundSide } from "@/types/refund";
import { RefundCreateForm } from "@/app/(erp)/finance/refunds/create/refund-create-form";

export const metadata: Metadata = {
  title: "คืนเงินมัดจำ | Refund Management",
  description: "ออกเอกสารคืนเงินมัดจำ AR_REFUND / AP_REFUND",
};

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type RefundCreatePageProps = {
  searchParams: Promise<{
    type?: string;
    contact_id?: string;
  }>;
};

function resolveRefundSide(raw: string | undefined): RefundSide {
  return raw === "AP" ? "AP" : "AR";
}

export default async function RefundCreatePage({
  searchParams,
}: RefundCreatePageProps) {
  const params = await searchParams;
  const type = resolveRefundSide(params.type);
  const selectedContactId = params.contact_id?.trim() || "";

  const [partiesResult, depositsResult, bankAccountsResult] = await Promise.all(
    [
      getRefundParties(type),
      selectedContactId
        ? getAvailableDeposits(type, selectedContactId)
        : Promise.resolve({ success: true, data: [], error: null }),
      getBankAccounts(),
    ],
  );

  return (
    <RefundCreateForm
      key={`${type}-${selectedContactId || "empty"}`}
      type={type}
      selectedContactId={selectedContactId}
      parties={partiesResult.data}
      partiesError={partiesResult.error}
      deposits={depositsResult.data}
      depositsError={depositsResult.error}
      bankAccounts={bankAccountsResult.data ?? []}
      defaultDate={todayIsoDate()}
    />
  );
}
