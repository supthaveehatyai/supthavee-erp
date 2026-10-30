"use client";

/**
 * Create Billing Note form — Client island.
 * Contact / type state via URL Search Params (parent Server Component re-fetches).
 * Mutation via `createBillingNote` Server Action only — no client Supabase.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { CheckCircle2, Loader2, Save } from "lucide-react";
import { createBillingNote } from "@/app/actions/billing";
import type {
  BillingCategory,
  OutstandingContactSummary,
  UnbilledInvoice,
} from "@/types/billing";
import CustomerCombobox from "@/app/(erp)/sales/create/customer-combobox";
import VendorCombobox from "@/components/procurement/VendorCombobox";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { VendorOption } from "@/lib/actions/mapping";
import { cn } from "@/lib/utils";
import { formatThaiDate } from "@/lib/utils/date-formatter";
import {
  coerceBillingDueDate,
  formatBillingInvoiceNo,
  invoiceInRange,
  monthBounds,
  monthKeyFromIso,
  thaiMonthLabel,
  todayBillingIso,
} from "@/lib/utils/billing-period";
import { addDaysIso } from "@/lib/utils/outstanding-summary";
import { ApBatchBillingPanel } from "@/components/finance/ap-batch-billing-panel";
import { ContactSortBar, SortHeaderButton } from "@/components/finance/billing-sort-controls";
import {
  matchesContactQuery,
  nextContactSort,
  sortContacts,
  type ContactSortKey,
  type SortDir,
} from "@/lib/utils/billing-list-sort";
import type { CustomerOption } from "@/types/document";

export type CreateBillingNoteFormProps = {
  type: BillingCategory;
  contactId: string;
  customers: CustomerOption[];
  vendors: VendorOption[];
  invoices: UnbilledInvoice[];
  /** Shown when contact_id is empty — contacts with outstanding unbilled invoices. */
  outstandingContacts: OutstandingContactSummary[];
  creditDays?: number;
  mode?: "single" | "batch";
  contactQuery: string;
  contactSort: ContactSortKey;
  contactDir: SortDir;
  onContactQueryChange: (value: string) => void;
  onContactSort: (key: ContactSortKey, dir: SortDir) => void;
};

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

function buildHref(
  type: BillingCategory,
  contactId?: string,
  mode?: "single" | "batch",
): string {
  const params = new URLSearchParams();
  params.set("type", type);
  if (contactId) params.set("contact_id", contactId);
  if (type === "AP" && mode === "batch") params.set("mode", "batch");
  return `/finance/billing-notes/create?${params.toString()}`;
}

export function CreateBillingNoteForm({
  type,
  contactId,
  customers,
  vendors,
  invoices,
  outstandingContacts,
  creditDays = 0,
  mode = "single",
  contactQuery,
  contactSort,
  contactDir,
  onContactQueryChange,
  onContactSort,
}: CreateBillingNoteFormProps) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [, startNavigate] = useTransition();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [billingDate, setBillingDate] = useState(todayBillingIso);
  const [dueDate, setDueDate] = useState(todayBillingIso);
  const [dueTouched, setDueTouched] = useState(false);
  const [filterFromDate, setFilterFromDate] = useState("");
  const [filterToDate, setFilterToDate] = useState("");
  const [periodKey, setPeriodKey] = useState("all");
  const [remark, setRemark] = useState("");
  const [error, setError] = useState<string | null>(null);

  const isAR = type === "AR";
  const shownContacts = useMemo(() => {
    const filtered = outstandingContacts.filter((row) =>
      matchesContactQuery(row.contact_name, contactQuery),
    );
    return sortContacts(filtered, contactSort, contactDir, {
      name: (row) => row.contact_name,
      count: (row) => row.invoice_count,
      amount: (row) => row.total_outstanding,
    });
  }, [outstandingContacts, contactQuery, contactSort, contactDir]);

  function sortContactColumn(key: ContactSortKey) {
    const next = nextContactSort(contactSort, contactDir, key);
    onContactSort(next.key, next.dir);
  }

  const contactTools = (
    <ContactSortBar
      query={contactQuery}
      onQueryChange={onContactQueryChange}
      sortKey={contactSort}
      sortDir={contactDir}
      onSort={onContactSort}
      placeholder={isAR ? "ค้นหาชื่อลูกค้า..." : "ค้นหาชื่อคู่ค้า..."}
    />
  );

  const totalBilledAmount = useMemo(() => {
    return roundMoney(
      invoices.reduce((sum, inv) => {
        if (!selectedIds.has(inv.id)) return sum;
        return sum + inv.outstanding_amount;
      }, 0),
    );
  }, [invoices, selectedIds]);

  const monthPills = useMemo(() => {
    const buckets = new Map<string, { count: number; total: number }>();
    for (const invoice of invoices) {
      const key = monthKeyFromIso(invoice.doc_date);
      if (!/^\d{4}-\d{2}$/.test(key)) continue;
      const current = buckets.get(key) ?? { count: 0, total: 0 };
      current.count += 1;
      current.total = roundMoney(current.total + invoice.outstanding_amount);
      buckets.set(key, current);
    }
    return Array.from(buckets.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [invoices]);

  const visibleInvoices = useMemo(
    () => invoices.filter((invoice) => invoiceInRange(invoice.doc_date, filterFromDate, filterToDate)),
    [invoices, filterFromDate, filterToDate],
  );

  const allSelected =
    visibleInvoices.length > 0 && visibleInvoices.every((inv) => selectedIds.has(inv.id));

  const contactKey = `${type}|${contactId}`;
  const seenContactKey = useRef<string | null>(null);
  useEffect(() => {
    if (seenContactKey.current === contactKey) return;
    seenContactKey.current = contactKey;
    const today = todayBillingIso();
    setBillingDate(today);
    setDueTouched(false);
    setDueDate(
      coerceBillingDueDate(today, addDaysIso(today, Math.max(0, creditDays)), creditDays),
    );
  }, [contactKey, creditDays]);

  useEffect(() => {
    setDueDate((current) => {
      const base = dueTouched
        ? current
        : addDaysIso(billingDate, Math.max(0, creditDays));
      return coerceBillingDueDate(billingDate, base, creditDays);
    });
  }, [billingDate, creditDays, dueTouched]);

  function navigate(nextType: BillingCategory, nextContactId: string) {
    router.push(buildHref(nextType, nextContactId || undefined));
  }

  function applyInvoicePeriod(from: string, to: string, key: string) {
    setFilterFromDate(from);
    setFilterToDate(to);
    setPeriodKey(key);
    if (!from && !to) {
      setSelectedIds(new Set());
      return;
    }
    setSelectedIds(
      new Set(
        invoices
          .filter((invoice) => invoiceInRange(invoice.doc_date, from, to))
          .map((invoice) => invoice.id),
      ),
    );
  }

  function toggleAll(checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const invoice of visibleInvoices) {
        if (checked) next.add(invoice.id);
        else next.delete(invoice.id);
      }
      return next;
    });
  }

  function toggleOne(id: string, checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  const listHref = `/finance/billing-notes?type=${isAR ? "BN" : "BR"}`;

  async function saveBillingNote(intent: "next" | "list") {
    if (isSubmitting) return;

    setError(null);

    if (!contactId) {
      const message = isAR
        ? "กรุณาเลือกลูกค้า"
        : "กรุณาเลือกซัพพลายเออร์";
      setError(message);
      toast.error(message);
      return;
    }

    const invoiceIds = Array.from(selectedIds);
    if (invoiceIds.length === 0) {
      const message = "กรุณาเลือกอย่างน้อย 1 บิล";
      setError(message);
      toast.error(message);
      return;
    }

    if (totalBilledAmount <= 0) {
      const message = "ยอดวางบิลต้องมากกว่า 0";
      setError(message);
      toast.error(message);
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await createBillingNote({
        contactId,
        category: type,
        invoiceIds,
        totalBilledAmount,
        documentDate: billingDate,
        dueDate,
        remark: remark.trim() || undefined,
      });

      if (!result.success) {
        const message = result.error ?? "สร้างใบวางบิลไม่สำเร็จ";
        setError(message);
        toast.error(message);
        setIsSubmitting(false);
        return;
      }

      const docNo = result.docNo;
      const amountLabel = formatMoney(result.totalAmount);
      toast.success(
        isAR
          ? `✅ สร้างใบวางบิล ${docNo} ยอดรวม ฿${amountLabel} สำเร็จ`
          : `✅ สร้างใบรับวางบิล ${docNo} ยอดรวม ฿${amountLabel} สำเร็จ`,
      );

      const nextHref = result.nextVendorId
        ? buildHref(type, result.nextVendorId)
        : buildHref(type);
      const href = intent === "next" ? nextHref : listHref;
      startNavigate(() => {
        router.push(href);
        router.refresh();
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "สร้างใบวางบิลไม่สำเร็จ";
      setError(message);
      toast.error(message);
      setIsSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void saveBillingNote("list");
      }}
      className="space-y-6"
    >
      <div
        role="tablist"
        className="inline-flex h-10 w-full max-w-xl items-center justify-center rounded-xl bg-slate-100 p-1 text-slate-600"
      >
        <Link
          role="tab"
          aria-selected={isAR}
          href={buildHref("AR")}
          className={cn(
            "inline-flex flex-1 items-center justify-center whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-semibold transition",
            isAR
              ? "bg-white text-slate-900 shadow-sm"
              : "text-slate-600 hover:text-slate-900",
          )}
        >
          วางบิลลูกหนี้ (AR)
        </Link>
        <Link
          role="tab"
          aria-selected={!isAR}
          href={buildHref("AP")}
          className={cn(
            "inline-flex flex-1 items-center justify-center whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-semibold transition",
            !isAR
              ? "bg-white text-slate-900 shadow-sm"
              : "text-slate-600 hover:text-slate-900",
          )}
        >
          รับวางบิลเจ้าหนี้ (AP)
        </Link>
      </div>

      {!isAR ? (
        <div
          role="tablist"
          className="inline-flex h-10 w-full max-w-2xl items-center justify-center rounded-xl bg-orange-50 p-1 text-slate-600"
        >
          <Link
            role="tab"
            aria-selected={mode !== "batch"}
            href={buildHref("AP")}
            className={cn(
              "inline-flex flex-1 items-center justify-center rounded-lg px-3 py-1.5 text-sm font-semibold",
              mode !== "batch" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600",
            )}
          >
            วางบิลรายเจ้า
          </Link>
          <Link
            role="tab"
            aria-selected={mode === "batch"}
            href={buildHref("AP", undefined, "batch")}
            className={cn(
              "inline-flex flex-1 items-center justify-center rounded-lg px-3 py-1.5 text-sm font-semibold",
              mode === "batch" ? "bg-white text-orange-800 shadow-sm" : "text-slate-600",
            )}
          >
            ⚡ รวบวางบิลประจำเดือน (หลายเจ้าพร้อมกัน)
          </Link>
        </div>
      ) : null}

      {!isAR && mode === "batch" ? (
        <div className="space-y-3">
          {contactTools}
          <ApBatchBillingPanel
            contactQuery={contactQuery}
            contactSort={contactSort}
            contactDir={contactDir}
            onContactSort={sortContactColumn}
          />
        </div>
      ) : !contactId ? (
        <Card>
          <CardHeader>
            <CardTitle>
              {isAR
                ? "ลูกค้าที่มียอดค้างวางบิล"
                : "ซัพพลายเออร์ที่มียอดค้างรับวางบิล"}
            </CardTitle>
            <CardDescription>
              {
                "แสดงเฉพาะรายชื่อที่มีบิลค้างชำระ (status = ISSUED และยอดค้าง > 0) — กดเลือกเพื่อโหลดรายการบิล"
              }
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {contactTools}
            {outstandingContacts.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
                ไม่พบ{isAR ? "ลูกค้า" : "ซัพพลายเออร์"}ที่มียอดค้างวางบิล
              </div>
            ) : (
              <div className="overflow-hidden rounded-md border border-slate-200">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50">
                      <TableHead>
                        <SortHeaderButton
                          label={isAR ? "ชื่อลูกค้า" : "ชื่อคู่ค้า"}
                          active={contactSort === "name"}
                          dir={contactDir}
                          onClick={() => sortContactColumn("name")}
                        />
                      </TableHead>
                      <TableHead className="whitespace-nowrap text-right">
                        <SortHeaderButton
                          label="จำนวนบิล"
                          active={contactSort === "count"}
                          dir={contactDir}
                          align="right"
                          onClick={() => sortContactColumn("count")}
                        />
                      </TableHead>
                      <TableHead className="whitespace-nowrap text-right">
                        <SortHeaderButton
                          label="ยอดค้างชำระรวม"
                          active={contactSort === "amount"}
                          dir={contactDir}
                          align="right"
                          onClick={() => sortContactColumn("amount")}
                        />
                      </TableHead>
                      <TableHead className="whitespace-nowrap text-right">
                        การดำเนินการ
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {shownContacts.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={4} className="h-16 text-center text-slate-500">
                          ไม่พบคู่ค้าที่ตรงกับคำค้น
                        </TableCell>
                      </TableRow>
                    ) : shownContacts.map((row) => (
                      <TableRow key={row.contact_id}>
                        <TableCell className="font-medium text-slate-900">
                          {row.contact_name}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-slate-700">
                          {row.invoice_count}
                        </TableCell>
                        <TableCell className="text-right font-semibold tabular-nums text-blue-700">
                          ฿{formatMoney(row.total_outstanding)}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            type="button"
                            variant="outline"
                            className="h-8 rounded-xl px-3 text-xs"
                            onClick={() => navigate(type, row.contact_id)}
                          >
                            เลือก
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <>
      <Card>
        <CardHeader>
          <CardTitle>
            {isAR ? "ฟอร์มวางบิลลูกหนี้ (BN)" : "ฟอร์มรับวางบิลเจ้าหนี้ (BR)"}
          </CardTitle>
          <CardDescription>
            เลือกบิลค้างวางบิลแล้วบันทึก · เลขที่เอกสารรันอัตโนมัติ
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          ) : null}

          <div className="space-y-2">
            <Label>
              {isAR ? "ลูกค้า" : "ซัพพลายเออร์"}{" "}
              <span className="text-red-500">*</span>
            </Label>
            {isAR ? (
              <CustomerCombobox
                options={customers}
                value={contactId}
                onChange={(id) => navigate("AR", id)}
                placeholder="ค้นหาและเลือกลูกค้า..."
              />
            ) : (
              <VendorCombobox
                options={vendors}
                value={contactId}
                onChange={(id) => navigate("AP", id)}
                placeholder="ค้นหาและเลือกซัพพลายเออร์..."
              />
            )}
            <button
              type="button"
              className="text-xs font-medium text-blue-600 hover:underline"
              onClick={() => navigate(type, "")}
            >
              ← กลับไปเลือกรายชื่อที่มียอดค้าง
            </button>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="billing_date">
                วันที่เอกสารวางบิล (Billing Date) <span className="text-red-500">*</span>
              </Label>
              <Input
                id="billing_date"
                type="date"
                value={billingDate}
                onChange={(e) => {
                  const next = e.target.value;
                  setBillingDate(next);
                  setDueDate((current) =>
                    coerceBillingDueDate(
                      next,
                      dueTouched ? current : addDaysIso(next, Math.max(0, creditDays)),
                      creditDays,
                    ),
                  );
                }}
                required
                className="h-10"
              />
              <p className="text-xs text-slate-500">ข้อมูลหัวใบวางบิล ไม่ใช้กรองรายการบิลซื้อ</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="due_date">
                วันครบกำหนดชำระ (Due Date) <span className="text-red-500">*</span>
              </Label>
              <Input
                id="due_date"
                type="date"
                value={dueDate}
                onChange={(e) => {
                  setDueTouched(true);
                  setDueDate(coerceBillingDueDate(billingDate, e.target.value, creditDays));
                }}
                required
                className="h-10"
              />
              <p className="text-xs text-slate-500">
                {creditDays > 0
                  ? `ค่าเริ่มต้นจากเครดิตเทอม ${creditDays} วัน`
                  : "ข้อมูลหัวใบวางบิล"}
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="remark">หมายเหตุ</Label>
            <Input
              id="remark"
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              placeholder="ระบุหมายเหตุ (ถ้ามี)"
              className="h-10"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>รายการบิลค้างวางบิล</CardTitle>
          <CardDescription>
            {invoices.length === 0
              ? "ไม่พบบิลค้างวางบิลสำหรับผู้ติดต่อนี้"
              : `พบ ${invoices.length} รายการ — ติ๊กเลือกบิลที่ต้องการวางบิล`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {invoices.length > 0 ? (
            <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-sm font-semibold text-slate-800">
                กรองงวดบิลซื้อ (Filter by Invoice Period)
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => applyInvoicePeriod("", "", "all")}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs font-semibold",
                    periodKey === "all"
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-200 bg-white text-slate-700",
                  )}
                >
                  ทั้งหมด ({invoices.length})
                </button>
                {monthPills.map(([key, bucket]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => {
                      const bounds = monthBounds(key);
                      if (!bounds) return;
                      applyInvoicePeriod(bounds.from, bounds.to, key);
                    }}
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs font-semibold",
                      periodKey === key
                        ? "border-blue-600 bg-blue-600 text-white"
                        : "border-slate-200 bg-white text-slate-700",
                    )}
                  >
                    {thaiMonthLabel(key)} ({bucket.count} ใบ • ฿{formatMoney(bucket.total)})
                  </button>
                ))}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="invoice-from">ตั้งแต่วันที่บิล</Label>
                  <Input
                    id="invoice-from"
                    type="date"
                    value={filterFromDate}
                    onChange={(event) => {
                      const nextFrom = event.target.value;
                      const bounds = monthBounds(monthKeyFromIso(nextFrom));
                      const key =
                        bounds && bounds.from === nextFrom && bounds.to === filterToDate
                          ? monthKeyFromIso(nextFrom)
                          : nextFrom || filterToDate
                            ? "custom"
                            : "all";
                      applyInvoicePeriod(nextFrom, filterToDate, key);
                    }}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="invoice-to">ถึงวันที่บิล</Label>
                  <Input
                    id="invoice-to"
                    type="date"
                    value={filterToDate}
                    onChange={(event) => {
                      const nextTo = event.target.value;
                      const bounds = monthBounds(monthKeyFromIso(filterFromDate));
                      const key =
                        bounds && bounds.from === filterFromDate && bounds.to === nextTo
                          ? monthKeyFromIso(filterFromDate)
                          : filterFromDate || nextTo
                            ? "custom"
                            : "all";
                      applyInvoicePeriod(filterFromDate, nextTo, key);
                    }}
                  />
                </div>
              </div>
            </div>
          ) : null}
          {invoices.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
              ไม่พบบิลที่มียอดค้างชำระ หรือบิลถูกวางบิลไปแล้ว
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">
                    <input
                      type="checkbox"
                      aria-label="เลือกทั้งหมด"
                      className="size-4 rounded border-slate-300 accent-blue-600"
                      checked={allSelected}
                      onChange={(e) => toggleAll(e.target.checked)}
                    />
                  </TableHead>
                  <TableHead>เลขที่เอกสาร</TableHead>
                  <TableHead>วันที่</TableHead>
                  <TableHead>ครบกำหนด</TableHead>
                  <TableHead className="text-right">ยอดรวม</TableHead>
                  <TableHead className="text-right">ชำระแล้ว</TableHead>
                  <TableHead className="text-right">ค้างชำระ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleInvoices.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="h-16 text-center text-slate-500">
                      ไม่มีบิลซื้อในงวดที่เลือก
                    </TableCell>
                  </TableRow>
                ) : visibleInvoices.map((inv) => {
                  const checked = selectedIds.has(inv.id);
                  return (
                    <TableRow
                      key={inv.id}
                      data-state={checked ? "selected" : undefined}
                    >
                      <TableCell>
                        <input
                          type="checkbox"
                          aria-label={`เลือก ${inv.doc_no}`}
                          className="size-4 rounded border-slate-300 accent-blue-600"
                          checked={checked}
                          onChange={(e) =>
                            toggleOne(inv.id, e.target.checked)
                          }
                        />
                      </TableCell>
                      <TableCell className="font-medium text-slate-900">
                        {formatBillingInvoiceNo(inv.doc_no, inv.reference_no, inv.tax_invoice_no)}
                      </TableCell>
                      <TableCell>{formatDate(inv.doc_date)}</TableCell>
                      <TableCell>{formatDate(inv.due_date)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(inv.grand_total)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-slate-500">
                        {formatMoney(inv.paid_amount)}
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular-nums text-blue-700">
                        {formatMoney(inv.outstanding_amount)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
        <CardFooter className="flex flex-col gap-4 border-t border-slate-100 bg-slate-50/60">
          <div className="text-sm text-slate-600">
            เลือกแล้ว{" "}
            <span className="font-semibold text-slate-900">
              {selectedIds.size}
            </span>{" "}
            บิล · ยอดวางบิลรวม{" "}
            <span className="text-lg font-bold tabular-nums text-blue-700">
              {formatMoney(totalBilledAmount)}
            </span>{" "}
            บาท
          </div>
          <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <Link
              href={listHref}
              className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            >
              ยกเลิก / กลับหน้ารายการ
            </Link>
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="outline"
                disabled={isSubmitting || selectedIds.size === 0 || !contactId}
                className="h-10 rounded-xl"
                onClick={() => void saveBillingNote("next")}
              >
                {isSubmitting ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Save className="size-4" />
                )}
                {isAR ? "💾 บันทึก และทำลูกค้าถัดไป" : "💾 บันทึก และทำเจ้าถัดไป"}
              </Button>
              <Button
                type="submit"
                disabled={isSubmitting || selectedIds.size === 0 || !contactId}
                className="h-10 rounded-xl"
              >
                {isSubmitting ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="size-4" />
                )}
                ✓ บันทึก และไปหน้ารายการวางบิล
              </Button>
            </div>
          </div>
        </CardFooter>
      </Card>
        </>
      )}
    </form>
  );
}
