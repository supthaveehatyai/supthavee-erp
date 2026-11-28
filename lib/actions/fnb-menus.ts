"use server";

import { callFnbRpc } from "@/lib/fnb/rpc";
import { asRows, caught, fail, num, result, text, todayBangkok } from "@/lib/fnb/rows";
import { schemaAdmin } from "@/lib/holding/schema-db";
import { requireFnbModuleAccess, requireFnbStoreOperationAccess } from "@/lib/holding/workspace-access";
import type { FnbActionResult, FnbBomCatalogItem, FnbBomVarianceRow, FnbMenuBomLineRow, FnbMenuRow, FnbPrepBaseCost, FnbPrepBaseRow } from "@/types/fnb";

export async function listFnbMenusAction(): Promise<FnbActionResult<{ bases: FnbPrepBaseRow[]; menus: FnbMenuRow[]; lines: FnbMenuBomLineRow[]; catalog: FnbBomCatalogItem[]; prepCosts: FnbPrepBaseCost[] }>> {
  try {
    const ctx = await requireFnbModuleAccess("master_items_bom");
    const canCost = ctx.isSuperAdmin || ctx.fnbGuardrailPermissions.can_view_cost_price;
    const db = schemaAdmin().schema("fnb");
    const [bases, menus, lines, items, prepLines] = await Promise.all([
      db.from("prep_bases").select("*").order("base_code", { ascending: true }).limit(50),
      db.from("menus").select("*").order("menu_code", { ascending: true }).limit(400),
      db.from("menu_bom_lines").select("*").limit(4000),
      db.from("items").select("id,short_code,name_th,recipe_uom,count_uom,moving_avg_cost_per_recipe_unit,brand_scope,is_active").eq("is_active", true).limit(800),
      db.from("prep_base_lines").select("brand_code,base_code,item_id,input_recipe_qty").limit(400),
    ]);
    const empty = { bases: [] as FnbPrepBaseRow[], menus: [] as FnbMenuRow[], lines: [] as FnbMenuBomLineRow[], catalog: [] as FnbBomCatalogItem[], prepCosts: [] as FnbPrepBaseCost[] };
    if (bases.error) return fail(empty, bases.error, "อ่านเบสไม่สำเร็จ");
    if (menus.error) return fail(empty, menus.error, "อ่านเมนูไม่สำเร็จ");
    if (lines.error) return fail(empty, lines.error, "อ่านสูตรไม่สำเร็จ");
    const itemCost = new Map(asRows(items.data).map((row) => [text(row.id), num(row.moving_avg_cost_per_recipe_unit)]));
    const yieldMl = new Map(asRows(bases.data).map((row) => [`${text(row.brand_code)}|${text(row.base_code)}`, num(row.yield_qty_ml) || 1]));
    const prepCost = new Map<string, number>();
    for (const row of asRows(prepLines.data)) {
      const key = `${text(row.brand_code)}|${text(row.base_code)}`;
      const batch = (itemCost.get(text(row.item_id)) ?? 0) * num(row.input_recipe_qty);
      prepCost.set(key, (prepCost.get(key) ?? 0) + batch);
    }
    const mappedLines = asRows(lines.data).map((row) => ({
      id: text(row.id),
      menu_id: text(row.menu_id),
      component_type: text(row.component_type),
      item_id: row.item_id == null ? null : text(row.item_id),
      prep_base_code: row.prep_base_code == null ? null : text(row.prep_base_code),
      usage_qty: num(row.usage_qty),
      usage_uom: text(row.usage_uom),
      note: row.note == null ? null : text(row.note),
      line_tolerance_pct: num(row.line_tolerance_pct) || 5,
      is_user_customized: row.is_user_customized === true,
      is_packaging: row.is_packaging === true,
    }));
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
        menu_category: text(row.menu_category) || "ไม่ระบุหมวด",
        is_active: row.is_active !== false,
        is_bom_pending: row.is_bom_pending === true,
        is_auto_discovered: row.is_auto_discovered === true,
        theoretical_cost_thb: canCost ? mappedLines.filter((line) => line.menu_id === text(row.id)).reduce((sum, line) => {
          if (line.component_type === "PREP_BASE") {
            const key = `${text(row.brand_code)}|${line.prep_base_code}`;
            const perMl = (prepCost.get(key) ?? 0) / (yieldMl.get(key) || 1);
            return sum + line.usage_qty * perMl;
          }
          return sum + line.usage_qty * (itemCost.get(line.item_id || "") ?? 0);
        }, 0) : null,
      })),
      lines: mappedLines,
      catalog: asRows(items.data).map((row) => ({
        id: text(row.id),
        short_code: text(row.short_code),
        name_th: text(row.name_th),
        recipe_uom: text(row.recipe_uom),
        count_uom: text(row.count_uom),
        unit_cost: canCost ? num(row.moving_avg_cost_per_recipe_unit) : 0,
      })),
      prepCosts: [...prepCost.entries()].map(([key, batch]) => ({
        base_code: key.split("|")[1] || "",
        cost_per_ml: canCost ? batch / (yieldMl.get(key) || 1) : 0,
      })),
    });
  } catch (error) {
    return caught({ bases: [], menus: [], lines: [], catalog: [], prepCosts: [] }, error, "อ่านเมนูไม่สำเร็จ");
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
    await requireFnbModuleAccess("master_items_bom");
    if (input.brand_code !== "LUCKY_CUP" && input.brand_code !== "CHATORN") return result({ ok: false }, "เบสต้องสังกัดแบรนด์เดียว");
    const existing = await schemaAdmin().schema("fnb").from("prep_bases").select("base_code").eq("base_code", input.base_code.trim().toUpperCase()).eq("brand_code", input.brand_code).maybeSingle();
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
    await requireFnbModuleAccess("master_items_bom");
    if (input.brand_code !== "LUCKY_CUP" && input.brand_code !== "CHATORN") return result({ ok: false }, "เมนูต้องสังกัดแบรนด์เดียว");
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
    await requireFnbModuleAccess("master_items_bom");
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

export async function copyBrandStarterAction(fromBrand: string, toBrand: string): Promise<FnbActionResult<{ bases: number; menus: number }>> {
  try {
    const ctx = await requireFnbModuleAccess("master_items_bom");
    if (!ctx.isSuperAdmin) return result({ bases: 0, menus: 0 }, "เฉพาะ Super Admin คัดลอกชุดข้อมูลข้ามแบรนด์ได้");
    if ((fromBrand !== "LUCKY_CUP" && fromBrand !== "CHATORN") || (toBrand !== "LUCKY_CUP" && toBrand !== "CHATORN") || fromBrand === toBrand) {
      return result({ bases: 0, menus: 0 }, "เลือกแบรนด์ต้นทางและปลายทางคนละแบรนด์");
    }
    const db = schemaAdmin().schema("fnb");
    const [sourceBases, targetBases] = await Promise.all([
      db.from("prep_bases").select("base_code,base_name_th,yield_qty_ml,shelf_life_hours").eq("brand_code", fromBrand).limit(50),
      db.from("prep_bases").select("base_code").eq("brand_code", toBrand).limit(50),
    ]);
    if (sourceBases.error) return fail({ bases: 0, menus: 0 }, sourceBases.error, "อ่านเบสต้นทางไม่สำเร็จ");
    const owned = new Set(asRows(targetBases.data).map((row) => text(row.base_code)));
    let bases = 0;
    for (const row of asRows(sourceBases.data)) {
      if (owned.has(text(row.base_code))) continue;
      const inserted = await db.from("prep_bases").insert({
        base_code: text(row.base_code),
        brand_code: toBrand,
        base_name_th: text(row.base_name_th),
        yield_qty_ml: num(row.yield_qty_ml),
        shelf_life_hours: row.shelf_life_hours == null ? null : num(row.shelf_life_hours),
        is_active: true,
      });
      if (inserted.error) return fail({ bases, menus: 0 }, inserted.error, "คัดลอกเบสไม่สำเร็จ");
      bases += 1;
    }
    let menus = 0;
    const fullMenus = await db.from("menus").select("id,menu_code,menu_name_th,cup_size,temperature,retail_price").eq("brand_code", fromBrand).eq("is_active", true).limit(400);
    for (const row of asRows(fullMenus.data)) {
      const id = crypto.randomUUID();
      const inserted = await db.from("menus").insert({
        id,
        brand_code: toBrand,
        menu_code: `${text(row.menu_code)}-${toBrand === "CHATORN" ? "CT" : "LC"}`,
        menu_name_th: text(row.menu_name_th),
        cup_size: text(row.cup_size) || "R",
        temperature: text(row.temperature) || "ICE",
        retail_price: num(row.retail_price),
        is_active: true,
      });
      if (inserted.error) continue;
      const lines = await db.from("menu_bom_lines").select("component_type,item_id,prep_base_code,usage_qty,usage_uom,note").eq("menu_id", text(row.id)).limit(40);
      for (const line of asRows(lines.data)) {
        await db.from("menu_bom_lines").insert({
          menu_id: id,
          component_type: text(line.component_type),
          item_id: line.item_id,
          prep_base_code: line.prep_base_code,
          usage_qty: num(line.usage_qty),
          usage_uom: text(line.usage_uom) || "g",
          note: line.note,
        });
      }
      menus += 1;
    }
    return result({ bases, menus });
  } catch (error) {
    return caught({ bases: 0, menus: 0 }, error, "คัดลอกชุดข้อมูลไม่สำเร็จ");
  }
}

export async function saveMenuBomAction(input: {
  menu_id: string;
  lines: { component_type: string; item_id: string; prep_base_code: string; usage_qty: number; usage_uom: string; line_tolerance_pct: number; is_packaging: boolean }[];
}): Promise<FnbActionResult<{ ok: boolean }>> {
  try {
    await requireFnbModuleAccess("master_items_bom");
    const db = schemaAdmin().schema("fnb");
    const menu = await db.from("menus").select("id,brand_code").eq("id", input.menu_id).maybeSingle();
    if (menu.error || !menu.data) return fail({ ok: false }, menu.error, "ไม่พบเมนู");
    const brand = text((menu.data as { brand_code?: string }).brand_code);
    const cleared = await db.from("menu_bom_lines").delete().eq("menu_id", input.menu_id);
    if (cleared.error) return fail({ ok: false }, cleared.error, "ล้างสูตรเดิมไม่สำเร็จ");
    let order = 1;
    for (const line of input.lines) {
      if (!line.usage_qty) continue;
      const inserted = await db.from("menu_bom_lines").insert({
        menu_id: input.menu_id,
        brand_code: brand,
        component_type: line.component_type,
        item_id: line.component_type === "RAW_ITEM" ? line.item_id || null : null,
        prep_base_code: line.component_type === "PREP_BASE" ? line.prep_base_code || null : null,
        usage_qty: Number(line.usage_qty) || 0,
        usage_uom: line.usage_uom || "g",
        line_tolerance_pct: Number(line.line_tolerance_pct) || 0,
        is_packaging: line.is_packaging === true,
        is_user_customized: true,
        sort_order: order,
      });
      order += 1;
      if (inserted.error) return fail({ ok: false }, inserted.error, "บันทึกสูตรไม่สำเร็จ");
    }
    await db.from("menus").update({ is_bom_pending: false }).eq("id", input.menu_id);
    return result({ ok: true });
  } catch (error) {
    return caught({ ok: false }, error, "บันทึกสูตรไม่สำเร็จ");
  }
}

export async function getBomUsageForecastAction(input: {
  branch_code: string;
  from_date: string;
  to_date: string;
  forecast_days: number;
}): Promise<FnbActionResult<{ items: FnbBomVarianceRow[]; period_days: number; forecast_days: number }>> {
  const empty = { items: [] as FnbBomVarianceRow[], period_days: 0, forecast_days: input.forecast_days };
  try {
    const access = await requireFnbStoreOperationAccess(input.branch_code);
    if (!access.ok) return result(empty, access.error);
    const canCost = access.ctx.isSuperAdmin || access.ctx.fnbGuardrailPermissions.can_view_cost_price;
    const saved = await callFnbRpc("get_bom_usage_variance_and_forecast", {
      p_branch_code: input.branch_code,
      p_from_date: input.from_date || todayBangkok(),
      p_to_date: input.to_date || todayBangkok(),
      p_forecast_days: input.forecast_days || 7,
    });
    if (saved.error) return fail(empty, saved.error, "อ่านคาดการณ์สูตรไม่สำเร็จ");
    const body = saved.data && typeof saved.data === "object" ? saved.data as Record<string, unknown> : {};
    if (body.ok !== true) return result(empty, text(body.error) || "อ่านคาดการณ์สูตรไม่สำเร็จ");
    const items = Array.isArray(body.items) ? body.items : [];
    return result({
      period_days: num(body.period_days),
      forecast_days: num(body.forecast_days),
      items: items.map((row) => {
        const rec = row && typeof row === "object" ? row as Record<string, unknown> : {};
        return {
          item_id: text(rec.item_id),
          short_code: text(rec.short_code),
          name_th: text(rec.name_th),
          count_uom: text(rec.count_uom),
          tolerance_pct: num(rec.tolerance_pct),
          theoretical_recipe_qty: num(rec.theoretical_recipe_qty),
          theoretical_cost_thb: canCost ? num(rec.theoretical_cost_thb) : null,
          actual_used_recipe_qty: num(rec.actual_used_recipe_qty),
          actual_cost_thb: canCost ? num(rec.actual_cost_thb) : null,
          variance_pct: num(rec.variance_pct),
          is_over_tolerance: rec.is_over_tolerance === true,
          on_hand_count_qty: num(rec.on_hand_count_qty),
          forecast_need_count_qty: num(rec.forecast_need_count_qty),
          recommended_order_count_qty: num(rec.recommended_order_count_qty),
        };
      }),
    });
  } catch (error) {
    return caught(empty, error, "อ่านคาดการณ์สูตรไม่สำเร็จ");
  }
}
