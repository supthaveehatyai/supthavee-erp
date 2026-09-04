"use client";

/**
 * Technician Billing (TB) — unbilled production jobs + create TB document.
 * Filters are URL-driven (?type=TB&technicianId=&from=&to=).
 */

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, Receipt } from "lucide-react";
import { toast } from "sonner";
import { createTechnicianBill } from "@/app/actions/technician-billing";
import type {
  TechnicianBillingContact,
  TechnicianBillingJobRow,
} from "@/types/technician-billing";
import type { MstWhtRate } from "@/types/wht-rate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const JOB_STATUS_LABEL: Record<string, string> = {
  COMPLETED: "เสร็จสิ้น",
  READY_TO_SHIP: "พร้อมส่งมอบ",
  DELIVERED: "ส่งมอบแล้ว",
  PENDING: "รอดำเนินการ",
};

const SOURCE_TYPE_LABEL: Record<string, string> = {
  SERVICE: "งานบริการ",
  ROUTING: "Routing",
};

export type TechnicianBillingPanelProps = {
  technicianId: string;
  from: string;
  to: string;
  rows: TechnicianBillingJobRow[];
  totalWage: number;
  technicians: TechnicianBillingContact[];
  whtRates: MstWhtRate[];
  whtRatesError?: string | null;
  error: string | null;
};

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function formatWhtRatePercent(rate: number): string {
  const rounded = roundMoney(rate);
  return Number.isInteger(rounded)
    ? String(rounded)
    : rounded.toFixed(2).replace(/\.?0+$/, "");
}

function formatWhtOptionLabel(name: string, rate: number): string {
  return `${name} (${formatWhtRatePercent(rate)}%)`;
}

function calculateTechnicianBillWht(
  totalWageCost: number,
  whtRate: number,
): { whtAmount: number; netAmount: number } {
  const base = roundMoney(Math.max(0, totalWageCost));
  const rate = Number.isFinite(whtRate) && whtRate > 0 ? whtRate : 0;
  const whtAmount = roundMoney(base * (rate / 100));
  const netAmount = roundMoney(Math.max(0, base - whtAmount));
  return { whtAmount, netAmount };
}

function formatMoney(value: number): string {
  return value.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("th-TH", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function buildTbHref(filters: {
  technicianId?: string;
  from?: string;
  to?: string;
}): string {
  const params = new URLSearchParams();
  params.set("type", "TB");
  if (filters.technicianId?.trim()) {
    params.set("technicianId", filters.technicianId.trim());
  }
  if (filters.from?.trim()) params.set("from", filters.from.trim());
  if (filters.to?.trim()) params.set("to", filters.to.trim());
  return `/finance/billing-notes?${params.toString()}`;
}

export function TechnicianBillingPanel({
  technicianId: urlTechnicianId,
  from: urlFrom,
  to: urlTo,
  rows,
  totalWage,
  technicians,
  whtRates,
  whtRatesError,
  error,
}: TechnicianBillingPanelProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isCreating, startCreate] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [whtType, setWhtType] = useState("");
  const [technicianId, setTechnicianId] = useState(urlTechnicianId);
  const [from, setFrom] = useState(urlFrom);
  const [to, setTo] = useState(urlTo);
  const latestRef = useRef({ technicianId, from, to, urlTechnicianId, urlFrom, urlTo });
  latestRef.current = {
    technicianId,
    from,
    to,
    urlTechnicianId,
    urlFrom,
    urlTo,
  };

  useEffect(() => {
    setTechnicianId(urlTechnicianId);
    setFrom(urlFrom);
    setTo(urlTo);
  }, [urlTechnicianId, urlFrom, urlTo]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      const latest = latestRef.current;
      if (
        latest.technicianId === latest.urlTechnicianId &&
        latest.from === latest.urlFrom &&
        latest.to === latest.urlTo
      ) {
        return;
      }
      startTransition(() => {
        router.replace(
          buildTbHref({
            technicianId: latest.technicianId,
            from: latest.from,
            to: latest.to,
          }),
          { scroll: false },
        );
      });
    }, 250);

    return () => window.clearTimeout(handle);
  }, [technicianId, from, to, router]);

  const searchParams = useSearchParams();
  const canCreate = Boolean(urlTechnicianId) && rows.length > 0 && !isCreating;
  const busy = isPending || isCreating;

  const whtOptions = useMemo(
    () => [
      { value: "", label: "None (0%)", rate: 0 },
      ...whtRates.map((row) => ({
        value: row.wht_name,
        label: formatWhtOptionLabel(row.wht_name, Number(row.wht_rate)),
        rate: Number(row.wht_rate),
      })),
    ],
    [whtRates],
  );

  const selectedWhtRate = useMemo(() => {
    if (!whtType.trim()) return 0;
    return (
      whtOptions.find((opt) => opt.value === whtType)?.rate ??
      whtRates.find((row) => row.wht_name === whtType)?.wht_rate ??
      0
    );
  }, [whtType, whtOptions, whtRates]);

  const whtTotals = useMemo(
    () => calculateTechnicianBillWht(totalWage, selectedWhtRate),
    [totalWage, selectedWhtRate],
  );

  function handleViewJob(jobId: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("view_job_id", jobId);
    router.push(`/finance/billing-notes?${params.toString()}`, { scroll: false });
  }

  function handleCreate() {
    if (!canCreate) return;
    startCreate(async () => {
      const result = await createTechnicianBill({
        technicianId: urlTechnicianId,
        items: rows.map((row) => ({
          id: row.id,
          source_type: row.source_type,
        })),
        whtType: whtType.trim() || null,
        whtRate: selectedWhtRate,
      });
      if (!result.success) {
        toast.error(result.error);
        setConfirmOpen(false);
        return;
      }
      toast.success(
        `สร้าง ${result.docNo} แล้ว · ${result.jobCount} บรรทัด · ค่าแรง ฿${formatMoney(result.totalWage)}` +
          (result.whtAmount > 0
            ? ` · หัก ณ ที่จ่าย ฿${formatMoney(result.whtAmount)} · โอนจ่าย ฿${formatMoney(result.netAmount)}`
            : ""),
      );
      setConfirmOpen(false);
      router.replace(buildTbHref({ technicianId: urlTechnicianId, from: urlFrom, to: urlTo }));
      router.refresh();
    });
  }

  return (
    <>
      <Card>
        <CardHeader className="gap-4">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle>งานค้างสรุปวางบิลช่าง</CardTitle>
              <CardDescription>
                รวมค่าแรงค้างจ่าย 2 แหล่ง (Accrual): งานบริการลูกค้า
                (document_items) + In-house Routing
                (production_job_operations · สถานะ COMPLETED) · ยังไม่ผูกเอกสาร TB
              </CardDescription>
            </div>
            <Button
              type="button"
              className="h-10 shrink-0 gap-1.5"
              disabled={!canCreate || busy}
              onClick={() => setConfirmOpen(true)}
            >
              {isCreating ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Receipt className="size-4" />
              )}
              สร้างใบสรุปค่าแรง (Create Technician Bill)
            </Button>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="tb-technician">ชื่อช่าง</Label>
              <Select
                id="tb-technician"
                value={technicianId}
                disabled={busy}
                onChange={(event) => setTechnicianId(event.target.value)}
              >
                <option value="">— ทุกช่าง —</option>
                {technicians.map((tech) => (
                  <option key={tech.id} value={tech.id}>
                    {tech.company_name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tb-from">วันที่ส่งงาน (จาก)</Label>
              <Input
                id="tb-from"
                type="date"
                value={from}
                disabled={busy}
                onChange={(event) => setFrom(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tb-to">วันที่ส่งงาน (ถึง)</Label>
              <Input
                id="tb-to"
                type="date"
                value={to}
                disabled={busy}
                onChange={(event) => setTo(event.target.value)}
              />
            </div>
          </div>
          {!urlTechnicianId ? (
            <p className="text-xs text-amber-700">
              เลือกช่างรับเหมาก่อน จึงจะสร้างใบสรุปค่าแรงได้ (หนึ่งใบต่อช่างหนึ่งคน)
            </p>
          ) : null}
        </CardHeader>
        <CardContent>
          {error || whtRatesError ? (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {[error, whtRatesError ? `โหลดอัตราหัก ณ ที่จ่ายไม่สำเร็จ: ${whtRatesError}` : null]
                .filter(Boolean)
                .join(" · ")}
            </div>
          ) : null}

          {urlTechnicianId && rows.length > 0 ? (
            <div className="mb-4 grid gap-4 rounded-xl border border-slate-200 bg-slate-50/70 p-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="tb-wht-type">หัก ณ ที่จ่าย (WHT Type)</Label>
                <Select
                  id="tb-wht-type"
                  value={whtType}
                  disabled={busy}
                  onChange={(event) => setWhtType(event.target.value)}
                >
                  {whtOptions.map((option) => (
                    <option key={option.value || "none"} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
                <p className="text-[11px] text-slate-500">
                  WHT คำนวณจากยอดรวมค่าแรง × อัตรา {formatWhtRatePercent(selectedWhtRate)}%
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-lg border border-slate-200 bg-white p-3">
                  <p className="text-[11px] font-medium text-slate-500">
                    ยอดรวมค่าแรง
                  </p>
                  <p className="mt-1 text-base font-semibold tabular-nums text-slate-900">
                    ฿{formatMoney(totalWage)}
                  </p>
                </div>
                <div className="rounded-lg border border-amber-200 bg-amber-50/80 p-3">
                  <p className="text-[11px] font-medium text-amber-800">
                    หัก ณ ที่จ่าย
                  </p>
                  <p className="mt-1 text-base font-semibold tabular-nums text-amber-900">
                    ฿{formatMoney(whtTotals.whtAmount)}
                  </p>
                </div>
                <div className="rounded-lg border border-emerald-200 bg-emerald-50/80 p-3">
                  <p className="text-[11px] font-medium text-emerald-800">
                    ยอดโอนจ่ายจริง
                  </p>
                  <p className="mt-1 text-base font-bold tabular-nums text-emerald-900">
                    ฿{formatMoney(whtTotals.netAmount)}
                  </p>
                </div>
              </div>
            </div>
          ) : null}

          {rows.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-12 text-center text-sm text-slate-500">
              ไม่พบงานที่ค้างวางบิลตามตัวกรองนี้
            </div>
          ) : (
            <div className="overflow-hidden rounded-md border border-slate-200">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50">
                    <TableHead className="whitespace-nowrap">แหล่ง</TableHead>
                    <TableHead className="whitespace-nowrap">เลขที่ Job</TableHead>
                    <TableHead className="whitespace-nowrap">เลขที่บิลอ้างอิง</TableHead>
                    <TableHead>SKU / รายละเอียด</TableHead>
                    <TableHead className="hidden whitespace-nowrap md:table-cell">
                      ช่างรับเหมา
                    </TableHead>
                    <TableHead className="hidden whitespace-nowrap text-right lg:table-cell">
                      จำนวน
                    </TableHead>
                    <TableHead className="hidden whitespace-nowrap lg:table-cell">
                      วันที่ส่งงาน
                    </TableHead>
                    <TableHead className="whitespace-nowrap text-right">
                      ค่าแรง (Wage Cost)
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={`${row.source_type}:${row.id}`}>
                      <TableCell className="whitespace-nowrap">
                        <span
                          className={
                            row.source_type === "ROUTING"
                              ? "rounded-md bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700 ring-1 ring-blue-200"
                              : "rounded-md bg-violet-50 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700 ring-1 ring-violet-200"
                          }
                        >
                          {SOURCE_TYPE_LABEL[row.source_type] ??
                            row.source_type}
                        </span>
                      </TableCell>
                      <TableCell className="whitespace-nowrap font-mono text-sm">
                        <button
                          type="button"
                          onClick={() => handleViewJob(row.job_id)}
                          className="font-semibold text-blue-700 underline-offset-2 hover:underline"
                        >
                          {row.job_no}
                        </button>
                        <span className="mt-0.5 block text-[11px] font-normal text-slate-400">
                          {JOB_STATUS_LABEL[row.status] ?? row.status}
                        </span>
                      </TableCell>
                      <TableCell className="whitespace-nowrap font-mono text-sm text-slate-700">
                        {row.invoice_doc_no || "—"}
                      </TableCell>
                      <TableCell className="max-w-[16rem] text-slate-700">
                        <span className="block font-mono text-xs font-semibold">
                          {row.sku}
                        </span>
                        <span className="block truncate text-sm">
                          {row.service_name}
                        </span>
                      </TableCell>
                      <TableCell className="hidden max-w-[12rem] truncate text-slate-700 md:table-cell">
                        {row.technician_name}
                      </TableCell>
                      <TableCell className="hidden whitespace-nowrap text-right tabular-nums text-slate-600 lg:table-cell">
                        {row.qty.toLocaleString("th-TH")}
                      </TableCell>
                      <TableCell className="hidden whitespace-nowrap text-slate-600 lg:table-cell">
                        {formatDate(row.delivered_on)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right font-medium tabular-nums text-slate-900">
                        ฿{formatMoney(row.wage_cost)}
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="bg-slate-50">
                    <TableCell
                      colSpan={7}
                      className="text-right text-sm font-semibold text-slate-700"
                    >
                      ยอดรวมค่าแรงทั้งหมด ({rows.length} รายการ)
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right text-base font-bold tabular-nums text-blue-700">
                      ฿{formatMoney(totalWage)}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog
        open={confirmOpen}
        onOpenChange={(next) => !isCreating && setConfirmOpen(next)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>ยืนยันสร้างใบสรุปค่าแรง</AlertDialogTitle>
            <AlertDialogDescription>
              จะรวบยอด {rows.length} บรรทัด (SERVICE + ROUTING) ตามตัวกรองปัจจุบัน
              เป็นเอกสาร TB (สรุปวางบิลช่าง)
              <span className="mt-2 block space-y-1 text-slate-600">
                <span className="block">
                  ยอดรวมค่าแรง ฿{formatMoney(totalWage)}
                </span>
                {whtTotals.whtAmount > 0 ? (
                  <>
                    <span className="block">
                      หัก ณ ที่จ่าย ({whtType}) ฿{formatMoney(whtTotals.whtAmount)}
                    </span>
                    <span className="block font-semibold text-emerald-700">
                      ยอดโอนจ่ายจริง ฿{formatMoney(whtTotals.netAmount)}
                    </span>
                  </>
                ) : (
                  <span className="block font-semibold text-emerald-700">
                    ยอดโอนจ่ายจริง ฿{formatMoney(whtTotals.netAmount)}
                  </span>
                )}
              </span>
              <span className="mt-2 block">
                รายการเหล่านี้จะถูกทำเครื่องหมายว่าวางบิลแล้ว
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isCreating} />
            <AlertDialogAction
              disabled={isCreating}
              onClick={(event) => {
                event.preventDefault();
                handleCreate();
              }}
            >
              {isCreating ? (
                <>
                  <Loader2 className="mr-1 inline size-4 animate-spin" />
                  กำลังสร้าง...
                </>
              ) : (
                "ยืนยันสร้างเอกสาร"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
