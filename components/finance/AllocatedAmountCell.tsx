"use client";

/**
 * Allocated amount cell for AR/AP knock-off tables.
 * Info tooltip appears only when allocated > 0.
 */

import { Info } from "lucide-react";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const DEFAULT_ALLOCATED_HINT =
  "มียอดตัดชำระ หรือลดหนี้ (CN/Write-off) ไปแล้วบางส่วน";

export type AllocatedAmountCellProps = {
  allocatedAmount: number;
  sourceDocNos?: string[];
  formatMoney: (value: number) => string;
  className?: string;
};

export function AllocatedAmountCell({
  allocatedAmount,
  sourceDocNos = [],
  formatMoney,
  className,
}: AllocatedAmountCellProps) {
  const amount = Number.isFinite(allocatedAmount) ? allocatedAmount : 0;
  const uniqueDocs = [
    ...new Set(sourceDocNos.map((no) => no.trim()).filter(Boolean)),
  ];
  const tooltip = uniqueDocs.length
    ? `${DEFAULT_ALLOCATED_HINT}\nเอกสารที่ตัดหนี้: ${uniqueDocs.join(", ")}`
    : DEFAULT_ALLOCATED_HINT;

  return (
    <span
      className={cn(
        "inline-flex w-full items-center justify-end gap-1 tabular-nums",
        className,
      )}
    >
      <span>{formatMoney(amount)}</span>
      {amount > 0.02 ? (
        <Tooltip
          content={
            <span className="whitespace-pre-wrap">{tooltip}</span>
          }
        >
          <button
            type="button"
            className="inline-flex rounded-full text-slate-400 outline-none hover:text-slate-600 focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-1"
            aria-label={DEFAULT_ALLOCATED_HINT}
          >
            <Info className="size-3.5" />
          </button>
        </Tooltip>
      ) : null}
    </span>
  );
}
