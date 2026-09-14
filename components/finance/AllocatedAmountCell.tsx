"use client";

/**
 * Allocated amount cell for AR/AP knock-off tables.
 * Info tooltip lists each source document (CN / PWO / REC / PAY).
 */

import { Info } from "lucide-react";
import { Tooltip } from "@/components/ui/tooltip";
import type { InvoiceAllocationSource } from "@/types/payment";
import { cn } from "@/lib/utils";

const DEFAULT_ALLOCATED_HINT =
  "มียอดตัดชำระ หรือลดหนี้ (CN/Write-off) ไปแล้วบางส่วน";

export type AllocatedAmountCellProps = {
  allocatedAmount: number;
  sources?: InvoiceAllocationSource[];
  formatMoney: (value: number) => string;
  className?: string;
};

export function AllocatedAmountCell({
  allocatedAmount,
  sources = [],
  formatMoney,
  className,
}: AllocatedAmountCellProps) {
  const amount = Number.isFinite(allocatedAmount) ? allocatedAmount : 0;
  const lines = sources.filter(
    (row) => row.doc_no?.trim() && Number(row.amount) > 0,
  );

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
            <span className="flex flex-col gap-1">
              <span>{DEFAULT_ALLOCATED_HINT}</span>
              {lines.length > 0 ? (
                <span className="flex flex-col gap-0.5 border-t border-white/20 pt-1">
                  {lines.map((row, index) => (
                    <span key={`${row.doc_no}-${row.doc_type}-${index}`}>
                      {row.doc_no}
                      {row.doc_type ? ` (${row.doc_type})` : ""} —{" "}
                      {formatMoney(row.amount)} บาท
                    </span>
                  ))}
                </span>
              ) : null}
            </span>
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
