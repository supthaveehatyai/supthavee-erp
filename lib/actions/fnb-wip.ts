"use server";

import { resolveFnbActor } from "@/lib/fnb/actor";
import { callFnbRpc } from "@/lib/fnb/rpc";
import { asRows, caught, fail, num, result, text, todayBangkok } from "@/lib/fnb/rows";
import { requireFnbModuleAccess } from "@/lib/holding/workspace-access";
import { schemaAdmin } from "@/lib/holding/schema-db";
import type {
  FnbActionResult,
  FnbBrandCode,
  FnbClosingWipContext,
  FnbOpenShelfMode,
  FnbOpenShelfRule,
  FnbWipBatchRow,
  FnbWipBoard,
  FnbWipCostRow,
} from "@/types/fnb";

const MODES = new Set<FnbOpenShelfMode>(["DAILY_EOD", "HOURS_AFTER_OPEN", "DAYS_AFTER_OPEN", "NONE"]);
const LOCKED = new Set(["JT", "BT", "MMK", "ML", "LEM"]);
const OPENING_PREP = new Set(["OP_BREW_JT", "OP_BREW_BT", "OP_MIX_MATCHA"]);

function brandOf(value: unknown): FnbBrandCode | null {
  const brand = text(value);
  return brand === "LUCKY_CUP" || brand === "CHATORN" ? brand : null;
}

function keepsBrand(label: string, scope: string, brand: FnbBrandCode | null): boolean {
  if (brand && scope !== "ALL" && scope !== brand) return false;
  if (brand === "LUCKY_CUP" && /ชาทร|chatorn/i.test(label)) return false;
  if (brand === "CHATORN" && /lucky\s*cup|ลัคกี้|luckycup/i.test(label)) return false;
  return true;
}

function mapBatch(row: Record<string, unknown>, label: string): FnbWipBatchRow {
  return {
    id: text(row.id),
    batch_no: text(row.batch_no),
    batch_kind: text(row.batch_kind),
    prep_base_code: row.prep_base_code == null ? null : text(row.prep_base_code),
    item_id: row.item_id == null ? null : text(row.item_id),
    item_label: label,
    brew_portion_mode: text(row.brew_portion_mode),
    packs_deducted: num(row.packs_deducted),
    actual_usable_qty: num(row.actual_usable_qty),
    recipe_uom: text(row.recipe_uom),
    total_issued_cost_thb: num(row.total_issued_cost_thb),
    unbrewed_rule_cost_thb: num(row.unbrewed_rule_cost_thb),
    shelf_life_mode: text(row.shelf_life_mode),
    opened_at: text(row.opened_at),
    expires_at: text(row.expires_at),
    sticker_label_text: row.sticker_label_text == null ? null : text(row.sticker_label_text),
    opened_by_name: text(row.opened_by_name),
    batch_status: text(row.batch_status),
    theoretical_full_qty: num(row.theoretical_full_qty),
    waste_qty: num(row.waste_qty),
    waste_cost_thb: num(row.waste_cost_thb),
  };
}

async function actorFrom(input: { actorSource: string | null; brandLock: string | null; branchCode: string | null }) {
  return resolveFnbActor(input);
}

export async function listOpenShelfRulesAction(): Promise<FnbActionResult<{ locked: FnbOpenShelfRule[]; rules: FnbOpenShelfRule[] }>> {
  const empty = { locked: [] as FnbOpenShelfRule[], rules: [] as FnbOpenShelfRule[] };
  try {
    await requireFnbModuleAccess("master_items_bom");
    const db = schemaAdmin().schema("fnb");
    const [items, rules, bases] = await Promise.all([
      db.from("items").select("id, short_code, name_th, brand_scope").eq("is_active", true).order("short_code", { ascending: true }).limit(2000),
      db.from("item_open_shelf_life_rules").select("*").limit(2000),
      db.from("prep_bases").select("base_code, base_name_th, open_shelf_life_mode, open_shelf_life_value").limit(20),
    ]);
    if (items.error) return fail(empty, items.error, "อ่านวัตถุดิบไม่สำเร็จ");
    const byItem = new Map<string, Record<string, unknown>[]>();
    for (const row of asRows(rules.data)) {
      const id = text(row.item_id);
      byItem.set(id, [...(byItem.get(id) ?? []), row]);
    }
    const locked: FnbOpenShelfRule[] = asRows(bases.data)
      .filter((row) => LOCKED.has(text(row.base_code)))
      .map((row) => ({
        id: null,
        item_id: null,
        short_code: text(row.base_code),
        name_th: text(row.base_name_th),
        brand_code: "ALL",
        open_shelf_life_mode: "DAILY_EOD",
        open_shelf_life_value: 1,
        require_expiry_clear_photo: true,
        locked: true,
      }));
    const catalog = asRows(items.data);
    const lemon = catalog.find((row) => text(row.short_code) === "LEM");
    if (lemon) {
      locked.push({
        id: null,
        item_id: text(lemon.id),
        short_code: "LEM",
        name_th: text(lemon.name_th),
        brand_code: "ALL",
        open_shelf_life_mode: "DAILY_EOD",
        open_shelf_life_value: 1,
        require_expiry_clear_photo: true,
        locked: true,
      });
    }
    const saved: FnbOpenShelfRule[] = [];
    for (const item of catalog) {
      if (LOCKED.has(text(item.short_code))) continue;
      const rows = byItem.get(text(item.id)) ?? [];
      if (rows.length === 0) {
        saved.push({
          id: null,
          item_id: text(item.id),
          short_code: text(item.short_code),
          name_th: text(item.name_th),
          brand_code: "ALL",
          open_shelf_life_mode: "NONE",
          open_shelf_life_value: 0,
          require_expiry_clear_photo: true,
          locked: false,
        });
        continue;
      }
      for (const row of rows) {
        const mode = text(row.open_shelf_life_mode);
        const brand = text(row.brand_code);
        saved.push({
          id: text(row.id),
          item_id: text(item.id),
          short_code: text(item.short_code),
          name_th: text(item.name_th),
          brand_code: brand === "LUCKY_CUP" || brand === "CHATORN" ? brand : "ALL",
          open_shelf_life_mode: MODES.has(mode as FnbOpenShelfMode) ? mode as FnbOpenShelfMode : "NONE",
          open_shelf_life_value: num(row.open_shelf_life_value),
          require_expiry_clear_photo: row.require_expiry_clear_photo !== false,
          locked: false,
        });
      }
    }
    return result({ locked, rules: saved });
  } catch (error) {
    return caught(empty, error, "อ่านอายุหลังเปิดใช้ไม่สำเร็จ");
  }
}

export async function saveOpenShelfRuleAction(formData: FormData): Promise<FnbActionResult<{ ok: boolean }>> {
  try {
    await requireFnbModuleAccess("master_items_bom");
    const itemId = text(formData.get("item_id"));
    const code = text(formData.get("short_code")).toUpperCase();
    if (!itemId) return result({ ok: false }, "ไม่พบวัตถุดิบ");
    if (LOCKED.has(code)) return result({ ok: false }, "รายการนี้บังคับเคลียร์ทิ้งตอนปิดร้านทุกวัน");
    const mode = text(formData.get("open_shelf_life_mode"));
    const brand = text(formData.get("brand_code"));
    const value = Number(formData.get("open_shelf_life_value") ?? 0) || 0;
    if (!MODES.has(mode as FnbOpenShelfMode)) return result({ ok: false }, "เลือกโหมดอายุหลังเปิดใช้");
    if ((mode === "HOURS_AFTER_OPEN" || mode === "DAYS_AFTER_OPEN") && value < 1) return result({ ok: false }, "กรอกจำนวนชั่วโมงหรือจำนวนวัน");
    const payload = {
      item_id: itemId,
      brand_code: brand === "LUCKY_CUP" || brand === "CHATORN" ? brand : "ALL",
      open_shelf_life_mode: mode,
      open_shelf_life_value: mode === "NONE" || mode === "DAILY_EOD" ? (mode === "DAILY_EOD" ? 1 : 0) : value,
      require_expiry_clear_photo: formData.get("require_expiry_clear_photo") === "true",
      updated_at: new Date().toISOString(),
    };
    const db = schemaAdmin().schema("fnb");
    const existing = await db.from("item_open_shelf_life_rules").select("id").eq("item_id", itemId).eq("brand_code", payload.brand_code).maybeSingle();
    if (existing.error) return fail({ ok: false }, existing.error, "บันทึกอายุหลังเปิดใช้ไม่สำเร็จ");
    const current = existing.data && typeof existing.data === "object" ? existing.data as Record<string, unknown> : null;
    const written = current?.id
      ? await db.from("item_open_shelf_life_rules").update(payload).eq("id", text(current.id))
      : await db.from("item_open_shelf_life_rules").insert(payload);
    if (written.error) return fail({ ok: false }, written.error, "บันทึกอายุหลังเปิดใช้ไม่สำเร็จ");
    return result({ ok: true });
  } catch (error) {
    return caught({ ok: false }, error, "บันทึกอายุหลังเปิดใช้ไม่สำเร็จ");
  }
}

export async function listWipBoardAction(input: {
  branch_code: string;
  work_date: string;
  brand_lock?: FnbBrandCode | null;
  actor_source: string;
}): Promise<FnbActionResult<FnbWipBoard>> {
  const empty: FnbWipBoard = { bases: [], items: [], brews: [], containers: [] };
  try {
    const actor = await actorFrom({ actorSource: input.actor_source, brandLock: input.brand_lock ?? null, branchCode: input.branch_code });
    if (!actor.ok) return result(empty, actor.error);
    const brand = input.brand_lock ?? actor.actor.brandCode;
    const db = schemaAdmin().schema("fnb");
    const [bases, items, batches] = await Promise.all([
      db.from("prep_bases").select("base_code, base_name_th, yield_qty_ml, brand_code, is_active").eq("is_active", true).limit(20),
      db.from("items").select("id, short_code, name_th, count_uom, brand_scope").eq("is_active", true).order("short_code", { ascending: true }).limit(2000),
      db.from("bar_wip_batches").select("*").eq("branch_code", input.branch_code).limit(500),
    ]);
    if (bases.error) return fail(empty, bases.error, "อ่านเบสไม่สำเร็จ");
    const names = new Map(asRows(items.data).map((row) => [text(row.id), `${text(row.short_code)} ${text(row.name_th)}`]));
    const baseNames = new Map(asRows(bases.data).map((row) => [text(row.base_code), text(row.base_name_th)]));
    const rows = asRows(batches.data).map((row) => ({
      work_date: text(row.work_date),
      batch: mapBatch(row, text(row.prep_base_code) ? baseNames.get(text(row.prep_base_code)) || text(row.prep_base_code) : names.get(text(row.item_id)) || "วัตถุดิบ"),
    }));
    return result({
      bases: asRows(bases.data)
        .filter((row) => keepsBrand(text(row.base_name_th), text(row.brand_code), brand))
        .map((row) => ({ base_code: text(row.base_code), base_name_th: text(row.base_name_th), yield_qty_ml: num(row.yield_qty_ml) })),
      items: asRows(items.data)
        .filter((row) => keepsBrand(`${text(row.short_code)} ${text(row.name_th)}`, text(row.brand_scope), brand))
        .map((row) => ({ id: text(row.id), short_code: text(row.short_code), name_th: text(row.name_th), count_uom: text(row.count_uom) })),
      brews: rows.filter((row) => row.batch.batch_kind === "PREP_BASE" && row.work_date === input.work_date).map((row) => row.batch),
      containers: rows.filter((row) => row.batch.batch_status === "ACTIVE" && (row.batch.shelf_life_mode === "HOURS_AFTER_OPEN" || row.batch.shelf_life_mode === "DAYS_AFTER_OPEN")).map((row) => row.batch),
    });
  } catch (error) {
    return caught(empty, error, "อ่านงานขึ้นบาร์ไม่สำเร็จ");
  }
}

export async function issueWipBatchAction(formData: FormData): Promise<FnbActionResult<{ ok: boolean; sticker: string | null; message: string | null }>> {
  const blank = { ok: false, sticker: null as string | null, message: null as string | null };
  try {
    const actor = await actorFrom({
      actorSource: text(formData.get("actor_source")),
      brandLock: text(formData.get("brand_lock")),
      branchCode: text(formData.get("branch_code")),
    });
    if (!actor.ok) return result(blank, actor.error);
    const saved = await callFnbRpc("issue_bar_wip_batch", {
      p_branch_code: text(formData.get("branch_code")),
      p_work_date: text(formData.get("work_date")) || todayBangkok(),
      p_shift_instance: text(formData.get("shift_instance")) || "SHIFT_1",
      p_batch_kind: text(formData.get("batch_kind")),
      p_prep_base_code: text(formData.get("prep_base_code")) || null,
      p_item_id: text(formData.get("item_id")) || null,
      p_brew_portion_mode: text(formData.get("brew_portion_mode")) || "FULL_RECIPE",
      p_pack_qty: Number(formData.get("pack_qty") ?? 1) || 1,
      p_staff_name: actor.actor.name,
      p_line_user_id: actor.actor.lineUserId,
      p_photo_urls: text(formData.get("photo_urls")).split("|").filter(Boolean),
      p_notes: text(formData.get("notes")) || null,
      p_source_ref_type: "MANUAL_BAR_ISSUE",
      p_source_ref_id: null,
    });
    if (saved.error) return fail(blank, saved.error, "เบิกขึ้นบาร์ไม่สำเร็จ");
    const body = saved.data && typeof saved.data === "object" ? saved.data as Record<string, unknown> : {};
    if (body.ok === false) return result({ ...blank, message: text(body.error) }, text(body.error) || "เบิกขึ้นบาร์ไม่สำเร็จ");
    return result({ ok: true, sticker: text(body.sticker_label_text) || null, message: null });
  } catch (error) {
    return caught(blank, error, "เบิกขึ้นบาร์ไม่สำเร็จ");
  }
}

export async function closeWipBatchAction(formData: FormData): Promise<FnbActionResult<{ ok: boolean; waste_cost_thb: number; loss_pct: number; message: string | null }>> {
  const blank = { ok: false, waste_cost_thb: 0, loss_pct: 0, message: null as string | null };
  try {
    const actor = await actorFrom({
      actorSource: text(formData.get("actor_source")),
      brandLock: text(formData.get("brand_lock")),
      branchCode: text(formData.get("branch_code")),
    });
    if (!actor.ok) return result(blank, actor.error);
    const mode = text(formData.get("close_mode"));
    const photos = text(formData.get("photo_urls")).split("|").filter(Boolean);
    if (mode === "EXPIRED_DUMPED") {
      const batch = await schemaAdmin().schema("fnb").from("bar_wip_batches").select("item_id, brand_code").eq("id", text(formData.get("batch_id"))).maybeSingle();
      const itemId = text((batch.data as Record<string, unknown> | null)?.item_id);
      const brand = text((batch.data as Record<string, unknown> | null)?.brand_code);
      if (itemId) {
        const rules = await schemaAdmin().schema("fnb").from("item_open_shelf_life_rules").select("brand_code, require_expiry_clear_photo").eq("item_id", itemId).limit(5);
        const match = asRows(rules.data).sort((left, right) => (text(left.brand_code) === brand ? -1 : 1) - (text(right.brand_code) === brand ? -1 : 1))[0];
        if ((!match || match.require_expiry_clear_photo !== false) && photos.length === 0) {
          return result({ ...blank, message: "กรุณาถ่ายรูปของเหลือก่อนเคลียร์ทิ้ง" }, "กรุณาถ่ายรูปของเหลือก่อนเคลียร์ทิ้ง");
        }
      }
    }
    const saved = await callFnbRpc("close_open_container_batch", {
      p_batch_id: text(formData.get("batch_id")),
      p_close_mode: text(formData.get("close_mode")),
      p_waste_qty: Number(formData.get("waste_qty") ?? 0) || 0,
      p_staff_name: actor.actor.name,
      p_photo_urls: text(formData.get("photo_urls")).split("|").filter(Boolean),
      p_notes: text(formData.get("notes")) || null,
    });
    if (saved.error) return fail(blank, saved.error, "ปิดภาชนะไม่สำเร็จ");
    const body = saved.data && typeof saved.data === "object" ? saved.data as Record<string, unknown> : {};
    if (body.ok === false) return result({ ...blank, message: text(body.error) }, text(body.error) || "ปิดภาชนะไม่สำเร็จ");
    return result({ ok: true, waste_cost_thb: num(body.waste_cost_thb), loss_pct: num(body.loss_pct), message: null });
  } catch (error) {
    return caught(blank, error, "ปิดภาชนะไม่สำเร็จ");
  }
}

export async function getClosingWipContextAction(branchCode: string, workDate: string): Promise<FnbActionResult<FnbClosingWipContext>> {
  const empty: FnbClosingWipContext = { brews: [], expired: [] };
  try {
    const listed = await schemaAdmin().schema("fnb").from("bar_wip_batches").select("*").eq("branch_code", branchCode).limit(500);
    if (listed.error) return fail(empty, listed.error, "อ่านยอดต้มไม่สำเร็จ");
    const rows = asRows(listed.data).map((row) => ({ work_date: text(row.work_date), batch: mapBatch(row, text(row.prep_base_code) || "วัตถุดิบ") }));
    const grouped = new Map<string, FnbClosingWipContext["brews"][number]>();
    for (const entry of rows) {
      const row = entry.batch;
      if (row.batch_kind !== "PREP_BASE" || entry.work_date !== workDate) continue;
      const code = row.prep_base_code || row.item_label;
      const found = grouped.get(code) ?? { code, usable: 0, full_qty: 0, half_qty: 0, packs: 0, cost: 0 };
      found.usable += row.actual_usable_qty;
      found.packs += row.packs_deducted;
      found.cost += row.total_issued_cost_thb;
      if (row.brew_portion_mode === "HALF_LIQUID_FULL_PACK") found.half_qty += row.actual_usable_qty;
      else found.full_qty += row.actual_usable_qty;
      grouped.set(code, found);
    }
    const end = new Date(`${workDate}T23:59:59+07:00`).getTime();
    const expired = rows.map((row) => row.batch).filter((row) => row.batch_status === "ACTIVE" && (row.shelf_life_mode === "HOURS_AFTER_OPEN" || row.shelf_life_mode === "DAYS_AFTER_OPEN") && new Date(row.expires_at).getTime() <= end);
    return result({ brews: [...grouped.values()], expired });
  } catch (error) {
    return caught(empty, error, "อ่านยอดต้มไม่สำเร็จ");
  }
}

export async function getWipCostAnalyticsAction(startDate: string, endDate: string): Promise<FnbActionResult<FnbWipCostRow[]>> {
  try {
    await requireFnbModuleAccess("all_branch_analytics");
    const db = schemaAdmin().schema("fnb");
    const [batches, waste, sales, ledger] = await Promise.all([
      db.from("bar_wip_batches").select("branch_code, work_date, total_issued_cost_thb, unbrewed_rule_cost_thb, shelf_life_mode, batch_status, waste_cost_thb, closed_at").limit(5000),
      db.from("daily_waste_logs").select("branch_code, work_date, total_waste_cost_thb").gte("work_date", startDate).lte("work_date", endDate).limit(2000),
      db.from("daily_menu_sales_lines").select("branch_code, work_date, estimated_bom_cost").gte("work_date", startDate).lte("work_date", endDate).limit(5000),
      db.from("stock_ledger").select("branch_code, tx_date, tx_type, total_cost_ex_vat").eq("tx_type", "POS_SALE_OUT").gte("tx_date", startDate).lte("tx_date", endDate).limit(5000),
    ]);
    if (batches.error) return fail([], batches.error, "อ่านต้นทุน WIP ไม่สำเร็จ");
    const rows = new Map<string, FnbWipCostRow>();
    const ensure = (code: string) => {
      const found = rows.get(code) ?? { branch_code: code, issued_cost: 0, sold_cogs: 0, eod_waste: 0, eod_waste_pct: 0, franchise_rule_cost: 0, multi_day_waste: 0, multi_day_waste_pct: 0, unexplained: 0 };
      rows.set(code, found);
      return found;
    };
    for (const row of asRows(batches.data)) {
      const workDate = text(row.work_date);
      const bucket = ensure(text(row.branch_code));
      if (workDate >= startDate && workDate <= endDate) {
        bucket.issued_cost += num(row.total_issued_cost_thb);
        bucket.franchise_rule_cost += num(row.unbrewed_rule_cost_thb);
      }
      const closed = text(row.closed_at).slice(0, 10);
      const multi = row.shelf_life_mode === "HOURS_AFTER_OPEN" || row.shelf_life_mode === "DAYS_AFTER_OPEN";
      if (text(row.batch_status) === "EXPIRED_DUMPED" && multi && closed >= startDate && closed <= endDate) {
        bucket.multi_day_waste += num(row.waste_cost_thb);
      }
    }
    for (const row of asRows(waste.data)) ensure(text(row.branch_code)).eod_waste += num(row.total_waste_cost_thb);
    const soldLedger = new Map<string, number>();
    for (const row of asRows(ledger.data)) {
      const code = text(row.branch_code);
      soldLedger.set(code, (soldLedger.get(code) ?? 0) + Math.abs(num(row.total_cost_ex_vat)));
    }
    const soldMenu = new Map<string, number>();
    for (const row of asRows(sales.data)) {
      const code = text(row.branch_code);
      soldMenu.set(code, (soldMenu.get(code) ?? 0) + num(row.estimated_bom_cost));
    }
    for (const bucket of rows.values()) {
      bucket.sold_cogs = soldLedger.get(bucket.branch_code) || soldMenu.get(bucket.branch_code) || 0;
      bucket.eod_waste_pct = bucket.issued_cost > 0 ? (bucket.eod_waste / bucket.issued_cost) * 100 : 0;
      bucket.multi_day_waste_pct = bucket.issued_cost > 0 ? (bucket.multi_day_waste / bucket.issued_cost) * 100 : 0;
      bucket.unexplained = bucket.issued_cost - bucket.sold_cogs - bucket.eod_waste - bucket.franchise_rule_cost - bucket.multi_day_waste;
    }
    return result([...rows.values()]);
  } catch (error) {
    return caught([], error, "อ่านต้นทุน WIP ไม่สำเร็จ");
  }
}

export async function issueOpeningPrepFromSopAction(input: {
  branch_code: string;
  work_date: string;
  stage_instance: string;
  template_id: string;
  staff_name: string;
  line_user_id: string | null;
  photo_urls: string[];
}): Promise<string | null> {
  const db = schemaAdmin().schema("fnb");
  const template = await db.from("sop_templates").select("task_code, input_type, linked_prep_base_code").eq("id", input.template_id).maybeSingle();
  const row = template.data && typeof template.data === "object" ? template.data as Record<string, unknown> : null;
  if (!row || text(row.input_type) !== "PREP_BATCH" || !OPENING_PREP.has(text(row.task_code))) return null;
  const submission = await db.from("sop_task_submissions").select("id").eq("branch_code", input.branch_code).eq("work_date", input.work_date).eq("stage_instance", input.stage_instance).eq("template_id", input.template_id).maybeSingle();
  const submissionId = text((submission.data as Record<string, unknown> | null)?.id);
  if (!submissionId) return "บันทึกงานเปิดร้านแล้ว แต่ยังหาเลขรายการเพื่อตัดสต็อกเบสไม่พบ";
  const saved = await callFnbRpc("issue_bar_wip_batch", {
    p_branch_code: input.branch_code,
    p_work_date: input.work_date,
    p_shift_instance: "SHIFT_1",
    p_batch_kind: "PREP_BASE",
    p_prep_base_code: text(row.linked_prep_base_code),
    p_item_id: null,
    p_brew_portion_mode: "FULL_RECIPE",
    p_pack_qty: 1,
    p_staff_name: input.staff_name,
    p_line_user_id: input.line_user_id,
    p_photo_urls: input.photo_urls,
    p_notes: null,
    p_source_ref_type: "SOP_OPENING",
    p_source_ref_id: submissionId,
  });
  if (saved.error) return saved.error.message || "ตัดสต็อกเบสเปิดร้านไม่สำเร็จ";
  const body = saved.data && typeof saved.data === "object" ? saved.data as Record<string, unknown> : {};
  if (body.ok === false) return text(body.error) || "ตัดสต็อกเบสเปิดร้านไม่สำเร็จ";
  return text(body.sticker_label_text) ? `🏷️ เขียนป้ายติดภาชนะ: ${text(body.sticker_label_text)}` : null;
}
