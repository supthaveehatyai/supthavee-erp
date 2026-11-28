"use client";

import { useState } from "react";
import { toast } from "sonner";
import { FnbQtyInput } from "@/components/fnb/fnb-qty-input";
import { replenishZoneAction, saveZoneCountsAction } from "@/lib/actions/fnb-store-day";
import { confirmStageSectionAction } from "@/lib/actions/fnb-stage";
import { UnsavedDraftBar } from "@/components/fnb/section-confirm-card";
import { crewAssist, useLiveBranch } from "@/components/fnb/shift-crew-bar";
import { addDays, bangkokHour, shortThaiDate } from "@/lib/fnb/stage-progress";
import { FNB_DISPLAY_SUB_GROUPS, type FnbDisplayLot, type FnbZoneCountLine } from "@/types/fnb";

function groupOf(line: FnbZoneCountLine): string {
  if (FNB_DISPLAY_SUB_GROUPS.some((group) => group.code === line.displaySubGroup)) return line.displaySubGroup;
  if (line.category === "ICE_CREAM") return "ICECREAM_CONE";
  if (line.category === "MERCHANDISE") return "MERCH_DISPLAY";
  if (line.category === "BAKERY_FROZEN") return "CAKE_MOUSSE";
  return "OTHER_DISPLAY";
}

function LotBadges({ lots, today }: { lots: FnbDisplayLot[]; today: string }) {
  if (lots.length === 0) return <span className="text-xs text-slate-400">ยังไม่มีล็อตในตู้</span>;
  const due = lots.filter((lot) => lot.displayExpiryDate.slice(0, 10) <= today).reduce((sum, lot) => sum + lot.remainingQty, 0);
  return (
    <span className="flex flex-wrap items-center gap-1 text-xs">
      <span>ล็อตในตู้:</span>
      {lots.map((lot) => (
        <span key={lot.id} className={`rounded-full px-2 py-0.5 ${lot.displayExpiryDate.slice(0, 10) <= today ? "bg-red-100 text-red-800" : "bg-white"}`}>
          {lot.remainingQty} ชิ้น หมด {shortThaiDate(lot.displayExpiryDate)}
        </span>
      ))}
      {due > 0 ? <span className="font-semibold text-red-700">🚨 ครบกำหนดทิ้งวันนี้ {due} ชิ้น!</span> : null}
    </span>
  );
}

function CabinetRows(props: {
  lines: FnbZoneCountLine[];
  lots: FnbDisplayLot[];
  today: string;
  qty: Record<string, string>;
  setQty: (value: Record<string, string>) => void;
  bakery: boolean;
  evening: boolean;
  setEvening: (value: boolean) => void;
  onReplenish: (line: FnbZoneCountLine, qty: number) => void;
}) {
  const groups = FNB_DISPLAY_SUB_GROUPS.filter((group) => props.lines.some((line) => groupOf(line) === group.code));
  return (
    <div className="space-y-3">
      {groups.map((group) => (
        <div key={group.code}>
          <p className="text-xs font-semibold text-slate-500">{group.label}</p>
          {props.lines.filter((line) => groupOf(line) === group.code).sort((left, right) => left.displayWalkOrder - right.displayWalkOrder).map((line) => {
            const life = line.shelfLifeDays || 4;
            const start = props.evening ? addDays(props.today, 1) : props.today;
            const expiry = addDays(start, life - 1);
            return (
              <div key={line.itemId} className="mt-1 flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-2 py-1.5 text-sm">
                <p className="min-w-28 flex-1 font-medium">{line.nameTh}</p>
                {props.bakery ? <LotBadges lots={props.lots.filter((lot) => lot.itemId === line.itemId)} today={props.today} /> : null}
                <FnbQtyInput className="h-10 w-20" value={props.qty[line.itemId] ?? ""} onChange={(value) => props.setQty({ ...props.qty, [line.itemId]: value })} unit={line.countUom || "ชิ้น"} />
                {props.bakery ? (
                  <button type="button" className="rounded-md border px-2 py-1 text-xs" onClick={() => {
                    const typed = window.prompt(`จำนวนที่เบิก ${line.nameTh} เข้าตู้`, "1");
                    const count = Math.trunc(Number(typed) || 0);
                    if (count > 0) props.onReplenish(line, count);
                  }}>➕ เบิกเติมเข้าตู้โชว์</button>
                ) : null}
                {props.bakery ? <span className="text-xs text-slate-500">สติ๊กเกอร์หมด {shortThaiDate(expiry)}</span> : null}
              </div>
            );
          })}
        </div>
      ))}
      {props.bakery ? (
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={props.evening} onChange={(event) => props.setEvening(event.target.checked)} />
          🌙 เติมช่วงเย็นเตรียมขายพรุ่งนี้ (นับพรุ่งนี้เป็นวันที่ 1)
        </label>
      ) : null}
    </div>
  );
}

export function DisplayCabinetGrid(props: {
  lines: FnbZoneCountLine[];
  lots: FnbDisplayLot[];
  today: string;
  branch: string;
  workDate: string;
  actorSource: "desktop" | "liff";
  brand: string;
  frontCode: string;
  backCode: string;
  onDone: () => void;
}) {
  const live = useLiveBranch();
  const [qty, setQty] = useState<Record<string, string>>({});
  const [evening, setEvening] = useState(bangkokHour() >= 17);
  const [busy, setBusy] = useState(false);
  const bakery = props.lines.filter((line) => ["CROISSANT", "PUFF_PIE", "CAKE_MOUSSE", "HANJUKU"].includes(groupOf(line)) || line.category === "BAKERY_FROZEN");
  const ice = props.lines.filter((line) => groupOf(line) === "ICECREAM_CONE" || line.category === "ICE_CREAM");
  const merch = props.lines.filter((line) => groupOf(line) === "MERCH_DISPLAY" || line.category === "MERCHANDISE");
  async function replenish(line: FnbZoneCountLine, count: number) {
    if (!props.backCode || !props.frontCode) { toast.error("ยังไม่พบจุดคลังหลังร้านหรือตู้โชว์"); return; }
    const saved = await replenishZoneAction({
      branchCode: props.branch,
      workDate: props.workDate,
      fromLocationCode: props.backCode,
      toLocationCode: props.frontCode,
      itemId: line.itemId,
      qty: count,
      actorSource: props.actorSource,
      brandLock: props.brand,
      eveningForTomorrow: evening,
      notes: evening ? "เติมเย็นเตรียมขายพรุ่งนี้" : "เบิกเติมเข้าตู้โชว์",
    });
    if (saved.error || !saved.data.ok) toast.error(saved.error || "เบิกเติมไม่สำเร็จ");
    else toast.success(saved.data.expiryDate ? `ติดสติ๊กเกอร์หมดอายุ ${shortThaiDate(saved.data.expiryDate)}` : "เบิกเติมเข้าตู้โชว์แล้ว");
    props.onDone();
  }
  return (
    <div className="space-y-3">
      <div className="grid gap-4 lg:grid-cols-2">
        <article className="rounded-xl border p-3">
          <h4 className="font-semibold">🥐 ตู้แช่เบเกอรี่หน้าร้าน</h4>
          <CabinetRows lines={bakery} lots={props.lots} today={props.today} qty={qty} setQty={setQty} bakery evening={evening} setEvening={setEvening} onReplenish={(line, count) => void replenish(line, count)} />
        </article>
        <div className="space-y-4">
          <article className="rounded-xl border p-3">
            <h4 className="font-semibold">🍦 ตู้ไอศกรีมและโคนหน้าบาร์</h4>
            <CabinetRows lines={ice} lots={props.lots} today={props.today} qty={qty} setQty={setQty} bakery={false} evening={evening} setEvening={setEvening} onReplenish={() => undefined} />
          </article>
          <article className="rounded-xl border p-3">
            <h4 className="font-semibold">🎁 ชั้นโชว์ของพรีเมียมหน้าร้าน</h4>
            <CabinetRows lines={merch} lots={props.lots} today={props.today} qty={qty} setQty={setQty} bakery={false} evening={evening} setEvening={setEvening} onReplenish={() => undefined} />
          </article>
        </div>
      </div>
      <button type="button" className="rounded-md bg-[#DC2626] px-3 py-2 text-sm text-white disabled:opacity-60" disabled={busy} onClick={() => {
        if (!props.frontCode) { toast.error("ยังไม่พบจุดคลังหลังร้านหรือตู้โชว์"); return; }
        setBusy(true);
        void (async () => {
          const lines = props.lines.filter((line) => qty[line.itemId] !== undefined && qty[line.itemId] !== "").map((line) => ({
            itemId: line.itemId,
            locationCode: props.frontCode,
            countedQty: Math.trunc(Number(qty[line.itemId]) || 0),
            openingQty: line.openingQty,
            replenishedQty: line.replenishedQty,
            posSoldQty: line.posSoldQty,
          }));
          const saved = await saveZoneCountsAction({ branchCode: props.branch, workDate: props.workDate, stage: "OPENING", actorSource: props.actorSource, brandLock: props.brand, lines });
          if (saved.error || !saved.data.ok) { toast.error(saved.error || "บันทึกยอดเช้าไม่สำเร็จ"); setBusy(false); return; }
          const assist = crewAssist(live);
          for (const section of [
            { key: "SEC_4_BAKERY_ICE", title: "หมวดที่ 4: ตู้แช่เบเกอรี่และตู้ไอศกรีม", lines: [...bakery, ...ice] },
            { key: "SEC_5_MERCH", title: "หมวดที่ 5: ชั้นโชว์ของพรีเมียมหน้าร้าน", lines: merch },
          ]) {
            const confirmed = await confirmStageSectionAction({ branchCode: props.branch, workDate: props.workDate, stageCode: "OPENING", sectionKey: section.key, sectionTitle: section.title, actorSource: props.actorSource, brandLock: props.brand, shiftSlot: "SHIFT_1", payload: { lines: section.lines.map((line) => ({ itemId: line.itemId, code: line.shortCode, qty: qty[line.itemId] ?? "" })) }, ...assist });
            if (confirmed.error || !confirmed.data.ok) { toast.error(confirmed.error || "ยืนยันหมวดไม่สำเร็จ"); setBusy(false); return; }
          }
          toast.success("บันทึกยอดชั้นโชว์ตอนเปิดร้านแล้ว");
          void live.refresh();
          setBusy(false);
          props.onDone();
        })();
      }}>{busy ? "กำลังบันทึก..." : "💾 บันทึกยืนยันหมวดที่ 4 และหมวดที่ 5"}</button>
      {Object.values(qty).some((value) => value !== "") ? <UnsavedDraftBar sectionNo={4} /> : null}
    </div>
  );
}
