"use client";

/**
 * Production Kanban Board — Client Component
 * @hello-pangea/dnd + useOptimistic / useTransition (Zero-Latency UX)
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useOptimistic,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import {
  DragDropContext,
  Draggable,
  Droppable,
  type DropResult,
} from "@hello-pangea/dnd";
import { GripVertical } from "lucide-react";
import { toast } from "sonner";
import { updateJobStatus } from "@/lib/actions/production-actions";
import {
  emptyProductionBoard,
  isProductionKanbanStatus,
  PRODUCTION_KANBAN_STATUSES,
  type ProductionJobCard,
  type ProductionJobsByStatus,
  type ProductionKanbanStatus,
} from "@/types/production";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type KanbanBoardProps = {
  initialJobs: ProductionJobCard[];
};

const COLUMN_META: Record<
  ProductionKanbanStatus,
  { title: string; badge: "slate" | "blue" | "amber" | "emerald" }
> = {
  PLANNED: { title: "รอผลิต", badge: "slate" },
  IN_PROGRESS: { title: "กำลังผลิต", badge: "blue" },
  QA: { title: "ตรวจสอบคุณภาพ", badge: "amber" },
  COMPLETED: { title: "เสร็จสิ้น", badge: "emerald" },
};

type OptimisticAction = {
  jobId: string;
  from: ProductionKanbanStatus;
  to: ProductionKanbanStatus;
  fromIndex: number;
  toIndex: number;
};

function groupByStatus(jobs: ProductionJobCard[]): ProductionJobsByStatus {
  const board = emptyProductionBoard();
  for (const job of jobs) {
    if (isProductionKanbanStatus(job.status)) {
      board[job.status].push(job);
    }
  }
  return board;
}

function applyOptimistic(
  board: ProductionJobsByStatus,
  action: OptimisticAction,
): ProductionJobsByStatus {
  const next: ProductionJobsByStatus = {
    PLANNED: [...board.PLANNED],
    IN_PROGRESS: [...board.IN_PROGRESS],
    QA: [...board.QA],
    COMPLETED: [...board.COMPLETED],
  };

  const sourceList = next[action.from];
  const idx = sourceList.findIndex((j) => j.id === action.jobId);
  const fromIndex = idx >= 0 ? idx : action.fromIndex;
  const [moved] = sourceList.splice(fromIndex, 1);
  if (!moved) return board;

  next[action.to].splice(action.toIndex, 0, {
    ...moved,
    status: action.to,
  });
  return next;
}

function formatQty(value: number): string {
  return value.toLocaleString("th-TH", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  });
}

export function KanbanBoard({ initialJobs }: KanbanBoardProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  /** Source of truth — synced from Server Component props */
  const [jobs, setJobs] = useState<ProductionJobCard[]>(initialJobs);

  useEffect(() => {
    setJobs(initialJobs);
  }, [initialJobs]);

  const baseBoard = useMemo(() => groupByStatus(jobs), [jobs]);

  const [optimisticBoard, dispatchOptimistic] = useOptimistic(
    baseBoard,
    applyOptimistic,
  );

  const totalJobs = useMemo(
    () =>
      PRODUCTION_KANBAN_STATUSES.reduce(
        (sum, status) => sum + optimisticBoard[status].length,
        0,
      ),
    [optimisticBoard],
  );

  const onDragEnd = useCallback(
    (result: DropResult) => {
      const { destination, source, draggableId } = result;
      if (!destination || isPending) return;

      const from = source.droppableId;
      const to = destination.droppableId;
      if (!isProductionKanbanStatus(from) || !isProductionKanbanStatus(to)) {
        return;
      }
      if (from === to && source.index === destination.index) return;

      // Same-column reorder — visual only (no persistent sort_order)
      if (from === to) {
        startTransition(() => {
          dispatchOptimistic({
            jobId: draggableId,
            from,
            to,
            fromIndex: source.index,
            toIndex: destination.index,
          });
        });
        return;
      }

      startTransition(async () => {
        // 1) Optimistic UI — zero latency
        dispatchOptimistic({
          jobId: draggableId,
          from,
          to,
          fromIndex: source.index,
          toIndex: destination.index,
        });

        // 2) Persist in background
        const actionResult = await updateJobStatus(draggableId, to);

        if (!actionResult.success) {
          // 3) Revert: keep `jobs` unchanged → useOptimistic snaps back to baseBoard
          toast.error(actionResult.error ?? "อัปเดตสถานะไม่สำเร็จ — คืนการ์ดแล้ว");
          return;
        }

        // 4) Commit local truth so UI ไม่กระพริบก่อน refresh
        setJobs((prev) =>
          prev.map((job) =>
            job.id === draggableId ? { ...job, status: to } : job,
          ),
        );
        toast.success(`ย้ายไป "${COLUMN_META[to].title}" แล้ว`);
        router.refresh();
      });
    },
    [dispatchOptimistic, isPending, router],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground text-slate-500">
          ทั้งหมด{" "}
          <span className="font-semibold tabular-nums text-slate-800">
            {totalJobs}
          </span>{" "}
          งาน · ลากการ์ดเพื่อเปลี่ยนสถานะ
        </p>
        {isPending ? (
          <Badge variant="blue">กำลังบันทึก...</Badge>
        ) : (
          <Badge variant="slate">พร้อมลาก</Badge>
        )}
      </div>

      <DragDropContext onDragEnd={onDragEnd}>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {PRODUCTION_KANBAN_STATUSES.map((status) => {
            const meta = COLUMN_META[status];
            const columnJobs = optimisticBoard[status];

            return (
              <section
                key={status}
                className="flex min-h-[28rem] flex-col rounded-xl border border-slate-200 bg-slate-50/50"
              >
                <header className="flex items-center justify-between gap-2 border-b border-slate-200 px-3 py-3">
                  <div className="min-w-0">
                    <h2 className="truncate text-sm font-semibold text-slate-900">
                      {meta.title}
                    </h2>
                    <p className="font-mono text-[10px] uppercase tracking-wider text-slate-400">
                      {status}
                    </p>
                  </div>
                  <Badge variant={meta.badge}>{columnJobs.length}</Badge>
                </header>

                <Droppable droppableId={status} isDropDisabled={isPending}>
                  {(provided, snapshot) => (
                    <div
                      ref={provided.innerRef}
                      {...provided.droppableProps}
                      className={cn(
                        "flex flex-1 flex-col gap-2 p-2 transition-colors",
                        snapshot.isDraggingOver && "bg-blue-50/40",
                      )}
                    >
                      {columnJobs.map((job, index) => (
                        <Draggable
                          key={job.id}
                          draggableId={job.id}
                          index={index}
                          isDragDisabled={isPending}
                        >
                          {(dragProvided, dragSnapshot) => (
                            <article
                              ref={dragProvided.innerRef}
                              {...dragProvided.draggableProps}
                              className={cn(
                                "rounded-lg border border-slate-200 bg-white p-3 shadow-sm",
                                "transition-[box-shadow,border-color]",
                                dragSnapshot.isDragging &&
                                  "border-blue-300 shadow-md ring-2 ring-blue-100",
                              )}
                            >
                              <div className="flex items-start gap-2">
                                <button
                                  type="button"
                                  className="mt-0.5 shrink-0 cursor-grab text-slate-300 outline-none hover:text-slate-500 active:cursor-grabbing"
                                  aria-label={`ลากงาน ${job.job_no}`}
                                  {...dragProvided.dragHandleProps}
                                >
                                  <GripVertical className="size-4" />
                                </button>

                                <div className="min-w-0 flex-1 space-y-1.5">
                                  <p className="font-mono text-sm font-semibold text-slate-900">
                                    {job.job_no}
                                  </p>
                                  <p className="truncate text-sm text-slate-700">
                                    {job.product_name}
                                  </p>
                                  <p className="text-xs text-slate-500">
                                    จำนวน{" "}
                                    <span className="font-medium tabular-nums text-slate-800">
                                      {formatQty(job.target_quantity)}
                                    </span>
                                  </p>
                                </div>
                              </div>
                            </article>
                          )}
                        </Draggable>
                      ))}
                      {provided.placeholder}

                      {columnJobs.length === 0 ? (
                        <p className="px-2 py-10 text-center text-xs text-slate-400">
                          ว่าง
                        </p>
                      ) : null}
                    </div>
                  )}
                </Droppable>
              </section>
            );
          })}
        </div>
      </DragDropContext>
    </div>
  );
}
