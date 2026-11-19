"use client";

/**
 * Convert document dropdown — context-aware per source doc_type:
 *   QT (COMPLETED) → SO
 *   SO (ISSUED)    → INV_DO / TAX_INV / CS_TAX / ABB
 * Calls `convertDocument` Server Action only — no client Supabase.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { convertDocument } from "@/lib/actions/document-actions";
import { isVatCalculationType, type VatCalculationType } from "@/lib/utils/document-summary";
import type { ConvertTargetDocType } from "@/types/document";
import type { DocumentType } from "@/types/document";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

export type ConvertDocumentDropdownProps = {
  sourceDocId: string;
  sourceDocNo: string;
  sourceDocType: DocumentType;
  sourceVatType?: string | null;
};

const INVOICE_VAT_OPTIONS: { value: "INCLUSIVE" | "EXCLUSIVE"; label: string }[] = [
  { value: "INCLUSIVE", label: "รวม VAT 7% (Inclusive)" },
  { value: "EXCLUSIVE", label: "แยก VAT 7% (Exclusive / VAT นอก)" },
];

function invoiceTarget(type: ConvertTargetDocType): boolean {
  return type === "CS_TAX" || type === "TAX_INV" || type === "INV_DO";
}

type Option = { type: ConvertTargetDocType; label: string };

const QT_OPTIONS: Option[] = [
  { type: "SO", label: "สร้างใบสั่งขาย (SO)" },
];

const SO_OPTIONS: Option[] = [
  { type: "INV_DO", label: "สร้างใบส่งของ / ใบแจ้งหนี้ (INV_DO)" },
  { type: "TAX_INV", label: "สร้างใบกำกับภาษี / ใบส่งของ / ใบแจ้งหนี้ (TAX_INV)" },
  { type: "CS_TAX", label: "สร้างใบเสร็จรับเงิน / ใบกำกับภาษี (CS_TAX)" },
  { type: "ABB", label: "สร้างใบสำคัญเงินสด (ABB)" },
];

const INV_DO_OPTIONS: Option[] = [
  { type: "TAX_INV", label: "สร้างใบกำกับภาษีเงินเชื่อ (TAX_INV)" },
  { type: "CS_TAX", label: "สร้างใบเสร็จรับเงิน / ใบกำกับภาษี (CS_TAX)" },
];

function todayBangkokIso(): string {
  return new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
}

function getOptions(docType: DocumentType): Option[] {
  if (docType === "QT") return QT_OPTIONS;
  if (docType === "SO") return SO_OPTIONS;
  if (docType === "INV_DO") return INV_DO_OPTIONS;
  return [];
}

export default function ConvertDocumentDropdown({
  sourceDocId,
  sourceDocNo,
  sourceDocType,
  sourceVatType,
}: ConvertDocumentDropdownProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [convertDate, setConvertDate] = useState(todayBangkokIso);
  const initialVat: "INCLUSIVE" | "EXCLUSIVE" =
    isVatCalculationType(String(sourceVatType ?? "")) && sourceVatType === "EXCLUSIVE"
      ? "EXCLUSIVE"
      : "INCLUSIVE";
  const [invoiceVatType, setInvoiceVatType] = useState<"INCLUSIVE" | "EXCLUSIVE">(initialVat);
  const [isPending, startTransition] = useTransition();
  const options = getOptions(sourceDocType);
  const asksForIssueDate = sourceDocType === "SO";
  const asksForInvoiceVat = sourceDocType === "SO";

  if (options.length === 0) return null;

  function handleConvert(targetDocType: ConvertTargetDocType) {
    const selectedConvertDate =
      asksForIssueDate && /^\d{4}-\d{2}-\d{2}$/.test(convertDate)
        ? convertDate
        : null;
    const selectedVat: VatCalculationType | null =
      asksForInvoiceVat && invoiceTarget(targetDocType) ? invoiceVatType : null;
    setOpen(false);
    startTransition(async () => {
      const result = await convertDocument(
        sourceDocId,
        targetDocType,
        selectedConvertDate,
        selectedVat,
      );
      if (result.error || !result.data) {
        toast.error(result.error ?? "แปลงเอกสารไม่สำเร็จ");
        return;
      }

      const newDocNo = result.data.doc_no;
      toast.success(
        `สร้าง ${result.data.doc_type} ร่างจาก ${sourceDocNo}: ${newDocNo}`,
      );
      router.push(`/sales/${encodeURIComponent(newDocNo)}`);
    });
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="secondary"
          disabled={isPending}
          className="h-10 gap-2"
          aria-haspopup="menu"
          aria-expanded={open}
        >
          {isPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <RefreshCw className="size-4" />
          )}
          {isPending ? "กำลังแปลงเอกสาร..." : "สร้างเอกสารต่อยอด"}
          <ChevronDown className="size-4 opacity-70" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className={asksForIssueDate ? "w-80 p-2" : "w-64 p-1"}>
        {asksForInvoiceVat ? (
          <div className="space-y-1.5 px-2 pb-2">
            <Label className="text-xs text-slate-600">ประเภทภาษีของใบกำกับภาษี</Label>
            <div className="grid grid-cols-1 gap-1">
              {INVOICE_VAT_OPTIONS.map((option) => {
                const active = invoiceVatType === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    disabled={isPending}
                    onClick={() => setInvoiceVatType(option.value)}
                    className={
                      active
                        ? "rounded-lg border border-blue-700 bg-blue-800 px-2.5 py-1.5 text-left text-xs font-semibold text-white"
                        : "rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-left text-xs font-medium text-slate-700 hover:bg-slate-50"
                    }
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
        {asksForIssueDate ? (
          <div className="space-y-1.5 px-2 pb-2">
            <Label htmlFor="convert-doc-date" className="text-xs text-slate-600">
              วันที่ออกเอกสารใหม่ / วันที่รับเงินตามสลิป
            </Label>
            <Input
              id="convert-doc-date"
              type="date"
              value={convertDate}
              disabled={isPending}
              onChange={(event) => setConvertDate(event.target.value)}
              className="h-9"
            />
          </div>
        ) : null}
        <div role="menu" className="flex flex-col">
          {options.map((option) => (
            <button
              key={option.type}
              type="button"
              role="menuitem"
              disabled={isPending}
              onClick={() => handleConvert(option.type)}
              className="rounded-lg px-3 py-2.5 text-left text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
            >
              {option.label}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
