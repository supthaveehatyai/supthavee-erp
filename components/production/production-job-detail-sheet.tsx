"use client";

/**
 * Production Job Detail — Slide-over Sheet (URL-driven ?jobId=)
 * Minimalist UI สำหรับช่างหน้างาน / Tablet
 */

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  CalendarDays,
  FileText,
  ImageIcon,
  Package,
  Scissors,
} from "lucide-react";
import type { ProductionJobDetail } from "@/types/production";
import {
  isProductionKanbanStatus,
  PRODUCTION_STATUS_LABEL,
} from "@/types/production";
import { Badge } from "@/components/ui/badge";
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

export type ProductionJobDetailSheetProps = {
  jobId: string | null;
  detail: ProductionJobDetail | null;
  error?: string | null;
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

  function closeSheet() {
    router.push(pathname || "/production/kanban", { scroll: false });
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) closeSheet();
      }}
    >
      <SheetContent
        side="right"
        className="w-full gap-0 overflow-y-auto p-0 sm:max-w-xl"
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
              {/* Meta */}
              <section className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  {statusBadge(String(detail.status))}
                  {detail.product_model_code ? (
                    <span className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-600">
                      {detail.product_model_code}
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

              {/* Mockup */}
              <section className="space-y-2">
                <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                  <ImageIcon className="size-4 text-slate-500" aria-hidden />
                  รูป Mockup
                </h3>
                {detail.mockup_image_url ? (
                  <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={detail.mockup_image_url}
                      alt={`Mockup ${detail.job_no}`}
                      className="max-h-72 w-full object-contain bg-white"
                    />
                  </div>
                ) : (
                  <div className="grid h-36 place-items-center rounded-xl border border-dashed border-slate-200 bg-slate-50 text-sm text-slate-400">
                    ไม่มีรูป Mockup
                  </div>
                )}
              </section>

              {/* Items — งานผลิต */}
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

              {/* Materials — WIP */}
              <section className="space-y-2 pb-4">
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
            </>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

export default ProductionJobDetailSheet;
