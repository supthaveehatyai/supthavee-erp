"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { CleaningSpotBoard, StorageZoneBoard } from "@/components/fnb/branch-place-manager";
import { FnbQtyInput } from "@/components/fnb/fnb-qty-input";
import { listParLevelsAction, saveBranchShiftSettingsAction, saveDisplayShelfDaysAction, saveParLevelAction } from "@/lib/actions/fnb-sop";
import { listOpenShelfRulesAction, saveOpenShelfRuleAction } from "@/lib/actions/fnb-wip";
import type { FnbBranchOption, FnbBrandCode, FnbOpenShelfRule, FnbParLevelRow } from "@/types/fnb";

const field = "h-9 rounded-md border border-slate-200 px-2 text-sm";
type Tab = "shift" | "clean" | "zone" | "stock";
type CatalogItem = { id: string; short_code: string; name_th: string; item_category: string; count_uom: string; allow_decimal_count_qty: boolean; display_shelf_life_days: number | null };

function clock(value: string | null | undefined): string {
  return value ? value.slice(0, 5) : "";
}

export function SopSettingsWorkspace({
  branches,
  items,
  schemaMessage,
  brand,
}: {
  branches: FnbBranchOption[];
  items: CatalogItem[];
  schemaMessage: string | null;
  brand: FnbBrandCode;
}) {
  const [tab, setTab] = useState<Tab>("shift");
  const [branchCode, setBranchCode] = useState(branches[0]?.branch_code ?? "");
  const branch = branches.find((item) => item.branch_code === branchCode) ?? branches[0] ?? null;
  const tone = brand === "CHATORN" ? "bg-[#6B0F1A]" : "bg-[#DC2626]";
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">ตั้งค่าระเบียบหน้าร้าน & กะสาขา</h1>
          <p className="text-sm text-slate-500">{brand === "CHATORN" ? "🍷 ชาทรตะโหมด" : "🔴 Lucky Cup"}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {branches.map((item) => (
            <button key={item.branch_code} type="button" className={`rounded-full px-3 py-1 text-sm font-semibold ${item.branch_code === branch?.branch_code ? `${tone} text-white` : "bg-white ring-1 ring-slate-300"}`} onClick={() => setBranchCode(item.branch_code)}>{item.branch_code}</button>
          ))}
        </div>
      </div>
      {schemaMessage ? <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{schemaMessage}</p> : null}
      <div className="flex flex-wrap gap-2">
        <TabButton active={tab === "shift"} onClick={() => setTab("shift")}>⏰ กะทำงาน วงเงินเก๊ะ & เกณฑ์อุปกรณ์</TabButton>
        <TabButton active={tab === "clean"} onClick={() => setTab("clean")}>🧹 จุดตรวจความสะอาด & งานรอบสัปดาห์</TabButton>
        <TabButton active={tab === "zone"} onClick={() => setTab("zone")}>🏢 จุดจัดเก็บสินค้า & รอบนับสต็อก</TabButton>
        <TabButton active={tab === "stock"} onClick={() => setTab("stock")}>📦 จุดเตือนของใกล้หมด & อายุวัตถุดิบหลังเปิดใช้</TabButton>
      </div>
      {branch && tab === "shift" ? <ShiftCard key={branch.branch_code} branch={branch} /> : null}
      {branch && tab === "clean" ? <CleaningSpotBoard branch={branch.branch_code} siblingBranches={branches} /> : null}
      {branch && tab === "zone" ? <StorageZoneBoard branch={branch.branch_code} /> : null}
      {branch && tab === "stock" ? <StockTabs branch={branch.branch_code} brand={brand} items={items} /> : null}
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return <button type="button" className={`rounded-full px-3 py-1.5 text-sm ${active ? "bg-[var(--fnb-brand)] text-white" : "bg-white ring-1 ring-slate-200"}`} onClick={onClick}>{children}</button>;
}

function ShiftCard({ branch }: { branch: FnbBranchOption }) {
  const [shift3, setShift3] = useState(branch.enable_shift_3);
  const [busy, start] = useTransition();
  return (
    <form className="space-y-4" onSubmit={(event) => {
      event.preventDefault();
      const body = new FormData(event.currentTarget);
      body.set("enable_shift_3", shift3 ? "true" : "false");
      start(async () => {
        const saved = await saveBranchShiftSettingsAction(body);
        if (saved.error) toast.error(saved.error);
        else toast.success(`บันทึก ${branch.branch_code} แล้ว`);
      });
    }}>
      <input type="hidden" name="branch_code" value={branch.branch_code} />
      <article className="space-y-3 rounded-xl border bg-white p-4">
        <h2 className="font-semibold">ตั้งค่าเวลาและกะประจำสาขา {branch.branch_code}</h2>
        <div className="grid gap-3 md:grid-cols-5">
          <label className="text-xs">วงเงินสดตั้งต้นในเก๊ะ (บาท)<input className={`${field} w-32`} name="standard_cash_float" type="number" step="0.01" defaultValue={branch.standard_cash_float || 1200} /></label>
          <label className="text-xs">จำนวนพนักงานสูงสุดต่อกะ<input className={`${field} w-24`} name="max_staff_per_shift" type="number" min="1" max="6" step="1" defaultValue={branch.max_staff_per_shift || 2} /></label>
          <label className="text-xs">เวลาเปิดร้าน<input className={field} name="opening_time" type="time" defaultValue={clock(branch.opening_time) || "07:00"} /></label>
          <label className="text-xs">เวลาปิดร้าน<input className={field} name="closing_time" type="time" defaultValue={clock(branch.closing_time) || "20:30"} /></label>
          <label className="text-xs" title="ใช้คำนวณสถานะส่งตรงเวลา/ส่งสาย">เส้นตายส่งงานเปิดร้าน<input className={field} name="opening_deadline_time" type="time" defaultValue={clock(branch.opening_deadline_time) || "07:30"} /></label>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="flex flex-wrap items-center gap-2 text-sm"><span>☀️ กะเช้า (กะแรก)</span><label>เริ่ม<input className={field} name="shift_1_start" type="time" defaultValue={clock(branch.shift_1_start) || "07:00"} /></label><label>จบ<input className={field} name="shift_1_end" type="time" defaultValue={clock(branch.shift_1_end) || "13:30"} /></label></div>
          <div className="flex flex-wrap items-center gap-2 text-sm"><span>🌤️ กะบ่าย (กะสอง)</span><label>เริ่ม<input className={field} name="shift_2_start" type="time" defaultValue={clock(branch.shift_2_start) || "13:30"} /></label><label>จบ<input className={field} name="shift_2_end" type="time" defaultValue={clock(branch.shift_2_end) || "20:30"} /></label></div>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={shift3} onChange={(event) => setShift3(event.target.checked)} />🌙 เปิดใช้งานกะสาม (รอบดึก / เทศกาล)</label>
        {shift3 ? (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <label>กะสามเริ่ม<input className={field} name="shift_3_start" type="time" defaultValue={clock(branch.shift_3_start)} /></label>
            <label>กะสามจบ<input className={field} name="shift_3_end" type="time" defaultValue={clock(branch.shift_3_end)} /></label>
          </div>
        ) : null}
      </article>
      <article className="space-y-3 rounded-xl border bg-white p-4">
        <h2 className="font-semibold">เกณฑ์มาตรฐานอุปกรณ์ชงกาแฟประจำสาขา</h2>
        <div className="grid gap-3 md:grid-cols-3">
          <RangeBox title="โดสผงกาแฟบด (g)" minName="coffee_dose_min_g" maxName="coffee_dose_max_g" minValue={branch.coffee_dose_min_g ?? 19.8} maxValue={branch.coffee_dose_max_g ?? 20} step="0.1" />
          <RangeBox title="เวลาสกัดช็อต (วินาที)" minName="espresso_time_min_s" maxName="espresso_time_max_s" minValue={branch.espresso_time_min_s ?? 22} maxValue={branch.espresso_time_max_s ?? 28} step="1" />
          <RangeBox title="น้ำหนักน้ำกาแฟที่ได้ (g)" minName="espresso_yield_min_g" maxName="espresso_yield_max_g" minValue={branch.espresso_yield_min_g ?? 38} maxValue={branch.espresso_yield_max_g ?? 40} step="0.1" />
        </div>
      </article>
      <div className="flex justify-end"><button className="rounded-md bg-[var(--fnb-brand)] px-4 py-2 text-sm font-semibold text-white" disabled={busy}>{busy ? "กำลังบันทึก..." : "💾 บันทึกตั้งค่าสาขานี้"}</button></div>
    </form>
  );
}

function RangeBox({ title, minName, maxName, minValue, maxValue, step }: { title: string; minName: string; maxName: string; minValue: number; maxValue: number; step: string }) {
  return (
    <div className="rounded-lg bg-slate-50 p-3 text-sm">
      <p className="font-medium">{title}</p>
      <div className="mt-2 flex items-center gap-2">
        <label className="text-xs">ต่ำสุด<input className={`${field} w-24`} name={minName} type="number" step={step} defaultValue={minValue} /></label>
        <span>–</span>
        <label className="text-xs">สูงสุด<input className={`${field} w-24`} name={maxName} type="number" step={step} defaultValue={maxValue} /></label>
      </div>
    </div>
  );
}

function StockTabs({ branch, brand, items }: { branch: string; brand: FnbBrandCode; items: CatalogItem[] }) {
  const [sub, setSub] = useState<"par" | "shelf">("par");
  return (
    <section className="space-y-3">
      <div className="flex gap-2">
        <button type="button" className={`rounded-full px-3 py-1 text-sm ${sub === "par" ? "bg-[var(--fnb-brand)] text-white" : "bg-white ring-1 ring-slate-200"}`} onClick={() => setSub("par")}>📉 จุดเตือนของใกล้หมดรายสาขา (Min Par Levels)</button>
        <button type="button" className={`rounded-full px-3 py-1 text-sm ${sub === "shelf" ? "bg-[var(--fnb-brand)] text-white" : "bg-white ring-1 ring-slate-200"}`} onClick={() => setSub("shelf")}>⏱️ อายุซอสหลังเปิดใช้ & เบเกอรี่วางตู้โชว์ ({brand === "CHATORN" ? "ชาทรตะโหมด" : "Lucky Cup"})</button>
      </div>
      {sub === "par" ? <ParTable branch={branch} items={items.filter((item) => item.item_category === "RAW_MATERIAL" || item.item_category === "PACKAGING")} /> : <ShelfTable brand={brand} items={items} />}
    </section>
  );
}

function ParTable({ branch, items }: { branch: string; items: CatalogItem[] }) {
  const [pars, setPars] = useState<FnbParLevelRow[]>([]);
  const [category, setCategory] = useState("ALL");
  const [draft, setDraft] = useState<Record<string, { qty: string; alert: boolean }>>({});
  const [busy, start] = useTransition();
  useEffect(() => {
    void listParLevelsAction(branch).then((loaded) => setPars(loaded.data));
  }, [branch]);
  const saved = new Map(pars.map((row) => [row.item_id, row]));
  const shown = items.filter((item) => category === "ALL" || item.item_category === category);
  function valueOf(item: CatalogItem) {
    const row = saved.get(item.id);
    return draft[item.id] ?? { qty: row ? String(row.min_par_count_qty) : "", alert: row?.alert_enabled === true };
  }
  return (
    <article className="space-y-2 rounded-xl border bg-white p-3">
      <select className={`${field} w-48`} value={category} onChange={(event) => setCategory(event.target.value)}>
        <option value="ALL">ทุกหมวด</option>
        <option value="RAW_MATERIAL">วัตถุดิบ</option>
        <option value="PACKAGING">บรรจุภัณฑ์</option>
      </select>
      <table className="w-full text-left text-sm">
        <thead><tr className="text-xs text-slate-500"><th className="py-1">รหัส</th><th>ชื่อ</th><th>จุดเตือนขั้นต่ำ</th><th>แจ้งเตือน</th></tr></thead>
        <tbody>
          {shown.map((item) => {
            const value = valueOf(item);
            return (
              <tr key={item.id} className="border-t">
                <td className="py-1 font-semibold">{item.short_code}</td>
                <td>{item.name_th}</td>
                <td><FnbQtyInput value={value.qty} onChange={(qty) => setDraft((current) => ({ ...current, [item.id]: { qty, alert: value.alert } }))} unit={item.count_uom || "ชิ้น"} allowDecimal={item.allow_decimal_count_qty} /></td>
                <td><input type="checkbox" checked={value.alert} onChange={(event) => setDraft((current) => ({ ...current, [item.id]: { qty: value.qty, alert: event.target.checked } }))} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="flex justify-end">
        <button type="button" className="rounded-md bg-[var(--fnb-brand)] px-3 py-2 text-sm text-white" disabled={busy} onClick={() => start(async () => {
          const rows = shown.filter((item) => draft[item.id]);
          for (const item of rows) {
            const value = draft[item.id];
            const body = new FormData();
            body.set("branch_code", branch);
            body.set("item_id", item.id);
            body.set("min_par_count_qty", value.qty || "0");
            body.set("lead_time_days", String(saved.get(item.id)?.lead_time_days || 2));
            body.set("alert_enabled", value.alert ? "true" : "false");
            const savedRow = await saveParLevelAction(body);
            if (savedRow.error) { toast.error(savedRow.error); return; }
          }
          toast.success("บันทึกจุดเตือนทั้งหมดแล้ว");
          const listed = await listParLevelsAction(branch);
          setPars(listed.data);
          setDraft({});
        })}>{busy ? "กำลังบันทึก..." : "💾 บันทึกจุดเตือนทั้งหมด"}</button>
      </div>
    </article>
  );
}

function ShelfTable({ brand, items }: { brand: FnbBrandCode; items: CatalogItem[] }) {
  const [rules, setRules] = useState<FnbOpenShelfRule[]>([]);
  const [days, setDays] = useState<Record<string, string>>({});
  const [bakeryDays, setBakeryDays] = useState<Record<string, string>>({});
  const [busy, start] = useTransition();
  useEffect(() => {
    void listOpenShelfRulesAction().then((loaded) => {
      const visible = [...loaded.data.locked, ...loaded.data.rules].filter((rule) => {
        const sameBrand = rule.brand_code === brand || rule.brand_code === "ALL";
        const kept = rule.locked || rule.open_shelf_life_mode === "DAYS_AFTER_OPEN" || rule.open_shelf_life_mode === "HOURS_AFTER_OPEN" || rule.open_shelf_life_mode === "DAILY_EOD";
        return sameBrand && kept;
      });
      setRules(visible);
    });
  }, [brand]);
  const bakery = items.filter((item) => item.item_category === "BAKERY_FROZEN" || (item.display_shelf_life_days ?? 0) > 0);
  return (
    <article className="space-y-3 rounded-xl border bg-white p-3">
      <table className="w-full text-left text-sm">
        <thead><tr className="text-xs text-slate-500"><th className="py-1">รหัส</th><th>ชื่อ</th><th>อายุหลังเปิดใช้</th><th /></tr></thead>
        <tbody>
          {rules.map((rule) => {
            const key = `${rule.short_code}-${rule.brand_code}`;
            const locked = rule.locked || rule.open_shelf_life_mode === "DAILY_EOD" || !rule.item_id;
            return (
              <tr key={key} className="border-t">
                <td className="py-1 font-semibold">{rule.short_code}</td>
                <td>{rule.name_th}</td>
                <td>
                  {locked ? "เคลียร์สิ้นวัน" : (
                    <span className="inline-flex items-center gap-1">
                      <input className={`${field} w-16`} type="number" min="1" defaultValue={rule.open_shelf_life_value || 1} onChange={(event) => setDays((current) => ({ ...current, [key]: event.target.value }))} />
                      {rule.open_shelf_life_mode === "HOURS_AFTER_OPEN" ? "ชั่วโมง" : "วัน"}
                    </span>
                  )}
                </td>
                <td>{locked ? null : (
                  <button type="button" className="rounded-md border px-2 py-1 text-xs" disabled={busy} onClick={() => start(async () => {
                    const next = Number(days[key] || rule.open_shelf_life_value || 1);
                    const body = new FormData();
                    body.set("item_id", rule.item_id || "");
                    body.set("short_code", rule.short_code);
                    body.set("brand_code", rule.brand_code);
                    body.set("open_shelf_life_mode", rule.open_shelf_life_mode === "HOURS_AFTER_OPEN" ? "HOURS_AFTER_OPEN" : "DAYS_AFTER_OPEN");
                    body.set("open_shelf_life_value", String(next));
                    body.set("require_expiry_clear_photo", rule.require_expiry_clear_photo ? "true" : "false");
                    const saved = await saveOpenShelfRuleAction(body);
                    if (saved.error || !saved.data.ok) toast.error(saved.error || "บันทึกอายุไม่สำเร็จ");
                    else toast.success(`บันทึก ${rule.short_code} ${next} ${rule.open_shelf_life_mode === "HOURS_AFTER_OPEN" ? "ชั่วโมง" : "วัน"}`);
                  })}>บันทึก</button>
                )}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <h3 className="text-sm font-semibold">เบเกอรี่วางตู้โชว์</h3>
      <table className="w-full text-left text-sm">
        <tbody>
          {bakery.map((item) => (
            <tr key={item.id} className="border-t">
              <td className="py-1 font-semibold">{item.short_code}</td>
              <td>{item.name_th}</td>
              <td className="w-28"><input className={`${field} w-20`} type="number" min="1" defaultValue={item.display_shelf_life_days || 4} onChange={(event) => setBakeryDays((current) => ({ ...current, [item.id]: event.target.value }))} /> วัน</td>
              <td><button type="button" className="rounded-md border px-2 py-1 text-xs" disabled={busy} onClick={() => start(async () => {
                const saved = await saveDisplayShelfDaysAction(item.id, Number(bakeryDays[item.id] || item.display_shelf_life_days || 4));
                if (saved.error || !saved.data.ok) toast.error(saved.error || "บันทึกอายุเบเกอรี่ไม่สำเร็จ");
                else toast.success(`บันทึก ${item.short_code} แล้ว`);
              })}>บันทึก</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </article>
  );
}
