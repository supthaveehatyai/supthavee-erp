"use client";

/**
 * Phase 7 — Job Detail Slide-over (URL-driven via ?jobId=).
 * Data is fetched on the Server and passed in (Zero Client-Side Fetching).
 */

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Ban,
  CalendarDays,
  Factory,
  FileText,
  ImageIcon,
  Loader2,
  Package,
  Save,
  User,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";
import {
  cancelProductionJob,
  lookupTechnicianWageForService,
  updateProductionJobAssignment,
} from "@/app/actions/kanban-actions";
import {
  JOB_STATUS_LABEL,
  type ProductionJobDetails,
  type ProductionJobLineItem,
  type ProductionJobStatus,
  type ProductionJobType,
  type TechnicianOption,
  type TechnicianRateOption,
} from "@/types/kanban";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
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
import { TieredStorageImage } from "@/components/shared/tiered-storage-image";
import { isHttpUrl } from "@/lib/utils/storage-tier";

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
  technicians?: TechnicianOption[];
  rates?: TechnicianRateOption[];
  /** URL to navigate when closing the sheet (defaults to /production/kanban) */
  closeHref?: string;
};

type LineDraft = {
  technicianId: string;
  wageCost: string;
};

export function JobDetailSheet({
  job,
  error,
  technicians = [],
  rates = [],
  closeHref,
}: JobDetailSheetProps) {
  const router = useRouter();
  const open = Boolean(job) || Boolean(error);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [isSaving, startSaveTransition] = useTransition();
  const [lookingUpItemId, setLookingUpItemId] = useState<string | null>(null);
  const [lineDrafts, setLineDrafts] = useState<Record<string, LineDraft>>({});
  const lookupSeqRef = useRef<Record<string, number>>({});

  const formBusy = isPending || isSaving;
  const busy = formBusy || Boolean(lookingUpItemId);

  const technicianOptions = technicians;

  useEffect(() => {
    const next: Record<string, LineDraft> = {};
    for (const item of job?.line_items ?? []) {
      next[item.id] = {
        technicianId: item.technician_id ?? "",
        wageCost: String(Number.isFinite(item.wage_cost) ? item.wage_cost : 0),
      };
    }
    setLineDrafts(next);
    lookupSeqRef.current = {};
    setLookingUpItemId(null);
  }, [job?.id, job?.line_items]);

  function techniciansForLine(item: ProductionJobLineItem): TechnicianOption[] {
    const list = [...technicianOptions];
    const assignedId = lineDrafts[item.id]?.technicianId || item.technician_id;
    if (assignedId && !list.some((tech) => tech.id === assignedId)) {
      list.unshift({
        id: assignedId,
        company_name: item.technician_name || "ช่างที่เลือกไว้",
        contact_type: "Technician",
        default_wage: item.wage_cost,
      });
    }
    return list;
  }

  function applyLineTechnician(item: ProductionJobLineItem, nextTechnicianId: string) {
    const rate = rates.find(
      (row) =>
        row.technician_id === nextTechnicianId &&
        row.service_model_id === (item.model_id ?? ""),
    );
    setLineDrafts((prev) => ({
      ...prev,
      [item.id]: {
        technicianId: nextTechnicianId,
        wageCost: nextTechnicianId ? String(rate?.default_wage ?? 0) : "0",
      },
    }));

    if (!nextTechnicianId) {
      lookupSeqRef.current[item.id] = (lookupSeqRef.current[item.id] ?? 0) + 1;
      return;
    }

    const seq = (lookupSeqRef.current[item.id] ?? 0) + 1;
    lookupSeqRef.current[item.id] = seq;
    setLookingUpItemId(item.id);
    void lookupTechnicianWageForService(nextTechnicianId, item.model_id).then(
      (result) => {
        if (lookupSeqRef.current[item.id] !== seq) return;
        setLookingUpItemId(null);
        if (!result.success) {
          toast.error(result.error ?? "ตรวจสอบ Rate Card ไม่สำเร็จ");
          return;
        }
        if (result.has_rate) {
          setLineDrafts((prev) => ({
            ...prev,
            [item.id]: {
              technicianId: nextTechnicianId,
              wageCost: String(result.default_wage),
            },
          }));
          return;
        }
        setLineDrafts((prev) => ({
          ...prev,
          [item.id]: { technicianId: nextTechnicianId, wageCost: "0" },
        }));
        toast.warning("ช่างคนนี้ไม่มี Rate Card สำหรับงานบริการนี้");
      },
    );
  }

  function closeSheet() {
    if (closeHref) {
      router.push(closeHref);
    } else {
      router.push("/production/kanban");
    }
  }

  function handleOpenChange(next: boolean) {
    if (!next && !busy) closeSheet();
  }

  function handleSaveAssignment() {
    if (!job || isPending || isSaving) return;

    const serviceLines = job.line_items.filter((item) => item.is_service);
    if (serviceLines.length === 0) {
      toast.error("เอกสารนี้ไม่มีรายการงานบริการ");
      return;
    }

    const lines: Array<{
      item_id: string;
      document_item_id: string;
      technician_id: string | null;
      wage_cost: number;
    }> = [];
    for (const item of serviceLines) {
      if (item.technician_bill_id) continue;
      const draft = lineDrafts[item.id];
      const wage = Number.parseFloat(draft?.wageCost ?? "0");
      if (!Number.isFinite(wage) || wage < 0) {
        toast.error(`ค่าแรงของ ${item.sku} ต้องเป็นตัวเลขมากกว่าหรือเท่ากับ 0`);
        return;
      }
      lines.push({
        item_id: item.id,
        document_item_id: item.id,
        technician_id: draft?.technicianId?.trim() || null,
        wage_cost: wage,
      });
    }

    if (lines.length === 0) {
      toast.error("ทุกรายการงานบริการถูกวางบิลแล้ว");
      return;
    }

    startSaveTransition(async () => {
      const result = await updateProductionJobAssignment({
        job_id: job.id,
        lines,
      });

      if (!result.success) {
        toast.error(result.error ?? "บันทึกช่างรับเหมา / ค่าแรงไม่สำเร็จ");
        return;
      }

      toast.success("บันทึกช่างรับเหมาและค่าแรงรายบรรทัดแล้ว");
      router.refresh();
    });
  }

  function handleCancelJob() {
    if (!job || isPending || isSaving) return;

    startTransition(async () => {
      const result = await cancelProductionJob(job.id);
      if (!result.success || !result.data) {
        toast.error(result.error ?? "ยกเลิกงานไม่สำเร็จ");
        setConfirmOpen(false);
        return;
      }

      toast.success(`ยกเลิกงาน ${result.data.job_no} แล้ว`);
      setConfirmOpen(false);
      closeSheet();
      router.refresh();
    });
  }

  const canCancel =
    job && job.status !== "DELIVERED" && job.status !== "CANCELLED";
  const canEditAssignment = job && job.status !== "CANCELLED";
  const goodsItems = (job?.line_items ?? []).filter((item) => !item.is_service);
  const serviceItems = (job?.line_items ?? []).filter((item) => item.is_service);

  return (
    <>
      <Sheet open={open} onOpenChange={handleOpenChange}>
        <SheetContent
          side="right"
          className="w-full overflow-y-auto p-0 sm:max-w-3xl"
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
                      {job.document_no ? (
                        <Link
                          href={`/sales/${encodeURIComponent(job.document_no)}`}
                          className="underline decoration-slate-300 underline-offset-2 hover:text-blue-700"
                        >
                          {job.document_no}
                        </Link>
                      ) : (
                        "ไม่ผูกเอกสาร"
                      )}
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
                  {job.service_model ? (
                    <div className="flex items-center gap-2 text-slate-600">
                      <Wrench className="size-4 shrink-0 text-violet-500" />
                      <span>
                        งานบริการในบิล (ระบุช่างแยกบรรทัดด้านล่าง)
                      </span>
                    </div>
                  ) : null}
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
                      ({job.display_attachment_urls.length})
                    </span>
                  </div>

                  {job.display_attachment_urls.length === 0 &&
                  job.storage_tier !== "NAS" ? (
                    <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-6 text-center text-xs text-slate-400">
                      ไม่มีรูปแนบ
                    </p>
                  ) : job.display_attachment_urls.length === 0 &&
                    job.storage_tier === "NAS" ? (
                    <div className="relative aspect-video overflow-hidden rounded-lg border border-amber-200 bg-amber-50">
                      <TieredStorageImage
                        src={null}
                        alt="NAS archive"
                        storageTier="NAS"
                        nasPath={job.nas_archive_url}
                        fill
                        sizes="400px"
                        showTierBadge
                      />
                    </div>
                  ) : (
                    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                      {job.display_attachment_urls.map((url, index) => {
                        const browsable = isHttpUrl(url);
                        const inner = (
                          <div className="relative aspect-square w-full overflow-hidden">
                            <TieredStorageImage
                              src={url}
                              alt={`Mockup ${index + 1}`}
                              storageTier={job.storage_tier}
                              nasPath={
                                job.storage_tier === "NAS" && !browsable
                                  ? job.nas_archive_url
                                  : null
                              }
                              fill
                              sizes="120px"
                              objectFit="cover"
                              showTierBadge={job.storage_tier === "NAS"}
                              className="transition group-hover:scale-[1.02]"
                            />
                          </div>
                        );
                        return browsable ? (
                          <a
                            key={`${url}-${index}`}
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="group overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm transition hover:border-violet-300 hover:ring-2 hover:ring-violet-100"
                          >
                            {inner}
                          </a>
                        ) : (
                          <div
                            key={`nas-${index}`}
                            className="overflow-hidden rounded-lg border border-amber-200 bg-white shadow-sm"
                          >
                            {inner}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>

                <section className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Package className="size-4 text-blue-500" />
                    <h3 className="text-sm font-bold text-slate-800">
                      สินค้าทั่วไป (Trading Goods)
                    </h3>
                    <span className="text-xs text-slate-400">
                      ({goodsItems.length})
                    </span>
                  </div>

                  {goodsItems.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-6 text-center text-xs text-slate-400">
                      ไม่มีสินค้าทั่วไปในเอกสารต้นทาง
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
                          {goodsItems.map((item) => (
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

                <section className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Wrench className="size-4 text-violet-500" />
                    <h3 className="text-sm font-bold text-slate-800">
                      งานบริการ (Service Products)
                    </h3>
                    <span className="text-xs text-slate-400">
                      ({serviceItems.length})
                    </span>
                  </div>

                  {serviceItems.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-violet-200 bg-violet-50/60 px-3 py-6 text-center text-xs text-slate-400">
                      ไม่มีงานบริการในเอกสารต้นทาง
                    </p>
                  ) : (
                    <div className="overflow-hidden rounded-xl border border-violet-200">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-violet-50 hover:bg-violet-50">
                            <TableHead className="text-xs">SKU / งานบริการ</TableHead>
                            <TableHead className="text-xs">รายละเอียด</TableHead>
                            <TableHead className="text-right text-xs">
                              จำนวนจุด
                            </TableHead>
                            <TableHead className="min-w-[10rem] text-xs">
                              ชื่อช่าง
                            </TableHead>
                            <TableHead className="min-w-[7rem] text-right text-xs">
                              ค่าแรง
                            </TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {serviceItems.map((item) => {
                            const draft = lineDrafts[item.id];
                            const billed = Boolean(item.technician_bill_id);
                            const lineTechs = techniciansForLine(item);
                            const selectedTechId =
                              draft?.technicianId || item.technician_id;
                            const hasRate = rates.some(
                              (rate) =>
                                rate.service_model_id === (item.model_id ?? "") &&
                                rate.technician_id === selectedTechId,
                            );
                            return (
                              <TableRow key={item.id}>
                                <TableCell className="align-top font-mono text-xs font-semibold text-slate-800">
                                  {item.sku}
                                  <span className="mt-1 block text-[10px] font-semibold text-violet-600">
                                    งานบริการ
                                  </span>
                                </TableCell>
                                <TableCell className="align-top text-xs text-slate-700">
                                  <p className="font-medium">{item.name}</p>
                                  {(item.color || item.size) && (
                                    <p className="mt-0.5 text-[10px] text-slate-400">
                                      {[item.color, item.size]
                                        .filter(Boolean)
                                        .join(" · ")}
                                    </p>
                                  )}
                                </TableCell>
                                <TableCell className="align-top text-right text-xs font-semibold tabular-nums text-slate-800">
                                  {formatQty(item.qty)}
                                  {item.uom ? (
                                    <span className="ml-1 font-normal text-slate-400">
                                      {item.uom}
                                    </span>
                                  ) : null}
                                </TableCell>
                                <TableCell className="align-top">
                                  <Select
                                    value={draft?.technicianId ?? ""}
                                    disabled={
                                      !canEditAssignment || formBusy || billed
                                    }
                                    onChange={(event) =>
                                      applyLineTechnician(
                                        item,
                                        event.target.value,
                                      )
                                    }
                                    className="h-9 text-xs"
                                  >
                                    <option value="">— ไม่ระบุ —</option>
                                    {lineTechs.map((tech) => (
                                      <option key={tech.id} value={tech.id}>
                                        {tech.company_name}
                                      </option>
                                    ))}
                                  </Select>
                                  {lineTechs.length === 0 ? (
                                    <p className="mt-1 text-[10px] text-amber-700">
                                      ยังไม่มีรายชื่อช่าง (role Technician)
                                    </p>
                                  ) : null}
                                  {selectedTechId && !hasRate ? (
                                    <p className="mt-1 text-[10px] text-amber-700">
                                      ไม่มี Rate Card สำหรับงานนี้
                                    </p>
                                  ) : null}
                                  {billed ? (
                                    <p className="mt-1 text-[10px] text-emerald-700">
                                      วางบิลช่างแล้ว
                                    </p>
                                  ) : null}
                                </TableCell>
                                <TableCell className="align-top">
                                  <Input
                                    type="number"
                                    min={0}
                                    step="0.0001"
                                    inputMode="decimal"
                                    value={draft?.wageCost ?? "0"}
                                    disabled={
                                      !canEditAssignment || busy || billed
                                    }
                                    onChange={(event) =>
                                      setLineDrafts((prev) => ({
                                        ...prev,
                                        [item.id]: {
                                          technicianId:
                                            prev[item.id]?.technicianId ?? "",
                                          wageCost: event.target.value,
                                        },
                                      }))
                                    }
                                    className="h-9 text-right text-xs tabular-nums"
                                  />
                                  {lookingUpItemId === item.id ? (
                                    <p className="mt-1 flex items-center justify-end gap-1 text-[10px] text-slate-400">
                                      <Loader2 className="size-3 animate-spin" />
                                      ดึงเรต...
                                    </p>
                                  ) : null}
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  )}

                  {canEditAssignment && serviceItems.length > 0 ? (
                    <Button
                      type="button"
                      className="h-10 w-full gap-2"
                      disabled={busy}
                      onClick={handleSaveAssignment}
                    >
                      {isSaving ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Save className="size-4" />
                      )}
                      บันทึกช่าง / ค่าแรงรายบรรทัด
                    </Button>
                  ) : null}
                </section>
              </div>

              {canCancel ? (
                <div className="border-t border-slate-200 bg-white px-6 py-4">
                  <Button
                    type="button"
                    variant="destructive"
                    className="h-10 w-full gap-2"
                    disabled={busy}
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
        onOpenChange={(next) => !busy && setConfirmOpen(next)}
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
            <AlertDialogCancel disabled={busy} />
            <AlertDialogAction
              disabled={busy}
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
