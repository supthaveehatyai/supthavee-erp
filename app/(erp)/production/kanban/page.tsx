import type { Metadata } from "next";
import { KanbanSquare } from "lucide-react";
import { getProductionJobs } from "@/app/actions/kanban-actions";
import { KanbanBoard } from "@/components/production/kanban-board";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Production Kanban | งานผลิต",
  description: "กระดานงานผลิต — สกรีน ปัก เย็บ (Phase 7)",
};

export default async function ProductionKanbanPage() {
  const result = await getProductionJobs();

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
          ติดตามงานสกรีน / ปัก / เย็บ — ลากการ์ดเพื่ออัปเดตสถานะแบบ Real-time
        </p>
      </div>

      <KanbanBoard initialJobs={result.flat} />
    </div>
  );
}
