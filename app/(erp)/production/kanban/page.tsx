import type { Metadata } from "next";
import { KanbanSquare } from "lucide-react";
import { getProductionJobs } from "@/lib/actions/production-actions";
import { CreateMtoJobDialog } from "@/components/production/create-mto-job-dialog";
import { KanbanBoard } from "@/components/production/kanban-board";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Production Kanban | งานผลิต",
  description: "กระดานงานผลิต MTO — รอผลิต / กำลังผลิต / QA / เสร็จสิ้น",
};

/**
 * Server Component — โหลด Initial Data แล้วส่งให้ Client Board
 * Zero Client-Side Fetching: ห้าม supabase.from() ใน Client
 */
export default async function ProductionKanbanPage() {
  const result = await getProductionJobs();

  if (!result.success) {
    return (
      <div className="space-y-4 p-6">
        <PageHeader />
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {result.error}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <PageHeader />
      <KanbanBoard initialJobs={result.flat} />
    </div>
  );
}

function PageHeader() {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-slate-900">
          <KanbanSquare className="size-7 text-blue-600" aria-hidden />
          Production Kanban
        </h1>
        <p className="text-sm text-slate-500">
          Make-to-Order — ลากการ์ดเพื่ออัปเดตสถานะ (PLANNED → IN_PROGRESS → QA →
          COMPLETED)
        </p>
      </div>
      <CreateMtoJobDialog />
    </div>
  );
}
