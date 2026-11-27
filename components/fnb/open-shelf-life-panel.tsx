"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { listOpenShelfRulesAction, saveOpenShelfRuleAction } from "@/lib/actions/fnb-wip";
import { FNB_OPEN_SHELF_MODES, type FnbOpenShelfMode, type FnbOpenShelfRule } from "@/types/fnb";

const field = "h-10 w-full rounded-md border border-slate-200 px-3 text-sm";
const MODE_LABEL: Record<FnbOpenShelfMode, string> = {
  DAILY_EOD: "บังคับเคลียร์ทิ้งปิดร้านทุกวัน",
  HOURS_AFTER_OPEN: "นับจำนวนชั่วโมงหลังเปิด",
  DAYS_AFTER_OPEN: "นับจำนวนวันหลังเปิด",
  NONE: "ไม่จับเวลาหลังเปิด",
};
const PINNED = ["SB", "MB", "MK", "CMK", "WMK", "CJ", "PF", "SYR", "G", "X", "BS", "CS"];

export function OpenShelfLifePanel() {
  const [locked, setLocked] = useState<FnbOpenShelfRule[]>([]);
  const [rules, setRules] = useState<FnbOpenShelfRule[]>([]);
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("");
  const [pending, start] = useTransition();

  function reload() {
    void listOpenShelfRulesAction().then((loaded) => {
      setLocked(loaded.data.locked);
      setRules(loaded.data.rules);
      if (loaded.error) setMessage(loaded.error);
    });
  }

  useEffect(() => { reload(); }, []);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rules
      .filter((row) => !needle || `${row.short_code} ${row.name_th}`.toLowerCase().includes(needle))
      .sort((left, right) => Number(PINNED.includes(right.short_code)) - Number(PINNED.includes(left.short_code)) || left.short_code.localeCompare(right.short_code));
  }, [query, rules]);

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">อายุวัตถุดิบหลังเปิดใช้ / หลังผสม (แยกแบรนด์)</h2>
      {message ? <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{message}</p> : null}
      <div className="grid gap-2 md:grid-cols-5">
        {locked.map((row) => (
          <article key={row.short_code} className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm">
            <p className="font-semibold">{row.short_code}</p>
            <p>{row.name_th}</p>
            <p className="mt-1 text-red-800">บังคับเคลียร์เททิ้งตอนปิดร้านทุกวัน (1 วัน / DAILY_EOD)</p>
          </article>
        ))}
      </div>
      <input className={field} value={query} placeholder="ค้นหาวัตถุดิบ เช่น แยม นม วิปครีม ไซรัป" onChange={(event) => setQuery(event.target.value)} />
      <div className="space-y-3">
        {visible.slice(0, 40).map((row) => (
          <form key={`${row.item_id}-${row.brand_code}-${row.id ?? "new"}`} className="grid gap-2 rounded-xl border bg-white p-3 md:grid-cols-5" onSubmit={(event) => {
            event.preventDefault();
            const body = new FormData(event.currentTarget);
            body.set("require_expiry_clear_photo", body.get("require_expiry_clear_photo") ? "true" : "false");
            start(async () => {
              const saved = await saveOpenShelfRuleAction(body);
              if (saved.error) { toast.error(saved.error); setMessage(saved.error); return; }
              toast.success(`บันทึกอายุ ${row.short_code} แล้ว`);
              setMessage(`บันทึกอายุ ${row.short_code} แล้ว`);
              reload();
            });
          }}>
            <input type="hidden" name="item_id" value={row.item_id ?? ""} />
            <input type="hidden" name="short_code" value={row.short_code} />
            <p className="text-sm font-medium">{row.short_code} {row.name_th}</p>
            <select className={field} name="brand_code" defaultValue={row.brand_code}>
              <option value="LUCKY_CUP">Lucky Cup</option>
              <option value="CHATORN">ชาทรตะโหมด</option>
            </select>
            <select className={field} name="open_shelf_life_mode" defaultValue={row.open_shelf_life_mode}>
              {FNB_OPEN_SHELF_MODES.map((mode) => <option key={mode} value={mode}>{MODE_LABEL[mode]}</option>)}
            </select>
            <input className={field} name="open_shelf_life_value" type="number" min={0} defaultValue={row.open_shelf_life_value} placeholder="ชั่วโมงหรือวัน" />
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="require_expiry_clear_photo" defaultChecked={row.require_expiry_clear_photo} />บังคับชั่งของเหลือและถ่ายรูปสดเมื่อครบอายุ</label>
            <button className="rounded-md bg-[var(--fnb-brand)] px-3 py-2 text-sm text-white" disabled={pending}>{pending ? "กำลังบันทึก..." : "บันทึกกฎนี้"}</button>
          </form>
        ))}
      </div>
    </div>
  );
}
