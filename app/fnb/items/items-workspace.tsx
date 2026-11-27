"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { OpenShelfLifePanel } from "@/components/fnb/open-shelf-life-panel";
import { commitFnbPriceExcelAction, previewFnbPriceExcelAction, saveFnbItemAction, saveFnbVendorPackAction } from "@/lib/actions/fnb-items";
import { itemMatches } from "@/lib/fnb/item-search";
import { FNB_BACKROOM_SCHEDULE_LABEL, FNB_BACKROOM_SCHEDULES, FNB_CATEGORY_LABEL, FNB_FRONT_GROUPS, FNB_ITEM_CATEGORIES, FNB_RECIPE_UOMS, FNB_VAT_MODES, FNB_WEEKDAY_OPTIONS, type FnbExcelPriceRow, type FnbItemRow, type FnbVendorPackRow } from "@/types/fnb";

const field = "h-10 w-full rounded-md border border-slate-200 px-3 text-sm";

export function ItemsWorkspace({ items, packs, initialTab = "items", brand }: { items: FnbItemRow[]; packs: FnbVendorPackRow[]; initialTab?: string; brand: "LUCKY_CUP" | "CHATORN" }) {
  const [tab, setTab] = useState(initialTab === "shelf" ? "shelf" : "items");
  const [category, setCategory] = useState("ALL");
  const [selected, setSelected] = useState(items[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const [preview, setPreview] = useState<FnbExcelPriceRow[]>([]);
  const [message, setMessage] = useState("");
  const [pending, start] = useTransition();
  const visible = useMemo(
    () => items.filter((item) => item.brand_scope === brand && (category === "ALL" || item.item_category === category) && itemMatches(query, item)),
    [items, brand, category, query],
  );
  const item = items.find((row) => row.id === selected) ?? null;
  const itemPacks = packs.filter((pack) => pack.item_id === selected);
  useEffect(() => {
    const block = (event: DragEvent) => event.preventDefault();
    window.addEventListener("dragover", block);
    window.addEventListener("drop", block);
    return () => {
      window.removeEventListener("dragover", block);
      window.removeEventListener("drop", block);
    };
  }, []);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-slate-900">วัตถุดิบหลายแหล่งซื้อ</h1>
      {message ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{message}</p> : null}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={`rounded-full px-3 py-1.5 text-sm ${tab === "items" ? "bg-[var(--fnb-brand)] text-white" : "bg-white ring-1 ring-red-200"}`} onClick={() => setTab("items")}>รายการวัตถุดิบ</button>
        <button type="button" className={`rounded-full px-3 py-1.5 text-sm ${tab === "shelf" ? "bg-[var(--fnb-brand)] text-white" : "bg-white ring-1 ring-red-200"}`} onClick={() => setTab("shelf")}>อายุวัตถุดิบหลังเปิดใช้ / หลังผสม (แยกแบรนด์)</button>
      </div>
      {tab === "shelf" ? <OpenShelfLifePanel /> : null}
      {tab === "items" ? <>
      <div className="flex flex-wrap gap-2">
        <input className={field} value={query} placeholder="ค้นรหัสย่อ รหัสเรียก รหัสคลัง หรือชื่อ" onChange={(event) => setQuery(event.target.value)} />
        <select className={field} value={category} onChange={(event) => setCategory(event.target.value)}>
          <option value="ALL">ทุกหมวด</option>
          {FNB_ITEM_CATEGORIES.map((key) => <option key={key} value={key}>{FNB_CATEGORY_LABEL[key]}</option>)}
        </select>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="max-h-[32rem] space-y-2 overflow-auto">
          {visible.map((row) => (
            <button key={row.id} type="button" onClick={() => setSelected(row.id)} className={`block w-full rounded-lg border p-3 text-left ${row.id === selected ? "border-red-700 bg-red-50" : "border-slate-200 bg-white"}`}>
              <p className="font-semibold">{row.short_code}{row.alias_codes?.length ? ` / ${row.alias_codes.join(" ")}` : ""} · {row.name_th}</p>
              <p className="text-xs text-slate-500">{row.brand_scope} · อายุ {row.shelf_life_months ?? "-"} เดือน · ราคา {row.reference_purchase_price.toFixed(2)} · {row.requires_expiry_tracking ? "ต้องคุมวันหมดอายุ" : "ไม่คุมวันหมดอายุ"}</p>
            </button>
          ))}
        </div>
        <div className="space-y-4">
          <ItemForm item={item} brand={brand} pending={pending} start={start} setMessage={setMessage} />
          {item ? <PackForm itemId={item.id} packs={itemPacks} pending={pending} start={start} setMessage={setMessage} /> : null}
        </div>
      </div>
      <section
        className="rounded-xl border border-dashed border-red-200 bg-white p-4"
        onDragOver={(event) => { event.preventDefault(); event.stopPropagation(); }}
        onDrop={(event) => {
          event.preventDefault();
          event.stopPropagation();
          const file = event.dataTransfer.files?.[0];
          if (file) readExcel(file);
        }}
      >
        <h2 className="font-semibold">นำเข้าราคา Excel Lucky Cup</h2>
        <input className="mt-2 text-sm" type="file" accept=".xlsx,.xls" onChange={(event) => { const file = event.target.files?.[0]; if (file) readExcel(file); }} />
        {preview.length > 0 ? (
          <div className="mt-3 space-y-2">
            {preview.slice(0, 20).map((row) => <p key={row.external_code} className="text-sm">{row.action === "insert" ? "ใหม่" : "อัปเดต"} {row.external_code} {row.unit_price.toFixed(2)}</p>)}
            <button className="rounded-md bg-[var(--fnb-brand)] px-4 py-2 text-sm text-white disabled:opacity-60" disabled={pending} onClick={() => start(async () => {
              const saved = await commitFnbPriceExcelAction(preview);
              if (saved.error) toast.error(saved.error);
              else toast.success(`ยืนยันอัปเดตราคา ${saved.data.saved} รายการแล้ว`);
              setMessage(saved.error ?? `บันทึก ${saved.data.saved} รายการ`);
            })}>{pending ? "กำลังบันทึก..." : "ยืนยันอัปเดตราคา"}</button>
          </div>
        ) : null}
      </section>
      </> : null}
    </div>
  );

  function readExcel(file: File) {
    const body = new FormData();
    body.set("file", file);
    start(async () => {
      const parsed = await previewFnbPriceExcelAction(body);
      setPreview(parsed.data);
      if (parsed.error) toast.error(parsed.error);
      else toast.success(`อ่านได้ ${parsed.data.length} รายการ`);
      setMessage(parsed.error ?? `พบ ${parsed.data.length} รหัส`);
    });
  }
}

function ItemForm({
  item,
  brand,
  pending,
  start,
  setMessage,
}: {
  item: FnbItemRow | null;
  brand: "LUCKY_CUP" | "CHATORN";
  pending: boolean;
  start: (callback: () => void) => void;
  setMessage: (message: string) => void;
}) {
  return (
    <form key={item?.id ?? "new"} className="grid gap-2 rounded-xl border bg-white p-4 md:grid-cols-2" onSubmit={(event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      start(async () => {
        const saved = await saveFnbItemAction({
          id: item?.id,
          short_code: String(form.get("short_code") ?? ""),
          external_code: String(form.get("external_code") ?? ""),
          brand_scope: brand,
          item_category: String(form.get("item_category") ?? "RAW_MATERIAL"),
          name_th: String(form.get("name_th") ?? ""),
          recipe_uom: String(form.get("recipe_uom") ?? "g"),
          count_uom: String(form.get("count_uom") ?? ""),
          recipe_per_count_uom: Number(form.get("recipe_per_count_uom") ?? 1),
          default_purchase_uom: String(form.get("default_purchase_uom") ?? ""),
          recipe_per_purchase_uom: Number(form.get("recipe_per_purchase_uom") ?? 1),
          reference_purchase_price: Number(form.get("reference_purchase_price") ?? 0),
          default_vat_mode: String(form.get("default_vat_mode") ?? "EX_VAT"),
          is_front_back_checked: form.get("is_front_back_checked") === "on",
          front_back_group: String(form.get("front_back_group") ?? ""),
          shelf_life_months: Number(form.get("shelf_life_months") ?? 0),
          requires_expiry_tracking: form.get("requires_expiry_tracking") === "on",
          alias_codes: String(form.get("alias_codes") ?? ""),
          track_front_display_daily: form.get("track_front_display_daily") === "on",
          backroom_count_schedule: String(form.get("backroom_count_schedule") ?? "WEEKLY_2X"),
          backroom_count_weekdays: form.getAll("weekday").map((day) => Number(day)),
        });
        if (saved.error) toast.error(saved.error);
        else toast.success("บันทึกวัตถุดิบแล้ว");
        setMessage(saved.error ?? "บันทึกวัตถุดิบแล้ว");
      });
    }}>
      <label className="text-sm">รหัสย่อตามคู่มือ (Short Code)<input className={field} name="short_code" defaultValue={item?.short_code} required /></label>
      <label className="text-sm">รหัสเรียกติดปากสำรอง (Aliases)<input className={field} name="alias_codes" defaultValue={item?.alias_codes?.join(", ") ?? ""} placeholder="PS, CWT" /></label>
      <label className="text-sm">รหัสคลังจีน<input className={field} name="external_code" defaultValue={item?.external_code ?? ""} /></label>
      <label className="text-sm">ชื่อวัตถุดิบ<input className={field} name="name_th" defaultValue={item?.name_th} required /></label>
      <p className="text-sm">แบรนด์ <strong>{brand === "CHATORN" ? "ชาทรตะโหมด" : "Lucky Cup"}</strong><input type="hidden" name="brand_scope" value={brand} /></p>
      <select className={field} name="item_category" defaultValue={item?.item_category ?? "RAW_MATERIAL"}>{FNB_ITEM_CATEGORIES.map((key) => <option key={key} value={key}>{FNB_CATEGORY_LABEL[key]}</option>)}</select>
      <select className={field} name="recipe_uom" defaultValue={item?.recipe_uom ?? "g"}>{FNB_RECIPE_UOMS.map((uom) => <option key={uom}>{uom}</option>)}</select>
      <input className={field} name="count_uom" defaultValue={item?.count_uom} placeholder="หน่วยนับ" />
      <input className={field} name="recipe_per_count_uom" type="number" step="0.0001" defaultValue={item?.recipe_per_count_uom ?? 1} />
      <input className={field} name="default_purchase_uom" defaultValue={item?.default_purchase_uom} placeholder="หน่วยซื้อ" />
      <input className={field} name="recipe_per_purchase_uom" type="number" step="0.0001" defaultValue={item?.recipe_per_purchase_uom ?? 1} />
      <input className={field} name="reference_purchase_price" type="number" step="0.01" defaultValue={item?.reference_purchase_price ?? 0} />
      <select className={field} name="default_vat_mode" defaultValue={item?.default_vat_mode ?? "EX_VAT"}>{FNB_VAT_MODES.map((mode) => <option key={mode}>{mode}</option>)}</select>
      <label className="text-sm">อายุเก็บรักษา (เดือน นับจากวันผลิต) เช่น 9, 12, 18 เดือน<input className={field} name="shelf_life_months" type="number" defaultValue={item?.shelf_life_months ?? ""} /></label>
      <label className="flex items-center gap-2 text-sm"><input name="requires_expiry_tracking" type="checkbox" defaultChecked={item?.requires_expiry_tracking !== false} />ต้องแกะกล่องลงวันหมดอายุหลังรับของ</label>
      <label className="flex items-center gap-2 text-sm md:col-span-2"><input name="track_front_display_daily" type="checkbox" defaultChecked={item ? item.track_front_display_daily : false} />เช็คจำนวนชั้นโชว์/ตู้แช่หน้าร้านทุกวัน (เปิด-ปิดร้าน)</label>
      <label className="text-sm md:col-span-2">รอบความถี่ตรวจนับคลังหลังร้าน / วัสดุสิ้นเปลืองตอนปิดร้าน
        <select className={field} name="backroom_count_schedule" defaultValue={item?.backroom_count_schedule || "WEEKLY_2X"}>{FNB_BACKROOM_SCHEDULES.map((key) => <option key={key} value={key}>{FNB_BACKROOM_SCHEDULE_LABEL[key]}</option>)}</select>
      </label>
      <div className="flex flex-wrap gap-3 text-sm md:col-span-2">{FNB_WEEKDAY_OPTIONS.map((day) => <label key={day.day} className="flex items-center gap-1"><input type="checkbox" name="weekday" value={day.day} defaultChecked={item?.backroom_count_weekdays?.includes(day.day)} />{day.label}</label>)}</div>
      <label className="flex items-center gap-2 text-sm"><input name="is_front_back_checked" type="checkbox" defaultChecked={item?.is_front_back_checked} />เช็กหน้า/หลัง</label>
      <select className={field} name="front_back_group" defaultValue={item?.front_back_group ?? "BAKERY_CAKE"}>{FNB_FRONT_GROUPS.map((group) => <option key={group}>{group}</option>)}</select>
      <button className="rounded-md bg-[var(--fnb-brand)] px-4 py-2 text-sm text-white md:col-span-2" disabled={pending}>{item ? "บันทึกการแก้ไข" : "เพิ่มวัตถุดิบ"}</button>
    </form>
  );
}

function PackForm({
  itemId,
  packs,
  pending,
  start,
  setMessage,
}: {
  itemId: string;
  packs: FnbVendorPackRow[];
  pending: boolean;
  start: (callback: () => void) => void;
  setMessage: (message: string) => void;
}) {
  return (
    <form className="space-y-2 rounded-xl border bg-white p-4" onSubmit={(event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      start(async () => {
        const saved = await saveFnbVendorPackAction({
          item_id: itemId,
          vendor_name: String(form.get("vendor_name") ?? ""),
          pack_label: String(form.get("pack_label") ?? ""),
          purchase_uom: String(form.get("purchase_uom") ?? ""),
          recipe_qty_per_pack: Number(form.get("recipe_qty_per_pack") ?? 1),
          unit_price: Number(form.get("unit_price") ?? 0),
          vat_mode: String(form.get("vat_mode") ?? "EX_VAT"),
          moq_qty: Number(form.get("moq_qty") ?? 0),
          under_moq_surcharge_thb: Number(form.get("under_moq_surcharge_thb") ?? 0),
          is_local_urgent_pack: form.get("is_local_urgent_pack") === "on",
        });
        setMessage(saved.error ?? "บันทึกแหล่งซื้อแล้ว");
      });
    }}>
      <h2 className="font-semibold">แพ็กผู้ขาย</h2>
      {packs.map((pack) => <p key={pack.id} className="text-sm">{pack.vendor_name} · {pack.pack_label} · {pack.unit_price.toFixed(2)} · MOQ {pack.moq_qty ?? 0}</p>)}
      <input className={field} name="vendor_name" placeholder="SUPER DAN / มาลี / แพนฟู้ด / GO Wholesale" required />
      <div className="grid gap-2 md:grid-cols-2">
        <input className={field} name="pack_label" placeholder="Litre / Carton" />
        <input className={field} name="purchase_uom" placeholder="หน่วยซื้อ" />
        <input className={field} name="recipe_qty_per_pack" type="number" step="0.0001" placeholder="ปริมาณสูตรต่อแพ็ก" />
        <input className={field} name="unit_price" type="number" step="0.01" placeholder="ราคา" />
        <select className={field} name="vat_mode">{FNB_VAT_MODES.map((mode) => <option key={mode}>{mode}</option>)}</select>
        <input className={field} name="moq_qty" type="number" placeholder="MOQ" />
        <input className={field} name="under_moq_surcharge_thb" type="number" step="0.01" placeholder="ค่าไม่ถึงขั้นต่ำ" />
        <label className="flex items-center gap-2 text-sm"><input name="is_local_urgent_pack" type="checkbox" />แพ็กด่วนในพื้นที่</label>
      </div>
      <button className="rounded-md bg-[var(--fnb-brand)] px-4 py-2 text-sm text-white" disabled={pending}>เพิ่มแหล่งซื้อ</button>
    </form>
  );
}
