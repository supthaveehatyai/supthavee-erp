import type { Metadata } from "next";
import { getBillingNotes } from "@/app/actions/billing";
import type { BillingNoteDocType } from "@/types/billing";
import {
  getJobDetails,
  getTechnicianOptions,
} from "@/app/actions/kanban-actions";
import { getUnbilledTechnicianJobs } from "@/app/actions/technician-billing";
import { BillingNoteList } from "@/components/finance/BillingNoteList";
import { JobDetailSheet } from "@/components/production/job-detail-sheet";
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
    view_job_id?: string;
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
  const viewJobId = params.view_job_id?.trim() ?? "";

  const jobDetailPromise = viewJobId
    ? Promise.all([
        getJobDetails(viewJobId).catch((err: unknown) => ({
          success: false as const,
          error: err instanceof Error ? err.message : "ดึงรายละเอียดงานไม่สำเร็จ",
          data: null,
        })),
        getTechnicianOptions().catch(() => ({ data: [], rates: [] })),
      ])
    : null;

  if (type === "TB") {
    const technicianId = params.technicianId?.trim() ?? "";
    const from = params.from?.trim() ?? "";
    const to = params.to?.trim() ?? "";
    const tb = await getUnbilledTechnicianJobs({
      technicianId,
      from,
      to,
    });

    const jobResults = await jobDetailPromise;
    const jobDetailsResult = jobResults?.[0] ?? null;
    const techniciansResult = jobResults?.[1] ?? { data: [], rates: [] };

    const closeParams = new URLSearchParams();
    closeParams.set("type", "TB");
    if (technicianId) closeParams.set("technicianId", technicianId);
    if (from) closeParams.set("from", from);
    if (to) closeParams.set("to", to);
    const closeHref = `/finance/billing-notes?${closeParams.toString()}`;

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
        {viewJobId && (
          <JobDetailSheet
            job={jobDetailsResult?.success ? jobDetailsResult.data : null}
            error={jobDetailsResult && !jobDetailsResult.success ? jobDetailsResult.error : null}
            technicians={techniciansResult.data}
            rates={techniciansResult.rates}
            closeHref={closeHref}
          />
        )}
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
