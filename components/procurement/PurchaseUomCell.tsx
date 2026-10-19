"use client";

import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import {
  allowsCustomMultiplier,
  findPurchaseUom,
  resolveConversionFactor,
  stockBaseQty,
  uomOptionLabel,
  type PurchaseUomOption,
} from "@/lib/utils/purchase-uom";

type PurchaseUomCellProps = {
  catalog: PurchaseUomOption[];
  uomCode: string;
  conversionFactor: number;
  qty: number;
  disabled?: boolean;
  baseUnitLabel?: string;
  onChange: (next: { uomCode: string; conversionFactor: number }) => void;
};

export function PurchaseUomCell({
  catalog,
  uomCode,
  conversionFactor,
  qty,
  disabled = false,
  baseUnitLabel = "ตัว",
  onChange,
}: PurchaseUomCellProps) {
  const selected = findPurchaseUom(catalog, uomCode);
  const factor = resolveConversionFactor(conversionFactor);
  const showMultiplier = allowsCustomMultiplier(selected);
  const received = stockBaseQty(qty, factor);

  return (
    <div className="space-y-1">
      <Select
        aria-label="หน่วยรับเข้า"
        disabled={disabled}
        value={uomCode}
        className="h-8 text-xs"
        onChange={(event) => {
          const next = findPurchaseUom(catalog, event.target.value);
          onChange({
            uomCode: event.target.value,
            conversionFactor: resolveConversionFactor(next?.default_multiplier),
          });
        }}
      >
        {catalog.map((uom) => (
          <option key={uom.uom_code} value={uom.uom_code}>
            {uomOptionLabel(uom)}
          </option>
        ))}
      </Select>
      {showMultiplier ? (
        <label className="flex items-center justify-end gap-1 text-[10px] text-slate-500">
          x
          <Input
            type="number"
            inputMode="decimal"
            min={0.0001}
            step="0.0001"
            disabled={disabled}
            value={factor}
            aria-label="ตัวคูณแปลงหน่วย"
            className="h-7 w-16 text-right text-xs tabular-nums"
            onChange={(event) =>
              onChange({
                uomCode,
                conversionFactor: resolveConversionFactor(event.target.value),
              })
            }
          />
        </label>
      ) : null}
      {factor > 1 ? (
        <p className="text-[10px] font-medium text-blue-700">
          รับเข้าคลัง: {received.toLocaleString("th-TH")} {baseUnitLabel}
        </p>
      ) : null}
    </div>
  );
}
