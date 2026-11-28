"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { copyCleaningSpotsAction, listBranchZonesAction, listCleaningSpotsAction, saveCleaningSpotAction, saveStorageZoneAction } from "@/lib/actions/fnb-store-day";
import type { FnbCleaningSpot, FnbStorageZone } from "@/types/fnb";

const input = "h-9 rounded-md border border-slate-200 px-2 text-sm";
const DAYS = [
  { day: 1, label: "จ" },
  { day: 2, label: "อ" },
  { day: 3, label: "พ" },
  { day: 4, label: "พฤ" },
  { day: 5, label: "ศ" },
  { day: 6, label: "ส" },
  { day: 0, label: "อา" },
];
const ZONE_OPTIONS = [
  ["FRONT_DISPLAY", "หน้าร้าน"],
  ["BACKROOM", "คลังหลังร้าน"],
  ["WAREHOUSE", "โกดัง"],
] as const;
const SCHEDULES = [
  ["DAILY_OPEN_CLOSE", "นับเปิดและปิดร้าน"],
  ["EVERY_3_DAYS", "นับทุก 3 วัน"],
  ["WEEKLY_2X", "สัปดาห์ละ 2 ครั้ง"],
  ["WEEKLY_1X", "สัปดาห์ละ 1 ครั้ง"],
  ["ON_DEMAND", "นับเมื่อเรียก"],
] as const;

export function CleaningSpotBoard({ branch, siblingBranches }: { branch: string; siblingBranches: { branch_code: string; branch_name_th: string }[] }) {
  const [stage, setStage] = useState<"OPENING" | "CLOSING">("OPENING");
  const [spots, setSpots] = useState<FnbCleaningSpot[]>([]);
  const [source, setSource] = useState("");
  const [, start] = useTransition();
  function reload() {
    void listCleaningSpotsAction(branch).then((loaded) => setSpots(loaded.data));
  }
  useEffect(() => { reload(); }, [branch]);
  const rows = spots.filter((spot) => spot.stageCode === stage);
  const others = siblingBranches.filter((item) => item.branch_code !== branch);
  return (
    <section className="space-y-3 rounded-xl border bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-2">
          <button type="button" className={`rounded-full px-3 py-1 text-sm ${stage === "OPENING" ? "bg-[var(--fnb-brand)] text-white" : "bg-slate-100"}`} onClick={() => setStage("OPENING")}>☀️ เปิดร้าน ({spots.filter((spot) => spot.stageCode === "OPENING").length} จุด)</button>
          <button type="button" className={`rounded-full px-3 py-1 text-sm ${stage === "CLOSING" ? "bg-[var(--fnb-brand)] text-white" : "bg-slate-100"}`} onClick={() => setStage("CLOSING")}>🌙 ปิดร้าน & ล้างอุปกรณ์ ({spots.filter((spot) => spot.stageCode === "CLOSING").length} จุด)</button>
        </div>
        <div className="flex items-center gap-2">
          <select className={input} value={source} onChange={(event) => setSource(event.target.value)}>
            <option value="">เลือกสาขาต้นทาง</option>
            {others.map((item) => <option key={item.branch_code} value={item.branch_code}>{item.branch_code}</option>)}
          </select>
          <button type="button" className="rounded-md border px-2 py-1 text-xs" onClick={() => start(async () => {
            if (!source) { toast.error("เลือกสาขาต้นทางในแบรนด์เดียวกัน"); return; }
            const saved = await copyCleaningSpotsAction({ fromBranch: source, toBranch: branch, stageCode: stage });
            if (saved.error || !saved.data.ok) toast.error(saved.error || "คัดลอกไม่สำเร็จ");
            else { toast.success("คัดลอกจุดตรวจแล้ว"); reload(); }
          })}>📋 คัดลอกจุดตรวจจากอีกสาขา (แบรนด์เดียวกัน)</button>
        </div>
      </div>
      <table className="w-full text-left text-sm">
        <thead><tr className="text-xs text-slate-500"><th className="w-16 py-1">#</th><th>ชื่อจุดตรวจความสะอาด / อุปกรณ์</th><th className="w-56">ความถี่</th><th className="w-16">เปิดใช้</th><th className="w-24" /></tr></thead>
        <tbody>
          {rows.map((spot) => <SpotRow key={spot.id} spot={spot} branch={branch} stage={stage} onDone={reload} />)}
        </tbody>
      </table>
      <SpotCreate branch={branch} stage={stage} onDone={reload} />
    </section>
  );
}

function SpotRow({ spot, branch, stage, onDone }: { spot: FnbCleaningSpot; branch: string; stage: "OPENING" | "CLOSING"; onDone: () => void }) {
  const [name, setName] = useState(spot.spotNameTh);
  const [sort, setSort] = useState(String(spot.sortOrder));
  const [weekly, setWeekly] = useState(spot.scheduleType === "WEEKLY");
  const [days, setDays] = useState<number[]>(spot.weekdays);
  const [active, setActive] = useState(true);
  const [busy, start] = useTransition();
  function save(isActive = active) {
    start(async () => {
      const saved = await saveCleaningSpotAction({ id: spot.id, branchCode: branch, stageCode: stage, spotNameTh: name, sortOrder: Number(sort) || spot.sortOrder, scheduleType: weekly ? "WEEKLY" : "DAILY", weekdays: days, isActive });
      if (saved.error || !saved.data.ok) toast.error(saved.error || "บันทึกจุดไม่สำเร็จ");
      else { toast.success(isActive ? "บันทึกจุดตรวจแล้ว" : "ปิดจุดตรวจแล้ว"); onDone(); }
    });
  }
  return (
    <tr className="border-t">
      <td className="py-1"><input className={`${input} w-14`} value={sort} onChange={(event) => setSort(event.target.value)} /></td>
      <td className="pr-2"><input className={`${input} w-full`} value={name} onChange={(event) => setName(event.target.value)} /></td>
      <td>
        <div className="flex flex-wrap items-center gap-1">
          <button type="button" className={`rounded-full px-2 py-0.5 text-xs ${weekly ? "bg-slate-100" : "bg-[var(--fnb-brand)] text-white"}`} onClick={() => setWeekly(false)}>ทุกวัน</button>
          <button type="button" className={`rounded-full px-2 py-0.5 text-xs ${weekly ? "bg-[var(--fnb-brand)] text-white" : "bg-slate-100"}`} onClick={() => setWeekly(true)}>รายสัปดาห์</button>
          {weekly ? DAYS.map((day) => (
            <button key={day.day} type="button" className={`rounded-full px-1.5 py-0.5 text-xs ${days.includes(day.day) ? "bg-slate-900 text-white" : "bg-slate-100"}`} onClick={() => setDays((current) => current.includes(day.day) ? current.filter((value) => value !== day.day) : [...current, day.day])}>{day.label}</button>
          )) : null}
        </div>
      </td>
      <td><input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} /></td>
      <td className="space-x-1 text-right">
        <button type="button" className="rounded-md border px-2 py-1 text-xs" disabled={busy} onClick={() => save(true)}>บันทึก</button>
        <button type="button" className="rounded-md border px-2 py-1 text-xs" disabled={busy} onClick={() => save(false)}>🗑️</button>
      </td>
    </tr>
  );
}

function SpotCreate({ branch, stage, onDone }: { branch: string; stage: "OPENING" | "CLOSING"; onDone: () => void }) {
  const [name, setName] = useState("");
  const [sort, setSort] = useState("10");
  const [busy, start] = useTransition();
  return (
    <form className="flex flex-wrap items-center gap-2" onSubmit={(event) => {
      event.preventDefault();
      if (!name.trim() || busy) return;
      start(async () => {
        const saved = await saveCleaningSpotAction({ branchCode: branch, stageCode: stage, spotNameTh: name, sortOrder: Number(sort) || 10, scheduleType: "DAILY", weekdays: [] });
        if (saved.error || !saved.data.ok) toast.error(saved.error || "เพิ่มจุดไม่สำเร็จ");
        else { toast.success("เพิ่มจุดตรวจแล้ว"); setName(""); onDone(); }
      });
    }}>
      <input className={`${input} w-16`} value={sort} onChange={(event) => setSort(event.target.value)} />
      <input className={`${input} min-w-64 flex-1`} value={name} onChange={(event) => setName(event.target.value)} placeholder="+ เพิ่มจุดตรวจใหม่" />
      <button className="rounded-md bg-[var(--fnb-brand)] px-3 py-1 text-sm text-white" disabled={busy}>{busy ? "กำลังบันทึก..." : "+ เพิ่มจุดตรวจใหม่"}</button>
    </form>
  );
}

export function StorageZoneBoard({ branch }: { branch: string }) {
  const [zones, setZones] = useState<FnbStorageZone[]>([]);
  const [adding, setAdding] = useState(false);
  function reload() {
    void listBranchZonesAction(branch).then((loaded) => setZones(loaded.data));
  }
  useEffect(() => { reload(); }, [branch]);
  return (
    <section className="space-y-3 rounded-xl border bg-white p-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">จุดจัดเก็บสินค้าในสาขานี้</h3>
        <button type="button" className="rounded-md border px-2 py-1 text-sm" onClick={() => setAdding((value) => !value)}>+ เพิ่มจุดจัดเก็บใหม่ในสาขานี้</button>
      </div>
      <table className="w-full text-left text-sm">
        <thead><tr className="text-xs text-slate-500"><th className="py-1">รหัสจุด</th><th>ชื่อจุดจัดเก็บ</th><th>ชื่อย่อ</th><th>ประเภทโซน</th><th>รอบการตรวจนับ</th><th>ระบุวันนับ</th><th>จุดรับของหลัก</th><th /></tr></thead>
        <tbody>
          {zones.map((zone) => <ZoneRow key={zone.id} zone={zone} branch={branch} onDone={reload} />)}
          {adding ? <ZoneRow zone={null} branch={branch} onDone={() => { setAdding(false); reload(); }} /> : null}
        </tbody>
      </table>
    </section>
  );
}

function ZoneRow({ zone, branch, onDone }: { zone: FnbStorageZone | null; branch: string; onDone: () => void }) {
  const [code, setCode] = useState(zone?.locationCode ?? "");
  const [name, setName] = useState(zone?.locationNameTh ?? "");
  const [shortLabel, setShortLabel] = useState(zone?.shortLabel ?? "");
  const [zoneType, setZoneType] = useState(zone?.zoneType || "BACKROOM");
  const [schedule, setSchedule] = useState(zone?.defaultCountSchedule || "DAILY_OPEN_CLOSE");
  const [days, setDays] = useState<number[]>(zone?.countWeekdays ?? []);
  const [gr, setGr] = useState(zone?.isDefaultGrTarget ?? false);
  const [busy, start] = useTransition();
  const weekly = schedule === "WEEKLY_1X" || schedule === "WEEKLY_2X";
  return (
    <tr className="border-t">
      <td className="py-1 pr-2"><input className={`${input} w-32`} value={code} onChange={(event) => setCode(event.target.value)} placeholder="รหัสจุด" /></td>
      <td className="pr-2"><input className={`${input} w-full`} value={name} onChange={(event) => setName(event.target.value)} placeholder="ชื่อจุดจัดเก็บ" /></td>
      <td className="pr-2"><input className={`${input} w-24`} value={shortLabel} onChange={(event) => setShortLabel(event.target.value)} placeholder="ตู้หน้า" /></td>
      <td><select className={`${input} w-36`} value={zoneType} onChange={(event) => setZoneType(event.target.value)}>{ZONE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></td>
      <td><select className={`${input} w-44`} value={schedule} onChange={(event) => setSchedule(event.target.value)}>{SCHEDULES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></td>
      <td>
        {weekly ? <div className="flex gap-1">{DAYS.map((day) => <button key={day.day} type="button" className={`rounded-full px-1.5 py-0.5 text-xs ${days.includes(day.day) ? "bg-slate-900 text-white" : "bg-slate-100"}`} onClick={() => setDays((current) => current.includes(day.day) ? current.filter((value) => value !== day.day) : [...current, day.day])}>{day.label}</button>)}</div> : <span className="text-slate-400">—</span>}
      </td>
      <td className="text-center"><input type="checkbox" checked={gr} onChange={(event) => setGr(event.target.checked)} /></td>
      <td><button type="button" className="rounded-md bg-[var(--fnb-brand)] px-2 py-1 text-xs text-white" disabled={busy} onClick={() => start(async () => {
        const saved = await saveStorageZoneAction({ id: zone?.id, branchCode: branch, locationCode: code, locationNameTh: name, shortLabel, zoneType, defaultCountSchedule: schedule, countWeekdays: weekly ? days : [], isDefaultGrTarget: gr });
        if (saved.error || !saved.data.ok) toast.error(saved.error || "บันทึกจุดจัดเก็บไม่สำเร็จ");
        else { toast.success("บันทึกจุดจัดเก็บแล้ว"); onDone(); }
      })}>{busy ? "..." : "บันทึก"}</button></td>
    </tr>
  );
}
