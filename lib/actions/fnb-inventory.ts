"use server";

import { resolveFnbActor } from "@/lib/fnb/actor";
import { callFnbRpc } from "@/lib/fnb/rpc";
import { asRows, caught, fail, num, result, text, todayBangkok } from "@/lib/fnb/rows";
import { schemaAdmin } from "@/lib/holding/schema-db";
import { requireFnbModuleAccess, requireFnbStoreOperationAccess } from "@/lib/holding/workspace-access";
import type { UserAccessContext } from "@/types/holding";
import type { FnbActionResult, FnbExecutiveInventory, FnbExecutiveInventoryItem, FnbStockBalanceRow, FnbStockCard, FnbStockCardLot, FnbStockCardMovement } from "@/types/fnb";

function branchAllowed(ctx: UserAccessContext, branchCode: string): boolean {
  if (ctx.isSuperAdmin) return true;
  return ctx.allowedBranchCodes.includes(branchCode);
}

export async function listFnbStockAction(): Promise<FnbActionResult<FnbStockBalanceRow[]>> {
  try {
    const ctx = await requireFnbModuleAccess("branch_inventory_transfer");
    const db = schemaAdmin().schema("fnb");
    const [items, ledger] = await Promise.all([
      db.from("items").select("id,short_code,alias_codes,external_code,name_th,count_uom,recipe_uom,recipe_per_count_uom,is_catch_weight_produce,piece_uom_label").eq("is_active", true).limit(500),
      db.from("stock_ledger").select("branch_code,item_id,qty_delta,piece_qty_delta").limit(8000),
    ]);
    if (items.error) return fail([], items.error, "อ่านสินค้าไม่สำเร็จ");
    if (ledger.error) return fail([], ledger.error, "อ่านสต็อกไม่สำเร็จ");
    const catalog = new Map(asRows(items.data).map((row) => [text(row.id), row]));
    const totals = new Map<string, number>();
    const pieces = new Map<string, number>();
    for (const row of asRows(ledger.data)) {
      const key = `${text(row.branch_code)}|${text(row.item_id)}`;
      totals.set(key, (totals.get(key) ?? 0) + num(row.qty_delta));
      pieces.set(key, (pieces.get(key) ?? 0) + num(row.piece_qty_delta));
    }
    const balances: FnbStockBalanceRow[] = [];
    for (const key of new Set([...totals.keys(), ...pieces.keys()])) {
      const qty = totals.get(key) ?? 0;
      const pieceQty = pieces.get(key) ?? 0;
      const [branch, itemId] = key.split("|");
      const item = catalog.get(itemId);
      if (!item || (Math.abs(qty) < 0.0001 && Math.abs(pieceQty) < 0.0001)) continue;
      if (!branchAllowed(ctx, branch)) continue;
      const hideQty = !ctx.isSuperAdmin && ctx.fnbGuardrailPermissions.enforce_blind_count;
      balances.push({
        branch_code: branch,
        item_id: itemId,
        short_code: text(item.short_code),
        name_th: text(item.name_th),
        count_uom: text(item.count_uom),
        recipe_uom: text(item.recipe_uom),
        recipe_per_count_uom: num(item.recipe_per_count_uom) || 1,
        on_hand_recipe: hideQty ? 0 : qty,
        piece_on_hand: hideQty ? 0 : pieceQty,
        alias_codes: Array.isArray(item.alias_codes) ? item.alias_codes.map((code) => text(code)) : [],
        external_code: item.external_code == null ? null : text(item.external_code),
      });
    }
    return result(balances.sort((a, b) => a.branch_code.localeCompare(b.branch_code) || a.short_code.localeCompare(b.short_code)));
  } catch (error) {
    return caught([], error, "อ่านสต็อกไม่สำเร็จ");
  }
}

export async function transferFnbStockAction(input: {
  from_branch_code: string;
  to_branch_code: string;
  staff_name: string;
  actor_source?: string;
  item_id: string;
  qty_in_count_uom: number;
}): Promise<FnbActionResult<{ transfer_no: string }>> {
  try {
    const ctx = await requireFnbModuleAccess("branch_inventory_transfer");
    if (!branchAllowed(ctx, input.from_branch_code) || !branchAllowed(ctx, input.to_branch_code)) {
      return result({ transfer_no: "" }, "ไม่มีสิทธิ์โอนสินค้าของสาขานี้");
    }
    const actor = await resolveFnbActor({ actorSource: input.actor_source ?? "desktop", brandLock: null, branchCode: input.from_branch_code });
    if (!actor.ok) return result({ transfer_no: "" }, actor.error);
    const staffName = actor.actor.name;
    const db = schemaAdmin().schema("fnb");
    const [from, to, item] = await Promise.all([
      db.from("branches").select("legal_entity_id,brand_code").eq("branch_code", input.from_branch_code).maybeSingle(),
      db.from("branches").select("legal_entity_id,brand_code").eq("branch_code", input.to_branch_code).maybeSingle(),
      db.from("items").select("recipe_per_count_uom,moving_avg_cost_per_recipe_unit,brand_scope").eq("id", input.item_id).maybeSingle(),
    ]);
    if (from.error || to.error || item.error) return fail({ transfer_no: "" }, from.error ?? to.error ?? item.error, "อ่านข้อมูลโอนไม่สำเร็จ");
    const fromEntity = text((from.data as Record<string, unknown> | null)?.legal_entity_id);
    const toEntity = text((to.data as Record<string, unknown> | null)?.legal_entity_id);
    if (!fromEntity || fromEntity !== toEntity) return result({ transfer_no: "" }, "โอนได้เฉพาะสาขาในนิติบุคคลเดียวกัน");
    const fromBrand = text((from.data as Record<string, unknown> | null)?.brand_code);
    const toBrand = text((to.data as Record<string, unknown> | null)?.brand_code);
    const itemBrand = text((item.data as Record<string, unknown> | null)?.brand_scope);
    if (!fromBrand || fromBrand !== toBrand || itemBrand !== fromBrand) return result({ transfer_no: "" }, "โอนได้เฉพาะภายในแบรนด์เดียวกัน");
    const per = num((item.data as Record<string, unknown> | null)?.recipe_per_count_uom) || 1;
    const recipeQty = (Number(input.qty_in_count_uom) || 0) * per;
    const unit = num((item.data as Record<string, unknown> | null)?.moving_avg_cost_per_recipe_unit);
    const id = crypto.randomUUID();
    const transferNo = `FNB-TF-${todayBangkok().replace(/-/g, "")}-${id.slice(0, 4).toUpperCase()}`;
    const header = await db.from("inter_branch_transfers").insert({
      id,
      transfer_no: transferNo,
      from_branch_code: input.from_branch_code,
      to_branch_code: input.to_branch_code,
      transfer_date: todayBangkok(),
      staff_name: staffName,
    });
    if (header.error) return fail({ transfer_no: "" }, header.error, "บันทึกโอนไม่สำเร็จ");
    const line = await db.from("inter_branch_transfer_lines").insert({
      transfer_id: id,
      item_id: input.item_id,
      qty_in_count_uom: Number(input.qty_in_count_uom) || 0,
      total_recipe_qty: recipeQty,
      unit_cost_ex_vat: unit,
    });
    if (line.error) return fail({ transfer_no: transferNo }, line.error, "บันทึกรายการโอนไม่สำเร็จ");
    for (const [branch, delta, tx] of [
      [input.from_branch_code, -recipeQty, "TRANSFER_OUT"],
      [input.to_branch_code, recipeQty, "TRANSFER_IN"],
    ] as const) {
      const ledger = await db.from("stock_ledger").insert({
        branch_code: branch,
        item_id: input.item_id,
        tx_date: todayBangkok(),
        tx_type: tx,
        qty_delta: delta,
        unit_cost_ex_vat: unit,
        total_cost_ex_vat: Math.abs(delta) * unit,
        ref_table: "inter_branch_transfers",
        ref_id: id,
      });
      if (ledger.error) return fail({ transfer_no: transferNo }, ledger.error, "ลงสต็อกโอนไม่สำเร็จ");
    }
    return result({ transfer_no: transferNo });
  } catch (error) {
    return caught({ transfer_no: "" }, error, "บันทึกโอนไม่สำเร็จ");
  }
}

export async function submitBlindCountAction(input: {
  branch_code: string;
  staff_name: string;
  actor_source?: string;
  lines: { item_id: string; closed_pack_count: number; open_pack_weight_g: number }[];
}): Promise<FnbActionResult<{ count_no: string; lines: { short_code: string; counted: number; system: number; variance: number; cost: number }[] }>> {
  try {
    const ctx = await requireFnbModuleAccess("branch_inventory_transfer");
    if (!branchAllowed(ctx, input.branch_code)) return result({ count_no: "", lines: [] }, "ไม่มีสิทธิ์นับสต็อกของสาขานี้");
    const actor = await resolveFnbActor({ actorSource: input.actor_source ?? "desktop", brandLock: null, branchCode: input.branch_code });
    if (!actor.ok) return result({ count_no: "", lines: [] }, actor.error);
    const staffName = actor.actor.name;
    const db = schemaAdmin().schema("fnb");
    const items = await db.from("items").select("id,short_code,recipe_uom,recipe_per_count_uom,specific_gravity,tare_weight_g,moving_avg_cost_per_recipe_unit").limit(500);
    const ledger = await db.from("stock_ledger").select("item_id,qty_delta").eq("branch_code", input.branch_code).limit(5000);
    if (items.error || ledger.error) return fail({ count_no: "", lines: [] }, items.error ?? ledger.error, "อ่านสต็อกสำหรับนับไม่สำเร็จ");
    const catalog = new Map(asRows(items.data).map((row) => [text(row.id), row]));
    const system = new Map<string, number>();
    for (const row of asRows(ledger.data)) {
      system.set(text(row.item_id), (system.get(text(row.item_id)) ?? 0) + num(row.qty_delta));
    }
    const id = crypto.randomUUID();
    const countNo = `FNB-BC-${todayBangkok().replace(/-/g, "")}-${id.slice(0, 4).toUpperCase()}`;
    const header = await db.from("blind_stock_counts").insert({
      id,
      count_no: countNo,
      branch_code: input.branch_code,
      count_date: todayBangkok(),
      staff_name: staffName,
      status: "SUBMITTED",
    });
    if (header.error) return fail({ count_no: "", lines: [] }, header.error, "บันทึกใบนับไม่สำเร็จ");
    const report: { short_code: string; counted: number; system: number; variance: number; cost: number }[] = [];
    for (const line of input.lines) {
      const item = catalog.get(line.item_id);
      if (!item) continue;
      const per = num(item.recipe_per_count_uom) || 1;
      const gravity = num(item.specific_gravity) || 1;
      const openGrams = Math.max(0, Number(line.open_pack_weight_g) - num(item.tare_weight_g));
      const openRecipe = text(item.recipe_uom) === "ml" ? openGrams / gravity : openGrams;
      const counted = (Number(line.closed_pack_count) || 0) * per + (text(item.recipe_uom) === "pcs" ? 0 : openRecipe);
      const systemQty = system.get(line.item_id) ?? 0;
      const variance = counted - systemQty;
      const cost = variance * num(item.moving_avg_cost_per_recipe_unit);
      const inserted = await db.from("blind_stock_count_lines").insert({
        count_id: id,
        item_id: line.item_id,
        closed_pack_count: Number(line.closed_pack_count) || 0,
        open_pack_weight_g: Number(line.open_pack_weight_g) || 0,
        counted_recipe_qty: counted,
        system_recipe_qty: systemQty,
        variance_recipe_qty: variance,
        variance_cost_thb: cost,
      });
      if (inserted.error) return fail({ count_no: countNo, lines: report }, inserted.error, "บันทึกบรรทัดนับไม่สำเร็จ");
      const showSystem = ctx.isSuperAdmin || !ctx.fnbGuardrailPermissions.enforce_blind_count;
      const showCost = ctx.isSuperAdmin || ctx.fnbGuardrailPermissions.can_view_cost_price;
      report.push({
        short_code: text(item.short_code),
        counted,
        system: showSystem ? systemQty : 0,
        variance: showSystem ? variance : 0,
        cost: showCost ? cost : 0,
      });
    }
    return result({ count_no: countNo, lines: report });
  } catch (error) {
    return caught({ count_no: "", lines: [] }, error, "บันทึกใบนับไม่สำเร็จ");
  }
}

export async function listBrandCountItemsAction(brand: string): Promise<FnbActionResult<{ id: string; short_code: string; name_th: string; item_category: string; display_sub_group: string; count_uom: string; allow_decimal_count_qty: boolean; recipe_per_count_uom: number; recipe_uom: string; is_catch_weight_produce: boolean; piece_uom_label: string; avg_gross_grams_per_piece: number; prep_yield_pct: number; default_date_stamp_mode: string; shelf_life_value: number; shelf_life_unit: string; tare_weight_g: number; specific_gravity: number; image_urls: string[]; image_captions: string[] }[]>> {
  try {
    await requireFnbModuleAccess("branch_inventory_transfer");
    const listed = await schemaAdmin().schema("fnb").from("items").select("id,short_code,name_th,item_category,display_sub_group,count_uom,recipe_uom,allow_decimal_count_qty,recipe_per_count_uom,brand_scope,is_active,is_catch_weight_produce,piece_uom_label,avg_gross_grams_per_piece,prep_yield_pct,default_date_stamp_mode,shelf_life_value,shelf_life_unit,shelf_life_months,tare_weight_g,specific_gravity,image_urls,image_captions").eq("is_active", true).eq("brand_scope", brand).order("short_code", { ascending: true }).limit(800);
    if (listed.error) return fail([], listed.error, "อ่านสินค้าแบรนด์ไม่สำเร็จ");
    return result(asRows(listed.data).map((row) => ({
      id: text(row.id),
      short_code: text(row.short_code),
      name_th: text(row.name_th),
      item_category: text(row.item_category),
      count_uom: text(row.count_uom) || "ชิ้น",
      allow_decimal_count_qty: row.allow_decimal_count_qty === true,
      recipe_per_count_uom: num(row.recipe_per_count_uom) || 1,
      recipe_uom: text(row.recipe_uom) || "g",
      is_catch_weight_produce: row.is_catch_weight_produce === true,
      piece_uom_label: text(row.piece_uom_label) || "ลูก",
      avg_gross_grams_per_piece: num(row.avg_gross_grams_per_piece) || 110,
      prep_yield_pct: num(row.prep_yield_pct) || 80,
      default_date_stamp_mode: text(row.default_date_stamp_mode) || "MFD",
      shelf_life_value: num(row.shelf_life_value) || num(row.shelf_life_months) || 12,
      shelf_life_unit: text(row.shelf_life_unit) || "MONTHS",
      tare_weight_g: num(row.tare_weight_g),
      specific_gravity: num(row.specific_gravity) || 1,
      image_urls: Array.isArray(row.image_urls) ? row.image_urls.map((url) => text(url)).filter(Boolean) : [],
      image_captions: Array.isArray(row.image_captions) ? row.image_captions.map((caption) => text(caption)) : [],
      display_sub_group: text(row.display_sub_group),
    })));
  } catch (error) {
    return caught([], error, "อ่านสินค้าแบรนด์ไม่สำเร็จ");
  }
}

function mapCountItem(row: Record<string, unknown>) {
  return {
    id: text(row.id),
    short_code: text(row.short_code),
    name_th: text(row.name_th),
    item_category: text(row.item_category),
    count_uom: text(row.count_uom) || "ชิ้น",
    allow_decimal_count_qty: row.allow_decimal_count_qty === true,
    recipe_per_count_uom: num(row.recipe_per_count_uom) || 1,
    recipe_uom: text(row.recipe_uom) || "g",
    is_catch_weight_produce: row.is_catch_weight_produce === true,
    piece_uom_label: text(row.piece_uom_label) || "ลูก",
    avg_gross_grams_per_piece: num(row.avg_gross_grams_per_piece) || 110,
    prep_yield_pct: num(row.prep_yield_pct) || 80,
    default_date_stamp_mode: text(row.default_date_stamp_mode) || "MFD",
    shelf_life_value: num(row.shelf_life_value) || num(row.shelf_life_months) || 12,
    shelf_life_unit: text(row.shelf_life_unit) || "MONTHS",
    tare_weight_g: num(row.tare_weight_g),
    specific_gravity: num(row.specific_gravity) || 1,
    image_urls: Array.isArray(row.image_urls) ? row.image_urls.map((url) => text(url)).filter(Boolean) : [],
    image_captions: Array.isArray(row.image_captions) ? row.image_captions.map((caption) => text(caption)) : [],
    display_sub_group: text(row.display_sub_group),
  };
}

export async function listStoreCountItemsAction(branchCode: string) {
  try {
    const access = await requireFnbStoreOperationAccess(branchCode);
    if (!access.ok) return result([] as ReturnType<typeof mapCountItem>[], access.error);
    const branch = await schemaAdmin().schema("fnb").from("branches").select("brand_code").eq("branch_code", branchCode).maybeSingle();
    const brand = text((branch.data as { brand_code?: string } | null)?.brand_code);
    const listed = await schemaAdmin().schema("fnb").from("items").select("id,short_code,name_th,item_category,display_sub_group,count_uom,recipe_uom,allow_decimal_count_qty,recipe_per_count_uom,brand_scope,is_active,is_catch_weight_produce,piece_uom_label,avg_gross_grams_per_piece,prep_yield_pct,default_date_stamp_mode,shelf_life_value,shelf_life_unit,shelf_life_months,tare_weight_g,specific_gravity,image_urls,image_captions").eq("is_active", true).eq("brand_scope", brand).order("short_code", { ascending: true }).limit(800);
    if (listed.error) return fail([], listed.error, "อ่านสินค้าแบรนด์ไม่สำเร็จ");
    return result(asRows(listed.data).map(mapCountItem));
  } catch (error) {
    return caught([], error, "อ่านสินค้าแบรนด์ไม่สำเร็จ");
  }
}

export async function saveSingleInventoryItemCountAction(input: {
  branch_code: string;
  location_code: string;
  count_date: string;
  item_id: string;
  sealed_pack_qty: number;
  open_pack_gross_weight_g: number;
  expiry_lots: { entry_mode: string; mfg_date: string; shelf_life_value: number; shelf_life_unit: string; expiry_date: string; qty: number }[];
  notes?: string;
}): Promise<FnbActionResult<{ ok: boolean; saved_by: string; saved_at: string }>> {
  const blank = { ok: false, saved_by: "", saved_at: "" };
  try {
    const access = await requireFnbStoreOperationAccess(input.branch_code);
    if (!access.ok) return result(blank, access.error);
    const saved = await callFnbRpc("save_single_inventory_item_count_atomic", {
      p_branch_code: input.branch_code,
      p_location_code: input.location_code,
      p_count_date: input.count_date || todayBangkok(),
      p_item_id: input.item_id,
      p_sealed_pack_qty: Number(input.sealed_pack_qty) || 0,
      p_open_pack_gross_weight_g: Number(input.open_pack_gross_weight_g) || 0,
      p_expiry_lots_json: input.expiry_lots.filter((lot) => Number(lot.qty) > 0).map((lot) => ({
        entry_mode: lot.entry_mode,
        mfg_date: lot.mfg_date || null,
        shelf_life_value: Number(lot.shelf_life_value) || null,
        shelf_life_unit: lot.shelf_life_unit,
        expiry_date: lot.expiry_date || null,
        qty: Number(lot.qty) || 0,
      })),
      p_staff_name: access.displayActorName,
      p_user_id: access.userId,
      p_post_stock_adjustment: true,
      p_notes: input.notes || null,
    });
    if (saved.error) return fail(blank, saved.error, "บันทึกรายการนับไม่สำเร็จ");
    const body = saved.data && typeof saved.data === "object" ? saved.data as Record<string, unknown> : {};
    if (body.ok !== true) return result(blank, text(body.error) || "บันทึกรายการนับไม่สำเร็จ");
    return result({ ok: true, saved_by: text(body.saved_by) || access.displayActorName, saved_at: text(body.saved_at) });
  } catch (error) {
    return caught(blank, error, "บันทึกรายการนับไม่สำเร็จ");
  }
}

export async function getFnbItemStockCardAction(input: {
  branch_code: string;
  item_id: string;
  location_code: string;
  from_date: string;
  to_date: string;
}): Promise<FnbActionResult<FnbStockCard | null>> {
  try {
    const access = await requireFnbStoreOperationAccess(input.branch_code);
    if (!access.ok) return result(null, access.error);
    const saved = await callFnbRpc("get_fnb_item_stock_card", {
      p_branch_code: input.branch_code,
      p_item_id: input.item_id,
      p_location_code: input.location_code || "ALL",
      p_from_date: input.from_date || null,
      p_to_date: input.to_date || null,
    });
    if (saved.error) return fail(null, saved.error, "อ่านบัตรสต็อกไม่สำเร็จ");
    const body = saved.data && typeof saved.data === "object" ? saved.data as Record<string, unknown> : {};
    if (body.ok !== true) return result(null, text(body.error) || "อ่านบัตรสต็อกไม่สำเร็จ");
    const movements = (Array.isArray(body.movements) ? body.movements : []).map((row) => {
      const rec = row && typeof row === "object" ? row as Record<string, unknown> : {};
      const movement: FnbStockCardMovement = {
        id: text(rec.id),
        tx_datetime_th: text(rec.tx_datetime_th),
        location_name_th: text(rec.location_name_th),
        actor_name: text(rec.actor_name),
        tx_type: text(rec.tx_type),
        notes: text(rec.notes),
        in_count_qty: num(rec.in_count_qty),
        out_count_qty: num(rec.out_count_qty),
        balance_count_qty: num(rec.balance_count_qty),
        in_recipe_qty: num(rec.in_recipe_qty),
        out_recipe_qty: num(rec.out_recipe_qty),
        balance_recipe_qty: num(rec.balance_recipe_qty),
      };
      return movement;
    });
    const lotRows = await schemaAdmin().schema("fnb").from("inventory_expiry_lots").select("location_code,entry_mode,mfg_date,expiry_date,lot_qty_in_count_uom,count_uom").eq("branch_code", input.branch_code).eq("item_id", input.item_id).gt("lot_qty_in_count_uom", 0).order("expiry_date", { ascending: true }).limit(40);
    const expiryLots: FnbStockCardLot[] = asRows(lotRows.data).filter((row) => !input.location_code || input.location_code === "ALL" || text(row.location_code) === input.location_code).map((row) => ({
      location_code: text(row.location_code),
      entry_mode: text(row.entry_mode),
      mfg_date: text(row.mfg_date),
      expiry_date: text(row.expiry_date),
      qty: num(row.lot_qty_in_count_uom),
      uom: text(row.count_uom),
    }));
    return result({
      ok: true,
      short_code: text(body.short_code),
      name_th: text(body.name_th),
      count_uom: text(body.count_uom),
      recipe_uom: text(body.recipe_uom),
      recipe_per_count_uom: num(body.recipe_per_count_uom) || 1,
      from_date: text(body.from_date),
      to_date: text(body.to_date),
      brought_forward_count_qty: num(body.brought_forward_count_qty),
      brought_forward_recipe_qty: num(body.brought_forward_recipe_qty),
      closing_count_qty: num(body.closing_count_qty),
      closing_recipe_qty: num(body.closing_recipe_qty),
      movements,
      expiry_lots: expiryLots,
    });
  } catch (error) {
    return caught(null, error, "อ่านบัตรสต็อกไม่สำเร็จ");
  }
}

export async function getExecutiveInventoryOverviewAction(branchCode: string): Promise<FnbActionResult<FnbExecutiveInventory | null>> {
  try {
    const access = await requireFnbStoreOperationAccess(branchCode);
    if (!access.ok) return result(null, access.error);
    const saved = await callFnbRpc("get_executive_inventory_overview", { p_branch_code: branchCode });
    if (saved.error) return fail(null, saved.error, "อ่านภาพรวมสต็อกไม่สำเร็จ");
    const body = saved.data && typeof saved.data === "object" ? saved.data as Record<string, unknown> : {};
    if (body.ok !== true) return result(null, text(body.error) || "อ่านภาพรวมสต็อกไม่สำเร็จ");
    const canView = access.ctx.isSuperAdmin || access.ctx.fnbGuardrailPermissions.can_view_cost_price;
    const zoneRows = await schemaAdmin().schema("fnb").from("storage_locations").select("location_code,location_name_th,short_label,sort_order").eq("branch_code", branchCode).eq("is_active", true).order("sort_order", { ascending: true }).limit(40);
    const zoneShort = new Map(asRows(zoneRows.error ? [] : zoneRows.data).map((row) => [text(row.location_code), text(row.short_label)]));
    const subgroupRows = await schemaAdmin().schema("fnb").from("items").select("id,display_sub_group").eq("is_active", true).limit(800);
    const subgroups = new Map(asRows(subgroupRows.data).map((row) => [text(row.id), text(row.display_sub_group)]));
    const locations = (Array.isArray(body.locations) ? body.locations : []).map((row) => {
      const rec = row && typeof row === "object" ? row as Record<string, unknown> : {};
      const code = text(rec.location_code);
      return { location_code: code, location_name_th: text(rec.location_name_th), short_label: text(rec.short_label) || zoneShort.get(code) || "" };
    });
    const items: FnbExecutiveInventoryItem[] = (Array.isArray(body.items) ? body.items : []).map((row) => {
      const rec = row && typeof row === "object" ? row as Record<string, unknown> : {};
      const per = num(rec.recipe_per_count_uom) || 1;
      const recipeByLocation = rec.by_location_recipe_qty && typeof rec.by_location_recipe_qty === "object" ? rec.by_location_recipe_qty as Record<string, unknown> : {};
      const byLocation: Record<string, number> = {};
      for (const [code, qty] of Object.entries(recipeByLocation)) byLocation[code] = Math.round((num(qty) / per) * 100) / 100;
      const lots = (Array.isArray(rec.expiry_lots) ? rec.expiry_lots : []).map((lot) => {
        const item = lot && typeof lot === "object" ? lot as Record<string, unknown> : {};
        return { location_code: text(item.location_code), mfg_date: text(item.mfg_date), expiry_date: text(item.expiry_date), qty: num(item.qty), uom: text(item.uom) };
      });
      return {
        item_id: text(rec.item_id),
        short_code: text(rec.short_code),
        name_th: text(rec.name_th),
        item_category: text(rec.item_category),
        image_urls: Array.isArray(rec.image_urls) ? rec.image_urls.map((url) => text(url)).filter(Boolean) : [],
        image_captions: Array.isArray(rec.image_captions) ? rec.image_captions.map((caption) => text(caption)) : [],
        recipe_uom: text(rec.recipe_uom) || "g",
        count_uom: text(rec.count_uom) || "ชิ้น",
        recipe_per_count_uom: per,
        reorder_point_count_qty: num(rec.reorder_point_count_qty),
        total_recipe_qty: num(rec.total_recipe_qty),
        total_count_qty: num(rec.total_count_qty),
        by_location_count_qty: byLocation,
        total_stock_value_thb: canView ? num(rec.total_stock_value_thb) : null,
        nearest_expiry_date: text(rec.nearest_expiry_date),
        expiry_lots: lots,
        last_counted_at: text(rec.last_counted_at),
        last_counted_by: text(rec.last_counted_by),
        open_pack_net_recipe_qty: num(rec.open_pack_net_recipe_qty),
        display_sub_group: text(rec.display_sub_group) || subgroups.get(text(rec.item_id)) || "",
        unit_cost_per_count_uom: canView ? num(rec.unit_cost_per_count_uom) || num(rec.unit_cost) || (num(rec.total_count_qty) ? Math.round((num(rec.total_stock_value_thb) / num(rec.total_count_qty)) * 100) / 100 : 0) : null,
        active_lot_count: num(rec.active_lot_count) || lots.length,
      };
    });
    const stockValue = canView ? items.reduce((sum, item) => sum + (item.total_stock_value_thb ?? 0), 0) : null;
    return result({
      branch_code: text(body.branch_code),
      branch_name_th: text(body.branch_name_th),
      locations,
      items,
      stock_value_thb: stockValue,
    });
  } catch (error) {
    return caught(null, error, "อ่านภาพรวมสต็อกไม่สำเร็จ");
  }
}
