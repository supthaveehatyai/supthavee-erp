"use server";

import { resolveFnbActor } from "@/lib/fnb/actor";
import { asRows, caught, fail, num, result, text, todayBangkok } from "@/lib/fnb/rows";
import { schemaAdmin } from "@/lib/holding/schema-db";
import { requireFnbModuleAccess } from "@/lib/holding/workspace-access";
import type { UserAccessContext } from "@/types/holding";
import type { FnbActionResult, FnbStockBalanceRow } from "@/types/fnb";

function branchAllowed(ctx: UserAccessContext, branchCode: string): boolean {
  if (ctx.isSuperAdmin) return true;
  return ctx.allowedBranchCodes.includes(branchCode);
}

export async function listFnbStockAction(): Promise<FnbActionResult<FnbStockBalanceRow[]>> {
  try {
    const ctx = await requireFnbModuleAccess("branch_inventory_transfer");
    const db = schemaAdmin().schema("fnb");
    const [items, ledger] = await Promise.all([
      db.from("items").select("id,short_code,alias_codes,external_code,name_th,count_uom,recipe_uom,recipe_per_count_uom").eq("is_active", true).limit(500),
      db.from("stock_ledger").select("branch_code,item_id,qty_delta").limit(5000),
    ]);
    if (items.error) return fail([], items.error, "อ่านสินค้าไม่สำเร็จ");
    if (ledger.error) return fail([], ledger.error, "อ่านสต็อกไม่สำเร็จ");
    const catalog = new Map(asRows(items.data).map((row) => [text(row.id), row]));
    const totals = new Map<string, number>();
    for (const row of asRows(ledger.data)) {
      const key = `${text(row.branch_code)}|${text(row.item_id)}`;
      totals.set(key, (totals.get(key) ?? 0) + num(row.qty_delta));
    }
    const balances: FnbStockBalanceRow[] = [];
    for (const [key, qty] of totals) {
      const [branch, itemId] = key.split("|");
      const item = catalog.get(itemId);
      if (!item || Math.abs(qty) < 0.0001) continue;
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
      db.from("branches").select("legal_entity_id").eq("branch_code", input.from_branch_code).maybeSingle(),
      db.from("branches").select("legal_entity_id").eq("branch_code", input.to_branch_code).maybeSingle(),
      db.from("items").select("recipe_per_count_uom,moving_avg_cost_per_recipe_unit").eq("id", input.item_id).maybeSingle(),
    ]);
    if (from.error || to.error || item.error) return fail({ transfer_no: "" }, from.error ?? to.error ?? item.error, "อ่านข้อมูลโอนไม่สำเร็จ");
    const fromEntity = text((from.data as Record<string, unknown> | null)?.legal_entity_id);
    const toEntity = text((to.data as Record<string, unknown> | null)?.legal_entity_id);
    if (!fromEntity || fromEntity !== toEntity) return result({ transfer_no: "" }, "โอนได้เฉพาะสาขาในนิติบุคคลเดียวกัน");
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
