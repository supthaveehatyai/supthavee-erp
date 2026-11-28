"use server";

import { resolveFnbActor } from "@/lib/fnb/actor";
import { fnbMonthLockMessage } from "@/lib/fnb/period-lock";
import { isBackroomDue } from "@/lib/fnb/item-search";
import { bangkokHour } from "@/lib/fnb/stage-progress";
import { callFnbRpc } from "@/lib/fnb/rpc";
import { asRows, caught, fail, num, result, text, todayBangkok } from "@/lib/fnb/rows";
import { schemaAdmin } from "@/lib/holding/schema-db";
import { requireAnyFnbModule, requireFnbModuleAccess, requireFnbStoreOperationAccess } from "@/lib/holding/workspace-access";
import {
  FNB_FRONT_DISPLAY_CATEGORIES,
  FNB_SAUCE_OPEN_DAYS,
  type FnbActionResult,
  type FnbCleaningSpot,
  type FnbStorageZone,
  type FnbStoreDayBoard,
  type FnbZoneCountLine,
} from "@/types/fnb";

const FRONT_CATS = new Set<string>(FNB_FRONT_DISPLAY_CATEGORIES);

function zoneOf(row: Record<string, unknown>): FnbStorageZone {
  return {
    id: text(row.id),
    branchCode: text(row.branch_code),
    locationCode: text(row.location_code),
    locationNameTh: text(row.location_name_th),
    zoneType: text(row.zone_type),
    defaultCountSchedule: text(row.default_count_schedule) || "ON_DEMAND",
    countWeekdays: Array.isArray(row.count_weekdays) ? row.count_weekdays.map((day) => Number(day)) : [],
    isDefaultGrTarget: row.is_default_gr_target === true,
    sortOrder: num(row.sort_order),
  };
}

function spotOf(row: Record<string, unknown>): FnbCleaningSpot {
  const stage = text(row.stage_code) === "CLOSING" ? "CLOSING" : "OPENING";
  return {
    id: text(row.id),
    branchCode: text(row.branch_code),
    stageCode: stage,
    spotNameTh: text(row.spot_name_th),
    sortOrder: num(row.sort_order),
    photoUrl: null,
    scheduleType: text(row.schedule_type) === "WEEKLY" ? "WEEKLY" : "DAILY",
    weekdays: Array.isArray(row.schedule_weekdays) ? row.schedule_weekdays.map((day) => Number(day)).filter((day) => Number.isFinite(day)) : [],
  };
}

async function actorName(branch: string, actorSource: string, brandLock: string): Promise<{ ok: true; name: string; userId: string | null } | { ok: false; error: string }> {
  const actor = await resolveFnbActor({ actorSource, brandLock, branchCode: branch });
  if (!actor.ok) return actor;
  return { ok: true, name: actor.actor.name, userId: actor.actor.userId };
}

export async function listBranchZonesAction(branchCode?: string): Promise<FnbActionResult<FnbStorageZone[]>> {
  try {
    await requireAnyFnbModule(["goods_receipt_expiry", "sop_shift_settings", "branch_inventory_transfer", "store_portal"]);
    const listed = await schemaAdmin().schema("fnb").from("storage_locations").select("id,branch_code,location_code,location_name_th,zone_type,default_count_schedule,count_weekdays,is_default_gr_target,sort_order,is_active").eq("is_active", true).order("sort_order", { ascending: true }).limit(200);
    if (listed.error) return fail([], listed.error, "อ่านจุดจัดเก็บไม่สำเร็จ");
    const rows = asRows(listed.data).map(zoneOf).filter((row) => !branchCode || row.branchCode === branchCode);
    return result(rows);
  } catch (error) {
    return caught([], error, "อ่านจุดจัดเก็บไม่สำเร็จ");
  }
}

export async function saveStorageZoneAction(input: {
  id?: string;
  branchCode: string;
  locationCode: string;
  locationNameTh: string;
  zoneType: string;
  defaultCountSchedule: string;
  countWeekdays: number[];
  isDefaultGrTarget: boolean;
}): Promise<FnbActionResult<{ ok: boolean }>> {
  try {
    const ctx = await requireFnbModuleAccess("sop_shift_settings");
    if (!ctx.isSuperAdmin) return result({ ok: false }, "เฉพาะ Super Admin แก้ไขจุดจัดเก็บได้");
    const payload = {
      branch_code: input.branchCode,
      location_code: input.locationCode.trim().toUpperCase(),
      location_name_th: input.locationNameTh.trim(),
      zone_type: input.zoneType,
      default_count_schedule: input.defaultCountSchedule,
      count_weekdays: input.countWeekdays,
      is_default_gr_target: input.isDefaultGrTarget,
      is_active: true,
    };
    const saved = input.id
      ? await schemaAdmin().schema("fnb").from("storage_locations").update(payload).eq("id", input.id)
      : await schemaAdmin().schema("fnb").from("storage_locations").insert(payload);
    if (saved.error) return fail({ ok: false }, saved.error, "บันทึกจุดจัดเก็บไม่สำเร็จ");
    return result({ ok: true });
  } catch (error) {
    return caught({ ok: false }, error, "บันทึกจุดจัดเก็บไม่สำเร็จ");
  }
}

export async function listCleaningSpotsAction(branchCode: string): Promise<FnbActionResult<FnbCleaningSpot[]>> {
  try {
    const listed = await schemaAdmin().schema("fnb").from("branch_cleaning_spots").select("id,branch_code,stage_code,spot_name_th,sort_order,is_active,schedule_type,schedule_weekdays").eq("branch_code", branchCode).eq("is_active", true).order("sort_order", { ascending: true }).limit(80);
    if (listed.error) return fail([], listed.error, "อ่านจุดความสะอาดไม่สำเร็จ");
    return result(asRows(listed.data).map(spotOf));
  } catch (error) {
    return caught([], error, "อ่านจุดความสะอาดไม่สำเร็จ");
  }
}

export async function saveCleaningSpotAction(input: {
  id?: string;
  branchCode: string;
  stageCode: "OPENING" | "CLOSING";
  spotNameTh: string;
  sortOrder: number;
  scheduleType?: "DAILY" | "WEEKLY";
  weekdays?: number[];
  isActive?: boolean;
}): Promise<FnbActionResult<{ ok: boolean }>> {
  try {
    const ctx = await requireFnbModuleAccess("sop_shift_settings");
    if (!ctx.isSuperAdmin) return result({ ok: false }, "เฉพาะ Super Admin แก้ไขจุดความสะอาดได้");
    const payload: Record<string, unknown> = {
      branch_code: input.branchCode,
      stage_code: input.stageCode,
      spot_name_th: input.spotNameTh.trim(),
      sort_order: Number(input.sortOrder) || 10,
      is_active: input.isActive !== false,
    };
    if (input.scheduleType) {
      payload.schedule_type = input.scheduleType === "WEEKLY" ? "WEEKLY" : "DAILY";
      payload.schedule_weekdays = input.scheduleType === "WEEKLY" ? input.weekdays ?? [] : [];
    }
    const saved = input.id
      ? await schemaAdmin().schema("fnb").from("branch_cleaning_spots").update(payload).eq("id", input.id)
      : await schemaAdmin().schema("fnb").from("branch_cleaning_spots").insert(payload);
    if (saved.error) return fail({ ok: false }, saved.error, "บันทึกจุดความสะอาดไม่สำเร็จ");
    return result({ ok: true });
  } catch (error) {
    return caught({ ok: false }, error, "บันทึกจุดความสะอาดไม่สำเร็จ");
  }
}

export async function copyCleaningSpotsAction(input: { fromBranch: string; toBranch: string; stageCode: "OPENING" | "CLOSING" }): Promise<FnbActionResult<{ ok: boolean }>> {
  try {
    const ctx = await requireFnbModuleAccess("sop_shift_settings");
    if (!ctx.isSuperAdmin) return result({ ok: false }, "เฉพาะ Super Admin คัดลอกจุดตรวจได้");
    if (input.fromBranch === input.toBranch) return result({ ok: false }, "เลือกสาขาต้นทางคนละสาขากับสาขาปัจจุบัน");
    const db = schemaAdmin().schema("fnb");
    const [fromBranch, toBranch] = await Promise.all([
      db.from("branches").select("brand_code").eq("branch_code", input.fromBranch).maybeSingle(),
      db.from("branches").select("brand_code").eq("branch_code", input.toBranch).maybeSingle(),
    ]);
    if (fromBranch.error) return fail({ ok: false }, fromBranch.error, "อ่านสาขาไม่สำเร็จ");
    if (toBranch.error) return fail({ ok: false }, toBranch.error, "อ่านสาขาไม่สำเร็จ");
    const fromBrand = text(fromBranch.data && typeof fromBranch.data === "object" ? (fromBranch.data as Record<string, unknown>).brand_code : "");
    const toBrand = text(toBranch.data && typeof toBranch.data === "object" ? (toBranch.data as Record<string, unknown>).brand_code : "");
    if (!fromBrand || fromBrand !== toBrand) return result({ ok: false }, "คัดลอกได้เฉพาะสาขาในแบรนด์เดียวกัน");
    const listed = await db.from("branch_cleaning_spots").select("spot_name_th,sort_order,schedule_type,schedule_weekdays,branch_code,stage_code,is_active").eq("stage_code", input.stageCode).eq("is_active", true).limit(200);
    if (listed.error) return fail({ ok: false }, listed.error, "อ่านจุดตรวจไม่สำเร็จ");
    const all = asRows(listed.data);
    const existing = new Set(all.filter((row) => text(row.branch_code) === input.toBranch).map((row) => text(row.spot_name_th)));
    const fresh = all.filter((row) => text(row.branch_code) === input.fromBranch && !existing.has(text(row.spot_name_th)));
    if (fresh.length === 0) return result({ ok: true });
    const inserted = await db.from("branch_cleaning_spots").insert(fresh.map((row) => ({
      branch_code: input.toBranch,
      stage_code: input.stageCode,
      spot_name_th: text(row.spot_name_th),
      sort_order: num(row.sort_order) || 10,
      schedule_type: text(row.schedule_type) === "WEEKLY" ? "WEEKLY" : "DAILY",
      schedule_weekdays: Array.isArray(row.schedule_weekdays) ? row.schedule_weekdays : [],
      is_active: true,
    })));
    if (inserted.error) return fail({ ok: false }, inserted.error, "คัดลอกจุดตรวจไม่สำเร็จ");
    return result({ ok: true });
  } catch (error) {
    return caught({ ok: false }, error, "คัดลอกจุดตรวจไม่สำเร็จ");
  }
}

export async function saveCleaningSpotLogAction(input: {
  branchCode: string;
  workDate: string;
  stageCode: "OPENING" | "CLOSING";
  spotId: string;
  statusFlag: "PASSED" | "ISSUE_REPORTED";
  photoUrl: string;
  issueNote?: string;
  actorSource: string;
  brandLock: string;
}): Promise<FnbActionResult<{ ok: boolean; checkedByName: string; checkedAt: string }>> {
  const empty = { ok: false, checkedByName: "", checkedAt: "" };
  try {
    const actor = await actorName(input.branchCode, input.actorSource, input.brandLock);
    if (!actor.ok) return result(empty, actor.error);
    const locked = await fnbMonthLockMessage(input.branchCode, input.workDate, input.brandLock);
    if (locked) return result(empty, locked);
    if (!input.photoUrl) return result(empty, "ถ่ายรูปจุดนี้ก่อนบันทึก");
    const saved = await callFnbRpc("upsert_cleaning_spot_log", {
      p_branch_code: input.branchCode,
      p_work_date: input.workDate,
      p_stage_code: input.stageCode,
      p_spot_id: input.spotId,
      p_status_flag: input.statusFlag,
      p_photo_url: input.photoUrl,
      p_issue_note: input.issueNote || null,
      p_staff_name: actor.name,
      p_user_id: actor.userId,
    });
    if (saved.error) return fail(empty, saved.error, "บันทึกจุดความสะอาดไม่สำเร็จ");
    const body = saved.data && typeof saved.data === "object" ? saved.data as Record<string, unknown> : {};
    if (body.ok === false) return result(empty, text(body.error) || "บันทึกจุดความสะอาดไม่สำเร็จ");
    return result({ ok: true, checkedByName: actor.name, checkedAt: new Date().toISOString() });
  } catch (error) {
    return caught(empty, error, "บันทึกจุดความสะอาดไม่สำเร็จ");
  }
}

export async function getStoreDayBoardAction(branchCode: string, workDate: string, actorSource = "desktop", brandLock = ""): Promise<FnbActionResult<FnbStoreDayBoard | null>> {
  const empty = null;
  try {
    const actor = await resolveFnbActor({ actorSource, brandLock, branchCode });
    if (!actor.ok) return result(empty, actor.error);
    const db = schemaAdmin().schema("fnb");
    const [zones, spots, items, lots, writeOffs, counts, transfers, sales, batches, calibration, receipts] = await Promise.all([
      db.from("storage_locations").select("id,branch_code,location_code,location_name_th,zone_type,default_count_schedule,count_weekdays,is_default_gr_target,sort_order").eq("branch_code", branchCode).eq("is_active", true).order("sort_order", { ascending: true }).limit(20),
      db.from("branch_cleaning_spots").select("id,branch_code,stage_code,spot_name_th,sort_order").eq("branch_code", branchCode).eq("is_active", true).order("sort_order", { ascending: true }).limit(40),
      db.from("items").select("id,short_code,alias_codes,name_th,item_category,count_uom,allow_decimal_count_qty,track_front_display_daily,backroom_count_schedule,backroom_count_weekdays,brand_scope,display_shelf_life_days,display_sub_group,display_walk_order").eq("is_active", true).limit(800),
      db.from("display_chiller_lots").select("id,item_id,remaining_qty,display_expiry_date,effective_day_1,lot_status").eq("branch_code", branchCode).eq("lot_status", "ACTIVE").limit(500),
      db.from("item_write_offs").select("item_id,location_code,qty_in_count_uom").eq("branch_code", branchCode).eq("work_date", workDate).limit(500),
      db.from("zone_stock_counts").select("item_id,location_code,count_stage,count_date,counted_qty,nearest_expiry_date").eq("branch_code", branchCode).gte("count_date", shiftDate(workDate, -14)).lte("count_date", workDate).limit(4000),
      db.from("internal_zone_transfers").select("item_id,to_location_code,qty_in_count_uom").eq("branch_code", branchCode).eq("work_date", workDate).limit(500),
      db.from("daily_menu_sales_lines").select("menu_name_th,qty_sold").eq("branch_code", branchCode).eq("work_date", workDate).limit(2000),
      db.from("bar_wip_batches").select("id,item_id,prep_base_code,expires_at,sticker_label_text,batch_status,packs_deducted,pack_uom").eq("branch_code", branchCode).eq("batch_status", "ACTIVE").limit(200),
      db.from("daily_equipment_calibrations").select("grinder_dose_g,espresso_time_sec,espresso_yield_g,syrup_random_target_g,syrup_measured_actual_g,syrup_adjusted_ok").eq("branch_code", branchCode).eq("work_date", workDate).maybeSingle(),
      db.from("goods_receipts").select("id").eq("receiving_branch_code", branchCode).limit(300),
    ]);
    if (zones.error) return fail(empty, zones.error, "อ่านจุดจัดเก็บไม่สำเร็จ");
    if (lots.error) return fail(empty, lots.error, "อ่านล็อตตู้โชว์ไม่สำเร็จ");
    if (writeOffs.error) return fail(empty, writeOffs.error, "อ่านรายการตัดของเสียไม่สำเร็จ");
    const locations = asRows(zones.data).map(zoneOf);
    const front = locations.find((row) => row.zoneType === "FRONT_DISPLAY");
    const back = locations.find((row) => row.zoneType === "BACKROOM");
    const warehouse = locations.find((row) => row.zoneType === "WAREHOUSE");
    const receiptIds = new Set(asRows(receipts.data).map((row) => text(row.id)));
    const receivedItemIds = new Set<string>();
    if (receiptIds.size > 0) {
      const lines = await db.from("goods_receipt_lines").select("gr_id,item_id").limit(4000);
      for (const row of asRows(lines.data)) {
        if (receiptIds.has(text(row.gr_id)) && text(row.item_id)) receivedItemIds.add(text(row.item_id));
      }
    }
    const catalog = asRows(items.data).map((row) => ({
      id: text(row.id),
      shortCode: text(row.short_code),
      aliases: Array.isArray(row.alias_codes) ? row.alias_codes.map((code) => text(code)) : [],
      nameTh: text(row.name_th),
      category: text(row.item_category),
      trackFront: row.track_front_display_daily === true,
      schedule: text(row.backroom_count_schedule) || "WEEKLY_2X",
      weekdays: Array.isArray(row.backroom_count_weekdays) ? row.backroom_count_weekdays.map((day) => Number(day)) : [],
      countUom: text(row.count_uom) || "ชิ้น",
      allowDecimal: row.allow_decimal_count_qty === true,
      brand: text(row.brand_scope),
      displaySubGroup: text(row.display_sub_group),
      displayWalkOrder: num(row.display_walk_order) || 100,
      shelfLifeDays: num(row.display_shelf_life_days),
    })).filter((item) => (brandLock !== "LUCKY_CUP" && brandLock !== "CHATORN") || item.brand === brandLock);
    const written = new Map<string, number>();
    for (const row of asRows(writeOffs.data)) {
      const key = `${text(row.location_code)}|${text(row.item_id)}`;
      written.set(key, (written.get(key) ?? 0) + num(row.qty_in_count_uom));
    }
    const sold = new Map<string, number>();
    for (const row of asRows(sales.data)) {
      const name = text(row.menu_name_th).toLowerCase();
      const qty = num(row.qty_sold);
      for (const item of catalog) {
        const aliases = [item.shortCode, ...item.aliases].map((code) => code.toLowerCase());
        if (aliases.some((code) => code && name.includes(code)) || name.includes(item.nameTh.toLowerCase())) {
          sold.set(item.id, (sold.get(item.id) ?? 0) + qty);
        }
      }
    }
    const moved = new Map<string, number>();
    for (const row of asRows(transfers.data)) {
      const key = `${text(row.to_location_code)}|${text(row.item_id)}`;
      moved.set(key, (moved.get(key) ?? 0) + num(row.qty_in_count_uom));
    }
    const countRows = asRows(counts.data);
    function lastClose(locationCode: string, itemId: string): number {
      const hits = countRows.filter((row) => text(row.location_code) === locationCode && text(row.item_id) === itemId && text(row.count_stage) === "CLOSING" && text(row.count_date) < workDate);
      hits.sort((left, right) => text(right.count_date).localeCompare(text(left.count_date)));
      return hits[0] ? num(hits[0].counted_qty) : 0;
    }
    function todayCount(locationCode: string, itemId: string, stage: string): { qty: number | null; expiry: string | null } {
      const hit = countRows.find((row) => text(row.location_code) === locationCode && text(row.item_id) === itemId && text(row.count_stage) === stage && text(row.count_date) === workDate);
      return hit ? { qty: num(hit.counted_qty), expiry: text(hit.nearest_expiry_date) || null } : { qty: null, expiry: null };
    }
    function lineFor(item: (typeof catalog)[number], locationCode: string, stage: "OPENING" | "CLOSING"): FnbZoneCountLine {
      const opening = stage === "OPENING" ? lastClose(locationCode, item.id) : (todayCount(locationCode, item.id, "OPENING").qty ?? lastClose(locationCode, item.id));
      const replenished = moved.get(`${locationCode}|${item.id}`) ?? 0;
      const posSold = sold.get(item.id) ?? 0;
      const writeOffQty = written.get(`${locationCode}|${item.id}`) ?? 0;
      const expected = Math.max(0, opening + replenished - posSold - writeOffQty);
      const counted = todayCount(locationCode, item.id, stage);
      const countedQty = counted.qty;
      const shrinkage = countedQty == null ? 0 : expected - countedQty;
      const openingToday = todayCount(locationCode, item.id, "OPENING").qty;
      return {
        itemId: item.id,
        shortCode: item.shortCode,
        nameTh: item.nameTh,
        aliases: item.aliases,
        locationCode,
        openingQty: opening,
        replenishedQty: replenished,
        posSoldQty: posSold,
        expectedQty: expected,
        countedQty,
        nearestExpiry: counted.expiry,
        shrinkageQty: shrinkage > 0 ? shrinkage : 0,
        suggestReplenishQty: countedQty != null && countedQty > expected ? countedQty - expected : 0,
        belowLastClose: stage === "OPENING" && openingToday != null && openingToday < lastClose(locationCode, item.id),
        dueTonight: isBackroomDue(item.schedule, item.weekdays, workDate),
        countUom: item.countUom,
        allowDecimal: item.allowDecimal,
        category: item.category,
        displaySubGroup: item.displaySubGroup,
        displayWalkOrder: item.displayWalkOrder,
        shelfLifeDays: item.shelfLifeDays,
        writeOffQty,
      };
    }
    const frontItems = catalog.filter((item) => item.trackFront || (FRONT_CATS.has(item.category) && (item.trackFront || receivedItemIds.has(item.id))));
    const backItems = catalog.filter((item) => !front || item.trackFront === false || item.category === "CLEANING_SUPPLY" || item.category === "RAW_MATERIAL" || item.category === "PACKAGING");
    const dueBack = backItems;
    const cal = calibration.data as Record<string, unknown> | null;
    const sauceByCode = new Map(catalog.map((item) => [item.shortCode, item]));
    const active = asRows(batches.data);
    const sauceCodes = ["SB", "MB", "CS", "BS", "PF", "X", "CJ", "WMK", "CW", "CMK"] as const;
    const sauces = sauceCodes.map((code) => {
      const openDays = FNB_SAUCE_OPEN_DAYS[code];
      const item = sauceByCode.get(code);
      const batches = (item ? active.filter((row) => text(row.item_id) === item.id) : []).map((row) => ({
        id: text(row.id),
        qty: num(row.packs_deducted) || 1,
        uom: text(row.pack_uom) || item?.countUom || "ชิ้น",
        expiresAt: text(row.expires_at) || null,
        sticker: text(row.sticker_label_text) || null,
      }));
      const soonest = batches.map((row) => row.expiresAt).filter((value): value is string => Boolean(value)).sort()[0] ?? null;
      return {
        code,
        itemId: item?.id ?? null,
        nameTh: code === "PF" ? `${item?.nameTh || "PF"} (เรียกสำรอง PS)` : code === "CW" ? `${item?.nameTh || "CW"} (เรียกสำรอง CWT)` : item?.nameTh || code,
        countUom: item?.countUom || "ชิ้น",
        openDays,
        batchId: batches[0]?.id ?? null,
        expiresAt: soonest,
        sticker: batches[0]?.sticker ?? null,
        batches,
      };
    });
    const cleaning = asRows(spots.data).map(spotOf);
    const warehouseDue = warehouse ? isBackroomDue(warehouse.defaultCountSchedule === "WEEKLY_1X" ? "WEEKLY_1X" : warehouse.defaultCountSchedule === "EVERY_3_DAYS" ? "EVERY_3_DAYS" : "WEEKLY_1X", warehouse.countWeekdays, workDate) || warehouse.defaultCountSchedule.startsWith("DAILY") : false;
    return result({
      locations,
      openingSpots: cleaning.filter((spot) => spot.stageCode === "OPENING"),
      closingSpots: cleaning.filter((spot) => spot.stageCode === "CLOSING"),
      frontOpeningLines: front && frontItems.length ? frontItems.map((item) => lineFor(item, front.locationCode, "OPENING")) : [],
      frontLines: front && frontItems.length ? frontItems.map((item) => lineFor(item, front.locationCode, "CLOSING")) : [],
      backroomLines: back ? dueBack.map((item) => lineFor(item, back.locationCode, "CLOSING")) : [],
      warehouseLines: warehouse ? catalog.filter((item) => receivedItemIds.has(item.id) || item.category === "PACKAGING" || item.category === "CLEANING_SUPPLY").slice(0, 40).map((item) => lineFor(item, warehouse.locationCode, "CLOSING")) : [],
      warehouseDue,
      sauces,
      displayLots: asRows(lots.data).filter((row) => num(row.remaining_qty) > 0).map((row) => ({
        id: text(row.id),
        itemId: text(row.item_id),
        remainingQty: num(row.remaining_qty),
        displayExpiryDate: text(row.display_expiry_date),
        effectiveDay1: text(row.effective_day_1),
      })),
      calibration: cal ? {
        grinderDoseG: cal.grinder_dose_g == null ? null : num(cal.grinder_dose_g),
        espressoTimeSec: cal.espresso_time_sec == null ? null : num(cal.espresso_time_sec),
        espressoYieldG: cal.espresso_yield_g == null ? null : num(cal.espresso_yield_g),
        syrupRandomG: cal.syrup_random_target_g == null ? null : num(cal.syrup_random_target_g),
        syrupActualG: cal.syrup_measured_actual_g == null ? null : num(cal.syrup_measured_actual_g),
        syrupAdjusted: cal.syrup_adjusted_ok === true,
      } : null,
    });
  } catch (error) {
    return caught(empty, error, "อ่านบอร์ดหน้าร้านไม่สำเร็จ");
  }
}

function shiftDate(iso: string, days: number): string {
  const date = new Date(`${iso}T12:00:00+07:00`);
  date.setDate(date.getDate() + days);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(date);
}

export async function saveZoneCountsAction(input: {
  branchCode: string;
  workDate: string;
  stage: "OPENING" | "CLOSING" | "CYCLE_COUNT";
  actorSource: string;
  brandLock: string;
  lines: { itemId: string; locationCode: string; countedQty: number; nearestExpiry?: string | null; openingQty: number; replenishedQty: number; posSoldQty: number }[];
}): Promise<FnbActionResult<{ ok: boolean }>> {
  try {
    const actor = await actorName(input.branchCode, input.actorSource, input.brandLock);
    if (!actor.ok) return result({ ok: false }, actor.error);
    const locked = await fnbMonthLockMessage(input.branchCode, input.workDate, input.brandLock);
    if (locked) return result({ ok: false }, locked);
    const db = schemaAdmin().schema("fnb");
    for (const line of input.lines) {
      const expected = line.openingQty + line.replenishedQty - line.posSoldQty;
      const payload = {
        branch_code: input.branchCode,
        location_code: line.locationCode,
        item_id: line.itemId,
        count_date: input.workDate || todayBangkok(),
        count_stage: input.stage,
        counted_qty: line.countedQty,
        expected_qty: expected,
        opening_qty_ref: line.openingQty,
        replenished_in_qty: line.replenishedQty,
        pos_sold_qty: line.posSoldQty,
        shrinkage_diff_qty: expected - line.countedQty,
        nearest_expiry_date: line.nearestExpiry || null,
        staff_name: actor.name,
        count_uom: "pcs",
      };
      const existing = await db.from("zone_stock_counts").select("id").eq("location_code", line.locationCode).eq("count_date", payload.count_date).eq("count_stage", input.stage).eq("item_id", line.itemId).maybeSingle();
      const id = text((existing.data as { id?: string } | null)?.id);
      const saved = id ? await db.from("zone_stock_counts").update(payload).eq("id", id) : await db.from("zone_stock_counts").insert(payload);
      if (saved.error) return fail({ ok: false }, saved.error, "บันทึกยอดนับไม่สำเร็จ");
    }
    return result({ ok: true });
  } catch (error) {
    return caught({ ok: false }, error, "บันทึกยอดนับไม่สำเร็จ");
  }
}

export async function saveDisplaySectionCountsAction(input: {
  branchCode: string;
  workDate: string;
  stageCode: "OPENING" | "CLOSING";
  sectionKey: string;
  sectionTitle: string;
  items: { itemId: string; countedQty: number }[];
  actorSource: string;
  brandLock: string;
  isEdit?: boolean;
  editReason?: string;
}): Promise<FnbActionResult<{ ok: boolean }>> {
  try {
    const actor = await actorName(input.branchCode, input.actorSource, input.brandLock);
    if (!actor.ok) return result({ ok: false }, actor.error);
    const gate = await requireFnbStoreOperationAccess(input.branchCode);
    if (!gate.ok) return result({ ok: false }, gate.error);
    const locked = await fnbMonthLockMessage(input.branchCode, input.workDate, input.brandLock);
    if (locked) return result({ ok: false }, locked);
    const reason = (input.editReason || "").trim();
    const manager = gate.ctx.workspaceRole === "FNB_BRANCH_MANAGER";
    const supervisor = (gate.ctx.isSuperAdmin || manager) && reason.length >= 3;
    if (gate.ctx.isSuperAdmin && reason.length < 3) return result({ ok: false }, "ระบุเหตุผลการเข้าช่วยเหลือ/แก้ไข (อย่างน้อย 3 ตัวอักษร)");
    if (input.isEdit && reason.length < 3) return result({ ok: false }, "ระบุเหตุผลการแก้ไขอย่างน้อย 3 ตัวอักษร");
    if (input.items.length === 0) return result({ ok: false }, "ไม่พบรายการสินค้าที่จะบันทึกยอดนับ");
    const saved = await callFnbRpc("save_display_section_counts_atomic", {
      p_branch_code: input.branchCode,
      p_work_date: input.workDate,
      p_stage_code: input.stageCode,
      p_section_key: input.sectionKey,
      p_section_title_th: input.sectionTitle,
      p_items_json: input.items.map((item) => ({ item_id: item.itemId, counted_qty: item.countedQty })),
      p_staff_name: actor.name,
      p_user_id: actor.userId,
      p_is_edit: Boolean(input.isEdit),
      p_edit_reason: reason || null,
      p_is_supervisor: supervisor,
    });
    if (saved.error) return fail({ ok: false }, saved.error, "บันทึกยอดนับไม่สำเร็จ");
    const body = saved.data && typeof saved.data === "object" ? saved.data as Record<string, unknown> : {};
    if (body.ok !== true) return result({ ok: false }, text(body.error) || "บันทึกยอดนับไม่สำเร็จ");
    return result({ ok: true });
  } catch (error) {
    return caught({ ok: false }, error, "บันทึกยอดนับไม่สำเร็จ");
  }
}

export async function saveEquipmentCalibrationAction(formData: FormData): Promise<FnbActionResult<{ ok: boolean; warning: string | null }>> {
  try {
    const branch = text(formData.get("branch_code"));
    const actor = await actorName(branch, text(formData.get("actor_source")), text(formData.get("brand_lock")));
    if (!actor.ok) return result({ ok: false, warning: null }, actor.error);
    const locked = await fnbMonthLockMessage(branch, text(formData.get("work_date")) || todayBangkok(), text(formData.get("brand_lock")));
    if (locked) return result({ ok: false, warning: null }, locked);
    const dose = Number(formData.get("grinder_dose_g"));
    const seconds = Number(formData.get("espresso_time_sec"));
    const yieldG = Number(formData.get("espresso_yield_g"));
    const syrupRandom = Number(formData.get("syrup_random_target_g"));
    const syrupActual = Number(formData.get("syrup_measured_actual_g"));
    const photos = text(formData.get("photo_urls")).split("|").filter(Boolean);
    if (!(dose > 0) || !(seconds > 0) || !(yieldG > 0) || !(syrupRandom > 0) || !(syrupActual > 0) || photos.length === 0) {
      return result({ ok: false, warning: null }, "กรอกตัวเลขอุปกรณ์ทุกช่องให้มากกว่า 0 และถ่ายรูปสดก่อนบันทึก");
    }
    const warnings = [
      Number.isFinite(dose) && (dose < 19.8 || dose > 20) ? "เครื่องบดอยู่นอกช่วง 19.8–20.0 g" : "",
      Number.isFinite(seconds) && (seconds < 22 || seconds > 28) ? "เวลาช็อตอยู่นอก 22–28 วินาที" : "",
      Number.isFinite(yieldG) && (yieldG < 38 || yieldG > 40) ? "น้ำหนักช็อตอยู่นอก 38–40 g" : "",
    ].filter(Boolean);
    const payload = {
      branch_code: branch,
      work_date: text(formData.get("work_date")) || todayBangkok(),
      grinder_dose_g: dose,
      espresso_time_sec: seconds,
      espresso_yield_g: yieldG,
      syrup_random_target_g: syrupRandom,
      syrup_measured_actual_g: syrupActual,
      syrup_adjusted_ok: formData.get("syrup_adjusted_ok") === "true",
      staff_name: actor.name,
      photo_urls: photos,
      notes: warnings.join(" · ") || null,
    };
    const db = schemaAdmin().schema("fnb");
    const existing = await db.from("daily_equipment_calibrations").select("id").eq("branch_code", branch).eq("work_date", payload.work_date).maybeSingle();
    const id = text((existing.data as { id?: string } | null)?.id);
    const saved = id ? await db.from("daily_equipment_calibrations").update(payload).eq("id", id) : await db.from("daily_equipment_calibrations").insert(payload);
    if (saved.error) return fail({ ok: false, warning: null }, saved.error, "บันทึกมาตรฐานอุปกรณ์ไม่สำเร็จ");
    return result({ ok: true, warning: warnings.join(" · ") || null });
  } catch (error) {
    return caught({ ok: false, warning: null }, error, "บันทึกมาตรฐานอุปกรณ์ไม่สำเร็จ");
  }
}

export async function replenishZoneAction(input: {
  branchCode: string;
  workDate: string;
  fromLocationCode: string;
  toLocationCode: string;
  itemId: string;
  qty: number;
  actorSource: string;
  brandLock: string;
  autoReconciled?: boolean;
  notes?: string;
  eveningForTomorrow?: boolean;
}): Promise<FnbActionResult<{ ok: boolean; transferNo: string | null; expiryDate: string | null }>> {
  try {
    const actor = await actorName(input.branchCode, input.actorSource, input.brandLock);
    if (!actor.ok) return result({ ok: false, transferNo: null, expiryDate: null }, actor.error);
    const locked = await fnbMonthLockMessage(input.branchCode, input.workDate, input.brandLock);
    if (locked) return result({ ok: false, transferNo: null, expiryDate: null }, locked);
    const saved = await callFnbRpc("record_internal_zone_replenishment", {
      p_branch_code: input.branchCode,
      p_work_date: input.workDate || todayBangkok(),
      p_from_location_code: input.fromLocationCode,
      p_to_location_code: input.toLocationCode,
      p_item_id: input.itemId,
      p_qty_in_count_uom: input.qty,
      p_staff_name: actor.name,
      p_is_auto_reconciled: Boolean(input.autoReconciled),
      p_photo_url: null,
      p_notes: input.notes || null,
      p_is_evening_for_tomorrow: input.eveningForTomorrow ?? bangkokHour() >= 17,
    });
    if (saved.error) return fail({ ok: false, transferNo: null, expiryDate: null }, saved.error, "บันทึกเบิกเติมไม่สำเร็จ");
    const body = saved.data && typeof saved.data === "object" ? saved.data as Record<string, unknown> : {};
    if (body.ok === false) return result({ ok: false, transferNo: null, expiryDate: null }, text(body.error) || "บันทึกเบิกเติมไม่สำเร็จ");
    return result({ ok: true, transferNo: text(body.transfer_no) || null, expiryDate: text(body.display_expiry_date) || null });
  } catch (error) {
    return caught({ ok: false, transferNo: null, expiryDate: null }, error, "บันทึกเบิกเติมไม่สำเร็จ");
  }
}

export async function saveCleaningPhotoAction(input: {
  branchCode: string;
  workDate: string;
  stage: "OPENING" | "CLOSING";
  spotId: string;
  photoUrl: string;
  actorSource: string;
  brandLock: string;
}): Promise<FnbActionResult<{ ok: boolean }>> {
  try {
    const actor = await actorName(input.branchCode, input.actorSource, input.brandLock);
    if (!actor.ok) return result({ ok: false }, actor.error);
    const db = schemaAdmin().schema("fnb");
    const spot = await db.from("branch_cleaning_spots").select("spot_name_th").eq("id", input.spotId).maybeSingle();
    const title = text((spot.data as { spot_name_th?: string } | null)?.spot_name_th) || "จุดความสะอาด";
    const taskCode = `SPOT${input.spotId.replace(/-/g, "").slice(0, 12).toUpperCase()}`;
    const existing = await db.from("sop_templates").select("id").eq("task_code", taskCode).maybeSingle();
    let templateId = text((existing.data as { id?: string } | null)?.id);
    if (!templateId) {
      const created = await db.from("sop_templates").insert({
        task_code: taskCode,
        stage_code: input.stage,
        brand_scope: "ALL",
        category_label: "ความสะอาด",
        title_th: title,
        input_type: "PHOTO_ONLY",
        live_camera_only: true,
        is_mandatory: true,
        require_photo: true,
        schedule_type: "DAILY",
        schedule_days: [],
        sort_order: 900,
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      if (created.error) return fail({ ok: false }, created.error, "เตรียมหัวข้อความสะอาดไม่สำเร็จ");
      const again = await db.from("sop_templates").select("id").eq("task_code", taskCode).maybeSingle();
      templateId = text((again.data as { id?: string } | null)?.id);
    }
    if (!templateId) return result({ ok: false }, "ไม่พบหัวข้อความสะอาดของจุดนี้");
    const assigned = await db.from("sop_branch_assignments").select("template_id").eq("template_id", templateId).eq("branch_code", input.branchCode).maybeSingle();
    if (!text((assigned.data as { template_id?: string } | null)?.template_id)) {
      await db.from("sop_branch_assignments").insert({ template_id: templateId, branch_code: input.branchCode, is_enabled: true, updated_at: new Date().toISOString() });
    }
    const saved = await callFnbRpc("submit_sop_task_atomic", {
      p_branch_code: input.branchCode,
      p_work_date: input.workDate,
      p_stage_instance: input.stage,
      p_template_id: templateId,
      p_staff_name: actor.name,
      p_line_user_id: null,
      p_user_id: actor.userId,
      p_status_value: "DONE",
      p_numeric_value: null,
      p_secondary_value_1: null,
      p_secondary_value_2: null,
      p_note_text: `SPOT:${input.spotId}`,
      p_photo_urls: [input.photoUrl],
      p_photo_hashes: [],
      p_watermark_meta: { live: true, staff: actor.name },
    });
    if (saved.error) return fail({ ok: false }, saved.error, "บันทึกรูปจุดความสะอาดไม่สำเร็จ");
    const body = saved.data && typeof saved.data === "object" ? saved.data as Record<string, unknown> : {};
    if (body.ok === false) return result({ ok: false }, text(body.error) || "บันทึกรูปจุดความสะอาดไม่สำเร็จ");
    return result({ ok: true });
  } catch (error) {
    return caught({ ok: false }, error, "บันทึกรูปจุดความสะอาดไม่สำเร็จ");
  }
}
