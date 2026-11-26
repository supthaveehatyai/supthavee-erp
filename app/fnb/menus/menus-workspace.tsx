"use client";

import { useState, useTransition } from "react";
import { copyMenuToChatornAction, saveMenuAction, savePrepBaseAction } from "@/lib/actions/fnb-menus";
import { FNB_SCOOP_HINTS, type FnbMenuBomLineRow, type FnbMenuRow, type FnbPrepBaseRow } from "@/types/fnb";

const field = "h-10 w-full rounded-md border border-slate-200 px-3 text-sm";

export function MenusWorkspace({
  bases,
  menus,
  lines,
}: {
  bases: FnbPrepBaseRow[];
  menus: FnbMenuRow[];
  lines: FnbMenuBomLineRow[];
}) {
  const [message, setMessage] = useState("");
  const [pending, start] = useTransition();
  const [brand, setBrand] = useState("LUCKY_CUP");
  const visible = menus.filter((menu) => menu.brand_code === brand);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-slate-900">เมนู สูตรชง และเบส</h1>
      <div className="flex flex-wrap gap-2">
        {FNB_SCOOP_HINTS.map((hint) => <span key={hint} className="rounded-full bg-red-50 px-3 py-1 text-xs text-red-800">{hint}</span>)}
      </div>
      {message ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{message}</p> : null}
      <form className="grid gap-2 rounded-xl border bg-white p-4 md:grid-cols-5" onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        start(async () => {
          const saved = await savePrepBaseAction({
            base_code: String(form.get("base_code") ?? ""),
            brand_code: String(form.get("brand_code") ?? "ALL"),
            base_name_th: String(form.get("base_name_th") ?? ""),
            yield_qty_ml: Number(form.get("yield_qty_ml") ?? 0),
            shelf_life_hours: Number(form.get("shelf_life_hours") ?? 0),
          });
          setMessage(saved.error ?? "บันทึกเบสแล้ว");
        });
      }}>
        <input className={field} name="base_code" placeholder="JT / BT / MMK / ML / CCF" required />
        <input className={field} name="base_name_th" placeholder="ชื่อเบส" required />
        <select className={field} name="brand_code" defaultValue="ALL"><option>ALL</option><option>LUCKY_CUP</option><option>CHATORN</option></select>
        <input className={field} name="yield_qty_ml" type="number" placeholder="ได้กี่ ml" />
        <input className={field} name="shelf_life_hours" type="number" placeholder="อายุชม." />
        <button className="rounded-md bg-red-700 px-4 py-2 text-sm text-white" disabled={pending}>บันทึกเบส</button>
      </form>
      <div className="grid gap-2 md:grid-cols-3">
        {bases.map((base) => <article key={base.base_code} className="rounded-lg border bg-white p-3 text-sm"><p className="font-semibold">{base.base_code}</p><p>{base.base_name_th}</p><p className="text-slate-500">{base.yield_qty_ml} ml</p></article>)}
      </div>
      <div className="flex gap-2">
        <button type="button" className={`rounded-full px-3 py-1 text-sm ${brand === "LUCKY_CUP" ? "bg-red-700 text-white" : "bg-white ring-1 ring-red-200"}`} onClick={() => setBrand("LUCKY_CUP")}>Lucky Cup</button>
        <button type="button" className={`rounded-full px-3 py-1 text-sm ${brand === "CHATORN" ? "bg-red-700 text-white" : "bg-white ring-1 ring-red-200"}`} onClick={() => setBrand("CHATORN")}>ชาทรตะโหมด</button>
      </div>
      <form className="grid gap-2 rounded-xl border bg-white p-4 md:grid-cols-3" onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        start(async () => {
          const saved = await saveMenuAction({
            brand_code: String(form.get("brand_code") ?? "LUCKY_CUP"),
            menu_code: String(form.get("menu_code") ?? ""),
            menu_name_th: String(form.get("menu_name_th") ?? ""),
            cup_size: String(form.get("cup_size") ?? "R"),
            temperature: String(form.get("temperature") ?? "ICE"),
            retail_price: Number(form.get("retail_price") ?? 0),
            bom: [{
              component_type: String(form.get("component_type") ?? "RAW_ITEM"),
              item_id: String(form.get("item_id") ?? ""),
              prep_base_code: String(form.get("prep_base_code") ?? ""),
              usage_qty: Number(form.get("usage_qty") ?? 0),
              usage_uom: String(form.get("usage_uom") ?? "g"),
            }],
          });
          setMessage(saved.error ?? "บันทึกเมนูแล้ว");
        });
      }}>
        <select className={field} name="brand_code"><option>LUCKY_CUP</option><option>CHATORN</option></select>
        <input className={field} name="menu_code" placeholder="รหัสเมนู" required />
        <input className={field} name="menu_name_th" placeholder="ชื่อเมนู" required />
        <select className={field} name="cup_size"><option>R</option><option>L</option><option>16A</option><option>SINGLE</option></select>
        <select className={field} name="temperature"><option>ICE</option><option>HOT</option><option>FRAPPE</option><option>READY</option></select>
        <input className={field} name="retail_price" type="number" step="0.01" placeholder="ราคา" />
        <select className={field} name="component_type"><option value="RAW_ITEM">วัตถุดิบ</option><option value="PREP_BASE">เบส</option></select>
        <input className={field} name="prep_base_code" placeholder="รหัสเบส เช่น JT" />
        <input className={field} name="usage_qty" type="number" step="0.01" placeholder="ปริมาณต่อแก้ว" />
        <input className={field} name="usage_uom" placeholder="g / ml" defaultValue="g" />
        <button className="rounded-md bg-red-700 px-4 py-2 text-sm text-white" disabled={pending}>บันทึกเมนู</button>
      </form>
      <div className="space-y-2">
        {visible.map((menu) => (
          <article key={menu.id} className="rounded-lg border bg-white p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-semibold">{menu.menu_code} · {menu.menu_name_th}</p>
                <p className="text-xs text-slate-500">{menu.cup_size} {menu.temperature} · {menu.retail_price.toFixed(2)}</p>
              </div>
              {menu.brand_code === "LUCKY_CUP" ? (
                <button className="rounded-md border px-3 py-1 text-sm" disabled={pending} onClick={() => start(async () => {
                  const copied = await copyMenuToChatornAction(menu.id);
                  setMessage(copied.error ?? `คัดลอกเป็น ${copied.data.menu_code}`);
                })}>คัดลอกโครงสร้างไปปรับใช้กับชาทรตะโหมด</button>
              ) : null}
            </div>
            <ul className="mt-2 text-sm text-slate-600">
              {lines.filter((line) => line.menu_id === menu.id).map((line) => (
                <li key={line.id}>{line.component_type} {line.prep_base_code ?? line.item_id} {line.usage_qty} {line.usage_uom}</li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </div>
  );
}
