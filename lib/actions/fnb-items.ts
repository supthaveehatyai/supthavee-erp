"use server";

import { parseLuckyCupPriceWorkbook } from "@/lib/fnb/excel";
import { asRows, caught, fail, num, result, text } from "@/lib/fnb/rows";
import { schemaAdmin } from "@/lib/holding/schema-db";
import { requireAnyFnbModule, requireFnbModuleAccess } from "@/lib/holding/workspace-access";
import { FNB_FRONT_DISPLAY_CATEGORIES, type FnbActionResult, type FnbExcelPriceRow, type FnbItemRow, type FnbVendorPackRow } from "@/types/fnb";

function mapItem(row: Record<string, unknown>): FnbItemRow {
  return {
    id: text(row.id),
    short_code: text(row.short_code),
    external_code: row.external_code == null ? null : text(row.external_code),
    brand_scope: text(row.brand_scope),
    item_category: text(row.item_category),
    name_th: text(row.name_th),
    name_cn: row.name_cn == null ? null : text(row.name_cn),
    recipe_uom: text(row.recipe_uom),
    count_uom: text(row.count_uom),
    recipe_per_count_uom: num(row.recipe_per_count_uom),
    default_purchase_uom: text(row.default_purchase_uom),
    recipe_per_purchase_uom: num(row.recipe_per_purchase_uom),
    specific_gravity: num(row.specific_gravity) || 1,
    tare_weight_g: num(row.tare_weight_g),
    reference_purchase_price: num(row.reference_purchase_price),
    default_vat_mode: text(row.default_vat_mode),
    moving_avg_cost_per_recipe_unit: num(row.moving_avg_cost_per_recipe_unit),
    is_front_back_checked: row.is_front_back_checked === true,
    front_back_group: row.front_back_group == null ? null : text(row.front_back_group),
    is_active: row.is_active !== false,
    shelf_life_months: row.shelf_life_months == null ? null : num(row.shelf_life_months),
    requires_expiry_tracking: row.requires_expiry_tracking !== false,
    alias_codes: Array.isArray(row.alias_codes) ? row.alias_codes.map((code) => text(code)).filter(Boolean) : [],
    track_front_display_daily: row.track_front_display_daily === true,
    backroom_count_schedule: text(row.backroom_count_schedule) || "WEEKLY_2X",
    backroom_count_weekdays: Array.isArray(row.backroom_count_weekdays) ? row.backroom_count_weekdays.map((day) => Number(day)).filter((day) => Number.isFinite(day)) : [],
  };
}

function mapPack(row: Record<string, unknown>): FnbVendorPackRow {
  return {
    id: text(row.id),
    item_id: text(row.item_id),
    vendor_name: text(row.vendor_name),
    pack_label: text(row.pack_label),
    purchase_uom: text(row.purchase_uom),
    recipe_qty_per_pack: num(row.recipe_qty_per_pack),
    unit_price: num(row.unit_price),
    vat_mode: text(row.vat_mode),
    moq_qty: row.moq_qty == null ? null : num(row.moq_qty),
    under_moq_surcharge_thb: num(row.under_moq_surcharge_thb),
    is_local_urgent_pack: row.is_local_urgent_pack === true,
    is_preferred: row.is_preferred === true,
    is_active: row.is_active !== false,
  };
}

export async function listFnbItemsAction(): Promise<FnbActionResult<{ items: FnbItemRow[]; packs: FnbVendorPackRow[] }>> {
  try {
    await requireAnyFnbModule(["master_items_bom", "sop_shift_settings"]);
    const db = schemaAdmin().schema("fnb");
    const [items, packs] = await Promise.all([
      db.from("items").select("*").order("short_code", { ascending: true }).limit(500),
      db.from("item_vendor_packs").select("*").order("vendor_name", { ascending: true }).limit(1000),
    ]);
    if (items.error) return fail({ items: [], packs: [] }, items.error, "อ่านวัตถุดิบไม่สำเร็จ");
    if (packs.error) return fail({ items: [], packs: [] }, packs.error, "อ่านแหล่งซื้อไม่สำเร็จ");
    return result({ items: asRows(items.data).map(mapItem), packs: asRows(packs.data).map(mapPack) });
  } catch (error) {
    return caught({ items: [], packs: [] }, error, "อ่านวัตถุดิบไม่สำเร็จ");
  }
}

export async function saveFnbItemAction(input: {
  id?: string;
  short_code: string;
  external_code: string;
  brand_scope: string;
  item_category: string;
  name_th: string;
  recipe_uom: string;
  count_uom: string;
  recipe_per_count_uom: number;
  default_purchase_uom: string;
  recipe_per_purchase_uom: number;
  reference_purchase_price: number;
  default_vat_mode: string;
  is_front_back_checked: boolean;
  front_back_group: string;
  shelf_life_months: number;
  requires_expiry_tracking: boolean;
  alias_codes?: string;
  track_front_display_daily?: boolean;
  backroom_count_schedule?: string;
  backroom_count_weekdays?: number[];
}): Promise<FnbActionResult<{ ok: boolean }>> {
  try {
    await requireFnbModuleAccess("master_items_bom");
    const shortCode = input.short_code.trim().toUpperCase();
    if (!shortCode) return result({ ok: false }, "กรอกรหัสย่อตามคู่มือ");
    const clash = await schemaAdmin().schema("fnb").from("items").select("id").eq("short_code", shortCode).maybeSingle();
    const clashId = text((clash.data as { id?: string } | null)?.id);
    if (clashId && clashId !== input.id) return result({ ok: false }, `รหัสย่อ ${shortCode} ถูกใช้แล้ว`);
    const aliases = String(input.alias_codes ?? "").split(/[,|\s]+/).map((code) => code.trim().toUpperCase()).filter(Boolean);
    const schedule = ["DAILY", "EVERY_3_DAYS", "WEEKLY_2X", "WEEKLY_1X", "MONTHLY_ONLY"].includes(String(input.backroom_count_schedule))
      ? String(input.backroom_count_schedule)
      : "WEEKLY_2X";
    const autoFront = (FNB_FRONT_DISPLAY_CATEGORIES as readonly string[]).includes(input.item_category);
    const payload = {
      short_code: shortCode,
      external_code: input.external_code.trim() || null,
      brand_scope: input.brand_scope,
      item_category: input.item_category,
      name_th: input.name_th.trim(),
      recipe_uom: input.recipe_uom,
      count_uom: input.count_uom.trim() || "ชิ้น",
      recipe_per_count_uom: Number(input.recipe_per_count_uom) || 1,
      default_purchase_uom: input.default_purchase_uom.trim() || input.count_uom.trim() || "ชิ้น",
      recipe_per_purchase_uom: Number(input.recipe_per_purchase_uom) || 1,
      reference_purchase_price: Number(input.reference_purchase_price) || 0,
      default_vat_mode: input.default_vat_mode,
      is_front_back_checked: Boolean(input.is_front_back_checked),
      front_back_group: input.is_front_back_checked ? input.front_back_group || null : null,
      shelf_life_months: Number(input.shelf_life_months) || null,
      requires_expiry_tracking: Boolean(input.requires_expiry_tracking),
      alias_codes: aliases,
      track_front_display_daily: input.id ? Boolean(input.track_front_display_daily) : autoFront || Boolean(input.track_front_display_daily),
      backroom_count_schedule: schedule,
      backroom_count_weekdays: (input.backroom_count_weekdays ?? []).map(Number).filter((day) => day >= 0 && day <= 6),
      is_active: true,
    };
    const table = schemaAdmin().schema("fnb").from("items");
    const saved = input.id
      ? await table.update(payload).eq("id", input.id)
      : await table.insert({ ...payload, specific_gravity: 1, tare_weight_g: 0, moving_avg_cost_per_recipe_unit: 0 });
    if (saved.error) return fail({ ok: false }, saved.error, "บันทึกวัตถุดิบไม่สำเร็จ");
    return result({ ok: true });
  } catch (error) {
    return caught({ ok: false }, error, "บันทึกวัตถุดิบไม่สำเร็จ");
  }
}

export async function saveFnbVendorPackAction(input: {
  id?: string;
  item_id: string;
  vendor_name: string;
  pack_label: string;
  purchase_uom: string;
  recipe_qty_per_pack: number;
  unit_price: number;
  vat_mode: string;
  moq_qty: number;
  under_moq_surcharge_thb: number;
  is_local_urgent_pack: boolean;
}): Promise<FnbActionResult<{ ok: boolean }>> {
  try {
    await requireFnbModuleAccess("master_items_bom");
    const payload = {
      item_id: input.item_id,
      vendor_name: input.vendor_name.trim(),
      pack_label: input.pack_label.trim() || "มาตรฐาน",
      purchase_uom: input.purchase_uom.trim() || "ชิ้น",
      recipe_qty_per_pack: Number(input.recipe_qty_per_pack) || 1,
      unit_price: Number(input.unit_price) || 0,
      vat_mode: input.vat_mode,
      moq_qty: Number(input.moq_qty) || 0,
      under_moq_surcharge_thb: Number(input.under_moq_surcharge_thb) || 0,
      is_local_urgent_pack: Boolean(input.is_local_urgent_pack),
      is_preferred: !input.is_local_urgent_pack,
      is_active: true,
    };
    const table = schemaAdmin().schema("fnb").from("item_vendor_packs");
    const saved = input.id
      ? await table.update(payload).eq("id", input.id)
      : await table.insert(payload);
    if (saved.error) return fail({ ok: false }, saved.error, "บันทึกแหล่งซื้อไม่สำเร็จ");
    return result({ ok: true });
  } catch (error) {
    return caught({ ok: false }, error, "บันทึกแหล่งซื้อไม่สำเร็จ");
  }
}

export async function previewFnbPriceExcelAction(formData: FormData): Promise<FnbActionResult<FnbExcelPriceRow[]>> {
  try {
    await requireFnbModuleAccess("master_items_bom");
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) return result([], "ไม่พบไฟล์ Excel");
    const listed = await schemaAdmin().schema("fnb").from("items").select("external_code,short_code,alias_codes").limit(1000);
    if (listed.error) return fail([], listed.error, "อ่านรหัสวัตถุดิบไม่สำเร็จ");
    const known = new Set(
      asRows(listed.data).flatMap((row) => [text(row.external_code), text(row.short_code), ...(Array.isArray(row.alias_codes) ? row.alias_codes.map((code) => text(code)) : [])].filter(Boolean).map((code) => code.toUpperCase())),
    );
    return result(parseLuckyCupPriceWorkbook(await file.arrayBuffer(), known));
  } catch (error) {
    return caught([], error, "อ่านไฟล์ราคาไม่สำเร็จ");
  }
}

export async function commitFnbPriceExcelAction(rows: FnbExcelPriceRow[]): Promise<FnbActionResult<{ saved: number }>> {
  try {
    await requireFnbModuleAccess("master_items_bom");
    const db = schemaAdmin().schema("fnb");
    const listed = await db.from("items").select("id,external_code,short_code,alias_codes").limit(1000);
    if (listed.error) return fail({ saved: 0 }, listed.error, "อ่านวัตถุดิบไม่สำเร็จ");
    const byCode = new Map<string, string>();
    for (const row of asRows(listed.data)) {
      if (text(row.external_code)) byCode.set(text(row.external_code).toUpperCase(), text(row.id));
      if (text(row.short_code)) byCode.set(text(row.short_code).toUpperCase(), text(row.id));
      for (const alias of Array.isArray(row.alias_codes) ? row.alias_codes : []) byCode.set(text(alias).toUpperCase(), text(row.id));
    }
    let saved = 0;
    for (const row of rows) {
      const code = row.external_code.trim().toUpperCase();
      const existing = byCode.get(code);
      const written = existing
        ? await db.from("items").update({ reference_purchase_price: row.unit_price, external_code: code }).eq("id", existing)
        : await db.from("items").insert({
            short_code: code.slice(0, 32),
            external_code: code,
            brand_scope: "LUCKY_CUP",
            item_category: "RAW_MATERIAL",
            name_th: row.name_th || code,
            recipe_uom: "g",
            count_uom: "ถุง",
            recipe_per_count_uom: 1,
            default_purchase_uom: "ถุง",
            recipe_per_purchase_uom: 1,
            specific_gravity: 1,
            tare_weight_g: 0,
            reference_purchase_price: row.unit_price,
            default_vat_mode: "EX_VAT",
            is_front_back_checked: false,
            is_active: true,
          });
      if (written.error) return fail({ saved }, written.error, "บันทึกราคาจาก Excel ไม่สำเร็จ");
      saved += 1;
    }
    return result({ saved });
  } catch (error) {
    return caught({ saved: 0 }, error, "บันทึกราคาจาก Excel ไม่สำเร็จ");
  }
}
