"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Zap } from "lucide-react";
import { toast } from "sonner";
import {
  createBatchBillingNotesAction,
  loadUnbilledApSummaryByPeriod,
} from "@/app/actions/billing";
import type { ApPeriodVendorSummary } from "@/types/billing";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { formatThaiDate } from "@/lib/utils/date-formatter";
import {
  formatBillingInvoiceNo,
  monthBounds,
  monthKeyFromIso,
  thaiMonthLabel,
  todayBillingIso,
} from "@/lib/utils/billing-period";
import { addDaysIso } from "@/lib/utils/outstanding-summary";

function formatMoney(value: number): string {
  return value.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const labeled = formatThaiDate(value, "long");
  return labeled === "—" ? value : labeled;
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function ApBatchBillingPanel() {
  const router = useRouter();
  const [catalog, setCatalog] = useState<ApPeriodVendorSummary[]>([]);
  const [vendors, setVendors] = useState<ApPeriodVendorSummary[]>([]);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [periodKey, setPeriodKey] = useState("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [openVendorId, setOpenVendorId] = useState<string | null>(null);
  const [billingDate, setBillingDate] = useState(todayBillingIso);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const catalogInvoices = useMemo(
    () => catalog.flatMap((vendor) => vendor.invoices),
    [catalog],
  );
  const monthPills = useMemo(() => {
    const buckets = new Map<string, { count: number; total: number }>();
    for (const invoice of catalogInvoices) {
      const key = monthKeyFromIso(invoice.doc_date);
      if (!/^\d{4}-\d{2}$/.test(key)) continue;
      const current = buckets.get(key) ?? { count: 0, total: 0 };
      current.count += 1;
      current.total = roundMoney(current.total + invoice.outstanding_amount);
      buckets.set(key, current);
    }
    return Array.from(buckets.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [catalogInvoices]);

  useEffect(() => {
    let cancelled = false;
    void loadUnbilledApSummaryByPeriod("2000-01-01", "2100-12-31").then((result) => {
      if (cancelled) return;
      setCatalog(result.data);
      setError(result.error);
      const keys = Array.from(
        new Set(result.data.flatMap((vendor) => vendor.invoices.map((invoice) => monthKeyFromIso(invoice.doc_date)))),
      ).filter((key) => /^\d{4}-\d{2}$/.test(key));
      const current = todayBillingIso().slice(0, 7);
      const key = keys.includes(current) ? current : keys.sort((a, b) => b.localeCompare(a))[0];
      if (!key) {
        setVendors(result.data);
        setLoading(false);
        return;
      }
      const bounds = monthBounds(key);
      if (!bounds) return;
      setPeriodKey(key);
      setFromDate(bounds.from);
      setToDate(bounds.to);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (periodKey === "all") return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(toDate) || fromDate > toDate) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    void loadUnbilledApSummaryByPeriod(fromDate, toDate).then((result) => {
      if (cancelled) return;
      setVendors(result.data);
      setError(result.error);
      setSelectedIds(new Set(result.data.flatMap((vendor) => vendor.invoices.map((invoice) => invoice.id))));
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [fromDate, toDate, periodKey]);

  const selectedVendors = vendors.filter((vendor) =>
    vendor.invoices.some((invoice) => selectedIds.has(invoice.id)),
  );
  const selectedCount = vendors.reduce(
    (sum, vendor) => sum + vendor.invoices.filter((invoice) => selectedIds.has(invoice.id)).length,
    0,
  );
  const selectedTotal = roundMoney(
    vendors.reduce(
      (sum, vendor) =>
        sum +
        vendor.invoices.reduce(
          (inner, invoice) => inner + (selectedIds.has(invoice.id) ? invoice.outstanding_amount : 0),
          0,
        ),
      0,
    ),
  );
  const allChecked =
    vendors.length > 0 &&
    vendors.every((vendor) => vendor.invoices.every((invoice) => selectedIds.has(invoice.id)));

  function selectAll(checked: boolean) {
    if (!checked) {
      setSelectedIds(new Set());
      return;
    }
    setSelectedIds(new Set(vendors.flatMap((vendor) => vendor.invoices.map((invoice) => invoice.id))));
  }

  function toggleVendor(vendor: ApPeriodVendorSummary, checked: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const invoice of vendor.invoices) {
        if (checked) next.add(invoice.id);
        else next.delete(invoice.id);
      }
      return next;
    });
  }

  async function submitBatch() {
    if (submitting || selectedVendors.length === 0) return;
    setSubmitting(true);
    const groups = selectedVendors.map((vendor) => {
      const invoices = vendor.invoices.filter((invoice) => selectedIds.has(invoice.id));
      return {
        contactId: vendor.contact_id,
        invoiceIds: invoices.map((invoice) => invoice.id),
        dueDate: addDaysIso(billingDate, vendor.credit_days),
        totalBilledAmount: roundMoney(
          invoices.reduce((sum, invoice) => sum + invoice.outstanding_amount, 0),
        ),
      };
    });
    const result = await createBatchBillingNotesAction({
      billingDate,
      groups,
    });
    if (!result.success) {
      setSubmitting(false);
      toast.error(result.error ?? "ออกใบรับวางบิลแบบกลุ่มไม่สำเร็จ");
      if (result.created.length > 0) router.refresh();
      return;
    }
    const docNos = result.created.map((row) => row.docNo).join(", ");
    toast.success(`✅ สร้างใบรับวางบิล ${result.created.length} ใบ (${docNos}) สำเร็จ`);
    router.push("/finance/billing-notes?type=BR");
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>รวบวางบิลประจำเดือน (หลายเจ้าพร้อมกัน)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          ) : null}
          <div className="max-w-xs space-y-1">
            <Label htmlFor="batch-billing-date">วันที่เอกสารวางบิล (Billing Date)</Label>
            <Input
              id="batch-billing-date"
              type="date"
              value={billingDate}
              onChange={(event) => setBillingDate(event.target.value)}
            />
            <p className="text-xs text-slate-500">
              ข้อมูลหัวใบวางบิล ใช้เป็นเดือนของเลข BR และไม่เปลี่ยนตามงวดบิลซื้อ
            </p>
          </div>
          <div className="space-y-2">
            <p className="text-sm font-semibold text-slate-800">งวดเดือนของบิลที่ต้องการรวบจ่าย</p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setPeriodKey("all");
                  setFromDate("");
                  setToDate("");
                  setVendors(catalog);
                  setSelectedIds(new Set());
                }}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-semibold",
                  periodKey === "all" ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white",
                )}
              >
                ทั้งหมด ({catalogInvoices.length})
              </button>
              {monthPills.map(([key, bucket]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    const bounds = monthBounds(key);
                    if (!bounds) return;
                    setPeriodKey(key);
                    setFromDate(bounds.from);
                    setToDate(bounds.to);
                  }}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs font-semibold",
                    periodKey === key ? "border-blue-600 bg-blue-600 text-white" : "border-slate-200 bg-white",
                  )}
                >
                  {thaiMonthLabel(key)} ({bucket.count} ใบ • ฿{formatMoney(bucket.total)})
                </button>
              ))}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="batch-from">ตั้งแต่วันที่บิล</Label>
                <Input
                  id="batch-from"
                  type="date"
                  value={fromDate}
                  onChange={(event) => {
                    setPeriodKey("custom");
                    setFromDate(event.target.value);
                  }}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="batch-to">ถึงวันที่บิล</Label>
                <Input
                  id="batch-to"
                  type="date"
                  value={toDate}
                  onChange={(event) => {
                    setPeriodKey("custom");
                    setToDate(event.target.value);
                  }}
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 pt-6">
          <div className="flex justify-end">
            <Button type="button" variant="outline" onClick={() => selectAll(!allChecked)} disabled={loading}>
              เลือกทุกบริษัท
            </Button>
          </div>
          {loading ? (
            <div className="flex items-center gap-2 py-8 text-sm text-slate-500">
              <Loader2 className="size-4 animate-spin" />
              กำลังโหลดบิลค้างในงวด...
            </div>
          ) : vendors.length === 0 ? (
            <div className="rounded-lg border border-dashed px-4 py-10 text-center text-sm text-slate-500">
              ไม่มีผู้จำหน่ายที่มียอดค้างในงวดนี้
            </div>
          ) : (
            <div className="divide-y rounded-xl border">
              {vendors.map((vendor) => {
                const vendorChecked = vendor.invoices.every((invoice) => selectedIds.has(invoice.id));
                const open = openVendorId === vendor.contact_id;
                return (
                  <div key={vendor.contact_id} className="p-3">
                    <div className="flex flex-wrap items-start gap-3">
                      <input
                        type="checkbox"
                        className="mt-1 size-4 accent-blue-600"
                        checked={vendorChecked}
                        onChange={(event) => toggleVendor(vendor, event.target.checked)}
                        aria-label={`เลือก ${vendor.contact_name}`}
                      />
                      <button
                        type="button"
                        className="min-w-0 flex-1 text-left"
                        onClick={() => setOpenVendorId(open ? null : vendor.contact_id)}
                      >
                        <div className="text-sm font-semibold text-slate-900">{vendor.contact_name}</div>
                        <div className="mt-1 text-xs text-slate-500">
                          เครดิตเทอม {vendor.credit_days} วัน · {vendor.invoice_count} บิล ·{" "}
                          {formatDate(vendor.first_doc_date)} – {formatDate(vendor.last_doc_date)}
                        </div>
                      </button>
                      <div className="text-sm font-bold tabular-nums text-blue-700">
                        ฿{formatMoney(vendor.total_outstanding)}
                      </div>
                    </div>
                    {open ? (
                      <ul className="mt-3 space-y-2 pl-7">
                        {vendor.invoices.map((invoice) => {
                          return (
                            <li key={invoice.id} className="flex items-start gap-2 text-sm">
                              <input
                                type="checkbox"
                                className="mt-1 size-4 accent-blue-600"
                                checked={selectedIds.has(invoice.id)}
                                onChange={(event) => {
                                  setSelectedIds((current) => {
                                    const next = new Set(current);
                                    if (event.target.checked) next.add(invoice.id);
                                    else next.delete(invoice.id);
                                    return next;
                                  });
                                }}
                              />
                              <span>
                                <span className="font-medium">
                                  {formatBillingInvoiceNo(
                                    invoice.doc_no,
                                    invoice.reference_no,
                                    invoice.tax_invoice_no,
                                  )}
                                </span>
                                <span className="ml-2 text-xs text-slate-500">
                                  {formatDate(invoice.doc_date)} · ครบกำหนด {formatDate(invoice.due_date)} · ฿
                                  {formatMoney(invoice.outstanding_amount)}
                                </span>
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
          <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-900">
            เลือกแล้ว {selectedVendors.length} บริษัท (รวม {selectedCount} บิล) • ยอดรวมเตรียมชำระทั้งสิ้น ฿
            {formatMoney(selectedTotal)} บาท
          </div>
          <Button
            type="button"
            disabled={submitting || selectedCount === 0}
            onClick={() => void submitBatch()}
            className="h-11"
          >
            {submitting ? <Loader2 className="size-4 animate-spin" /> : <Zap className="size-4" />}
            ⚡ ออกใบรับวางบิลพร้อมกันทุกเจ้าที่เลือก (Batch Create BR)
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
