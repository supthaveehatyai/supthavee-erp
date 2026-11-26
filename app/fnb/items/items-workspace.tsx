"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { commitFnbPriceExcelAction, previewFnbPriceExcelAction, saveFnbItemAction, saveFnbVendorPackAction } from "@/lib/actions/fnb-items";
import { FNB_BRAND_SCOPES, FNB_CATEGORY_LABEL, FNB_FRONT_GROUPS, FNB_ITEM_CATEGORIES, FNB_RECIPE_UOMS, FNB_VAT_MODES, type FnbExcelPriceRow, type FnbItemRow, type FnbVendorPackRow } from "@/types/fnb";

const field = "h-10 w-full rounded-md border border-slate-200 px-3 text-sm";

export function ItemsWorkspace({ items, packs }: { items: FnbItemRow[]; packs: FnbVendorPackRow[] }) {
  const [brand, setBrand] = useState("ALL");
  const [category, setCategory] = useState("ALL");
  const [selected, setSelected] = useState(items[0]?.id ?? "");
  const [preview, setPreview] = useState<FnbExcelPriceRow[]>([]);
  const [message, setMessage] = useState("");
  const [pending, start] = useTransition();
  const visible = useMemo(
    () => items.filter((item) => (brand === "ALL" || item.brand_scope === brand) && (category === "ALL" || item.item_category === category)),
    [items, brand, category],
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
        <select className={field} value={brand} onChange={(event) => setBrand(event.target.value)}>
          <option value="ALL">ทุกแบรนด์</option>
          {FNB_BRAND_SCOPES.map((scope) => <option key={scope} value={scope}>{scope}</option>)}
        </select>
        <select className={field} value={category} onChange={(event) => setCategory(event.target.value)}>
          <option value="ALL">ทุกหมวด</option>
          {FNB_ITEM_CATEGORIES.map((key) => <option key={key} value={key}>{FNB_CATEGORY_LABEL[key]}</option>)}
        </select>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="max-h-[32rem] space-y-2 overflow-auto">
          {visible.map((row) => (
            <button key={row.id} type="button" onClick={() => setSelected(row.id)} className={`block w-full rounded-lg border p-3 text-left ${row.id === selected ? "border-red-700 bg-red-50" : "border-slate-200 bg-white"}`}>
              <p className="font-semibold">{row.short_code} · {row.name_th}</p>
              <p className="text-xs text-slate-500">{row.brand_scope} · {row.item_category} · {row.reference_purchase_price.toFixed(2)}</p>
            </button>
          ))}
        </div>
        <div className="space-y-4">
          <ItemForm item={item} pending={pending} start={start} setMessage={setMessage} />
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
            <button className="rounded-md bg-red-700 px-4 py-2 text-sm text-white" disabled={pending} onClick={() => start(async () => {
              const saved = await commitFnbPriceExcelAction(preview);
              setMessage(saved.error ?? `บันทึก ${saved.data.saved} รายการ`);
            })}>บันทึกราคา</button>
          </div>
        ) : null}
      </section>
    </div>
  );

  function readExcel(file: File) {
    const body = new FormData();
    body.set("file", file);
    start(async () => {
      const parsed = await previewFnbPriceExcelAction(body);
      setPreview(parsed.data);
      setMessage(parsed.error ?? `พบ ${parsed.data.length} รหัส`);
    });
  }
}

function ItemForm({
  item,
  pending,
  start,
  setMessage,
}: {
  item: FnbItemRow | null;
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
          brand_scope: String(form.get("brand_scope") ?? "ALL"),
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
        });
        setMessage(saved.error ?? "บันทึกวัตถุดิบแล้ว");
      });
    }}>
      <input className={field} name="short_code" defaultValue={item?.short_code} placeholder="รหัสสั้น" required />
      <input className={field} name="external_code" defaultValue={item?.external_code ?? ""} placeholder="รหัส X..." />
      <input className={field} name="name_th" defaultValue={item?.name_th} placeholder="ชื่อ" required />
      <select className={field} name="brand_scope" defaultValue={item?.brand_scope ?? "ALL"}>{FNB_BRAND_SCOPES.map((scope) => <option key={scope}>{scope}</option>)}</select>
      <select className={field} name="item_category" defaultValue={item?.item_category ?? "RAW_MATERIAL"}>{FNB_ITEM_CATEGORIES.map((key) => <option key={key} value={key}>{FNB_CATEGORY_LABEL[key]}</option>)}</select>
      <select className={field} name="recipe_uom" defaultValue={item?.recipe_uom ?? "g"}>{FNB_RECIPE_UOMS.map((uom) => <option key={uom}>{uom}</option>)}</select>
      <input className={field} name="count_uom" defaultValue={item?.count_uom} placeholder="หน่วยนับ" />
      <input className={field} name="recipe_per_count_uom" type="number" step="0.0001" defaultValue={item?.recipe_per_count_uom ?? 1} />
      <input className={field} name="default_purchase_uom" defaultValue={item?.default_purchase_uom} placeholder="หน่วยซื้อ" />
      <input className={field} name="recipe_per_purchase_uom" type="number" step="0.0001" defaultValue={item?.recipe_per_purchase_uom ?? 1} />
      <input className={field} name="reference_purchase_price" type="number" step="0.01" defaultValue={item?.reference_purchase_price ?? 0} />
      <select className={field} name="default_vat_mode" defaultValue={item?.default_vat_mode ?? "EX_VAT"}>{FNB_VAT_MODES.map((mode) => <option key={mode}>{mode}</option>)}</select>
      <label className="flex items-center gap-2 text-sm"><input name="is_front_back_checked" type="checkbox" defaultChecked={item?.is_front_back_checked} />เช็กหน้า/หลัง</label>
      <select className={field} name="front_back_group" defaultValue={item?.front_back_group ?? "BAKERY_CAKE"}>{FNB_FRONT_GROUPS.map((group) => <option key={group}>{group}</option>)}</select>
      <button className="rounded-md bg-red-700 px-4 py-2 text-sm text-white md:col-span-2" disabled={pending}>{item ? "บันทึกการแก้ไข" : "เพิ่มวัตถุดิบ"}</button>
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
      <button className="rounded-md bg-red-700 px-4 py-2 text-sm text-white" disabled={pending}>เพิ่มแหล่งซื้อ</button>
    </form>
  );
}
