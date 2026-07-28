import type { Metadata } from "next";
import { listActiveCustomers } from "@/lib/actions/document-actions";
import SalesCreateWorkspace from "./sales-create-workspace";

export const metadata: Metadata = {
  title: "เปิดบิลขาย | Sales Document",
  description:
    "Phase 4 — สร้างเอกสารขายผ่าน Server Component + Server Actions (ห้าม Client Supabase)",
};

/**
 * Server Component entry — loads customers via Service Role Server Action,
 * then hands interactive state to the Client workspace island.
 */
export default async function CreateSalesDocumentPage() {
  const customersResult = await listActiveCustomers();

  return (
    <SalesCreateWorkspace
      customers={customersResult.data}
      customersError={customersResult.error}
    />
  );
}
