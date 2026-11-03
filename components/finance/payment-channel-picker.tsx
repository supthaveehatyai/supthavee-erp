"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  CASH_RECEIPT_LABEL,
  COMPANY_BANK_LABEL,
  OTHER_BANK_LABEL,
  type PaymentChannel,
} from "@/lib/finance/payment-channel";
import { cn } from "@/lib/utils";

const OPTIONS: Array<{ value: PaymentChannel; label: string }> = [
  { value: "COMPANY_BANK", label: `🏦 ${COMPANY_BANK_LABEL}` },
  { value: "CASH", label: `💵 ${CASH_RECEIPT_LABEL}` },
  { value: "OTHER_BANK", label: `📱 ${OTHER_BANK_LABEL}` },
];

export function PaymentChannelPicker({
  value,
  otherBankName,
  onChange,
  disabled = false,
}: {
  value: PaymentChannel;
  otherBankName: string;
  onChange: (channel: PaymentChannel, otherBankName: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-2">
      <Label>ช่องทางรับเงิน</Label>
      <div className="grid gap-2 sm:grid-cols-3">
        {OPTIONS.map((option) => {
          const active = value === option.value;
          return (
            <button
              key={option.value}
              type="button"
              disabled={disabled}
              onClick={() => onChange(option.value, otherBankName)}
              className={cn(
                "h-auto min-h-10 rounded-lg border px-2 py-2 text-left text-xs font-semibold leading-snug",
                active
                  ? "border-blue-600 bg-blue-50 text-blue-950"
                  : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>
      {value === "OTHER_BANK" ? (
        <div className="space-y-1.5">
          <Label htmlFor="other-bank-name">ชื่อธนาคาร / บัญชีที่รับโอน</Label>
          <Input
            id="other-bank-name"
            value={otherBankName}
            disabled={disabled}
            placeholder="เช่น SCB / KBank สำรอง"
            onChange={(event) => onChange("OTHER_BANK", event.target.value)}
          />
        </div>
      ) : null}
    </div>
  );
}
