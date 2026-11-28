"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { FnbQtyInput } from "@/components/fnb/fnb-qty-input";
import { replenishZoneAction, saveDisplaySectionCountsAction } from "@/lib/actions/fnb-store-day";
import { postFnbInstantSave } from "@/lib/fnb/instant-client";
import { hhmm, UnsavedDraftBar } from "@/components/fnb/section-confirm-card";
import { crewAssist, useLiveBranch } from "@/components/fnb/shift-crew-bar";
import { addDays, bangkokHour, shortThaiDate } from "@/lib/fnb/stage-progress";
import { formatFnbQty } from "@/lib/utils/fnb-format";
import { FNB_DISPLAY_SUB_GROUPS, type FnbDisplayLot, type FnbLiveZoneStock, type FnbStageConfirmation, type FnbZoneCountLine } from "@/types/fnb";

const BAKERY_GROUPS = new Set(["CROISSANT", "PUFF_PIE", "CAKE_MOUSSE", "HANJUKU"]);

function groupOf(line: FnbZoneCountLine): string {
  if (FNB_DISPLAY_SUB_GROUPS.some((group) => group.code === line.displaySubGroup)) return line.displaySubGroup;
  if (line.category === "ICE_CREAM" || line.category === "CONE") return "ICECREAM_CONE";
  if (line.category === "MERCHANDISE") return "MERCH_DISPLAY";
  if (line.category === "BAKERY_FROZEN") return "CAKE_MOUSSE";
  return "OTHER_DISPLAY";
}

function isBakeryIce(line: FnbZoneCountLine): boolean {
  return line.category === "BAKERY_FROZEN" || line.category === "ICE_CREAM" || line.category === "CONE" || groupOf(line) === "ICECREAM_CONE" || BAKERY_GROUPS.has(groupOf(line));
}

function isMerch(line: FnbZoneCountLine): boolean {
  return line.category === "MERCHANDISE" || groupOf(line) === "MERCH_DISPLAY";
}

type CountItem = { key: string; name: string; qty: number; uom: string };

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

function payloadItems(row: FnbStageConfirmation | null, catalog: FnbZoneCountLine[]): CountItem[] {
  const raw = Array.isArray(row?.payload.items) ? row.payload.items : Array.isArray(row?.payload.lines) ? row.payload.lines : [];
  return raw.flatMap((item) => {
    const rec = asRecord(item);
    if (!rec) return [];
    const key = String(rec.item_id ?? rec.itemId ?? rec.code ?? "");
    const known = catalog.find((line) => line.itemId === key || line.shortCode === key);
    const qty = Number(rec.counted_qty ?? rec.countedQty ?? rec.qty ?? 0);
    return [{
      key: key || known?.itemId || "",
      name: String(rec.name_th ?? rec.nameTh ?? rec.name ?? known?.nameTh ?? rec.code ?? "รายการ"),
      qty: Number.isFinite(qty) ? qty : 0,
      uom: String(rec.count_uom ?? rec.uom ?? rec.countUom ?? known?.countUom ?? "ชิ้น"),
    }];
  });
}

function stockItems(rows: FnbLiveZoneStock[], lines: FnbZoneCountLine[]): CountItem[] {
  const ids = new Set(lines.map((line) => line.itemId));
  return rows.filter((row) => row.countStage === "OPENING" && ids.has(row.itemId)).map((row) => {
    const known = lines.find((line) => line.itemId === row.itemId);
    return {
      key: row.itemId,
      name: row.nameTh || known?.nameTh || row.shortCode || "รายการ",
      qty: row.countedQty,
      uom: row.countUom || known?.countUom || "ชิ้น",
    };
  });
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
  marks?: Record<string, string>;
  onQty: (itemId: string, value: string) => void;
  bakery: boolean;
  evening: boolean;
  setEvening: (value: boolean) => void;
  onReplenish: (line: FnbZoneCountLine, qty: number) => void;
}) {
  const groups = FNB_DISPLAY_SUB_GROUPS.filter((group) => props.lines.some((line) => groupOf(line) === group.code));
  const loose = props.lines.filter((line) => !groups.some((group) => group.code === groupOf(line)));
  const blocks = [
    ...groups.map((group) => ({ code: group.code, label: group.label, lines: props.lines.filter((line) => groupOf(line) === group.code) })),
    ...(loose.length ? [{ code: "OTHER", label: "รายการอื่น", lines: loose }] : []),
  ];
  return (
    <div className="space-y-3">
      {blocks.map((group) => (
        <div key={group.code}>
          <p className="text-xs font-semibold text-slate-500">{group.label}</p>
          {group.lines.sort((left, right) => left.displayWalkOrder - right.displayWalkOrder).map((line) => {
            const life = line.shelfLifeDays || 4;
            const start = props.evening ? addDays(props.today, 1) : props.today;
            const expiry = addDays(start, life - 1);
            return (
              <div key={line.itemId} className="mt-1 flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-2 py-1.5 text-sm">
                <p className="min-w-28 flex-1 font-medium">{line.nameTh}</p>
                {props.bakery ? <LotBadges lots={props.lots.filter((lot) => lot.itemId === line.itemId)} today={props.today} /> : null}
                <FnbQtyInput className="h-10 w-20" value={props.qty[line.itemId] ?? ""} onChange={(value) => props.onQty(line.itemId, value)} unit={line.countUom || "ชิ้น"} />
                {props.marks?.[line.itemId] ? <span className="text-xs text-emerald-700">{props.marks[line.itemId]}</span> : null}
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

function CountLockedCard(props: { sectionNo: number; row: FnbStageConfirmation; items: CountItem[]; onRevise?: () => void }) {
  const [showZero, setShowZero] = useState(false);
  const positive = props.items.filter((item) => item.qty > 0);
  const zeros = props.items.filter((item) => item.qty <= 0);
  return (
    <div className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-950">
      {positive.length > 0 ? (
        <>
          <div className="grid gap-1 sm:grid-cols-2">
            {positive.map((item) => <p key={item.key} className="rounded-full bg-white px-2 py-1 font-semibold">{item.name}: {formatFnbQty(item.qty, item.uom, false)}</p>)}
          </div>
          <p className="mt-2 text-xs">(มีของหน้าตู้ {positive.length} รายการ · 0 ชิ้น {zeros.length} รายการ)</p>
        </>
      ) : <p>ยืนยันตรวจนับแล้ว: หน้าตู้ 0 ชิ้นทุกรายการ</p>}
      {zeros.length > 0 && positive.length > 0 ? (
        <button type="button" className="mt-2 rounded-full bg-white px-2 py-1 text-xs" onClick={() => setShowZero((value) => !value)}>ดูรายการที่เป็น 0 ชิ้น ({zeros.length} รายการ)</button>
      ) : null}
      {showZero ? <p className="mt-1 text-xs">{zeros.map((item) => item.name).join(", ")}</p> : null}
      <p className="mt-2">✅ บันทึกยืนยันหมวดที่ {props.sectionNo} แล้วโดย: {props.row.confirmedByName} · เวลา {hhmm(props.row.confirmedAt)}</p>
      {props.onRevise ? <button type="button" className="mt-2 font-semibold underline" onClick={props.onRevise}>✏️ แก้ไขพร้อมระบุเหตุผล</button> : null}
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
  reopen?: string | null;
  onRevise?: (sectionKey: string) => void;
  onDone: () => void;
}) {
  const live = useLiveBranch();
  const dirty = useRef(new Set<string>());
  const [qty, setQty] = useState<Record<string, string>>({});
  const [evening, setEvening] = useState(bangkokHour() >= 17);
  const [busyKey, setBusyKey] = useState("");
  const confirms = (live.snapshot?.confirmations ?? []).filter((row) => row.stageCode === "OPENING");
  const sec4 = confirms.find((row) => row.sectionKey === "SEC_4_BAKERY_ICE") ?? null;
  const sec5 = confirms.find((row) => row.sectionKey === "SEC_5_MERCH") ?? null;
  const ice = props.lines.filter((line) => !isMerch(line) && (line.category === "ICE_CREAM" || line.category === "CONE" || groupOf(line) === "ICECREAM_CONE"));
  const bakery = props.lines.filter((line) => isBakeryIce(line) && !isMerch(line) && !ice.some((row) => row.itemId === line.itemId));
  const bakeryIce = [...bakery, ...ice];
  const merch = props.lines.filter((line) => isMerch(line));
  useEffect(() => {
    const saved = new Map<string, string>();
    for (const row of [sec4, sec5]) {
      for (const item of payloadItems(row, props.lines)) {
        if (item.key) saved.set(item.key, String(Math.round(item.qty)));
      }
    }
    const rows = (live.snapshot?.zoneStockCounts ?? []).filter((row) => row.countStage === "OPENING");
    if (rows.length === 0 && saved.size === 0) return;
    setQty((current) => {
      let changed = false;
      const next = { ...current };
      const apply = (itemId: string, shown: string) => {
        if (!itemId || dirty.current.has(itemId) || next[itemId] === shown) return;
        next[itemId] = shown;
        changed = true;
      };
      for (const row of rows) apply(row.itemId, String(Math.round(row.countedQty)));
      for (const [itemId, shown] of saved) apply(itemId, shown);
      return changed ? next : current;
    });
  }, [live.snapshot, sec4, sec5, props.lines]);
  const saveTimer = useRef<Record<string, number>>({});
  const [marks, setMarks] = useState<Record<string, string>>({});
  function onQty(itemId: string, value: string) {
    dirty.current.add(itemId);
    setQty((current) => ({ ...current, [itemId]: value }));
    setMarks((current) => ({ ...current, [itemId]: "⏳" }));
    window.clearTimeout(saveTimer.current[itemId]);
    saveTimer.current[itemId] = window.setTimeout(() => {
      const line = props.lines.find((row) => row.itemId === itemId);
      void postFnbInstantSave({
        action: "DISPLAY_ITEM_COUNT",
        branchCode: props.branch,
        workDate: props.workDate,
        stageCode: "OPENING",
        sectionKey: line && (line.category === "MERCHANDISE") ? "SEC_5_MERCH" : "SEC_4_BAKERY_ICE",
        itemId,
        locationCode: props.frontCode,
        countedQty: Math.trunc(Number(value) || 0),
      }).then((saved) => {
        setMarks((current) => ({ ...current, [itemId]: saved.ok ? "☁️ บันทึกแล้ว" : "" }));
        if (!saved.ok) toast.error(saved.error || "บันทึกยอดนับไม่สำเร็จ");
      });
    }, 700);
  }
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
  function counted(line: FnbZoneCountLine): number {
    const typed = qty[line.itemId];
    if (typed !== undefined && typed !== "") return Math.trunc(Number(typed) || 0);
    const remote = (live.snapshot?.zoneStockCounts ?? []).find((row) => row.itemId === line.itemId && row.countStage === "OPENING");
    return remote ? Math.round(remote.countedQty) : 0;
  }
  async function saveSection(key: "SEC_4_BAKERY_ICE" | "SEC_5_MERCH", title: string, lines: FnbZoneCountLine[]) {
    if (!props.frontCode) { toast.error("ยังไม่พบจุดคลังหลังร้านหรือตู้โชว์"); return; }
    if (busyKey) return;
    setBusyKey(key);
    const rows = lines.map((line) => ({
      itemId: line.itemId,
      locationCode: props.frontCode,
      countedQty: counted(line),
      openingQty: line.openingQty,
      replenishedQty: line.replenishedQty,
      posSoldQty: line.posSoldQty,
      nameTh: line.nameTh,
      uom: line.countUom || "ชิ้น",
      category: line.category,
    }));
    const existing = key === "SEC_4_BAKERY_ICE" ? sec4 : sec5;
    const assist = crewAssist(live);
    const saved = await saveDisplaySectionCountsAction({
      branchCode: props.branch,
      workDate: props.workDate,
      stageCode: "OPENING",
      sectionKey: key,
      sectionTitle: title,
      items: rows.map((line) => ({ itemId: line.itemId, countedQty: line.countedQty })),
      actorSource: props.actorSource,
      brandLock: props.brand,
      isEdit: Boolean(existing),
      editReason: assist.editReason || "",
    });
    setBusyKey("");
    if (saved.error || saved.data.ok !== true) { toast.error(saved.error || "บันทึกยอดนับไม่สำเร็จ"); return; }
    toast.success(key === "SEC_4_BAKERY_ICE" ? "บันทึกยืนยันหมวดที่ 4 แล้ว" : "บันทึกยืนยันหมวดที่ 5 แล้ว");
    lines.forEach((line) => dirty.current.delete(line.itemId));
    void live.refresh();
    props.onDone();
  }
  const stock = live.snapshot?.zoneStockCounts ?? [];
  function shownItems(row: FnbStageConfirmation | null, lines: FnbZoneCountLine[]): CountItem[] {
    const payload = payloadItems(row, lines);
    const remote = stockItems(stock, lines);
    if (!row) return remote;
    const merged = new Map<string, CountItem>();
    for (const item of remote) merged.set(item.key, item);
    for (const item of payload) merged.set(item.key || item.name, item);
    return merged.size > 0 ? [...merged.values()] : payload;
  }
  const sec4Items = shownItems(sec4, bakeryIce);
  const sec5Items = shownItems(sec5, merch);
  return (
    <div className="space-y-4">
      <article className="space-y-2 rounded-xl border p-3">
        <h3 className="font-semibold">หมวดที่ 4: ตู้แช่เบเกอรี่และตู้ไอศกรีมหน้าร้าน</h3>
        {sec4 && props.reopen !== "SEC_4_BAKERY_ICE" ? (
          <CountLockedCard sectionNo={4} row={sec4} items={sec4Items.length ? sec4Items : stockItems(stock, bakeryIce)} onRevise={props.onRevise ? () => props.onRevise?.("SEC_4_BAKERY_ICE") : undefined} />
        ) : (
          <>
            <h4 className="font-semibold">🥐 ตู้แช่เบเกอรี่หน้าร้าน</h4>
            <CabinetRows lines={bakery} lots={props.lots} today={props.today} qty={qty} onQty={onQty} marks={marks} bakery evening={evening} setEvening={setEvening} onReplenish={(line, count) => void replenish(line, count)} />
            <h4 className="font-semibold">🍦 ตู้ไอศกรีมและโคนหน้าบาร์</h4>
            <CabinetRows lines={ice} lots={props.lots} today={props.today} qty={qty} onQty={onQty} marks={marks} bakery={false} evening={evening} setEvening={setEvening} onReplenish={() => undefined} />
            <button type="button" className="rounded-md bg-[var(--fnb-brand)] px-3 py-2 text-sm text-white disabled:opacity-60" disabled={busyKey !== ""} onClick={() => void saveSection("SEC_4_BAKERY_ICE", "หมวดที่ 4: ตู้แช่เบเกอรี่และตู้ไอศกรีมหน้าร้าน", bakeryIce)}>{busyKey === "SEC_4_BAKERY_ICE" ? "กำลังบันทึก..." : "💾 บันทึกยืนยันหมวดที่ 4 (เบเกอรี่และไอศกรีม)"}</button>
            {bakeryIce.some((line) => dirty.current.has(line.itemId)) ? <UnsavedDraftBar sectionNo={4} /> : null}
          </>
        )}
      </article>
      <article className="space-y-2 rounded-xl border p-3">
        <h3 className="font-semibold">หมวดที่ 5: ชั้นโชว์ของพรีเมียมหน้าร้าน</h3>
        {sec5 && props.reopen !== "SEC_5_MERCH" ? (
          <CountLockedCard sectionNo={5} row={sec5} items={sec5Items.length ? sec5Items : stockItems(stock, merch)} onRevise={props.onRevise ? () => props.onRevise?.("SEC_5_MERCH") : undefined} />
        ) : (
          <>
            <CabinetRows lines={merch} lots={props.lots} today={props.today} qty={qty} onQty={onQty} marks={marks} bakery={false} evening={evening} setEvening={setEvening} onReplenish={() => undefined} />
            <button type="button" className="rounded-md bg-[var(--fnb-brand)] px-3 py-2 text-sm text-white disabled:opacity-60" disabled={busyKey !== ""} onClick={() => void saveSection("SEC_5_MERCH", "หมวดที่ 5: ชั้นโชว์ของพรีเมียมหน้าร้าน", merch)}>{busyKey === "SEC_5_MERCH" ? "กำลังบันทึก..." : "💾 บันทึกยืนยันหมวดที่ 5 (ชั้นโชว์ของพรีเมียม)"}</button>
            {merch.some((line) => dirty.current.has(line.itemId)) ? <UnsavedDraftBar sectionNo={5} /> : null}
          </>
        )}
      </article>
    </div>
  );
}
