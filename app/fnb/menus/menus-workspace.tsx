"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { copyBrandStarterAction, copyMenuToChatornAction, getBomUsageForecastAction, saveMenuAction, saveMenuBomAction, savePrepBaseAction } from "@/lib/actions/fnb-menus";
import { FNB_SCOOP_HINTS, type FnbBomCatalogItem, type FnbBomVarianceRow, type FnbBranchOption, type FnbMenuBomLineRow, type FnbMenuRow, type FnbPrepBaseCost, type FnbPrepBaseRow } from "@/types/fnb";

const field = "h-10 w-full rounded-md border border-slate-200 px-3 text-sm";

export function MenusWorkspace({
  bases,
  menus,
  lines,
  catalog,
  prepCosts,
  branches,
  brand,
  isSuperAdmin = false,
  canViewCost = false,
}: {
  bases: FnbPrepBaseRow[];
  menus: FnbMenuRow[];
  lines: FnbMenuBomLineRow[];
  catalog: FnbBomCatalogItem[];
  prepCosts: FnbPrepBaseCost[];
  branches: FnbBranchOption[];
  brand: "LUCKY_CUP" | "CHATORN";
  isSuperAdmin?: boolean;
  canViewCost?: boolean;
}) {
  const [tab, setTab] = useState<"bom" | "forecast">("bom");
  const [message, setMessage] = useState("");
  const [pending, start] = useTransition();
  const [pendingOnly, setPendingOnly] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const visible = menus.filter((menu) => menu.brand_code === brand);
  const pendingCount = visible.filter((menu) => menu.is_bom_pending).length;
  const shown = pendingOnly ? visible.filter((menu) => menu.is_bom_pending) : visible;
  const visibleBases = bases.filter((base) => base.brand_code === brand);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-slate-900">เมนู สูตรชง และเบส</h1>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={`rounded-full px-3 py-1 text-sm ${tab === "bom" ? "bg-[var(--fnb-brand)] text-white" : "bg-white"}`} onClick={() => setTab("bom")}>🍹 ทะเบียนเมนู ต้นทุนต่อแก้ว & ปรับปรุงสูตรชง (BOM & Tolerance %)</button>
        <button type="button" className={`rounded-full px-3 py-1 text-sm ${tab === "forecast" ? "bg-[var(--fnb-brand)] text-white" : "bg-white"}`} onClick={() => setTab("forecast")}>📈 คาดการณ์การเบิกวัตถุดิบ & เทียบต้นทุนตามสูตร vs ใช้จริง</button>
      </div>
      {tab === "forecast" ? <ForecastPanel branches={branches} canViewCost={canViewCost} /> : null}
      {tab === "bom" ? <>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={`rounded-full px-3 py-1 text-xs ${pendingOnly ? "bg-amber-500 text-white" : "bg-amber-100 text-amber-950"}`} onClick={() => setPendingOnly((value) => !value)}>🆕 เมนูใหม่จากสลิป POS รอผูกสูตร ({pendingCount})</button>
        {FNB_SCOOP_HINTS.map((hint) => <span key={hint} className="rounded-full bg-red-50 px-3 py-1 text-xs text-red-800">{hint}</span>)}
      </div>
      {message ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{message}</p> : null}
      <form className="grid gap-2 rounded-xl border bg-white p-4 md:grid-cols-5" onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        start(async () => {
          const saved = await savePrepBaseAction({
            base_code: String(form.get("base_code") ?? ""),
            brand_code: brand,
            base_name_th: String(form.get("base_name_th") ?? ""),
            yield_qty_ml: Number(form.get("yield_qty_ml") ?? 0),
            shelf_life_hours: Number(form.get("shelf_life_hours") ?? 0),
          });
          setMessage(saved.error ?? "บันทึกเบสแล้ว");
        });
      }}>
        <label className="text-sm">รหัสเบส<input className={field} name="base_code" placeholder="JT / BT / MMK / ML" required /></label>
        <label className="text-sm">ชื่อเบส<input className={field} name="base_name_th" required /></label>
        <label className="text-sm">ปริมาตรที่ได้ (ml)<input className={field} name="yield_qty_ml" type="number" /></label>
        <label className="text-sm">อายุหลังต้ม (ชม.)<input className={field} name="shelf_life_hours" type="number" /></label>
        <button className="rounded-md bg-[var(--fnb-brand)] px-4 py-2 text-sm text-white" disabled={pending}>บันทึกเบส</button>
      </form>
      <div className="grid gap-2 md:grid-cols-3">
        {visibleBases.map((base) => <article key={`${base.brand_code}-${base.base_code}`} className="rounded-lg border bg-white p-3 text-sm"><p className="font-semibold">{base.base_code}</p><p>{base.base_name_th}</p><p className="text-slate-500">{base.yield_qty_ml} ml</p></article>)}
      </div>
      {isSuperAdmin ? <button type="button" className="rounded-md border border-[var(--fnb-brand)] px-3 py-2 text-sm text-[var(--fnb-brand)]" disabled={pending} onClick={() => start(async () => {
        const saved = await copyBrandStarterAction(brand, brand === "LUCKY_CUP" ? "CHATORN" : "LUCKY_CUP");
        setMessage(saved.error ?? `คัดลอกเบส ${saved.data.bases} รายการ และเมนู ${saved.data.menus} รายการไปอีกแบรนด์แล้ว`);
      })}>คัดลอกรายการตั้งต้นไปยังอีกแบรนด์ (สร้างชุดข้อมูลแยกอิสระ)</button> : null}
      <form className="grid gap-2 rounded-xl border bg-white p-4 md:grid-cols-3" onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        start(async () => {
          const saved = await saveMenuAction({
            brand_code: brand,
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
        <label className="text-sm">รหัสเมนู<input className={field} name="menu_code" required /></label>
        <label className="text-sm">ชื่อเมนู<input className={field} name="menu_name_th" required /></label>
        <select className={field} name="cup_size"><option>R</option><option>L</option><option>16A</option><option>SINGLE</option></select>
        <select className={field} name="temperature"><option>ICE</option><option>HOT</option><option>FRAPPE</option><option>READY</option></select>
        <input className={field} name="retail_price" type="number" step="0.01" placeholder="ราคา" />
        <select className={field} name="component_type"><option value="RAW_ITEM">วัตถุดิบ</option><option value="PREP_BASE">เบส</option></select>
        <label className="text-sm">วัตถุดิบตั้งต้น / รหัสเบส<input className={field} name="prep_base_code" placeholder="JT" /></label>
        <label className="text-sm">ปริมาณที่ใช้<input className={field} name="usage_qty" type="number" step="0.01" /></label>
        <input className={field} name="usage_uom" placeholder="g / ml" defaultValue="g" />
        <button className="rounded-md bg-[var(--fnb-brand)] px-4 py-2 text-sm text-white" disabled={pending}>บันทึกเมนู</button>
      </form>
      <div className="space-y-3">
        {groupMenus(shown).map(([category, rows]) => (
          <section key={category} className="space-y-2">
            <h2 className="font-semibold">{category}</h2>
            {rows.map((menu) => {
              const cost = menu.theoretical_cost_thb;
              const margin = canViewCost && cost != null && menu.retail_price > 0 ? ((menu.retail_price - cost) / menu.retail_price) * 100 : null;
              return (
                <article key={menu.id} className="rounded-lg border bg-white p-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="font-semibold">{menu.menu_code} · {menu.menu_name_th}{menu.is_bom_pending ? " · 🆕 รอผูกสูตร" : ""}</p>
                      <p className="text-xs text-slate-500">{menu.cup_size} {menu.temperature} · ราคาขาย {menu.retail_price.toFixed(2)}{canViewCost && cost != null ? ` · ต้นทุนวัตถุดิบ + บรรจุภัณฑ์ต่อแก้ว ${cost.toFixed(2)} ฿ · กำไรขั้นต้นมาตรฐาน ${margin?.toFixed(1)}%` : ""}</p>
                    </div>
                    <div className="flex gap-2">
                      <button type="button" className="rounded-md border px-3 py-1 text-sm" onClick={() => setEditing(editing === menu.id ? null : menu.id)}>ปรับสูตร</button>
                      {menu.brand_code === "LUCKY_CUP" ? (
                        <button className="rounded-md border px-3 py-1 text-sm" disabled={pending} onClick={() => start(async () => {
                          const copied = await copyMenuToChatornAction(menu.id);
                          setMessage(copied.error ?? `คัดลอกเป็น ${copied.data.menu_code}`);
                        })}>คัดลอกโครงสร้างไปปรับใช้กับชาทรตะโหมด</button>
                      ) : null}
                    </div>
                  </div>
                  <ul className="mt-2 text-sm text-slate-600">
                    {lines.filter((line) => line.menu_id === menu.id).map((line) => (
                      <li key={line.id}>{line.is_packaging ? "บรรจุภัณฑ์" : line.component_type} {line.prep_base_code ?? catalog.find((item) => item.id === line.item_id)?.short_code ?? line.item_id} {line.usage_qty} {line.usage_uom} · ±{line.line_tolerance_pct}%</li>
                    ))}
                  </ul>
                  {editing === menu.id ? <BomEditor menuId={menu.id} lines={lines.filter((line) => line.menu_id === menu.id)} catalog={catalog} bases={visibleBases} pending={pending} onSave={(next) => start(async () => {
                    const saved = await saveMenuBomAction({ menu_id: menu.id, lines: next });
                    if (saved.error) toast.error(saved.error);
                    else toast.success("บันทึกสูตรแล้ว");
                    setMessage(saved.error ?? "บันทึกสูตรแล้ว");
                    if (!saved.error) setEditing(null);
                  })} /> : null}
                </article>
              );
            })}
          </section>
        ))}
      </div>
      </> : null}
    </div>
  );
}

function groupMenus(menus: FnbMenuRow[]): [string, FnbMenuRow[]][] {
  const groups = new Map<string, FnbMenuRow[]>();
  for (const menu of menus) {
    const key = menu.menu_category || "ไม่ระบุหมวด";
    groups.set(key, [...(groups.get(key) ?? []), menu]);
  }
  return [...groups.entries()];
}

function BomEditor(props: {
  menuId: string;
  lines: FnbMenuBomLineRow[];
  catalog: FnbBomCatalogItem[];
  bases: FnbPrepBaseRow[];
  pending: boolean;
  onSave: (lines: { component_type: string; item_id: string; prep_base_code: string; usage_qty: number; usage_uom: string; line_tolerance_pct: number; is_packaging: boolean }[]) => void;
}) {
  const [rows, setRows] = useState(props.lines.map((line) => ({
    component_type: line.component_type || "RAW_ITEM",
    item_id: line.item_id ?? "",
    prep_base_code: line.prep_base_code ?? "",
    usage_qty: String(line.usage_qty),
    usage_uom: line.usage_uom || "g",
    line_tolerance_pct: String(line.line_tolerance_pct || 5),
    is_packaging: line.is_packaging,
  })));
  return (
    <div className="mt-3 space-y-2 rounded-lg bg-slate-50 p-3">
      {rows.map((row, index) => (
        <div key={`${props.menuId}-${index}`} className="grid gap-2 md:grid-cols-6">
          <select className={field} value={row.component_type} onChange={(event) => setRows((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, component_type: event.target.value } : item))}>
            <option value="RAW_ITEM">วัตถุดิบ</option>
            <option value="PREP_BASE">เบส</option>
          </select>
          {row.component_type === "PREP_BASE" ? (
            <select className={field} value={row.prep_base_code} onChange={(event) => setRows((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, prep_base_code: event.target.value } : item))}>{props.bases.map((base) => <option key={base.base_code} value={base.base_code}>{base.base_code}</option>)}</select>
          ) : (
            <select className={field} value={row.item_id} onChange={(event) => setRows((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, item_id: event.target.value } : item))}>{props.catalog.map((item) => <option key={item.id} value={item.id}>{item.short_code} {item.name_th}</option>)}</select>
          )}
          <input className={field} type="number" step="0.01" value={row.usage_qty} onChange={(event) => setRows((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, usage_qty: event.target.value } : item))} />
          <input className={field} value={row.usage_uom} onChange={(event) => setRows((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, usage_uom: event.target.value } : item))} />
          <input className={field} type="number" step="0.1" value={row.line_tolerance_pct} onChange={(event) => setRows((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, line_tolerance_pct: event.target.value } : item))} />
          <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={row.is_packaging} onChange={(event) => setRows((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, is_packaging: event.target.checked } : item))} />บรรจุภัณฑ์</label>
        </div>
      ))}
      <button type="button" className="text-sm text-[var(--fnb-brand)]" onClick={() => setRows((current) => [...current, { component_type: "RAW_ITEM", item_id: props.catalog[0]?.id ?? "", prep_base_code: props.bases[0]?.base_code ?? "", usage_qty: "", usage_uom: "g", line_tolerance_pct: "5", is_packaging: false }])}>เพิ่มบรรทัดสูตร</button>
      <button type="button" className="rounded-md bg-[var(--fnb-brand)] px-3 py-2 text-sm text-white" disabled={props.pending} onClick={() => props.onSave(rows.map((row) => ({ ...row, usage_qty: Number(row.usage_qty) || 0, line_tolerance_pct: Number(row.line_tolerance_pct) || 0 })))}>บันทึกสูตรนี้</button>
    </div>
  );
}

function ForecastPanel({ branches, canViewCost }: { branches: FnbBranchOption[]; canViewCost: boolean }) {
  const today = useMemo(() => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date()), []);
  const [branch, setBranch] = useState(branches[0]?.branch_code ?? "");
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [days, setDays] = useState(7);
  const [rows, setRows] = useState<FnbBomVarianceRow[]>([]);
  const [pending, start] = useTransition();
  return (
    <section className="space-y-3 rounded-xl border bg-white p-4">
      <div className="grid gap-2 md:grid-cols-5">
        <select className={field} value={branch} onChange={(event) => setBranch(event.target.value)}>{branches.map((item) => <option key={item.branch_code} value={item.branch_code}>{item.branch_code}</option>)}</select>
        <input className={field} type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
        <input className={field} type="date" value={to} onChange={(event) => setTo(event.target.value)} />
        <select className={field} value={days} onChange={(event) => setDays(Number(event.target.value))}>{[3, 7, 14].map((value) => <option key={value} value={value}>คาดการณ์ {value} วัน</option>)}</select>
        <button type="button" className="rounded-md bg-[var(--fnb-brand)] px-3 py-2 text-sm text-white" disabled={pending} onClick={() => start(async () => {
          const loaded = await getBomUsageForecastAction({ branch_code: branch, from_date: from, to_date: to, forecast_days: days });
          if (loaded.error) toast.error(loaded.error);
          setRows(loaded.data.items);
        })}>คำนวณ</button>
      </div>
      <button type="button" className="rounded-md border px-3 py-1 text-sm" onClick={() => {
        const sheet = XLSX.utils.json_to_sheet(rows.map((row) => ({
          รหัส: row.short_code,
          ชื่อ: row.name_th,
          หน่วย: row.count_uom,
          ตามสูตร: row.theoretical_recipe_qty,
          ใช้จริง: row.actual_used_recipe_qty,
          "ส่วนต่าง%": row.variance_pct,
          เกินกรอบ: row.is_over_tolerance ? "ใช่" : "",
          คงเหลือ: row.on_hand_count_qty,
          "ควรสั่ง": row.recommended_order_count_qty,
          ...(canViewCost ? { ทุนตามสูตร: row.theoretical_cost_thb, ทุนใช้จริง: row.actual_cost_thb } : {}),
        })));
        const book = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(book, sheet, "Forecast");
        XLSX.writeFile(book, `fnb-bom-forecast-${branch}.xlsx`);
      }}>ดาวน์โหลด .xlsx</button>
      <div className="overflow-auto">
        <table className="min-w-full text-sm">
          <thead><tr className="text-left"><th className="p-2">รหัส</th><th>ชื่อ</th><th>ตามสูตร</th><th>ใช้จริง</th><th>ส่วนต่าง</th><th>คงเหลือ</th><th>ควรสั่ง</th></tr></thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.item_id} className={row.is_over_tolerance ? "bg-red-50" : ""}>
                <td className="p-2">{row.short_code}</td>
                <td>{row.name_th}</td>
                <td>{row.theoretical_recipe_qty}</td>
                <td>{row.actual_used_recipe_qty}</td>
                <td>{row.variance_pct}% {row.is_over_tolerance ? `เกิน ±${row.tolerance_pct}%` : ""}</td>
                <td>{row.on_hand_count_qty} {row.count_uom}</td>
                <td>{row.recommended_order_count_qty} {row.count_uom}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
