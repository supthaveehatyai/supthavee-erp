"use client";

/**
 * Production Job Detail — Slide-over Sheet (URL-driven ?jobId=)
 * Phase 17 MTO: SKU + WIP tables
 * Phase 13 Service: technician / wage assignment → document_items (TB)
 */

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  CalendarDays,
  FileText,
  ImageIcon,
  Loader2,
  Package,
  Save,
  Scissors,
  Wrench,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  lookupTechnicianWageForService,
  updateProductionJobAssignment,
} from "@/app/actions/kanban-actions";
import type {
  ProductionJobDetail,
  ProductionJobServiceLine,
} from "@/types/production";
import {
  isProductionKanbanStatus,
  PRODUCTION_STATUS_LABEL,
} from "@/types/production";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
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
import { formatThaiDate } from "@/lib/utils/date-formatter";
import { JobOperationsSection } from "@/components/production/job-operations-section";

export type ProductionJobDetailSheetProps = {
  jobId: string | null;
  detail: ProductionJobDetail | null;
  error?: string | null;
};

type LineDraft = {
  technicianId: string;
  wageCost: string;
};

function formatQty(value: number): string {
  return value.toLocaleString("th-TH", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  });
}

function statusBadge(status: string) {
  const key = status.trim().toUpperCase();
  const label = isProductionKanbanStatus(key)
    ? PRODUCTION_STATUS_LABEL[key]
    : key || "—";

  const variant =
    key === "COMPLETED"
      ? "emerald"
      : key === "IN_PROGRESS"
        ? "blue"
        : key === "QA"
          ? "amber"
          : "slate";

  return <Badge variant={variant}>{label}</Badge>;
}

export function ProductionJobDetailSheet({
  jobId,
  detail,
  error = null,
}: ProductionJobDetailSheetProps) {
  const router = useRouter();
  const pathname = usePathname();
  const open = Boolean(jobId);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [isSaving, startSaveTransition] = useTransition();
  const [lookingUpItemId, setLookingUpItemId] = useState<string | null>(null);
  const [lineDrafts, setLineDrafts] = useState<Record<string, LineDraft>>({});
  const lookupSeqRef = useRef<Record<string, number>>({});

  const busy = isSaving || Boolean(lookingUpItemId);
  const canEditAssignment =
    detail != null && String(detail.status).toUpperCase() !== "CANCELLED";

  const showSkuTable =
    (detail?.items.length ?? 0) > 0 || detail?.is_manufactured === true;
  const showWipTable =
    (detail?.materials.length ?? 0) > 0 || detail?.is_manufactured === true;
  const serviceLines = detail?.service_lines ?? [];
  const technicians = detail?.technicians ?? [];
  const rates = detail?.technician_rates ?? [];

  useEffect(() => {
    const next: Record<string, LineDraft> = {};
    for (const item of detail?.service_lines ?? []) {
      next[item.id] = {
        technicianId: item.technician_id ?? "",
        wageCost: String(Number.isFinite(item.wage_cost) ? item.wage_cost : 0),
      };
    }
    setLineDrafts(next);
  }, [detail?.id, detail?.service_lines]);

  function closeSheet() {
    setPreviewOpen(false);
    router.push(pathname || "/production/kanban", { scroll: false });
  }

  function techniciansForLine(item: ProductionJobServiceLine) {
    const modelId = item.model_id ?? "";
    if (!modelId) return technicians;
    const ratedIds = new Set(
      rates
        .filter((rate) => rate.service_model_id === modelId)
        .map((rate) => rate.technician_id),
    );
    if (ratedIds.size === 0) return technicians;
    const preferred = technicians.filter((tech) => ratedIds.has(tech.id));
    return preferred.length > 0 ? preferred : technicians;
  }

  function applyLineTechnician(
    item: ProductionJobServiceLine,
    nextTechnicianId: string,
  ) {
    const rate = rates.find(
      (row) =>
        row.service_model_id === (item.model_id ?? "") &&
        row.technician_id === nextTechnicianId,
    );

    setLineDrafts((prev) => ({
      ...prev,
      [item.id]: {
        technicianId: nextTechnicianId,
        wageCost:
          rate != null
            ? String(rate.default_wage)
            : (prev[item.id]?.wageCost ?? String(item.wage_cost ?? 0)),
      },
    }));

    if (!nextTechnicianId || !item.model_id) return;

    const seq = (lookupSeqRef.current[item.id] ?? 0) + 1;
    lookupSeqRef.current[item.id] = seq;
    setLookingUpItemId(item.id);

    void (async () => {
      const result = await lookupTechnicianWageForService(
        nextTechnicianId,
        item.model_id,
      );
      if (lookupSeqRef.current[item.id] !== seq) return;
      setLookingUpItemId((current) => (current === item.id ? null : current));
      if (!result.success) {
        toast.error(result.error ?? "ดึงเรตค่าแรงไม่สำเร็จ");
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
      }
    })();
  }

  function handleSaveAssignment() {
    if (!detail || isSaving) return;
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
        job_id: detail.id,
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

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) closeSheet();
      }}
    >
      <SheetContent
        side="right"
        className="w-full gap-0 overflow-y-auto p-0 sm:max-w-2xl"
      >
        <SheetHeader className="sticky top-0 z-10 border-b border-slate-200 bg-white px-5 py-4 pr-12 text-left">
          <SheetTitle className="font-mono text-lg tracking-tight text-slate-900">
            {detail?.job_no ?? "รายละเอียดงานผลิต"}
          </SheetTitle>
          <SheetDescription className="text-sm text-slate-500">
            {detail?.product_name ??
              (error ? "โหลดรายละเอียดไม่สำเร็จ" : "กำลังโหลด...")}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-6 px-5 py-5">
          {error ? (
            <div
              role="alert"
              className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
            >
              {error}
            </div>
          ) : null}

          {!error && !detail ? (
            <p className="py-12 text-center text-sm text-slate-400">
              ไม่พบข้อมูลใบสั่งผลิต
            </p>
          ) : null}

          {detail ? (
            <>
              <section className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  {statusBadge(String(detail.status))}
                  {detail.product_model_code ? (
                    <span className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-600">
                      {detail.product_model_code}
                    </span>
                  ) : null}
                  {detail.is_service ? (
                    <span className="rounded-md bg-violet-50 px-2 py-0.5 text-[11px] font-semibold text-violet-700 ring-1 ring-violet-200">
                      งานบริการ
                    </span>
                  ) : null}
                  {detail.is_manufactured ? (
                    <span className="rounded-md bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700 ring-1 ring-blue-200">
                      MTO
                    </span>
                  ) : null}
                </div>

                <dl className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2.5">
                    <dt className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-400">
                      <FileText className="size-3.5" aria-hidden />
                      อ้างอิง SO
                    </dt>
                    <dd className="mt-1 font-mono text-sm font-semibold text-slate-900">
                      {detail.so_doc_no && detail.ref_document_id ? (
                        <Link
                          href={`/sales/${encodeURIComponent(detail.so_doc_no)}`}
                          className="text-blue-700 underline-offset-2 hover:underline"
                        >
                          {detail.so_doc_no}
                        </Link>
                      ) : (
                        detail.so_doc_no || "—"
                      )}
                    </dd>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2.5">
                    <dt className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-400">
                      <Package className="size-3.5" aria-hidden />
                      จำนวนรวม
                    </dt>
                    <dd className="mt-1 text-sm font-semibold tabular-nums text-slate-900">
                      {formatQty(detail.target_quantity)}
                    </dd>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2.5 sm:col-span-2">
                    <dt className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-400">
                      <CalendarDays className="size-3.5" aria-hidden />
                      วันคาดเสร็จ
                    </dt>
                    <dd className="mt-1 text-sm text-slate-800">
                      {detail.estimated_completion_date
                        ? formatThaiDate(
                            detail.estimated_completion_date.slice(0, 10),
                            "short",
                          )
                        : "ไม่ระบุ"}
                    </dd>
                  </div>
                </dl>

                {detail.remark ? (
                  <div className="rounded-xl border border-amber-200 bg-amber-50/70 px-3 py-2.5">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-amber-700/80">
                      Remark
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-slate-800">
                      {detail.remark}
                    </p>
                  </div>
                ) : null}
              </section>

              {detail.mockup_image_url?.trim() ? (
                <section className="space-y-2">
                  <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                    <ImageIcon className="size-4 text-slate-500" aria-hidden />
                    รูป Mockup
                  </h3>
                  <button
                    type="button"
                    onClick={() => setPreviewOpen(true)}
                    className="group block w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-100 text-left outline-none transition hover:border-blue-300 focus-visible:ring-2 focus-visible:ring-blue-400"
                    aria-label="ดูรูป Mockup ขนาดใหญ่"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={detail.mockup_image_url}
                      alt={`Mockup ${detail.job_no}`}
                      className="mx-auto max-h-48 w-auto object-contain bg-white transition group-hover:opacity-95"
                    />
                    <p className="border-t border-slate-200 bg-white px-3 py-1.5 text-center text-[11px] text-slate-500">
                      แตะเพื่อดูภาพใหญ่
                    </p>
                  </button>
                </section>
              ) : null}

              {previewOpen && detail.mockup_image_url?.trim() ? (
                <div
                  className="fixed inset-0 z-[10020] flex items-center justify-center bg-slate-950/80 p-4"
                  role="dialog"
                  aria-modal="true"
                  aria-label="ดูรูป Mockup"
                  onClick={() => setPreviewOpen(false)}
                >
                  <button
                    type="button"
                    className="absolute right-4 top-4 rounded-lg bg-white/10 p-2 text-white outline-none hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-white"
                    aria-label="ปิด"
                    onClick={() => setPreviewOpen(false)}
                  >
                    <X className="size-5" />
                  </button>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={detail.mockup_image_url}
                    alt={`Mockup ${detail.job_no}`}
                    className="max-h-[90vh] max-w-full rounded-lg object-contain shadow-2xl"
                    onClick={(event) => event.stopPropagation()}
                  />
                </div>
              ) : null}

              {/* MTO SKU — แสดงเมื่อเป็นงานผลิตเองหรือมีรายการ */}
              {showSkuTable ? (
                <section className="space-y-2">
                  <div className="flex items-end justify-between gap-2">
                    <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                      <Scissors className="size-4 text-slate-500" aria-hidden />
                      ตารางงานผลิต
                    </h3>
                    <span className="text-xs text-slate-400">
                      {detail.items.length} SKU
                    </span>
                  </div>
                  <div className="overflow-hidden rounded-xl border border-slate-200">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-slate-50/90 hover:bg-slate-50/90">
                          <TableHead className="px-3 text-xs">SKU</TableHead>
                          <TableHead className="px-3 text-xs">ไซส์/สี</TableHead>
                          <TableHead className="px-3 text-right text-xs">
                            จำนวน
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {detail.items.length === 0 ? (
                          <TableRow>
                            <TableCell
                              colSpan={3}
                              className="px-3 py-8 text-center text-sm text-slate-400"
                            >
                              ไม่มีรายการ SKU
                            </TableCell>
                          </TableRow>
                        ) : (
                          detail.items.map((item) => (
                            <TableRow key={item.id}>
                              <TableCell className="px-3 py-2.5 align-top">
                                <p className="font-mono text-xs font-semibold text-slate-800">
                                  {item.sku}
                                </p>
                                <p
                                  className={cn(
                                    "mt-0.5 text-sm leading-snug text-slate-600",
                                    "line-clamp-2",
                                  )}
                                >
                                  {item.product_name}
                                </p>
                              </TableCell>
                              <TableCell className="px-3 py-2.5 text-sm text-slate-700">
                                {[item.size, item.color]
                                  .filter(Boolean)
                                  .join(" / ") || "—"}
                              </TableCell>
                              <TableCell className="px-3 py-2.5 text-right text-base font-semibold tabular-nums text-slate-900">
                                {formatQty(item.quantity)}
                              </TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </section>
              ) : null}

              {/* MTO WIP */}
              {showWipTable ? (
                <section className="space-y-2">
                  <div className="flex items-end justify-between gap-2">
                    <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                      <Package className="size-4 text-slate-500" aria-hidden />
                      ตารางวัตถุดิบ (WIP)
                    </h3>
                    <span className="text-xs text-slate-400">
                      {detail.materials.length} รายการ
                    </span>
                  </div>
                  <div className="overflow-hidden rounded-xl border border-slate-200">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-slate-50/90 hover:bg-slate-50/90">
                          <TableHead className="px-3 text-xs">วัตถุดิบ</TableHead>
                          <TableHead className="px-3 text-right text-xs">
                            เบิก (planned)
                          </TableHead>
                          <TableHead className="px-3 text-xs">หน่วย</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {detail.materials.length === 0 ? (
                          <TableRow>
                            <TableCell
                              colSpan={3}
                              className="px-3 py-8 text-center text-sm text-slate-400"
                            >
                              ไม่มีรายการวัตถุดิบ
                            </TableCell>
                          </TableRow>
                        ) : (
                          detail.materials.map((mat) => (
                            <TableRow key={mat.id}>
                              <TableCell className="px-3 py-2.5 align-top">
                                <p className="font-mono text-xs font-semibold text-slate-800">
                                  {mat.raw_material_code}
                                </p>
                                <p className="mt-0.5 line-clamp-2 text-sm text-slate-600">
                                  {mat.raw_material_name}
                                </p>
                              </TableCell>
                              <TableCell className="px-3 py-2.5 text-right text-base font-semibold tabular-nums text-slate-900">
                                {formatQty(mat.planned_qty)}
                              </TableCell>
                              <TableCell className="px-3 py-2.5 text-sm text-slate-600">
                                {mat.uom_code ?? "—"}
                              </TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </section>
              ) : null}

              {/* In-house Routing — production_job_operations (แยกจาก Service Assignment) */}
              <JobOperationsSection
                jobId={detail.id}
                technicians={technicians}
                disabled={!canEditAssignment}
              />

              {/* Phase 13 Service Assignment → document_items (TB) */}
              {serviceLines.length > 0 ? (
                <section className="space-y-3 pb-4">
                  <div className="flex items-end justify-between gap-2">
                    <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                      <Wrench className="size-4 text-violet-500" aria-hidden />
                      ตารางงานบริการ (Service Assignment)
                    </h3>
                    <span className="text-xs text-slate-400">
                      {serviceLines.length} รายการ
                    </span>
                  </div>
                  <p className="text-xs leading-relaxed text-slate-500">
                    มอบหมายช่างและค่าแรงลง{" "}
                    <span className="font-mono">document_items</span>{" "}
                    ของ SO — โมดูลวางบิลช่าง (TB) จะดึงรายการที่ระบุช่าง +
                    ค่าแรงและงาน COMPLETED
                  </p>

                  <div className="overflow-hidden rounded-xl border border-violet-200">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-violet-50/90 hover:bg-violet-50/90">
                          <TableHead className="px-3 text-xs">งานบริการ</TableHead>
                          <TableHead className="px-3 text-right text-xs">
                            จุด
                          </TableHead>
                          <TableHead className="min-w-[9rem] px-3 text-xs">
                            ช่าง
                          </TableHead>
                          <TableHead className="min-w-[6.5rem] px-3 text-right text-xs">
                            ค่าแรง
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {serviceLines.map((item) => {
                          const draft = lineDrafts[item.id];
                          const billed = Boolean(item.technician_bill_id);
                          const lineTechs = techniciansForLine(item);
                          const selectedTechId =
                            draft?.technicianId || item.technician_id || "";
                          const hasRate = rates.some(
                            (rate) =>
                              rate.service_model_id === (item.model_id ?? "") &&
                              rate.technician_id === selectedTechId,
                          );
                          return (
                            <TableRow key={item.id}>
                              <TableCell className="px-3 py-2.5 align-top">
                                <p className="font-mono text-xs font-semibold text-slate-800">
                                  {item.sku}
                                </p>
                                <p className="mt-0.5 line-clamp-2 text-sm text-slate-600">
                                  {item.name}
                                </p>
                                {item.description ? (
                                  <p className="mt-0.5 line-clamp-2 text-[11px] text-slate-400">
                                    {item.description}
                                  </p>
                                ) : null}
                              </TableCell>
                              <TableCell className="px-3 py-2.5 align-top text-right text-sm font-semibold tabular-nums text-slate-900">
                                {formatQty(item.qty)}
                                {item.uom ? (
                                  <span className="ml-1 text-xs font-normal text-slate-400">
                                    {item.uom}
                                  </span>
                                ) : null}
                              </TableCell>
                              <TableCell className="px-3 py-2.5 align-top">
                                <Select
                                  value={draft?.technicianId ?? ""}
                                  disabled={
                                    !canEditAssignment || busy || billed
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
                              <TableCell className="px-3 py-2.5 align-top">
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

                  {canEditAssignment ? (
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
              ) : null}
            </>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

export default ProductionJobDetailSheet;
