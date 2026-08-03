"use client";

/**
 * Phase 7 — Production Kanban Board (Drag & Drop).
 * Optimistic UI → Server Action `updateJobStatus` (supabaseAdmin).
 */

import { useCallback, useMemo, useState } from "react";
import {
  DragDropContext,
  Draggable,
  Droppable,
  type DropResult,
} from "@hello-pangea/dnd";
import { CalendarDays, FileText, GripVertical } from "lucide-react";
import { toast } from "sonner";
import { updateJobStatus } from "@/app/actions/kanban-actions";
import {
  KANBAN_STATUSES,
  type ProductionJobCard,
  type ProductionJobStatus,
  type ProductionJobType,
  type ProductionJobsByStatus,
} from "@/types/kanban";
import { cn } from "@/lib/utils";

export type KanbanBoardProps = {
  initialJobs: ProductionJobCard[];
};

const COLUMN_META: Record<
  ProductionJobStatus,
  { title: string; accent: string; headerBg: string }
> = {
  TODO: {
    title: "รอดำเนินการ",
    accent: "border-t-slate-400",
    headerBg: "bg-slate-50",
  },
  IN_PROGRESS: {
    title: "กำลังทำ",
    accent: "border-t-blue-500",
    headerBg: "bg-blue-50/60",
  },
  QC: {
    title: "ตรวจคุณภาพ",
    accent: "border-t-amber-500",
    headerBg: "bg-amber-50/60",
  },
  READY_TO_SHIP: {
    title: "พร้อมส่ง",
    accent: "border-t-emerald-500",
    headerBg: "bg-emerald-50/60",
  },
  DELIVERED: {
    title: "ส่งมอบแล้ว",
    accent: "border-t-violet-500",
    headerBg: "bg-violet-50/60",
  },
};

const JOB_TYPE_LABEL: Record<ProductionJobType, string> = {
  SCREEN: "สกรีน",
  EMBROIDERY: "ปัก",
  SEWING: "เย็บ",
  OTHER: "อื่นๆ",
};

function emptyBoard(): ProductionJobsByStatus {
  return {
    TODO: [],
    IN_PROGRESS: [],
    QC: [],
    READY_TO_SHIP: [],
    DELIVERED: [],
  };
}

function groupByStatus(jobs: ProductionJobCard[]): ProductionJobsByStatus {
  const board = emptyBoard();
  for (const job of jobs) {
    const key = KANBAN_STATUSES.includes(job.status) ? job.status : "TODO";
    board[key].push(job);
  }
  return board;
}

function formatDueDate(value: string | null): string {
  if (!value) return "ไม่ระบุกำหนดส่ง";
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("th-TH", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

function isOverdue(dueDate: string | null, status: ProductionJobStatus): boolean {
  if (!dueDate || status === "DELIVERED") return false;
  const due = new Date(`${dueDate.slice(0, 10)}T23:59:59`);
  if (Number.isNaN(due.getTime())) return false;
  return due.getTime() < Date.now();
}

export function KanbanBoard({ initialJobs }: KanbanBoardProps) {
  const [columns, setColumns] = useState<ProductionJobsByStatus>(() =>
    groupByStatus(initialJobs),
  );

  const totalJobs = useMemo(
    () => KANBAN_STATUSES.reduce((sum, s) => sum + columns[s].length, 0),
    [columns],
  );

  const onDragEnd = useCallback(async (result: DropResult) => {
    const { destination, source, draggableId } = result;
    if (!destination) return;

    const sourceStatus = source.droppableId as ProductionJobStatus;
    const destStatus = destination.droppableId as ProductionJobStatus;

    if (
      sourceStatus === destStatus &&
      source.index === destination.index
    ) {
      return;
    }

    if (
      !KANBAN_STATUSES.includes(sourceStatus) ||
      !KANBAN_STATUSES.includes(destStatus)
    ) {
      return;
    }

    let snapshotForRollback: ProductionJobsByStatus | null = null;
    let didMove = false;

    setColumns((prev) => {
      snapshotForRollback = {
        TODO: [...prev.TODO],
        IN_PROGRESS: [...prev.IN_PROGRESS],
        QC: [...prev.QC],
        READY_TO_SHIP: [...prev.READY_TO_SHIP],
        DELIVERED: [...prev.DELIVERED],
      };

      const next: ProductionJobsByStatus = {
        TODO: [...prev.TODO],
        IN_PROGRESS: [...prev.IN_PROGRESS],
        QC: [...prev.QC],
        READY_TO_SHIP: [...prev.READY_TO_SHIP],
        DELIVERED: [...prev.DELIVERED],
      };

      const sourceList = next[sourceStatus];
      const [moved] = sourceList.splice(source.index, 1);
      if (!moved) return prev;

      didMove = true;
      next[destStatus].splice(destination.index, 0, {
        ...moved,
        status: destStatus,
      });
      return next;
    });

    // Same column reorder — visual only (no sort order column in DB)
    if (sourceStatus === destStatus || !didMove) {
      return;
    }

    const actionResult = await updateJobStatus(draggableId, destStatus);
    if (!actionResult.success) {
      if (snapshotForRollback) setColumns(snapshotForRollback);
      toast.error(actionResult.error ?? "อัปเดตสถานะไม่สำเร็จ");
      return;
    }

    toast.success(`ย้ายงานไป "${COLUMN_META[destStatus].title}" แล้ว`);
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-slate-500">
        ทั้งหมด {totalJobs} งาน · ลากการ์ดเพื่อเปลี่ยนสถานะ (บันทึกอัตโนมัติ)
      </p>

      <DragDropContext onDragEnd={onDragEnd}>
        <div className="flex gap-3 overflow-x-auto pb-2">
          {KANBAN_STATUSES.map((status) => {
            const meta = COLUMN_META[status];
            const jobs = columns[status];

            return (
              <div
                key={status}
                className={cn(
                  "flex w-[280px] shrink-0 flex-col rounded-xl border border-slate-200 bg-slate-50/40 shadow-sm border-t-4",
                  meta.accent,
                )}
              >
                <div
                  className={cn(
                    "flex items-center justify-between gap-2 rounded-t-[10px] border-b border-slate-200 px-3 py-2.5",
                    meta.headerBg,
                  )}
                >
                  <div>
                    <p className="text-sm font-bold text-slate-800">
                      {meta.title}
                    </p>
                    <p className="font-mono text-[10px] uppercase tracking-wide text-slate-400">
                      {status}
                    </p>
                  </div>
                  <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-white px-1.5 text-xs font-semibold text-slate-700 ring-1 ring-slate-200">
                    {jobs.length}
                  </span>
                </div>

                <Droppable droppableId={status}>
                  {(provided, snapshot) => (
                    <div
                      ref={provided.innerRef}
                      {...provided.droppableProps}
                      className={cn(
                        "flex min-h-[420px] flex-1 flex-col gap-2 p-2 transition-colors",
                        snapshot.isDraggingOver && "bg-blue-50/50",
                      )}
                    >
                      {jobs.map((job, index) => (
                        <Draggable
                          key={job.id}
                          draggableId={job.id}
                          index={index}
                        >
                          {(dragProvided, dragSnapshot) => (
                            <article
                              ref={dragProvided.innerRef}
                              {...dragProvided.draggableProps}
                              className={cn(
                                "rounded-lg border border-slate-200 bg-white p-3 shadow-sm transition-shadow",
                                dragSnapshot.isDragging &&
                                  "rotate-[1deg] shadow-lg ring-2 ring-blue-200",
                              )}
                            >
                              <div className="flex items-start gap-2">
                                <button
                                  type="button"
                                  className="mt-0.5 cursor-grab text-slate-300 active:cursor-grabbing"
                                  {...dragProvided.dragHandleProps}
                                  aria-label="ลากเพื่อย้ายสถานะ"
                                >
                                  <GripVertical className="h-4 w-4" />
                                </button>
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-start justify-between gap-2">
                                    <p className="font-mono text-sm font-bold text-slate-900">
                                      {job.job_no}
                                    </p>
                                    <span className="shrink-0 rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
                                      {JOB_TYPE_LABEL[job.job_type] ??
                                        job.job_type}
                                    </span>
                                  </div>

                                  <div className="mt-1.5 flex items-center gap-1.5 text-xs text-slate-600">
                                    <FileText className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                                    <span className="truncate">
                                      {job.document_no || "ไม่ผูกเอกสาร"}
                                      {job.customer_name
                                        ? ` · ${job.customer_name}`
                                        : ""}
                                    </span>
                                  </div>

                                  <div
                                    className={cn(
                                      "mt-1.5 flex items-center gap-1.5 text-xs",
                                      isOverdue(job.due_date, job.status)
                                        ? "font-semibold text-red-600"
                                        : "text-slate-500",
                                    )}
                                  >
                                    <CalendarDays className="h-3.5 w-3.5 shrink-0" />
                                    <span>{formatDueDate(job.due_date)}</span>
                                  </div>

                                  {job.details ? (
                                    <p className="mt-2 line-clamp-2 text-[11px] leading-snug text-slate-500">
                                      {job.details}
                                    </p>
                                  ) : null}
                                </div>
                              </div>
                            </article>
                          )}
                        </Draggable>
                      ))}
                      {provided.placeholder}
                      {jobs.length === 0 ? (
                        <p className="px-2 py-6 text-center text-[11px] text-slate-400">
                          วางการ์ดที่นี่
                        </p>
                      ) : null}
                    </div>
                  )}
                </Droppable>
              </div>
            );
          })}
        </div>
      </DragDropContext>
    </div>
  );
}
