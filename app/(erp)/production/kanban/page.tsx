import type { Metadata } from "next";
import { KanbanSquare } from "lucide-react";
import {
  getJobDetails,
  getKanbanBoardData,
} from "@/app/actions/kanban-actions";
import { JobDetailSheet } from "@/components/production/job-detail-sheet";
import { KanbanBoard } from "@/components/production/kanban-board";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Production Kanban | งานผลิต",
  description: "กระดานงานผลิต — สกรีน ปัก เย็บ (Phase 7)",
};

type PageProps = {
  searchParams: Promise<{ jobId?: string }>;
};

export default async function ProductionKanbanPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const jobId = params.jobId?.trim() ?? "";

  const result = await getKanbanBoardData();

  const jobDetailsResult = jobId ? await getJobDetails(jobId) : null;

  if (!result.success) {
    return (
      <div className="flex flex-col gap-4 p-6">
        <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight text-slate-900">
          <KanbanSquare className="h-8 w-8 text-blue-600" />
          Production Kanban
        </h1>
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {result.error}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-2">
        <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight text-slate-900">
          <KanbanSquare className="h-8 w-8 text-blue-600" />
          Production Kanban
        </h1>
        <p className="text-sm text-slate-500">
          Make-to-Order — ส่งงานจาก INV_DO · ลากการ์ดเพื่ออัปเดตสถานะ ·
          คลิกการ์ดเพื่อดูรายละเอียด
        </p>
      </div>

      <KanbanBoard initialJobs={result.flat} selectedJobId={jobId || null} />

      <JobDetailSheet
        job={jobDetailsResult?.success ? jobDetailsResult.data : null}
        error={
          jobDetailsResult && !jobDetailsResult.success
            ? jobDetailsResult.error
            : null
        }
      />
    </div>
  );
}
