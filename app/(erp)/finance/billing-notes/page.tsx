import type { Metadata } from "next";
import {
  getBillingNotes,
  type BillingNoteDocType,
} from "@/app/actions/billing";
import { BillingNoteList } from "@/components/finance/BillingNoteList";

export const metadata: Metadata = {
  title: "ระบบวางบิล | Billing Note",
  description: "รายการใบวางบิลลูกหนี้ (BN) และรับวางบิลเจ้าหนี้ (BR)",
};

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{
    type?: string;
    search?: string;
  }>;
};

function resolveType(raw: string | undefined): BillingNoteDocType {
  return raw === "BR" ? "BR" : "BN";
}

export default async function BillingNotesPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const type = resolveType(params.type);
  const search = params.search?.trim() || undefined;

  const { data, error } = await getBillingNotes(type, search);

  return (
    <div className="flex flex-col gap-6 p-6">
      <BillingNoteList
        type={type}
        search={search ?? ""}
        rows={data}
        error={error}
      />
    </div>
  );
}
