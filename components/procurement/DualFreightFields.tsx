"use client";

import { useState } from "react";
import { toast } from "sonner";
import { createCarrier } from "@/lib/actions/carrier-actions";
import type { CarrierOption } from "@/types/carrier";
import {
  type FreightTaxMode,
} from "@/lib/utils/dual-freight";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

export function CarrierOptionGroups({ carriers }: { carriers: CarrierOption[] }) {
  const primary = carriers.filter((carrier) => carrier.carrier_tier === "PRIMARY_MONTHLY");
  const occasional = carriers.filter((carrier) => carrier.carrier_tier !== "PRIMARY_MONTHLY");
  return (
    <>
      {primary.length > 0 ? (
        <optgroup label="🌟 3 ขนส่งหลัก (สรุปขอใบเสร็จรายเดือน)">
          {primary.map((carrier) => (
            <option key={carrier.carrier_id} value={carrier.carrier_id}>
              {carrier.carrier_code} — {carrier.carrier_name}
            </option>
          ))}
        </optgroup>
      ) : null}
      {occasional.length > 0 ? (
        <optgroup label="📦 ขนส่งอื่นๆ (ใช้เป็นครั้งคราว)">
          {occasional.map((carrier) => (
            <option key={carrier.carrier_id} value={carrier.carrier_id}>
              {carrier.carrier_code} — {carrier.carrier_name}
            </option>
          ))}
        </optgroup>
      ) : null}
    </>
  );
}

export type DualFreightFieldsProps = {
  carriers: CarrierOption[];
  onCarriersChange: (carriers: CarrierOption[]) => void;
  freightCost: string;
  onFreightCostChange: (value: string) => void;
  freightTaxMode: FreightTaxMode;
  onFreightTaxModeChange: (mode: FreightTaxMode) => void;
  destFreightCost: string;
  onDestFreightCostChange: (value: string) => void;
  carrierId: string;
  onCarrierIdChange: (carrierId: string) => void;
  trackingNo: string;
  onTrackingNoChange: (value: string) => void;
  disabled?: boolean;
};

function moneyOrZero(raw: string): number {
  const n = Number(raw.replace(/,/g, ""));
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

export function DualFreightFields({
  carriers,
  onCarriersChange,
  freightCost,
  onFreightCostChange,
  freightTaxMode,
  onFreightTaxModeChange,
  destFreightCost,
  onDestFreightCostChange,
  carrierId,
  onCarrierIdChange,
  trackingNo,
  onTrackingNoChange,
  disabled,
}: DualFreightFieldsProps) {
  const [adding, setAdding] = useState(false);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const origin = moneyOrZero(freightCost);
  const dest = moneyOrZero(destFreightCost);

  async function handleCreateCarrier() {
    setSaving(true);
    const result = await createCarrier({ carrierCode: code, carrierName: name });
    setSaving(false);
    if (result.error || !result.data) {
      toast.error(result.error ?? "เพิ่มบริษัทขนส่งไม่สำเร็จ");
      return;
    }
    onCarriersChange(
      [...carriers, result.data].sort((a, b) => a.sort_order - b.sort_order),
    );
    onCarrierIdChange(result.data.carrier_id);
    setCode("");
    setName("");
    setAdding(false);
    toast.success(`เพิ่มขนส่ง ${result.data.carrier_name} แล้ว`);
  }

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3">
        <Label htmlFor="origin-freight-cost">ค่าขนส่งต้นทาง (ผู้ขายเรียกเก็บในบิล)</Label>
        <Input
          id="origin-freight-cost"
          type="number"
          min={0}
          step="0.01"
          value={freightCost}
          onChange={(event) => onFreightCostChange(event.target.value)}
          placeholder="0.00"
          disabled={disabled}
          className="mt-1 text-right tabular-nums"
        />
        {origin > 0 ? (
          <div className="mt-2 space-y-1">
            <Label htmlFor="origin-freight-tax-mode">ภาษีของค่าขนส่งต้นทาง</Label>
            <Select
              id="origin-freight-tax-mode"
              value={freightTaxMode}
              disabled={disabled}
              onChange={(event) =>
                onFreightTaxModeChange(event.target.value as FreightTaxMode)
              }
              className="h-9"
            >
              <option value="INCLUDED_IN_TAX">
                รวมในใบกำกับภาษี / คิด VAT ร่วมกับสินค้า
              </option>
              <option value="SEPARATE_NON_VAT">
                ไม่รวมในใบกำกับภาษี / ชำระแยกให้ผู้ขาย (Non-VAT)
              </option>
            </Select>
          </div>
        ) : (
          <p className="mt-1 text-[11px] text-slate-500">
            ยอดนี้เข้าหนี้ผู้ขาย และเข้าต้นทุนสินค้า (ก่อน VAT)
          </p>
        )}
      </div>

      <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3">
        <Label htmlFor="dest-freight-cost">ค่าขนส่งเก็บปลายทาง (จ่ายบริษัทขนส่ง)</Label>
        <Input
          id="dest-freight-cost"
          type="number"
          min={0}
          step="0.01"
          value={destFreightCost}
          onChange={(event) => onDestFreightCostChange(event.target.value)}
          placeholder="0.00"
          disabled={disabled}
          className="mt-1 text-right tabular-nums"
        />
        {dest > 0 ? (
          <div className="mt-2 space-y-2">
            <div>
              <Label htmlFor="dest-carrier">บริษัทขนส่ง</Label>
              <Select
                id="dest-carrier"
                value={carrierId}
                disabled={disabled}
                onChange={(event) => onCarrierIdChange(event.target.value)}
                className="mt-1 h-9"
              >
                <option value="">เลือกบริษัทขนส่ง</option>
                <CarrierOptionGroups carriers={carriers} />
              </Select>
            </div>
            <div>
              <Label htmlFor="dest-tracking">เลขบิลขนส่ง/เลขพัสดุ (ไม่บังคับ)</Label>
              <Input
                id="dest-tracking"
                value={trackingNo}
                onChange={(event) => onTrackingNoChange(event.target.value)}
                disabled={disabled}
                className="mt-1"
              />
            </div>
            {adding ? (
              <div className="grid gap-2 rounded-lg border border-amber-200 bg-white p-2 sm:grid-cols-[1fr_1.4fr_auto]">
                <Input
                  value={code}
                  onChange={(event) => setCode(event.target.value.toUpperCase())}
                  placeholder="รหัส เช่น KERRY"
                  disabled={saving}
                />
                <Input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="ชื่อบริษัทขนส่ง"
                  disabled={saving}
                />
                <Button type="button" disabled={saving} onClick={() => void handleCreateCarrier()}>
                  {saving ? "กำลังบันทึก..." : "บันทึก"}
                </Button>
              </div>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={disabled}
                onClick={() => setAdding(true)}
              >
                + เพิ่มขนส่งใหม่
              </Button>
            )}
            <p className="text-[11px] text-amber-800">
              ยอดนี้เข้าต้นทุนสินค้า แต่ไม่บวกในหนี้ของผู้ขายสินค้า
            </p>
          </div>
        ) : (
          <p className="mt-1 text-[11px] text-amber-800">
            จ่ายแยกให้ขนส่ง · ไม่นำไปตั้งหนี้ผู้ขาย
          </p>
        )}
      </div>
    </div>
  );
}
