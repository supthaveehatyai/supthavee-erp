"use client";

/**
 * AP Write-off form — client island for remark + per-invoice amounts.
 * Data is server-fetched; persist via `createAPWriteOff`.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { getInvoicesByBillingNote } from "@/app/actions/billing";
import { createAPWriteOff } from "@/app/actions/ap-writeoff";
import { OutstandingSummaryTable } from "@/components/finance/OutstandingSummaryTable";
import { PENDING_APPROVAL_TOAST_MESSAGE } from "@/lib/approval/approval-rules";
import { isApWriteoffSourceDocType } from "@/lib/constants/document";
import { formatThaiDate } from "@/lib/utils/date-formatter";
import { roundMoney } from "@/lib/utils/payment-fifo";
import {
  WRITEOFF_AMOUNT_RANGE_MESSAGE,
  apWriteoffFormSchema,
} from "@/lib/validations/ap-writeoff";
import type { ApVendorOption } from "@/types/ap-payment";
import type { OpenBillingNoteOption } from "@/types/billing";
import type { UnpaidInvoice } from "@/types/payment";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AlertCircle, ArrowLeft, FileMinus2, Loader2 } from "lucide-react";

const CREATE_PATH = "/finance/ap-writeoff/create";

export type ApWriteoffFormProps = {
  vendors: ApVendorOption[];
  invoices: UnpaidInvoice[];
  selectedContactId: string;
  billingNotes?: OpenBillingNoteOption[];
};

function formatMoney(value: number): string {
  return value.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function emptyAmounts(invoices: UnpaidInvoice[]): Record<string, string> {
  return Object.fromEntries(invoices.map((inv) => [inv.id, ""]));
}

function parseAmount(raw: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return roundMoney(n);
}

function createHref(contactId?: string): string {
  if (!contactId) return CREATE_PATH;
  return `${CREATE_PATH}?contact_id=${encodeURIComponent(contactId)}`;
}

export function ApWriteoffForm({
  vendors,
  invoices: initialInvoices,
  selectedContactId,
  billingNotes = [],
}: ApWriteoffFormProps) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingBn, setIsLoadingBn] = useState(false);
  const [remark, setRemark] = useState("");
  const [selectedBillingNoteId, setSelectedBillingNoteId] = useState("");
  const [invoices, setInvoices] = useState<UnpaidInvoice[]>(initialInvoices);
  const [amounts, setAmounts] = useState<Record<string, string>>(() =>
    emptyAmounts(initialInvoices),
  );

  useEffect(() => {
    setInvoices(initialInvoices);
    setAmounts(emptyAmounts(initialInvoices));
    setSelectedBillingNoteId("");
    setRemark("");
  }, [initialInvoices, selectedContactId]);

  function applyInvoiceList(nextInvoices: UnpaidInvoice[]) {
    const filtered = nextInvoices.filter((inv) =>
      isApWriteoffSourceDocType(inv.doc_type),
    );
    setInvoices(filtered);
    setAmounts(emptyAmounts(filtered));
  }

  async function handleBillingNoteChange(noteId: string) {
    setSelectedBillingNoteId(noteId);
    if (!noteId) {
      applyInvoiceList(initialInvoices);
      return;
    }

    setIsLoadingBn(true);
    try {
      const result = await getInvoicesByBillingNote(noteId);
      if (result.error) {
        toast.error(result.error);
        setSelectedBillingNoteId("");
        applyInvoiceList(initialInvoices);
        return;
      }

      const mapped: UnpaidInvoice[] = result.data
        .filter((row) => isApWriteoffSourceDocType(row.doc_type))
        .map((row) => ({
          id: row.id,
          display_doc_no: row.doc_no,
          document_date: row.doc_date,
          doc_type: row.doc_type,
          payment_status: row.payment_status,
          grand_total: row.grand_total,
          net_amount_calc: row.grand_total,
          paid_amount: row.paid_amount,
          allocated_amount: roundMoney(
            Math.max(0, row.grand_total - row.outstanding),
          ),
          allocation_sources: [],
          remaining_balance: row.outstanding,
          contact_id: row.contact_id || selectedContactId,
        }));

      if (mapped.length === 0) {
        toast.message("ใบรับวางบิลนี้ไม่มีบิลค้างชำระที่ตัดหนี้สูญได้");
      } else {
        toast.success(`โหลด ${mapped.length} บิลจากใบรับวางบิลแล้ว`);
      }
      applyInvoiceList(mapped);
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "โหลดบิลจากใบรับวางบิลไม่สำเร็จ";
      toast.error(message);
      setSelectedBillingNoteId("");
      applyInvoiceList(initialInvoices);
    } finally {
      setIsLoadingBn(false);
    }
  }

  const selectedVendor =
    vendors.find((d) => d.id === selectedContactId) ?? null;
  const remarkTrimmed = remark.trim();

  const summaryGrandTotal = useMemo(
    () => vendors.reduce((sum, row) => sum + row.outstanding_total, 0),
    [vendors],
  );

  const lineErrors = useMemo(() => {
    const errors: Record<string, string> = {};
    for (const inv of invoices) {
      const amount = parseAmount(amounts[inv.id] ?? "");
      if (amount <= 0) continue;
      if (amount > roundMoney(inv.remaining_balance) + 0.02) {
        errors[inv.id] = WRITEOFF_AMOUNT_RANGE_MESSAGE;
      }
    }
    return errors;
  }, [amounts, invoices]);

  const allocatedItems = useMemo(
    () =>
      invoices
        .map((inv) => ({
          document_id: inv.id,
          writeoff_amount: parseAmount(amounts[inv.id] ?? ""),
        }))
        .filter((row) => row.writeoff_amount > 0),
    [amounts, invoices],
  );

  const totalWriteoff = useMemo(
    () =>
      roundMoney(
        allocatedItems.reduce((sum, row) => sum + row.writeoff_amount, 0),
      ),
    [allocatedItems],
  );

  const formParsed = selectedContactId
    ? apWriteoffFormSchema.safeParse({
        contact_id: selectedContactId,
        remark: remarkTrimmed,
        lines: invoices.map((inv) => ({
          document_id: inv.id,
          remaining_balance: inv.remaining_balance,
          writeoff_amount: parseAmount(amounts[inv.id] ?? ""),
        })),
      })
    : { success: false as const };

  const canSubmit =
    Boolean(selectedContactId) &&
    remarkTrimmed.length > 0 &&
    allocatedItems.length > 0 &&
    Object.keys(lineErrors).length === 0 &&
    formParsed.success &&
    !isSubmitting &&
    !isLoadingBn;

  async function handleSubmit() {
    if (isSubmitting || !canSubmit) return;
    if (!remarkTrimmed) {
      toast.error("กรุณาระบุเหตุผลการตัดหนี้สูญ");
      return;
    }
    setIsSubmitting(true);
    try {
      const result = await createAPWriteOff({
        contact_id: selectedContactId,
        remark: remarkTrimmed,
        allocated_items: allocatedItems,
      });
      if (!result.success) {
        toast.error(result.error ?? "บันทึกตัดหนี้สูญไม่สำเร็จ");
        return;
      }

      const docNo = result.data?.document_no ?? "";
      toast.success(
        result.data?.pending_approval
          ? PENDING_APPROVAL_TOAST_MESSAGE
          : `บันทึกตัดหนี้สูญสำเร็จ${docNo ? ` · ${docNo}` : ""}`,
      );
      router.push("/finance/ap-writeoff");
      router.refresh();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "บันทึกตัดหนี้สูญไม่สำเร็จ",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {!selectedContactId ? (
        <Card className="border-blue-200 shadow-sm">
          <CardHeader className="bg-blue-50/50">
            <CardTitle className="flex items-center gap-2">
              <FileMinus2 className="h-5 w-5 text-blue-600" />
              1. เลือกผู้จำหน่าย — ตารางสรุปยอดหนี้รายตัว
            </CardTitle>
            <CardDescription>
              จัดกลุ่มบิลค้างชำระ (AP_INV / AP_TAX / AP_CASH) ตามผู้จำหน่าย ·
              ใบรับวางบิล (BR) ใช้กรองรายการหลังเลือก · รวมยอดค้าง{" "}
              <strong className="text-blue-800">
                ฿{formatMoney(summaryGrandTotal)}
              </strong>{" "}
              จาก {vendors.length} ราย
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-6">
            <OutstandingSummaryTable
              mode="parties"
              rows={vendors}
              partyLabel="ชื่อผู้จำหน่าย"
              emptyMessage="ไม่มีข้อมูลเจ้าหนี้ค้างชำระในระบบ"
              selectHref={(id) => createHref(id)}
              nameAscLabel="เรียงตามชื่อผู้จำหน่าย (ก–ฮ)"
              nameDescLabel="เรียงตามชื่อผู้จำหน่าย (ฮ–ก)"
              sortSelectId="ap-writeoff-outstanding-sort"
            />
          </CardContent>
        </Card>
      ) : (
        <>
          <Card className="border-blue-200 shadow-sm">
            <CardHeader className="bg-blue-50/50">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <CardTitle>1. ผู้จำหน่ายที่กำลังตัดหนี้</CardTitle>
                  <CardDescription>
                    เลือกแล้วผ่าน URL (`?contact_id=`) · กดกลับไปหน้าสรุปเพื่อเปลี่ยนผู้จำหน่าย
                  </CardDescription>
                </div>
                <Link
                  href={CREATE_PATH}
                  className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                >
                  <ArrowLeft className="h-4 w-4" />
                  เปลี่ยนผู้จำหน่าย / กลับไปหน้าสรุป
                </Link>
              </div>
            </CardHeader>
            <CardContent className="pt-6">
              <div className="rounded-xl border border-slate-200 bg-slate-50/80 px-4 py-3">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  เจ้าหนี้
                </p>
                <p className="mt-1 text-lg font-semibold text-slate-900">
                  {selectedVendor?.name ?? "ผู้จำหน่ายที่เลือก"}
                </p>
                {selectedVendor ? (
                  <p className="mt-1 text-sm text-slate-600">
                    {selectedVendor.invoice_count} บิลค้าง · ยอดหนี้รวม{" "}
                    <span className="font-semibold text-red-600">
                      ฿{formatMoney(selectedVendor.outstanding_total)}
                    </span>
                    {selectedVendor.oldest_invoice_date
                      ? ` · บิลเก่าสุด ${formatThaiDate(selectedVendor.oldest_invoice_date, "short")}`
                      : ""}
                  </p>
                ) : null}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>2. เหตุผลการตัดหนี้ (Remark)</CardTitle>
              <CardDescription>
                บังคับกรอกตามมาตรฐานบัญชี — หากว่าง ปุ่มบันทึกจะถูกปิด
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <Label htmlFor="ap-writeoff-remark">
                เหตุผลการตัดหนี้ <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="ap-writeoff-remark"
                value={remark}
                disabled={isSubmitting}
                placeholder="ระบุเหตุผล เช่น เจ้าหนี้ปิดกิจการ / ยอดเศษที่ไม่สามารถจ่ายได้"
                onChange={(e) => setRemark(e.target.value)}
              />
              {remarkTrimmed.length === 0 ? (
                <p className="text-xs text-destructive">
                  กรุณาระบุเหตุผลการตัดหนี้สูญ
                </p>
              ) : null}
            </CardContent>
          </Card>

          <Card className="border-blue-200 shadow-sm">
            <CardHeader className="bg-blue-50/50">
              <div className="space-y-1">
                <CardTitle>3. เอกสารค้างชำระ (Outstanding Invoices)</CardTitle>
                <CardDescription>
                  {selectedVendor
                    ? `ผู้จำหน่าย: ${selectedVendor.name} · กรอกยอดที่ต้องการตัดหนี้ในแต่ละบิล`
                    : "กรอกยอดที่ต้องการตัดหนี้ในแต่ละบิล"}
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-4 pt-6">
              {billingNotes.length > 0 ? (
                <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50/80 p-4">
                  <Label htmlFor="ap-writeoff-billing-note">
                    ใบรับวางบิล (BR) — กรองบิลในใบรับวางบิล
                  </Label>
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      id="ap-writeoff-billing-note"
                      className="h-10 min-w-[280px] flex-1 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                      value={selectedBillingNoteId}
                      disabled={isLoadingBn || isSubmitting}
                      onChange={(e) =>
                        void handleBillingNoteChange(e.target.value)
                      }
                    >
                      <option value="">
                        — ใช้บิลค้างชำระทั้งหมดของผู้จำหน่าย —
                      </option>
                      {billingNotes.map((note) => (
                        <option key={note.id} value={note.id}>
                          {note.doc_no} · {note.invoice_count} บิล · ฿
                          {formatMoney(note.grand_total)} ({note.payment_status})
                        </option>
                      ))}
                    </select>
                    {isLoadingBn ? (
                      <Loader2 className="size-4 animate-spin text-blue-600" />
                    ) : null}
                  </div>
                </div>
              ) : null}

              {invoices.length === 0 ? (
                <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 py-10 text-center text-slate-500">
                  ไม่พบบิลค้างชำระสำหรับผู้จำหน่ายรายนี้
                </div>
              ) : (
                <>
                  {Object.keys(lineErrors).length > 0 ? (
                    <Alert variant="destructive">
                      <AlertCircle className="h-4 w-4" />
                      <AlertTitle>ยอดตัดหนี้ไม่ถูกต้อง</AlertTitle>
                      <AlertDescription>
                        {WRITEOFF_AMOUNT_RANGE_MESSAGE}
                      </AlertDescription>
                    </Alert>
                  ) : null}

                  <OutstandingSummaryTable
                    mode="invoices"
                    rows={invoices}
                    amounts={amounts}
                    onAmountChange={(id, value) =>
                      setAmounts((prev) => ({ ...prev, [id]: value }))
                    }
                    lineErrors={lineErrors}
                    documentHref={(docNo) =>
                      `/purchases/${encodeURIComponent(docNo)}`
                    }
                    totalWriteoff={totalWriteoff}
                    disabled={isSubmitting}
                    sortSelectId="ap-writeoff-invoice-sort"
                  />
                </>
              )}

              <div className="flex flex-wrap items-center justify-end gap-3">
                <Button
                  type="button"
                  className="gap-2"
                  disabled={!canSubmit}
                  onClick={() => void handleSubmit()}
                >
                  {isSubmitting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <FileMinus2 className="h-4 w-4" />
                  )}
                  {isSubmitting ? "กำลังบันทึก..." : "บันทึกตัดหนี้สูญ"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
