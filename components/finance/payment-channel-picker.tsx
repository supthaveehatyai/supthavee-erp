"use client";

import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  accountsForChannel,
  bankAccountDisplay,
  CASH_RECEIPT_LABEL,
  COMPANY_BANK_LABEL,
  type ActiveBankAccount,
  type PaymentChannel,
} from "@/lib/finance/payment-channel";
import { cn } from "@/lib/utils";

const OPTIONS: Array<{ value: PaymentChannel; label: string }> = [
  { value: "COMPANY_BANK", label: `🏦 ${COMPANY_BANK_LABEL}` },
  { value: "CASH", label: `💵 ${CASH_RECEIPT_LABEL}` },
  { value: "OTHER_BANK", label: "📱 โอนเข้าบัญชีบุคคล / บัญชีอื่น (รอโอนเข้าบริษัท)" },
];

export function PaymentChannelPicker({
  value,
  bankAccountId,
  accounts,
  onChange,
  disabled = false,
}: {
  value: PaymentChannel;
  bankAccountId: string | null;
  accounts: ActiveBankAccount[];
  onChange: (channel: PaymentChannel, bankAccountId: string | null) => void;
  disabled?: boolean;
}) {
  const pool = accountsForChannel(accounts, value);
  const accountLabel =
    value === "COMPANY_BANK" ? "บัญชีบริษัทที่รับโอน" : "ชื่อธนาคาร / บัญชีที่รับโอน";

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
              onClick={() => {
                const nextPool = accountsForChannel(accounts, option.value);
                onChange(
                  option.value,
                  option.value === "CASH" ? null : (nextPool[0]?.id ?? null),
                );
              }}
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
      {value === "CASH" ? null : (
        <div className="space-y-1.5">
          <Label htmlFor="receiving-bank-account">{accountLabel}</Label>
          {pool.length > 0 ? (
            <Select
              id="receiving-bank-account"
              value={bankAccountId ?? pool[0]?.id ?? ""}
              disabled={disabled}
              onChange={(event) => onChange(value, event.target.value || null)}
            >
              {pool.map((account) => (
                <option key={account.id} value={account.id}>
                  {bankAccountDisplay(account)}
                </option>
              ))}
            </Select>
          ) : (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              ยังไม่มีสมุดบัญชีในระบบสำหรับช่องทางนี้
            </p>
          )}
        </div>
      )}
    </div>
  );
}
