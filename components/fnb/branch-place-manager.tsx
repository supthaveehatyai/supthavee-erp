"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { branchForBrand } from "@/lib/fnb/brand-branch";
import { listBranchZonesAction, listCleaningSpotsAction, saveCleaningSpotAction, saveStorageZoneAction } from "@/lib/actions/fnb-store-day";
import type { FnbBrandCode } from "@/types/fnb";
import { FNB_BACKROOM_SCHEDULE_LABEL, FNB_WEEKDAY_OPTIONS, type FnbCleaningSpot, type FnbStorageZone } from "@/types/fnb";

const field = "h-10 w-full rounded-md border border-slate-200 px-3 text-sm";
const ZONE_SCHEDULES = ["DAILY_OPEN_CLOSE", "DAILY_CLOSE", "EVERY_3_DAYS", "WEEKLY_2X", "WEEKLY_1X", "ON_DEMAND"] as const;

export function BranchPlaceManager({ branches, brand }: { branches: { branch_code: string; branch_name_th: string; brand_code: string }[]; brand: FnbBrandCode }) {
  const [branch, setBranch] = useState(branches[0]?.branch_code ?? "");
  useEffect(() => {
    const next = branchForBrand(branches, brand, branch);
    if (next !== branch) setBranch(next);
  }, [brand, branches, branch]);
  const [zones, setZones] = useState<FnbStorageZone[]>([]);
  const [spots, setSpots] = useState<FnbCleaningSpot[]>([]);
  const [stage, setStage] = useState<"OPENING" | "CLOSING">("OPENING");
  const [, start] = useTransition();
  function reload(code = branch) {
    void listBranchZonesAction(code).then((loaded) => setZones(loaded.data));
    void listCleaningSpotsAction(code).then((loaded) => setSpots(loaded.data));
  }
  useEffect(() => { reload(branch); }, [branch]);
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold">จุดจัดเก็บและความสะอาดรายสาขา</h2>
        <select className={field} value={branch} onChange={(event) => setBranch(event.target.value)}>{branches.map((row) => <option key={row.branch_code} value={row.branch_code}>{row.branch_code} {row.branch_name_th}</option>)}</select>
      </div>
      <article className="space-y-2 rounded-xl border bg-white p-4">
        <h3 className="font-semibold">🏢 สถานที่จัดเก็บสินค้าประจำสาขา (Storage Zones)</h3>
        {zones.map((zone) => <ZoneEditor key={zone.id} zone={zone} onSave={(input) => start(async () => {
          const saved = await saveStorageZoneAction(input);
          if (saved.error || !saved.data.ok) toast.error(saved.error || "บันทึกจุดจัดเก็บไม่สำเร็จ");
          else { toast.success("บันทึกจุดจัดเก็บแล้ว"); reload(); }
        })} />)}
        <ZoneEditor zone={null} branchCode={branch} onSave={(input) => start(async () => {
          const saved = await saveStorageZoneAction(input);
          if (saved.error || !saved.data.ok) toast.error(saved.error || "เพิ่มจุดจัดเก็บไม่สำเร็จ");
          else { toast.success("เพิ่มจุดจัดเก็บแล้ว"); reload(); }
        })} />
      </article>
      <article className="space-y-2 rounded-xl border bg-white p-4">
        <h3 className="font-semibold">🧹 จุดตรวจความสะอาดแยกตามผังสาขา</h3>
        <div className="flex gap-2">
          <button type="button" className={`rounded-full px-3 py-1 text-sm ${stage === "OPENING" ? "bg-[var(--fnb-brand)] text-white" : "bg-slate-100"}`} onClick={() => setStage("OPENING")}>จุดความสะอาดเปิดร้าน</button>
          <button type="button" className={`rounded-full px-3 py-1 text-sm ${stage === "CLOSING" ? "bg-[var(--fnb-brand)] text-white" : "bg-slate-100"}`} onClick={() => setStage("CLOSING")}>จุดความสะอาดและล้างอุปกรณ์ปิดร้าน</button>
        </div>
        {spots.filter((spot) => spot.stageCode === stage).map((spot) => (
          <form key={spot.id} className="grid gap-2 md:grid-cols-3" onSubmit={(event) => {
            event.preventDefault();
            const body = new FormData(event.currentTarget);
            start(async () => {
              const saved = await saveCleaningSpotAction({ id: spot.id, branchCode: branch, stageCode: stage, spotNameTh: String(body.get("name") ?? ""), sortOrder: Number(body.get("sort") ?? spot.sortOrder) });
              if (saved.error || !saved.data.ok) toast.error(saved.error || "บันทึกจุดไม่สำเร็จ");
              else { toast.success("บันทึกจุดความสะอาดแล้ว"); reload(); }
            });
          }}>
            <input className={field} name="name" defaultValue={spot.spotNameTh} />
            <input className={field} name="sort" type="number" defaultValue={spot.sortOrder} />
            <button className="rounded-md border px-3 py-2 text-sm">บันทึกชื่อจุด</button>
          </form>
        ))}
        <form className="grid gap-2 md:grid-cols-3" onSubmit={(event) => {
          event.preventDefault();
          const body = new FormData(event.currentTarget);
          start(async () => {
            const saved = await saveCleaningSpotAction({ branchCode: branch, stageCode: stage, spotNameTh: String(body.get("name") ?? ""), sortOrder: Number(body.get("sort") ?? 10) });
            if (saved.error || !saved.data.ok) toast.error(saved.error || "เพิ่มจุดไม่สำเร็จ");
            else { toast.success("เพิ่มจุดความสะอาดแล้ว"); event.currentTarget.reset(); reload(); }
          });
        }}>
          <input className={field} name="name" placeholder="ชื่อจุดใหม่ของสาขานี้" />
          <input className={field} name="sort" type="number" placeholder="ลำดับ" defaultValue={10} />
          <button className="rounded-md bg-[var(--fnb-brand)] px-3 py-2 text-sm text-white">เพิ่มจุด</button>
        </form>
      </article>
    </section>
  );
}

function ZoneEditor({ zone, branchCode, onSave }: { zone: FnbStorageZone | null; branchCode?: string; onSave: (input: { id?: string; branchCode: string; locationCode: string; locationNameTh: string; zoneType: string; defaultCountSchedule: string; countWeekdays: number[]; isDefaultGrTarget: boolean }) => void }) {
  const [days, setDays] = useState<number[]>(zone?.countWeekdays ?? []);
  return (
    <form className="grid gap-2 rounded-lg bg-slate-50 p-3 md:grid-cols-3" onSubmit={(event) => {
      event.preventDefault();
      const body = new FormData(event.currentTarget);
      onSave({
        id: zone?.id,
        branchCode: zone?.branchCode || branchCode || "",
        locationCode: String(body.get("code") ?? ""),
        locationNameTh: String(body.get("name") ?? ""),
        zoneType: String(body.get("zone") ?? "BACKROOM"),
        defaultCountSchedule: String(body.get("schedule") ?? "ON_DEMAND"),
        countWeekdays: days,
        isDefaultGrTarget: body.get("gr") === "on",
      });
    }}>
      <input className={field} name="code" defaultValue={zone?.locationCode ?? ""} placeholder="รหัสจุด เช่น LC-HDY-WH" required />
      <input className={field} name="name" defaultValue={zone?.locationNameTh ?? ""} placeholder="ชื่อจุดจัดเก็บ" required />
      <select className={field} name="zone" defaultValue={zone?.zoneType ?? "BACKROOM"}><option value="FRONT_DISPLAY">หน้าร้าน</option><option value="BACKROOM">คลังหลังร้าน</option><option value="WAREHOUSE">โกดัง</option></select>
      <select className={field} name="schedule" defaultValue={zone?.defaultCountSchedule ?? "WEEKLY_1X"}>{ZONE_SCHEDULES.map((key) => <option key={key} value={key}>{key === "DAILY_OPEN_CLOSE" ? "นับเปิดและปิดร้าน" : key === "DAILY_CLOSE" ? "นับทุกคืน" : key === "ON_DEMAND" ? "นับเมื่อเรียก" : FNB_BACKROOM_SCHEDULE_LABEL[key as keyof typeof FNB_BACKROOM_SCHEDULE_LABEL] ?? key}</option>)}</select>
      <label className="flex items-center gap-2 text-sm"><input name="gr" type="checkbox" defaultChecked={zone?.isDefaultGrTarget} />จุดรับเข้าเริ่มต้น</label>
      <div className="flex flex-wrap gap-2 text-xs md:col-span-3">{FNB_WEEKDAY_OPTIONS.map((day) => <label key={day.day}><input type="checkbox" checked={days.includes(day.day)} onChange={(event) => setDays((current) => event.target.checked ? [...current, day.day] : current.filter((value) => value !== day.day))} /> {day.label}</label>)}</div>
      <button className="rounded-md bg-[var(--fnb-brand)] px-3 py-2 text-sm text-white">{zone ? "บันทึกจุดนี้" : "เพิ่มจุดจัดเก็บ"}</button>
    </form>
  );
}
