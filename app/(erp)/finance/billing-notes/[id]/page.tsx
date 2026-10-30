import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getBillingNoteById, getBillingNoteSettlements } from "@/app/actions/billing";
import { BillingNoteDetail } from "@/components/finance/BillingNoteDetail";
import BillingNotePrintTemplate from "@/components/finance/BillingNotePrintTemplate";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
};

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { id } = await params;
  const { data } = await getBillingNoteById(id);
  if (!data) {
    return { title: "ไม่พบใบวางบิล | Billing Note" };
  }
  return {
    title: `${data.doc_no} | Billing Note`,
    description: `รายละเอียดใบวางบิล ${data.doc_no}`,
  };
}

export default async function BillingNoteDetailPage({ params }: PageProps) {
  const { id } = await params;
  const { data, error } = await getBillingNoteById(id);
  const paid =
    (data?.doc_type === "BR" || data?.doc_type === "BN") &&
    ["PAID", "COMPLETED"].includes(String(data.payment_status ?? "").trim().toUpperCase());
  const settlements = paid ? await getBillingNoteSettlements(id) : { data: [], error: null };

  if (!data) {
    if (error) {
      return (
        <div className="p-6">
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        </div>
      );
    }
    notFound();
  }

  return (
    <div className="flex flex-col gap-6 p-6 print:gap-0 print:p-0">
      <BillingNoteDetail document={data} settlements={settlements.data} />
      <BillingNotePrintTemplate document={data} />
    </div>
  );
}
