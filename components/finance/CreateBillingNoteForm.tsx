"use client";

/**
 * Create Billing Note form — Client island.
 * Contact / type state via URL Search Params (parent Server Component re-fetches).
 * Mutation via `createBillingNote` Server Action only — no client Supabase.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, CheckCircle2, Loader2 } from "lucide-react";
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
import type { CustomerOption } from "@/types/document";

export type CreateBillingNoteFormProps = {
  type: BillingCategory;
  contactId: string;
  customers: CustomerOption[];
  vendors: VendorOption[];
  invoices: UnbilledInvoice[];
  /** Shown when contact_id is empty — contacts with outstanding unbilled invoices. */
  outstandingContacts: OutstandingContactSummary[];
  defaultDate: string;
};

function formatMoney(value: number): string {
  return value.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("th-TH", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function buildHref(type: BillingCategory, contactId?: string): string {
  const params = new URLSearchParams();
  params.set("type", type);
  if (contactId) params.set("contact_id", contactId);
  return `/finance/billing-notes/create?${params.toString()}`;
}

export function CreateBillingNoteForm({
  type,
  contactId,
  customers,
  vendors,
  invoices,
  outstandingContacts,
  defaultDate,
}: CreateBillingNoteFormProps) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [billingDate, setBillingDate] = useState(defaultDate);
  const [dueDate, setDueDate] = useState(defaultDate);
  const [remark, setRemark] = useState("");
  const [error, setError] = useState<string | null>(null);

  const isAR = type === "AR";

  const totalBilledAmount = useMemo(() => {
    return roundMoney(
      invoices.reduce((sum, inv) => {
        if (!selectedIds.has(inv.id)) return sum;
        return sum + inv.outstanding_amount;
      }, 0),
    );
  }, [invoices, selectedIds]);

  const allSelected =
    invoices.length > 0 && invoices.every((inv) => selectedIds.has(inv.id));

  function navigate(nextType: BillingCategory, nextContactId: string) {
    router.push(buildHref(nextType, nextContactId || undefined));
  }

  function toggleAll(checked: boolean) {
    if (!checked) {
      setSelectedIds(new Set());
      return;
    }
    setSelectedIds(new Set(invoices.map((inv) => inv.id)));
  }

  function toggleOne(id: string, checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
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
        return;
      }

      toast.success(
        isAR
          ? "สร้างใบวางบิลลูกหนี้ (BN) สำเร็จ"
          : "สร้างใบรับวางบิลเจ้าหนี้ (BR) สำเร็จ",
      );

      const listHref = `/finance/billing-notes?type=${encodeURIComponent(
        isAR ? "BN" : "BR",
      )}`;
      router.push(listHref);
      router.refresh();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "สร้างใบวางบิลไม่สำเร็จ";
      setError(message);
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href={`/finance/billing-notes?type=${isAR ? "BN" : "BR"}`}
          className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
        >
          <ArrowLeft className="size-4" />
          กลับรายการวางบิล
        </Link>
      </div>

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

      {!contactId ? (
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
          <CardContent>
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
                        {isAR ? "ชื่อลูกค้า" : "ชื่อคู่ค้า"}
                      </TableHead>
                      <TableHead className="whitespace-nowrap text-right">
                        จำนวนบิล
                      </TableHead>
                      <TableHead className="whitespace-nowrap text-right">
                        ยอดค้างชำระรวม
                      </TableHead>
                      <TableHead className="whitespace-nowrap text-right">
                        การดำเนินการ
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {outstandingContacts.map((row) => (
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
                วันที่วางบิล <span className="text-red-500">*</span>
              </Label>
              <Input
                id="billing_date"
                type="date"
                value={billingDate}
                onChange={(e) => setBillingDate(e.target.value)}
                required
                className="h-10"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="due_date">
                วันครบกำหนด <span className="text-red-500">*</span>
              </Label>
              <Input
                id="due_date"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                required
                className="h-10"
              />
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
        <CardContent>
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
                {invoices.map((inv) => {
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
                        <div>{inv.doc_no}</div>
                        <div className="text-xs text-slate-400">
                          {inv.doc_type}
                        </div>
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
        <CardFooter className="flex flex-col gap-4 border-t border-slate-100 bg-slate-50/60 sm:flex-row sm:items-center sm:justify-between">
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
          <Button
            type="submit"
            disabled={isSubmitting || selectedIds.size === 0 || !contactId}
            className="h-10 min-w-[160px] rounded-xl"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                กำลังบันทึก...
              </>
            ) : (
              <>
                <CheckCircle2 className="size-4" />
                บันทึกใบวางบิล
              </>
            )}
          </Button>
        </CardFooter>
      </Card>
        </>
      )}
    </form>
  );
}
