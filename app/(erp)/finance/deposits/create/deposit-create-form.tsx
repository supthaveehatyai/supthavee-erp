"use client";

/**
 * Deposit create form — Client island for Combobox + file input + VAT preview.
 * Data options come from Server Component parent (Zero Client-Side Fetching).
 * Mutation via Server Action only; VAT math is React state (real-time preview).
 */

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, FileUp, Loader2 } from "lucide-react";
import { createDepositDocument } from "@/app/actions/finance/deposit-actions";
import type { DepositTab } from "@/app/actions/finance/deposit-actions";
import CustomerCombobox from "@/app/(erp)/sales/create/customer-combobox";
import VendorCombobox from "@/components/procurement/VendorCombobox";
import type { VendorOption } from "@/lib/actions/mapping";
import type { CustomerOption } from "@/types/document";
import {
  DEFAULT_VAT_RATE,
  VAT_OPTIONS,
} from "@/lib/constants/accounting";
import {
  calculateDocumentSummary,
  type VatCalculationType,
} from "@/lib/utils/document-summary";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

const INITIAL_VAT_TYPE: VatCalculationType = "NONE";

function formatMoney(value: number): string {
  return value.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export type DepositCreateFormProps = {
  docType: DepositTab;
  customers: CustomerOption[];
  vendors: VendorOption[];
  defaultDate: string;
};

export function DepositCreateForm({
  docType,
  customers,
  vendors,
  defaultDate,
}: DepositCreateFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [contactId, setContactId] = useState("");
  const [documentDate, setDocumentDate] = useState(defaultDate);
  const [amount, setAmount] = useState("");
  const [vatType, setVatType] = useState<VatCalculationType>(INITIAL_VAT_TYPE);
  const [referenceNo, setReferenceNo] = useState("");
  const [remark, setRemark] = useState("");
  const [slipFile, setSlipFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isDepIn = docType === "DEP_IN";

  const billSummary = useMemo(() => {
    const raw = Number(amount);
    const lineAmount = Number.isFinite(raw) && raw > 0 ? raw : 0;
    return calculateDocumentSummary({
      lineTotals: [lineAmount],
      discountText: null,
      vatType,
      vatRate: vatType === "NONE" ? 0 : DEFAULT_VAT_RATE,
    });
  }, [amount, vatType]);

  const amountHint =
    vatType === "INCLUSIVE"
      ? "กรอกยอดรวม VAT แล้ว (Grand Total)"
      : vatType === "EXCLUSIVE"
        ? "กรอกยอดก่อน VAT (Net) — ระบบจะบวก VAT ให้"
        : "กรอกยอดมัดจำสุทธิ (ไม่มี VAT)";

  function handleSlipChange(files: FileList | null) {
    const file = files?.[0] ?? null;
    setSlipFile(file && file.size > 0 ? file : null);
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const formData = new FormData(e.currentTarget);
    formData.set("doc_type", docType);
    formData.set("contact_id", contactId);
    formData.set("document_date", documentDate);
    formData.set("amount", amount);
    formData.set("vat_type", vatType);
    formData.set("vat_rate", String(DEFAULT_VAT_RATE));
    formData.set("reference_no", referenceNo);
    formData.set("remark", remark);

    if (slipFile) {
      formData.set("slip_file", slipFile);
    } else {
      formData.delete("slip_file");
    }

    startTransition(async () => {
      const result = await createDepositDocument(formData);
      if (!result.success) {
        setError(result.error ?? "บันทึกเอกสารมัดจำไม่สำเร็จ");
        return;
      }
      router.push(
        `/finance/deposits?tab=${encodeURIComponent(result.doc_type ?? docType)}`,
      );
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href={`/finance/deposits?tab=${docType}`}
          className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
        >
          <ArrowLeft className="size-4" />
          กลับรายการมัดจำ
        </Link>
      </div>

      {/* Type switch via URL Search Params */}
      <div
        role="tablist"
        className="inline-flex h-10 w-full max-w-xl items-center justify-center rounded-xl bg-slate-100 p-1 text-slate-600"
      >
        <Link
          role="tab"
          aria-selected={isDepIn}
          href="/finance/deposits/create?type=DEP_IN"
          className={cn(
            "inline-flex flex-1 items-center justify-center whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-semibold transition",
            isDepIn
              ? "bg-white text-slate-900 shadow-sm"
              : "text-slate-600 hover:text-slate-900",
          )}
        >
          รับมัดจำลูกค้า (DEP_IN)
        </Link>
        <Link
          role="tab"
          aria-selected={!isDepIn}
          href="/finance/deposits/create?type=DEP_OUT"
          className={cn(
            "inline-flex flex-1 items-center justify-center whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-semibold transition",
            !isDepIn
              ? "bg-white text-slate-900 shadow-sm"
              : "text-slate-600 hover:text-slate-900",
          )}
        >
          จ่ายมัดจำซัพพลายเออร์ (DEP_OUT)
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            {isDepIn
              ? "ฟอร์มรับเงินมัดจำลูกค้า"
              : "ฟอร์มจ่ายเงินมัดจำซัพพลายเออร์"}
          </CardTitle>
          <CardDescription>
            เลขที่เอกสารรันอัตโนมัติ · รองรับ VAT ตามสรรพากรไทย (NONE /
            INCLUSIVE / EXCLUSIVE)
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
              {isDepIn ? "ลูกค้า" : "ซัพพลายเออร์"}{" "}
              <span className="text-red-500">*</span>
            </Label>
            {isDepIn ? (
              <CustomerCombobox
                options={customers}
                value={contactId}
                onChange={setContactId}
                disabled={isPending}
                placeholder="ค้นหาและเลือกลูกค้า..."
                emptyMessage="ไม่พบลูกค้า"
              />
            ) : (
              <VendorCombobox
                options={vendors}
                value={contactId}
                onChange={setContactId}
                disabled={isPending}
                placeholder="ค้นหาและเลือกซัพพลายเออร์..."
                emptyMessage="ไม่พบซัพพลายเออร์"
              />
            )}
            <input type="hidden" name="contact_id" value={contactId} />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="document_date">
                วันที่รับ/จ่ายเงิน <span className="text-red-500">*</span>
              </Label>
              <Input
                id="document_date"
                name="document_date"
                type="date"
                required
                disabled={isPending}
                value={documentDate}
                onChange={(e) => setDocumentDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="amount">
                ยอดเงินมัดจำ (บาท) <span className="text-red-500">*</span>
              </Label>
              <Input
                id="amount"
                name="amount"
                type="number"
                inputMode="decimal"
                min="0.01"
                step="0.01"
                required
                disabled={isPending}
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
              <p className="text-[11px] text-slate-400">{amountHint}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="reference_no">เลขที่อ้างอิง / เลขสลิป</Label>
              <Input
                id="reference_no"
                name="reference_no"
                disabled={isPending}
                placeholder="เลขสลิป / เลขอ้างอิง"
                value={referenceNo}
                onChange={(e) => setReferenceNo(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="remark">หมายเหตุ</Label>
              <Input
                id="remark"
                name="remark"
                disabled={isPending}
                placeholder="รายละเอียดเพิ่มเติม (ถ้ามี)"
                value={remark}
                onChange={(e) => setRemark(e.target.value)}
              />
            </div>
          </div>

          {/* Slip upload — same UX pattern as AR/AP Payment */}
          <div className="space-y-2">
            <Label htmlFor="slip_file">
              อัปโหลดสลิปโอนเงิน (Slip Attachment)
            </Label>
            <div className="flex flex-col gap-2 rounded-md border border-dashed border-slate-300 bg-slate-50 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3 text-sm text-slate-600">
                <FileUp
                  className={cn(
                    "mt-0.5 h-5 w-5 shrink-0",
                    isDepIn ? "text-blue-600" : "text-amber-700",
                  )}
                />
                <div>
                  <p className="font-medium text-slate-800">
                    แนบไฟล์รูปภาพ หรือ PDF (สูงสุด 10MB)
                  </p>
                  <p className="text-xs text-slate-500">
                    {slipFile
                      ? `เลือกแล้ว: ${slipFile.name}`
                      : "ยังไม่ได้เลือกไฟล์ — ไม่บังคับ แต่แนะนำให้แนบหลักฐาน"}
                  </p>
                </div>
              </div>
              <Input
                id="slip_file"
                name="slip_file"
                type="file"
                accept="image/*,application/pdf,.pdf"
                disabled={isPending}
                className="max-w-xs cursor-pointer bg-white"
                onChange={(e) => handleSlipChange(e.target.files)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* VAT + Summary — same pattern as Sales Form */}
      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">สรุปยอดเงิน</CardTitle>
          <CardDescription>
            เลือกประเภท VAT แล้วดู Preview แบบ Real-time ก่อนกดบันทึก
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="vat-type">ประเภท VAT (vat_type)</Label>
                <select
                  id="vat-type"
                  name="vat_type"
                  value={vatType}
                  disabled={isPending}
                  onChange={(event) =>
                    setVatType(event.target.value as VatCalculationType)
                  }
                  className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-60"
                >
                  {VAT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <input
                  type="hidden"
                  name="vat_rate"
                  value={String(DEFAULT_VAT_RATE)}
                />
              </div>
              <p className="text-xs leading-relaxed text-slate-500">
                {vatType === "NONE"
                  ? "ไม่คิดภาษีมูลค่าเพิ่ม — Net = Grand Total"
                  : vatType === "INCLUSIVE"
                    ? `ยอดที่กรอกเป็นยอดรวม VAT แล้ว ระบบจะแยก Net / VAT ${DEFAULT_VAT_RATE}%`
                    : `ยอดที่กรอกเป็นยอดก่อน VAT ระบบจะบวก VAT ${DEFAULT_VAT_RATE}% ให้`}
              </p>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4">
              <dl className="space-y-2.5 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-slate-600">ยอดก่อน VAT (Net Total)</dt>
                  <dd className="font-semibold tabular-nums text-slate-900">
                    {formatMoney(billSummary.net_before_vat)} ฿
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-slate-500">
                    ภาษีมูลค่าเพิ่ม {DEFAULT_VAT_RATE}%
                    <span className="ml-1 text-[10px] uppercase text-slate-400">
                      {vatType}
                    </span>
                  </dt>
                  <dd className="font-medium tabular-nums text-slate-800">
                    {formatMoney(billSummary.vat_amount)} ฿
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3 border-t border-slate-300 pt-3">
                  <dt className="text-base font-bold text-slate-900">
                    ยอดรวมสุทธิ (Grand Total)
                  </dt>
                  <dd
                    className={cn(
                      "text-lg font-bold tabular-nums",
                      isDepIn ? "text-blue-700" : "text-amber-700",
                    )}
                  >
                    {formatMoney(billSummary.grand_total)} ฿
                  </dd>
                </div>
              </dl>
            </div>
          </div>

          <div className="mt-6 flex justify-end border-t border-slate-100 pt-4">
            <Button
              type="submit"
              size="lg"
              disabled={isPending || !contactId || !(Number(amount) > 0)}
              className={cn(
                "h-12 gap-2 px-8 text-base font-semibold shadow-md",
                isDepIn
                  ? "bg-blue-600 hover:bg-blue-700"
                  : "bg-amber-600 hover:bg-amber-700",
              )}
            >
              {isPending ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <CheckCircle2 className="h-5 w-5" />
              )}
              {isPending ? "กำลังบันทึก..." : "บันทึกเอกสารมัดจำ"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </form>
  );
}
