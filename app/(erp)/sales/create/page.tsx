import type { Metadata } from "next";
import { listActiveBankAccounts, listActiveCustomers } from "@/lib/actions/document-actions";
import { isSalesTradingDocType } from "@/lib/constants/document";
import SalesCreateWorkspace from "./sales-create-workspace";

export const metadata: Metadata = {
  title: "เปิดบิลขาย | Sales Document",
  description:
    "Phase 4 — สร้างเอกสารขายผ่าน Server Component + Server Actions (ห้าม Client Supabase)",
};

export const maxDuration = 60;

type PageProps = {
  searchParams: Promise<{ import?: string; doc_type?: string }>;
};

/**
 * Server Component entry — loads customers via Service Role Server Action,
 * then hands interactive state to the Client workspace island.
 */
export default async function CreateSalesDocumentPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const requestedType = String(params.doc_type ?? "").trim().toUpperCase();
  const [customersResult, bankAccounts] = await Promise.all([
    listActiveCustomers(),
    listActiveBankAccounts(),
  ]);

  return (
    <SalesCreateWorkspace
      customers={customersResult.data}
      customersError={customersResult.error}
      openEcommerceImport={params.import === "ecommerce"}
      initialDocType={
        isSalesTradingDocType(requestedType) ? requestedType : undefined
      }
      bankAccounts={bankAccounts.data}
    />
  );
}
