"use client";

import type { LineItemsTaxConsensus, PurchaseTaxMode } from "@/lib/utils/purchase-tax";
import { formatMixedTaxGroups, purchaseTaxModeLabel } from "@/lib/utils/purchase-tax";

export function MixedTaxConflictBanner({
  consensus,
  confirmed,
  onConfirmedChange,
  showConfirm = true,
}: {
  consensus: LineItemsTaxConsensus;
  confirmed: boolean;
  onConfirmedChange: (checked: boolean) => void;
  showConfirm?: boolean;
}) {
  if (!consensus.hasMixedTaxConflict) return null;
  const detail = formatMixedTaxGroups(consensus.groups);
  return (
    <div className="mb-3 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900">
      <p className="font-semibold leading-relaxed">
        🚨 ตรวจพบสินค้าคนละประเภทภาษีปะปนกันในบิลเดียว! ({detail}) โดยปกติผู้จำหน่ายจะแยกบิลตามประเภทภาษี โปรดตรวจสอบว่าเลือก SKU ผิดรุ่นหรือไม่
      </p>
      {showConfirm ? (
        <label className="mt-2 flex items-start gap-2 text-xs font-medium">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={confirmed}
            onChange={(event) => onConfirmedChange(event.target.checked)}
          />
          <span>ยืนยันว่าบิลนี้มีสินค้าหลายประเภทภาษีปนกันจริง</span>
        </label>
      ) : null}
    </div>
  );
}

export function TaxModeMismatchBanner({
  documentMode,
  consensusTaxType,
  onApplyConsensus,
}: {
  documentMode: PurchaseTaxMode;
  consensusTaxType: PurchaseTaxMode;
  onApplyConsensus: () => void;
}) {
  if (documentMode === consensusTaxType) return null;
  return (
    <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
      <p className="leading-relaxed">
        ⚠️ โหมดภาษีของเอกสาร ({purchaseTaxModeLabel(documentMode)}) ขัดแย้งกับประเภทภาษีของสินค้าทุกรายการในตาราง ({purchaseTaxModeLabel(consensusTaxType)}) ซึ่งจะทำให้ต้นทุนสินค้า TAS 2 และยอดเจ้าหนี้คลาดเคลื่อน 7%
      </p>
      <button
        type="button"
        className="mt-2 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700"
        onClick={onApplyConsensus}
      >
        ⚡ ปรับโหมดภาษีเป็น {purchaseTaxModeLabel(consensusTaxType)} ตามสินค้าทันที
      </button>
    </div>
  );
}
