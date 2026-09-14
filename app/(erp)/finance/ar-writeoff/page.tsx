import type { Metadata } from "next";
import { FileMinus2 } from "lucide-react";
import { getOpenBillingNotesForContact } from "@/app/actions/billing";
import { ArWriteoffForm } from "@/components/finance/ArWriteoffForm";
import {
  getDebtorsList,
  getUnpaidInvoicesByCustomer,
} from "@/lib/actions/finance/payment";
import { isArWriteoffSourceDocType } from "@/lib/constants/document";

export const metadata: Metadata = {
  title: "ตัดหนี้สูญ | AR Write-off",
  description: "บันทึกใบสำคัญตัดหนี้สูญ / ตัดเศษบัญชีลูกหนี้การค้า",
};

export const dynamic = "force-dynamic";

type ArWriteoffPageProps = {
  searchParams: Promise<{ contact_id?: string }>;
};

export default async function ArWriteoffPage({
  searchParams,
}: ArWriteoffPageProps) {
  const params = await searchParams;
  const selectedContactId = params.contact_id?.trim() || "";

  const [debtors, paymentContext, billingNotesResult] = await Promise.all([
    getDebtorsList(),
    getUnpaidInvoicesByCustomer(selectedContactId),
    selectedContactId
      ? getOpenBillingNotesForContact(selectedContactId, "AR")
      : Promise.resolve({ data: [], error: null }),
  ]);

  const invoices = paymentContext.invoices.filter((inv) =>
    isArWriteoffSourceDocType(inv.doc_type),
  );

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-2">
        <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight text-slate-900">
          <FileMinus2 className="h-8 w-8 text-blue-600" />
          บันทึกตัดหนี้สูญ / ตัดเศษบัญชี
        </h1>
        <p className="text-slate-500">
          เลือกลูกหนี้และระบุยอดตัดหนี้ต่อบิล (INV_DO / TAX_INV / CS_TAX) ·
          ใบวางบิล (BN) ใช้กรองรายการ · ไม่มีการรับเงินสด
        </p>
      </div>

      <ArWriteoffForm
        key={selectedContactId || "empty"}
        debtors={debtors}
        invoices={invoices}
        selectedContactId={selectedContactId}
        billingNotes={billingNotesResult.data}
      />
    </div>
  );
}
