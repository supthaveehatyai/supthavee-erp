"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SALES_SHIPPING_METHODS } from "@/lib/utils/sales-shipping";

export function SalesShippingFields({
  fee,
  method,
  disabled = false,
  feeId = "shipping-fee",
  methodId = "shipping-method",
  onFeeChange,
  onMethodChange,
}: {
  fee: string;
  method: string;
  disabled?: boolean;
  feeId?: string;
  methodId?: string;
  onFeeChange: (value: string) => void;
  onMethodChange: (value: string) => void;
}) {
  const amount = Number(fee);
  const showMethod = (Number.isFinite(amount) && amount > 0) || Boolean(method);

  return (
    <>
      <div className="space-y-1.5">
        <Label htmlFor={feeId}>ค่าขนส่ง (บาท)</Label>
        <Input
          id={feeId}
          type="number"
          min={0}
          step="0.01"
          inputMode="decimal"
          value={fee}
          disabled={disabled}
          placeholder="0.00"
          onChange={(event) => onFeeChange(event.target.value)}
          className="h-10"
        />
        <p className="text-[11px] text-slate-400">
          ค่าฝากส่งตามจริง ไม่นำไปคิด VAT 7% ของสินค้า
        </p>
      </div>
      {showMethod ? (
        <div className="space-y-1.5">
          <Label htmlFor={methodId}>ผู้ให้บริการขนส่ง</Label>
          <select
            id={methodId}
            value={method}
            disabled={disabled}
            onChange={(event) => onMethodChange(event.target.value)}
            className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-60"
          >
            <option value="">— เลือกผู้ให้บริการ —</option>
            {SALES_SHIPPING_METHODS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      ) : null}
    </>
  );
}
