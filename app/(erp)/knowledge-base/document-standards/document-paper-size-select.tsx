"use client";

/**
 * Knowledge Base — interactive print paper size per document type.
 * Saves via Server Action only (Zero Client-Side Fetching).
 */

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { updateDocumentPrintSetting } from "@/lib/actions/settings";
import { PRINT_PAPER_SIZE_OPTIONS } from "@/lib/constants/print-paper-size";
import type { PrintPaperSize } from "@/types/print-document";
import { Select } from "@/components/ui/select";

export type DocumentPaperSizeSelectProps = {
  docType: string;
  value: PrintPaperSize;
};

export function DocumentPaperSizeSelect({
  docType,
  value,
}: DocumentPaperSizeSelectProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleChange(next: string) {
    if (next === value) return;

    startTransition(async () => {
      const result = await updateDocumentPrintSetting(docType, next);
      if (!result.success) {
        toast.error(result.error ?? "บันทึกขนาดกระดาษไม่สำเร็จ");
        return;
      }
      const label =
        PRINT_PAPER_SIZE_OPTIONS.find((opt) => opt.value === next)?.label ??
        next;
      toast.success(`บันทึก ${docType} → ${label} แล้ว`);
      router.refresh();
    });
  }

  return (
    <Select
      aria-label={`ขนาดกระดาษ ${docType}`}
      value={value}
      disabled={isPending}
      onChange={(event) => handleChange(event.target.value)}
      className="h-9 min-w-[8.5rem] text-xs"
    >
      {PRINT_PAPER_SIZE_OPTIONS.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </Select>
  );
}
