"use client";

import { cn } from "@/lib/utils";
import type { ReceiptTaxInvoiceChoice } from "@/lib/utils/tax-invoice-status";

const OPTIONS: { value: ReceiptTaxInvoiceChoice; label: string; className: string }[] = [
  {
    value: "TAX_READY",
    label: "🟢 ได้รับใบกำกับภาษีตัวจริงพร้อมสินค้าแล้ว (TAX_READY)",
    className: "border-emerald-300 bg-emerald-50 text-emerald-900",
  },
  {
    value: "PENDING_TAX_INVOICE",
    label: "🟠 รับของด้วยใบส่งของ/บิลชั่วคราว (รอใบกำกับภาษีตัวจริงตามหลัง - PENDING_TAX_INVOICE)",
    className: "border-orange-300 bg-orange-50 text-orange-950",
  },
];

export function TaxInvoiceStatusPicker({
  value,
  onChange,
  disabled = false,
}: {
  value: ReceiptTaxInvoiceChoice;
  onChange: (value: ReceiptTaxInvoiceChoice) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-[11px] font-semibold text-slate-500">สถานะใบกำกับภาษี</p>
      <div className="grid gap-1.5">
        {OPTIONS.map((option) => {
          const active = value === option.value;
          return (
            <button
              key={option.value}
              type="button"
              disabled={disabled}
              onClick={() => onChange(option.value)}
              className={cn(
                "rounded-lg border px-2.5 py-1.5 text-left text-[11px] font-semibold leading-snug",
                active ? option.className : "border-slate-200 bg-white text-slate-600",
                disabled && "cursor-not-allowed opacity-60",
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
