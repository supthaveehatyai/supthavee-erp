import type { Metadata } from "next";
import {
  getBillingNotes,
  type BillingNoteDocType,
} from "@/app/actions/billing";
import { getUnbilledTechnicianJobs } from "@/app/actions/technician-billing";
import { BillingNoteList } from "@/components/finance/BillingNoteList";
import type { BillingNotesTab } from "@/types/technician-billing";

export const metadata: Metadata = {
  title: "ระบบวางบิล | Billing Note",
  description:
    "วางบิลลูกหนี้ (BN) · รับวางบิลเจ้าหนี้ (BR) · สรุปวางบิลช่าง (TB)",
};

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{
    type?: string;
    search?: string;
    technicianId?: string;
    from?: string;
    to?: string;
  }>;
};

function resolveTab(raw: string | undefined): BillingNotesTab {
  if (raw === "BR") return "BR";
  if (raw === "TB") return "TB";
  return "BN";
}

export default async function BillingNotesPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const type = resolveTab(params.type);
  const search = params.search?.trim() || undefined;

  if (type === "TB") {
    const technicianId = params.technicianId?.trim() ?? "";
    const from = params.from?.trim() ?? "";
    const to = params.to?.trim() ?? "";
    const tb = await getUnbilledTechnicianJobs({
      technicianId,
      from,
      to,
    });

    return (
      <div className="flex flex-col gap-6 p-6">
        <BillingNoteList
          type="TB"
          search=""
          rows={[]}
          error={tb.success ? null : tb.error}
          technicianBilling={{
            technicianId,
            from,
            to,
            rows: tb.rows,
            totalWage: tb.totalWage,
            technicians: tb.technicians,
            error: tb.success ? null : tb.error,
          }}
        />
      </div>
    );
  }

  const { data, error } = await getBillingNotes(type as BillingNoteDocType, search);

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
