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
};

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
}: ConvertDocumentDropdownProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [convertDate, setConvertDate] = useState(todayBangkokIso);
  const [isPending, startTransition] = useTransition();
  const options = getOptions(sourceDocType);
  const asksForIssueDate = sourceDocType === "SO";

  if (options.length === 0) return null;

  function handleConvert(targetDocType: ConvertTargetDocType) {
    const selectedConvertDate =
      asksForIssueDate && /^\d{4}-\d{2}-\d{2}$/.test(convertDate)
        ? convertDate
        : null;
    setOpen(false);
    startTransition(async () => {
      const result = await convertDocument(
        sourceDocId,
        targetDocType,
        selectedConvertDate,
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
