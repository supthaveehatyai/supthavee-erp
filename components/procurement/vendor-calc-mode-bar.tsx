"use client";

import { cn } from "@/lib/utils";
import {
  vendorCalcModeLabel,
  type VendorCalcMode,
  type VendorCalcQuote,
} from "@/lib/utils/vendor-calc-mode";

function formatBaht(value: number): string {
  return value.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function VendorCalcModeBar({
  mode,
  quotes,
  disabled = false,
  onChange,
}: {
  mode: VendorCalcMode;
  quotes: VendorCalcQuote[];
  disabled?: boolean;
  onChange: (mode: VendorCalcMode) => void;
}) {
  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {quotes.map((quote) => {
        const active = quote.mode === mode;
        const label =
          quote.mode === "UNIT_4DEC"
            ? "วิธีคิด: ทศนิยม 4 ตำแหน่ง"
            : `วิธีคิด: ${vendorCalcModeLabel(quote.mode)} (฿${formatBaht(quote.grandTotal)})`;
        return (
          <button
            key={quote.mode}
            type="button"
            disabled={disabled}
            title={
              quote.mode === "UNIT_4DEC"
                ? `ยอดตามโหมดนี้ ฿${formatBaht(quote.grandTotal)}`
                : label
            }
            onClick={() => onChange(quote.mode)}
            className={cn(
              "rounded-lg border px-2.5 py-1 text-left text-[11px] font-semibold leading-snug",
              active
                ? "border-violet-600 bg-violet-600 text-white"
                : "border-violet-200 bg-white text-violet-900 hover:bg-violet-50",
              disabled && "cursor-not-allowed opacity-60",
            )}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
