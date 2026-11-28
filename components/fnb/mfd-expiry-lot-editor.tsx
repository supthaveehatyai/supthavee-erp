"use client";

import { FnbQtyInput } from "@/components/fnb/fnb-qty-input";
import { formatShortDateTH } from "@/lib/utils/fnb-format";
import {
  calcExpiryDateFromMfg,
  dateStampMode,
  daysUntilDate,
  parseChinese8DigitDate,
  shelfLifeUnit,
  type DateStampMode,
  type ShelfLifeUnit,
} from "@/lib/utils/fnb-expiry";

export type ExpiryLotDraft = {
  entry_mode: DateStampMode;
  mfg_date: string;
  stamp_raw: string;
  shelf_life_value: string;
  shelf_life_unit: ShelfLifeUnit;
  expiry_date: string;
  qty: string;
};

export function emptyExpiryLot(input?: {
  mode?: string | null;
  shelfLifeValue?: number | null;
  shelfLifeUnit?: string | null;
}): ExpiryLotDraft {
  return {
    entry_mode: dateStampMode(input?.mode),
    mfg_date: "",
    stamp_raw: "",
    shelf_life_value: String(input?.shelfLifeValue && input.shelfLifeValue > 0 ? input.shelfLifeValue : 12),
    shelf_life_unit: shelfLifeUnit(input?.shelfLifeUnit),
    expiry_date: "",
    qty: "",
  };
}

export function resolvedExpiry(lot: ExpiryLotDraft): string | null {
  if (lot.entry_mode === "EXP") return parseChinese8DigitDate(lot.expiry_date);
  return calcExpiryDateFromMfg(lot.mfg_date, Number(lot.shelf_life_value), lot.shelf_life_unit);
}

function ExpiryBadge({ iso }: { iso: string | null }) {
  if (!iso) return <p className="text-xs text-slate-500">กรอกวันที่แล้วระบบจะคำนวณวันหมดอายุ</p>;
  const left = daysUntilDate(iso);
  const tone = left == null ? "bg-slate-100 text-slate-700" : left < 0 ? "bg-red-100 text-red-800" : left <= 14 ? "bg-amber-100 text-amber-950" : "bg-emerald-50 text-emerald-900";
  const note = left == null ? "" : left < 0 ? " · ❌ หมดอายุแล้ว!" : left <= 14 ? " · 🚨 ใกล้หมดอายุ! รีบใช้ก่อน FEFO" : ` · เหลืออีก ${left} วัน`;
  return <p className={`rounded-md px-2 py-1 text-sm ${tone}`}>➡️ หมดอายุ: {formatShortDateTH(iso)}{note}</p>;
}

export function MfdExpiryLotEditor(props: {
  lots: ExpiryLotDraft[];
  onChange: (lots: ExpiryLotDraft[]) => void;
  countUom: string;
  expectedQty?: number;
  allowDecimal?: boolean;
  defaults?: { mode?: string | null; shelfLifeValue?: number | null; shelfLifeUnit?: string | null };
}) {
  const sum = props.lots.reduce((total, lot) => total + (Number(lot.qty) || 0), 0);
  function patch(index: number, next: Partial<ExpiryLotDraft>) {
    props.onChange(props.lots.map((lot, lotIndex) => (lotIndex === index ? { ...lot, ...next } : lot)));
  }
  return (
    <div className="space-y-2">
      {props.lots.map((lot, index) => {
        const expiry = resolvedExpiry(lot);
        return (
          <div key={index} className="space-y-2 rounded-lg border border-slate-200 bg-white p-2">
            <div className="flex flex-wrap gap-2 text-xs">
              <button type="button" className={`rounded-full px-2 py-1 ${lot.entry_mode === "MFD" ? "bg-[var(--fnb-brand)] text-white" : "bg-slate-100"}`} onClick={() => patch(index, { entry_mode: "MFD" })}>🏭 วันผลิต + อายุ (สินค้าจีน)</button>
              <button type="button" className={`rounded-full px-2 py-1 ${lot.entry_mode === "EXP" ? "bg-[var(--fnb-brand)] text-white" : "bg-slate-100"}`} onClick={() => patch(index, { entry_mode: "EXP" })}>📅 วันหมดอายุตรง (EXP)</button>
              <button type="button" className="ml-auto text-red-700" onClick={() => props.onChange(props.lots.filter((_, lotIndex) => lotIndex !== index))}>🗑️ ลบล็อต</button>
            </div>
            {lot.entry_mode === "MFD" ? (
              <div className="grid gap-2 md:grid-cols-3">
                <label className="text-xs">วันที่ผลิต (MFD)
                  <input className="mt-1 h-10 w-full rounded-md border px-2 text-sm" type="date" value={lot.mfg_date} onChange={(event) => patch(index, { mfg_date: event.target.value, stamp_raw: event.target.value })} />
                  <input className="mt-1 h-9 w-full rounded-md border px-2 text-sm" placeholder="20260515" value={lot.stamp_raw} onChange={(event) => {
                    const raw = event.target.value;
                    const parsed = parseChinese8DigitDate(raw);
                    patch(index, { stamp_raw: raw, mfg_date: parsed || lot.mfg_date });
                  }} />
                </label>
                <label className="text-xs">อายุวัตถุดิบ
                  <span className="mt-1 flex gap-1">
                    <input className="h-10 w-20 rounded-md border px-2 text-sm" type="number" min={1} step={1} value={lot.shelf_life_value} onChange={(event) => patch(index, { shelf_life_value: event.target.value })} />
                    <select className="h-10 rounded-md border px-2 text-sm" value={lot.shelf_life_unit} onChange={(event) => patch(index, { shelf_life_unit: shelfLifeUnit(event.target.value) })}>
                      <option value="DAYS">วัน</option>
                      <option value="MONTHS">เดือน</option>
                      <option value="YEARS">ปี</option>
                    </select>
                  </span>
                </label>
                <div className="self-end"><ExpiryBadge iso={expiry} /></div>
              </div>
            ) : (
              <div className="grid gap-2 md:grid-cols-2">
                <label className="text-xs">วันหมดอายุ (EXP)
                  <input className="mt-1 h-10 w-full rounded-md border px-2 text-sm" type="date" value={lot.expiry_date} onChange={(event) => patch(index, { expiry_date: event.target.value })} />
                </label>
                <div className="self-end"><ExpiryBadge iso={expiry} /></div>
              </div>
            )}
            <label className="text-xs">จำนวนล็อตนี้
              <span className="mt-1 flex items-center gap-2">
                <FnbQtyInput value={lot.qty} allowDecimal={props.allowDecimal} onChange={(value) => patch(index, { qty: value })} />
                <strong>{props.countUom}</strong>
              </span>
            </label>
          </div>
        );
      })}
      <button type="button" className="text-sm text-[var(--fnb-brand)]" onClick={() => props.onChange([...props.lots, emptyExpiryLot(props.defaults)])}>+ เพิ่มล็อตวันผลิต/วันหมดอายุอื่น</button>
      {props.expectedQty != null ? <p className={`text-sm ${sum === props.expectedQty ? "text-emerald-800" : "text-amber-900"}`}>รวมล็อตที่ระบุ: {sum} / {props.expectedQty} {props.countUom}</p> : null}
    </div>
  );
}
