"use server";

import { asRows, caught, fail, num, result, text } from "@/lib/fnb/rows";
import { schemaAdmin } from "@/lib/holding/schema-db";
import { requireSuperAdmin } from "@/lib/holding/workspace-access";
import type { FnbActionResult, FnbMenuBomLineRow, FnbMenuRow, FnbPrepBaseRow } from "@/types/fnb";

export async function listFnbMenusAction(): Promise<FnbActionResult<{ bases: FnbPrepBaseRow[]; menus: FnbMenuRow[]; lines: FnbMenuBomLineRow[] }>> {
  try {
    await requireSuperAdmin();
    const db = schemaAdmin().schema("fnb");
    const [bases, menus, lines] = await Promise.all([
      db.from("prep_bases").select("*").order("base_code", { ascending: true }).limit(50),
      db.from("menus").select("*").order("menu_code", { ascending: true }).limit(400),
      db.from("menu_bom_lines").select("*").limit(2000),
    ]);
    if (bases.error) return fail({ bases: [], menus: [], lines: [] }, bases.error, "อ่านเบสไม่สำเร็จ");
    if (menus.error) return fail({ bases: [], menus: [], lines: [] }, menus.error, "อ่านเมนูไม่สำเร็จ");
    if (lines.error) return fail({ bases: [], menus: [], lines: [] }, lines.error, "อ่านสูตรไม่สำเร็จ");
    return result({
      bases: asRows(bases.data).map((row) => ({
        base_code: text(row.base_code),
        brand_code: text(row.brand_code),
        base_name_th: text(row.base_name_th),
        yield_qty_ml: num(row.yield_qty_ml),
        shelf_life_hours: row.shelf_life_hours == null ? null : num(row.shelf_life_hours),
        is_active: row.is_active !== false,
      })),
      menus: asRows(menus.data).map((row) => ({
        id: text(row.id),
        brand_code: text(row.brand_code),
        menu_code: text(row.menu_code),
        menu_name_th: text(row.menu_name_th),
        cup_size: text(row.cup_size),
        temperature: text(row.temperature),
        retail_price: num(row.retail_price),
        is_active: row.is_active !== false,
      })),
      lines: asRows(lines.data).map((row) => ({
        id: text(row.id),
        menu_id: text(row.menu_id),
        component_type: text(row.component_type),
        item_id: row.item_id == null ? null : text(row.item_id),
        prep_base_code: row.prep_base_code == null ? null : text(row.prep_base_code),
        usage_qty: num(row.usage_qty),
        usage_uom: text(row.usage_uom),
        note: row.note == null ? null : text(row.note),
      })),
    });
  } catch (error) {
    return caught({ bases: [], menus: [], lines: [] }, error, "อ่านเมนูไม่สำเร็จ");
  }
}

export async function savePrepBaseAction(input: {
  base_code: string;
  brand_code: string;
  base_name_th: string;
  yield_qty_ml: number;
  shelf_life_hours: number;
}): Promise<FnbActionResult<{ ok: boolean }>> {
  try {
    await requireSuperAdmin();
    const existing = await schemaAdmin().schema("fnb").from("prep_bases").select("base_code").eq("base_code", input.base_code).maybeSingle();
    if (existing.error) return fail({ ok: false }, existing.error, "บันทึกเบสไม่สำเร็จ");
    const payload = {
      base_code: input.base_code.trim().toUpperCase(),
      brand_code: input.brand_code,
      base_name_th: input.base_name_th.trim(),
      yield_qty_ml: Number(input.yield_qty_ml) || 0,
      shelf_life_hours: Number(input.shelf_life_hours) || null,
      is_active: true,
    };
    const saved = existing.data
      ? await schemaAdmin().schema("fnb").from("prep_bases").update(payload).eq("base_code", payload.base_code)
      : await schemaAdmin().schema("fnb").from("prep_bases").insert(payload);
    if (saved.error) return fail({ ok: false }, saved.error, "บันทึกเบสไม่สำเร็จ");
    return result({ ok: true });
  } catch (error) {
    return caught({ ok: false }, error, "บันทึกเบสไม่สำเร็จ");
  }
}

export async function saveMenuAction(input: {
  id?: string;
  brand_code: string;
  menu_code: string;
  menu_name_th: string;
  cup_size: string;
  temperature: string;
  retail_price: number;
  bom: { component_type: string; item_id: string; prep_base_code: string; usage_qty: number; usage_uom: string }[];
}): Promise<FnbActionResult<{ ok: boolean }>> {
  try {
    await requireSuperAdmin();
    const db = schemaAdmin().schema("fnb");
    const payload = {
      brand_code: input.brand_code,
      menu_code: input.menu_code.trim(),
      menu_name_th: input.menu_name_th.trim(),
      cup_size: input.cup_size,
      temperature: input.temperature,
      retail_price: Number(input.retail_price) || 0,
      is_active: true,
    };
    const menuId = input.id || crypto.randomUUID();
    const saved = input.id
      ? await db.from("menus").update(payload).eq("id", input.id)
      : await db.from("menus").insert({ id: menuId, ...payload });
    if (saved.error) return fail({ ok: false }, saved.error, "บันทึกเมนูไม่สำเร็จ");
    if (input.id) {
      const cleared = await db.from("menu_bom_lines").delete().eq("menu_id", input.id);
      if (cleared.error) return fail({ ok: false }, cleared.error, "ล้างสูตรเดิมไม่สำเร็จ");
    }
    for (const line of input.bom) {
      if (!line.usage_qty) continue;
      const inserted = await db.from("menu_bom_lines").insert({
        menu_id: input.id || menuId,
        component_type: line.component_type,
        item_id: line.component_type === "RAW_ITEM" ? line.item_id || null : null,
        prep_base_code: line.component_type === "PREP_BASE" ? line.prep_base_code || null : null,
        usage_qty: Number(line.usage_qty) || 0,
        usage_uom: line.usage_uom || "g",
      });
      if (inserted.error) return fail({ ok: false }, inserted.error, "บันทึกสูตรไม่สำเร็จ");
    }
    return result({ ok: true });
  } catch (error) {
    return caught({ ok: false }, error, "บันทึกเมนูไม่สำเร็จ");
  }
}

export async function copyMenuToChatornAction(menuId: string): Promise<FnbActionResult<{ menu_code: string }>> {
  try {
    await requireSuperAdmin();
    const db = schemaAdmin().schema("fnb");
    const menu = await db.from("menus").select("*").eq("id", menuId).maybeSingle();
    if (menu.error || !menu.data) return fail({ menu_code: "" }, menu.error, "ไม่พบเมนูต้นทาง");
    const source = menu.data as Record<string, unknown>;
    const code = `${text(source.menu_code)}-CT`;
    const id = crypto.randomUUID();
    const copied = await db.from("menus").insert({
      id,
      brand_code: "CHATORN",
      menu_code: code,
      menu_name_th: text(source.menu_name_th),
      cup_size: text(source.cup_size) || "R",
      temperature: text(source.temperature) || "ICE",
      retail_price: num(source.retail_price),
      is_active: true,
    });
    if (copied.error) return fail({ menu_code: "" }, copied.error, "คัดลอกเมนูไม่สำเร็จ");
    const lines = await db.from("menu_bom_lines").select("*").eq("menu_id", menuId).limit(100);
    if (lines.error) return fail({ menu_code: code }, lines.error, "อ่านสูตรต้นทางไม่สำเร็จ");
    for (const line of asRows(lines.data)) {
      const inserted = await db.from("menu_bom_lines").insert({
        menu_id: id,
        component_type: text(line.component_type),
        item_id: line.item_id,
        prep_base_code: line.prep_base_code,
        usage_qty: num(line.usage_qty),
        usage_uom: text(line.usage_uom),
        note: line.note,
      });
      if (inserted.error) return fail({ menu_code: code }, inserted.error, "คัดลอกสูตรไม่สำเร็จ");
    }
    return result({ menu_code: code });
  } catch (error) {
    return caught({ menu_code: "" }, error, "คัดลอกเมนูไม่สำเร็จ");
  }
}
