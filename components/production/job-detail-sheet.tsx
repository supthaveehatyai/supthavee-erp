"use client";

/**
 * Phase 7 — Job Detail Slide-over (URL-driven via ?jobId=).
 * Data is fetched on the Server and passed in (Zero Client-Side Fetching).
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Ban,
  CalendarDays,
  Factory,
  FileText,
  ImageIcon,
  Loader2,
  Package,
  User,
} from "lucide-react";
import { toast } from "sonner";
import { cancelProductionJob } from "@/app/actions/kanban-actions";
import {
  JOB_STATUS_LABEL,
  type ProductionJobDetails,
  type ProductionJobStatus,
  type ProductionJobType,
} from "@/types/kanban";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

const JOB_TYPE_LABEL: Record<ProductionJobType, string> = {
  SCREEN: "สกรีน",
  EMBROIDERY: "ปัก",
  SEWING: "เย็บ",
  OTHER: "อื่นๆ",
};

function statusBadgeClass(status: ProductionJobStatus): string {
  switch (status) {
    case "TODO":
      return "bg-slate-100 text-slate-700 ring-slate-200";
    case "IN_PROGRESS":
      return "bg-blue-50 text-blue-700 ring-blue-200";
    case "QC":
      return "bg-amber-50 text-amber-800 ring-amber-200";
    case "READY_TO_SHIP":
      return "bg-emerald-50 text-emerald-700 ring-emerald-200";
    case "DELIVERED":
      return "bg-violet-50 text-violet-700 ring-violet-200";
    case "CANCELLED":
      return "bg-red-50 text-red-700 ring-red-200";
    default:
      return "bg-slate-100 text-slate-600 ring-slate-200";
  }
}

function formatDueDate(value: string | null): string {
  if (!value) return "ไม่ระบุ";
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("th-TH", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

function formatQty(value: number): string {
  return value.toLocaleString("th-TH");
}

export type JobDetailSheetProps = {
  job: ProductionJobDetails | null;
  error?: string | null;
};

export function JobDetailSheet({ job, error }: JobDetailSheetProps) {
  const router = useRouter();
  const open = Boolean(job) || Boolean(error);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function closeSheet() {
    router.push("/production/kanban");
  }

  function handleOpenChange(next: boolean) {
    if (!next && !isPending) closeSheet();
  }

  function handleCancelJob() {
    if (!job || isPending) return;

    startTransition(async () => {
      const result = await cancelProductionJob(job.id);
      if (!result.success || !result.data) {
        toast.error(result.error ?? "ยกเลิกงานไม่สำเร็จ");
        setConfirmOpen(false);
        return;
      }

      toast.success(`ยกเลิกงาน ${result.data.job_no} แล้ว`);
      setConfirmOpen(false);
      router.push("/production/kanban");
      router.refresh();
    });
  }

  const canCancel =
    job && job.status !== "DELIVERED" && job.status !== "CANCELLED";

  return (
    <>
      <Sheet open={open} onOpenChange={handleOpenChange}>
        <SheetContent
          side="right"
          className="w-full overflow-y-auto p-0 sm:max-w-xl"
        >
          {error && !job ? (
            <div className="flex h-full flex-col gap-4 p-6">
              <SheetHeader>
                <SheetTitle>ไม่พบใบสั่งผลิต</SheetTitle>
                <SheetDescription>{error}</SheetDescription>
              </SheetHeader>
              <Button type="button" variant="outline" onClick={closeSheet}>
                ปิด
              </Button>
            </div>
          ) : job ? (
            <div className="flex h-full flex-col">
              <div className="border-b border-slate-200 px-6 py-5 pr-12">
                <SheetHeader className="gap-2 text-left">
                  <div className="flex flex-wrap items-center gap-2">
                    <SheetTitle className="font-mono text-xl">
                      {job.job_no}
                    </SheetTitle>
                    <span
                      className={cn(
                        "inline-flex rounded-md px-2 py-0.5 text-[11px] font-semibold ring-1",
                        statusBadgeClass(job.status),
                      )}
                    >
                      {JOB_STATUS_LABEL[job.status]}
                    </span>
                  </div>
                  <SheetDescription className="text-left">
                    รายละเอียดงานผลิต ·{" "}
                    {JOB_TYPE_LABEL[job.job_type] ?? job.job_type}
                  </SheetDescription>
                </SheetHeader>

                <div className="mt-4 grid gap-2 text-sm">
                  <div className="flex items-center gap-2 text-slate-600">
                    <FileText className="size-4 shrink-0 text-slate-400" />
                    <span className="font-mono font-semibold text-slate-800">
                      {job.document_no || "ไม่ผูกเอกสาร"}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-slate-600">
                    <User className="size-4 shrink-0 text-slate-400" />
                    <span>{job.customer_name || "ไม่ระบุลูกค้า"}</span>
                  </div>
                  <div className="flex items-center gap-2 text-slate-600">
                    <CalendarDays className="size-4 shrink-0 text-slate-400" />
                    <span>กำหนดส่ง {formatDueDate(job.due_date)}</span>
                  </div>
                  <div className="flex items-start gap-2 text-slate-600">
                    <Factory className="mt-0.5 size-4 shrink-0 text-slate-400" />
                    <span className="leading-snug">
                      {job.details || "ไม่มีรายละเอียดเพิ่มเติม"}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex flex-1 flex-col gap-6 overflow-y-auto px-6 py-5">
                <section className="space-y-3">
                  <div className="flex items-center gap-2">
                    <ImageIcon className="size-4 text-violet-500" />
                    <h3 className="text-sm font-bold text-slate-800">
                      รูปแนบ Mockup / Logo
                    </h3>
                    <span className="text-xs text-slate-400">
                      ({job.attachment_paths.length})
                    </span>
                  </div>

                  {job.attachment_paths.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-6 text-center text-xs text-slate-400">
                      ไม่มีรูปแนบ
                    </p>
                  ) : (
                    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                      {job.attachment_paths.map((url, index) => (
                        <a
                          key={`${url}-${index}`}
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="group overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm transition hover:border-violet-300 hover:ring-2 hover:ring-violet-100"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={url}
                            alt={`Attachment ${index + 1}`}
                            className="aspect-square w-full object-cover transition group-hover:scale-[1.02]"
                          />
                        </a>
                      ))}
                    </div>
                  )}
                </section>

                <section className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Package className="size-4 text-blue-500" />
                    <h3 className="text-sm font-bold text-slate-800">
                      รายการสินค้าที่ต้องผลิต
                    </h3>
                  </div>

                  {job.line_items.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-6 text-center text-xs text-slate-400">
                      ไม่พบรายการสินค้าในเอกสารต้นทาง
                    </p>
                  ) : (
                    <div className="overflow-hidden rounded-xl border border-slate-200">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-slate-50 hover:bg-slate-50">
                            <TableHead className="text-xs">SKU</TableHead>
                            <TableHead className="text-xs">ชื่อสินค้า</TableHead>
                            <TableHead className="text-right text-xs">
                              จำนวน
                            </TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {job.line_items.map((item) => (
                            <TableRow key={item.id}>
                              <TableCell className="font-mono text-xs font-semibold text-slate-800">
                                {item.sku}
                              </TableCell>
                              <TableCell className="text-xs text-slate-700">
                                <p className="font-medium">{item.name}</p>
                                {(item.color || item.size) && (
                                  <p className="mt-0.5 text-[10px] text-slate-400">
                                    {[item.color, item.size]
                                      .filter(Boolean)
                                      .join(" · ")}
                                  </p>
                                )}
                              </TableCell>
                              <TableCell className="text-right text-xs font-semibold tabular-nums text-slate-800">
                                {formatQty(item.qty)}
                                {item.uom ? (
                                  <span className="ml-1 font-normal text-slate-400">
                                    {item.uom}
                                  </span>
                                ) : null}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </section>
              </div>

              {canCancel ? (
                <div className="border-t border-slate-200 bg-white px-6 py-4">
                  <Button
                    type="button"
                    variant="destructive"
                    className="h-10 w-full gap-2"
                    disabled={isPending}
                    onClick={() => setConfirmOpen(true)}
                  >
                    {isPending ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Ban className="size-4" />
                    )}
                    Cancel Job (ยกเลิกงาน)
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}
        </SheetContent>
      </Sheet>

      <AlertDialog
        open={confirmOpen}
        onOpenChange={(next) => !isPending && setConfirmOpen(next)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>ยืนยันยกเลิกใบสั่งผลิต</AlertDialogTitle>
            <AlertDialogDescription>
              สถานะจะเปลี่ยนเป็น CANCELLED และงานจะหายจากบอร์ด Kanban
              การกระทำนี้ไม่สามารถย้อนกลับได้
              {job ? (
                <span className="mt-2 block font-mono text-slate-700">
                  {job.job_no}
                </span>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending} />
            <AlertDialogAction
              disabled={isPending}
              className="bg-red-600 hover:bg-red-700 disabled:bg-red-400"
              onClick={(event) => {
                event.preventDefault();
                handleCancelJob();
              }}
            >
              {isPending ? (
                <>
                  <Loader2 className="mr-1 inline size-4 animate-spin" />
                  กำลังยกเลิก...
                </>
              ) : (
                "ยืนยันยกเลิกงาน"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
