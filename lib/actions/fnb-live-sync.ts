"use server";

import { unstable_noStore as noStore } from "next/cache";
import { callFnbRpc } from "@/lib/fnb/rpc";
import { asRows, caught, fail, num, result, text, todayBangkok } from "@/lib/fnb/rows";
import { schemaAdmin } from "@/lib/holding/schema-db";
import { requireFnbStoreOperationAccess } from "@/lib/holding/workspace-access";
import type { FnbActionResult, FnbCrewMember, FnbLiveSnapshot, FnbShiftRoster, FnbStageConfirmation } from "@/types/fnb";

function emptySnapshot(branchCode: string, workDate: string): FnbLiveSnapshot {
  return {
    branchCode,
    workDate,
    brandCode: "",
    maxStaffPerShift: 2,
    viewer: { userId: "", name: "", isSupervisor: false, isSuperAdmin: false, workspaceRole: "" },
    rosters: [
      { shiftSlot: "SHIFT_1", maxSeats: 2, members: [] },
      { shiftSlot: "SHIFT_2", maxSeats: 2, members: [] },
    ],
    confirmations: [],
    prepBases: [],
    lemonItemId: "",
    wipBatches: [],
    calibration: null,
    zoneCounts: [],
    zoneStockCounts: [],
    cleaningSpotLogs: [],
    displayLots: [],
    closings: [],
    shiftMenuSales: [],
    waste: [],
    writeOffs: [],
    menuSales: null,
    staffOptions: [],
  };
}

function confirmationOf(row: Record<string, unknown>): FnbStageConfirmation {
  return {
    id: text(row.id),
    sectionKey: text(row.section_key),
    sectionTitle: text(row.section_title_th),
    stageCode: text(row.stage_code) === "CLOSING" ? "CLOSING" : "OPENING",
    statusFlag: text(row.status_flag),
    numericAmount: row.numeric_amount == null ? null : num(row.numeric_amount),
    expectedAmount: row.expected_amount == null ? null : num(row.expected_amount),
    varianceReason: row.variance_reason == null ? null : text(row.variance_reason),
    photoUrls: Array.isArray(row.photo_urls) ? row.photo_urls.map((url) => text(url)).filter(Boolean) : [],
    confirmedByName: text(row.confirmed_by_name),
    confirmedAt: text(row.confirmed_at),
    lastEditReason: row.last_edit_reason == null ? null : text(row.last_edit_reason),
    payload: row.payload_json && typeof row.payload_json === "object" ? row.payload_json as Record<string, unknown> : {},
  };
}

function membersOf(value: unknown): FnbCrewMember[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => item && typeof item === "object").map((item) => {
    const row = item as Record<string, unknown>;
    return {
      userId: text(row.user_id),
      staffName: text(row.staff_name),
      role: text(row.role),
      checkedInAt: text(row.checked_in_at),
    };
  });
}

export async function getLiveBranchShiftSnapshotAction(input: { branchCode: string; workDate?: string }): Promise<FnbActionResult<FnbLiveSnapshot>> {
  noStore();
  const workDate = input.workDate || todayBangkok();
  const blank = emptySnapshot(input.branchCode, workDate);
  try {
    const gate = await requireFnbStoreOperationAccess(input.branchCode);
    if (!gate.ok) return result(blank, gate.error);
    const db = schemaAdmin().schema("fnb");
    const branchRow = await db.from("branches").select("branch_code,brand_code,branch_status,max_staff_per_shift").eq("branch_code", input.branchCode).maybeSingle();
    if (branchRow.error) return fail(blank, branchRow.error, "อ่านสาขาไม่สำเร็จ");
    const branch = branchRow.data && typeof branchRow.data === "object" ? branchRow.data as Record<string, unknown> : null;
    if (!branch) return result(blank, "ไม่พบสาขา");
    const brand = text(branch.brand_code);
    const maxSeats = Math.max(1, num(branch.max_staff_per_shift) || 2);
    const [rosters, confirmations, bases, prepBatches, openBatches, calibration, zones, lots, closings, shiftMenus, waste, writeOffs, menuSales, lemons, people, cleaningLogs, catalog] = await Promise.all([
      db.from("shift_crew_rosters").select("shift_slot,max_crew_seats,crew_members_json").eq("branch_code", input.branchCode).eq("work_date", workDate).limit(4),
      db.from("daily_stage_section_confirmations").select("id,section_key,section_title_th,stage_code,status_flag,numeric_amount,expected_amount,variance_reason,photo_urls,confirmed_by_name,confirmed_at,last_edit_reason,payload_json").eq("branch_code", input.branchCode).eq("work_date", workDate).limit(400),
      db.from("prep_bases").select("base_code,base_name_th,yield_qty_ml,brand_code,sort_order,is_active").eq("brand_code", brand).eq("is_active", true).order("sort_order", { ascending: true }).limit(40),
      db.from("bar_wip_batches").select("id,batch_kind,prep_base_code,item_id,packs_deducted,opened_by_name,batch_status,open_photo_urls,work_date").eq("branch_code", input.branchCode).eq("work_date", workDate).limit(300),
      db.from("bar_wip_batches").select("id,batch_kind,prep_base_code,item_id,packs_deducted,opened_by_name,batch_status,open_photo_urls,work_date").eq("branch_code", input.branchCode).eq("batch_status", "ACTIVE").limit(200),
      db.from("daily_equipment_calibrations").select("grinder_dose_g,espresso_time_sec,espresso_yield_g,syrup_random_target_g,syrup_measured_actual_g,syrup_adjusted_ok").eq("branch_code", input.branchCode).eq("work_date", workDate).maybeSingle(),
      db.from("zone_stock_counts").select("item_id,location_code,counted_qty,count_stage,staff_name").eq("branch_code", input.branchCode).eq("count_date", workDate).limit(500),
      db.from("display_chiller_lots").select("item_id,remaining_qty,display_expiry_date,placed_by_name,lot_status").eq("branch_code", input.branchCode).limit(200),
      db.from("shift_closings").select("shift_type,staff_name,net_sales_inc_vat,order_count,gross_sales,discount_total,cash_pos_amount,cash_counted_amount,qr_amount,lineman_gross_amount,grab_gross_amount,webapp_amount,drawer_total_cash_counted,cash_handover_to_next_shift,handover_status,handover_accepted_by_name,handover_accepted_at,handover_counted_drawer_cash,opening_float_amount,morning_cash_brought_forward,total_cash_for_eod_deposit,deposit_channel,seven_eleven_deposit_amount,seven_eleven_fee_thb,seven_eleven_slip_url,pos_slip_mode,kshop_app_amount,lineman_app_amount,grab_net_payout_amount").eq("branch_code", input.branchCode).eq("work_date", workDate).limit(6),
      db.from("shift_menu_sales").select("shift_type,menu_id,raw_menu_name,cup_size,qty_sold,sales_amount,cumulative_slip_qty,cumulative_slip_amount,pos_category_name,was_auto_created_menu").eq("branch_code", input.branchCode).eq("work_date", workDate).limit(800),
      db.from("daily_waste_logs").select("staff_name,total_waste_cost_thb").eq("branch_code", input.branchCode).eq("work_date", workDate).limit(5),
      db.from("item_write_offs").select("item_id,write_off_reason,qty_in_count_uom,reported_by_name,photo_urls").eq("branch_code", input.branchCode).eq("work_date", workDate).limit(200),
      db.from("daily_menu_sales_headers").select("submitted_by_name,reported_total_amount").eq("branch_code", input.branchCode).eq("work_date", workDate).limit(1),
      db.from("items").select("id,short_code,brand_scope").eq("short_code", "LEM").eq("is_active", true).limit(8),
      db.from("employees").select("user_id,nickname,full_name_th,primary_branch_code,allowed_branch_codes,employment_status").eq("employment_status", "ACTIVE").limit(200),
      db.from("daily_cleaning_spot_logs").select("id,stage_code,spot_id,spot_name_th,status_flag,photo_url,checked_by_name,checked_at").eq("branch_code", input.branchCode).eq("work_date", workDate).limit(200),
      db.from("items").select("id,short_code,name_th,item_category,count_uom,display_sub_group,display_walk_order,brand_scope").eq("is_active", true).limit(2000),
    ]);
    const failed = [rosters, confirmations, bases, prepBatches, openBatches, calibration, zones, lots, closings, shiftMenus, waste, writeOffs, menuSales, cleaningLogs, catalog].find((item) => item.error);
    if (failed?.error) return fail(blank, failed.error, "อ่านสถานะสาขาไม่สำเร็จ");
    const rosterRows = asRows(rosters.data);
    const slots: FnbShiftRoster[] = (["SHIFT_1", "SHIFT_2"] as const).map((slot) => {
      const row = rosterRows.find((item) => text(item.shift_slot) === slot);
      return { shiftSlot: slot, maxSeats: row ? Math.max(1, num(row.max_crew_seats) || maxSeats) : maxSeats, members: membersOf(row?.crew_members_json) };
    });
    const seen = new Set<string>();
    const wip = [...asRows(prepBatches.data), ...asRows(openBatches.data)].filter((row) => {
      const id = text(row.id);
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    }).map((row) => ({
      id: text(row.id),
      batchKind: text(row.batch_kind),
      prepBaseCode: text(row.prep_base_code),
      itemId: text(row.item_id),
      packsDeducted: num(row.packs_deducted),
      openedByName: text(row.opened_by_name),
      batchStatus: text(row.batch_status),
      photoUrls: Array.isArray(row.open_photo_urls) ? row.open_photo_urls.map((url) => text(url)).filter(Boolean) : [],
    }));
    const cal = calibration.data && typeof calibration.data === "object" ? calibration.data as Record<string, unknown> : null;
    const menu = asRows(menuSales.data)[0];
    const lemon = asRows(lemons.data).find((row) => !text(row.brand_scope) || text(row.brand_scope) === brand || text(row.brand_scope) === "ALL");
    const staffOptions = asRows(people.data).filter((row) => {
      const codes = Array.isArray(row.allowed_branch_codes) ? row.allowed_branch_codes.map((code) => text(code)) : [];
      return text(row.primary_branch_code) === input.branchCode || codes.includes(input.branchCode);
    }).map((row) => ({ userId: text(row.user_id), name: text(row.nickname) || text(row.full_name_th) })).filter((row) => row.userId);
    const catalogById = new Map(asRows(catalog.data).filter((row) => {
      const scope = text(row.brand_scope);
      return !scope || scope === brand || scope === "ALL";
    }).map((row) => [text(row.id), row]));
    return result({
      ...blank,
      brandCode: brand,
      maxStaffPerShift: maxSeats,
      viewer: {
        userId: gate.userId,
        name: gate.displayActorName,
        isSupervisor: gate.ctx.isSuperAdmin || gate.ctx.workspaceRole === "FNB_BRANCH_MANAGER",
        isSuperAdmin: gate.ctx.isSuperAdmin,
        workspaceRole: gate.ctx.workspaceRole,
      },
      rosters: slots,
      confirmations: asRows(confirmations.data).map(confirmationOf),
      prepBases: asRows(bases.data).map((row) => ({
        baseCode: text(row.base_code),
        baseNameTh: text(row.base_name_th),
        yieldQtyMl: num(row.yield_qty_ml),
        sortOrder: num(row.sort_order),
      })),
      lemonItemId: text(lemon?.id),
      wipBatches: wip,
      calibration: cal ? {
        grinderDoseG: cal.grinder_dose_g == null ? null : num(cal.grinder_dose_g),
        espressoTimeSec: cal.espresso_time_sec == null ? null : num(cal.espresso_time_sec),
        espressoYieldG: cal.espresso_yield_g == null ? null : num(cal.espresso_yield_g),
        syrupRandomG: cal.syrup_random_target_g == null ? null : num(cal.syrup_random_target_g),
        syrupActualG: cal.syrup_measured_actual_g == null ? null : num(cal.syrup_measured_actual_g),
        syrupAdjusted: cal.syrup_adjusted_ok === true,
      } : null,
      zoneCounts: asRows(zones.data).map((row) => ({
        itemId: text(row.item_id),
        locationCode: text(row.location_code),
        countedQty: num(row.counted_qty),
        countStage: text(row.count_stage),
        staffName: text(row.staff_name),
      })),
      zoneStockCounts: asRows(zones.data).map((row) => {
        const item = catalogById.get(text(row.item_id));
        return {
          itemId: text(row.item_id),
          locationCode: text(row.location_code),
          countedQty: num(row.counted_qty),
          countStage: text(row.count_stage),
          staffName: text(row.staff_name),
          shortCode: text(item?.short_code),
          nameTh: text(item?.name_th),
          itemCategory: text(item?.item_category),
          countUom: text(item?.count_uom) || "ชิ้น",
          displaySubGroup: text(item?.display_sub_group),
          displayWalkOrder: num(item?.display_walk_order),
        };
      }),
      cleaningSpotLogs: asRows(cleaningLogs.data).map((row) => ({
        id: text(row.id),
        spotId: text(row.spot_id),
        stageCode: text(row.stage_code) === "CLOSING" ? "CLOSING" as const : "OPENING" as const,
        spotNameTh: text(row.spot_name_th),
        statusFlag: text(row.status_flag),
        photoUrls: text(row.photo_url).startsWith("http") ? [text(row.photo_url)] : [],
        checkedByName: text(row.checked_by_name),
        checkedAt: text(row.checked_at),
      })),
      displayLots: asRows(lots.data).map((row) => ({
        itemId: text(row.item_id),
        remainingQty: num(row.remaining_qty),
        displayExpiryDate: text(row.display_expiry_date),
        placedByName: text(row.placed_by_name),
      })),
      closings: asRows(closings.data).map((row) => ({
        shiftType: text(row.shift_type),
        staffName: text(row.staff_name),
        netSalesIncVat: num(row.net_sales_inc_vat),
        orderCount: num(row.order_count),
        grossSales: num(row.gross_sales),
        discountTotal: num(row.discount_total),
        cashPosAmount: num(row.cash_pos_amount),
        cashCountedAmount: num(row.cash_counted_amount),
        qrAmount: num(row.qr_amount),
        linemanAmount: num(row.lineman_gross_amount),
        grabAmount: num(row.grab_gross_amount),
        webappAmount: num(row.webapp_amount),
        drawerTotal: num(row.drawer_total_cash_counted),
        cashHandover: num(row.cash_handover_to_next_shift),
        handoverStatus: text(row.handover_status),
        handoverAcceptedByName: text(row.handover_accepted_by_name),
        handoverAcceptedAt: text(row.handover_accepted_at),
        handoverCounted: num(row.handover_counted_drawer_cash),
        openingFloat: num(row.opening_float_amount),
        morningCashForward: num(row.morning_cash_brought_forward),
        eodDeposit: num(row.total_cash_for_eod_deposit),
        depositChannel: text(row.deposit_channel),
        sevenAmount: num(row.seven_eleven_deposit_amount),
        sevenFee: num(row.seven_eleven_fee_thb),
        sevenSlipUrl: text(row.seven_eleven_slip_url),
        posSlipMode: text(row.pos_slip_mode),
        kshopAmount: num(row.kshop_app_amount),
        linemanAppAmount: num(row.lineman_app_amount),
        grabNet: num(row.grab_net_payout_amount),
      })),
      shiftMenuSales: asRows(shiftMenus.data).map((row) => ({
        shiftType: text(row.shift_type),
        menuId: text(row.menu_id),
        rawMenuName: text(row.raw_menu_name),
        cupSize: text(row.cup_size) || "R",
        qtySold: num(row.qty_sold),
        salesAmount: num(row.sales_amount),
        cumulativeQty: row.cumulative_slip_qty == null ? null : num(row.cumulative_slip_qty),
        cumulativeAmount: row.cumulative_slip_amount == null ? null : num(row.cumulative_slip_amount),
        categoryName: text(row.pos_category_name),
        wasAutoCreated: row.was_auto_created_menu === true,
      })),
      waste: asRows(waste.data).map((row) => ({ staffName: text(row.staff_name), totalWasteCostThb: num(row.total_waste_cost_thb) })),
      writeOffs: asRows(writeOffs.data).map((row) => ({
        itemId: text(row.item_id),
        reason: text(row.write_off_reason),
        qty: num(row.qty_in_count_uom),
        staffName: text(row.reported_by_name),
        photoUrls: Array.isArray(row.photo_urls) ? row.photo_urls.map((url) => text(url)).filter(Boolean) : [],
      })),
      menuSales: menu ? { submittedByName: text(menu.submitted_by_name), reportedTotalAmount: num(menu.reported_total_amount) } : null,
      staffOptions,
    });
  } catch (error) {
    return caught(blank, error, "อ่านสถานะสาขาไม่สำเร็จ");
  }
}

export async function checkInShiftCrewAction(input: { branchCode: string; workDate: string; shiftSlot: "SHIFT_1" | "SHIFT_2" }): Promise<FnbActionResult<{ ok: boolean }>> {
  noStore();
  try {
    const gate = await requireFnbStoreOperationAccess(input.branchCode);
    if (!gate.ok) return result({ ok: false }, gate.error);
    if (gate.ctx.isSuperAdmin) {
      return result({ ok: false }, "ผู้บริหารไม่ใช้ที่นั่งพนักงาน — ใช้โหมดช่วยเหลือพร้อมระบุเหตุผล");
    }
    const saved = await callFnbRpc("check_in_shift_crew_seat", {
      p_branch_code: input.branchCode,
      p_work_date: input.workDate,
      p_shift_slot: input.shiftSlot,
      p_user_id: gate.userId,
      p_staff_name: gate.displayActorName,
      p_workspace_role: gate.ctx.workspaceRole || "FNB_STORE_STAFF",
    });
    if (saved.error) return fail({ ok: false }, saved.error, "ลงชื่อเข้ากะไม่สำเร็จ");
    const body = saved.data && typeof saved.data === "object" ? saved.data as Record<string, unknown> : {};
    if (body.ok === false) return result({ ok: false }, text(body.error) || "ลงชื่อเข้ากะไม่สำเร็จ");
    return result({ ok: true });
  } catch (error) {
    return caught({ ok: false }, error, "ลงชื่อเข้ากะไม่สำเร็จ");
  }
}

export async function swapShiftCrewSeatAction(input: {
  branchCode: string;
  workDate: string;
  shiftSlot: "SHIFT_1" | "SHIFT_2";
  removeUserId: string;
  newUserId: string;
  newStaffName: string;
  reason: string;
}): Promise<FnbActionResult<{ ok: boolean }>> {
  noStore();
  try {
    const gate = await requireFnbStoreOperationAccess(input.branchCode);
    if (!gate.ok) return result({ ok: false }, gate.error);
    const supervisor = gate.ctx.isSuperAdmin || gate.ctx.workspaceRole === "FNB_BRANCH_MANAGER";
    if (input.reason.trim().length < 4) return result({ ok: false }, "ระบุสาเหตุการเปลี่ยนตัวอย่างน้อย 4 ตัวอักษร");
    const saved = await callFnbRpc("swap_shift_crew_seat", {
      p_actor_user_id: gate.userId,
      p_actor_name: gate.displayActorName,
      p_is_supervisor: supervisor,
      p_branch_code: input.branchCode,
      p_work_date: input.workDate,
      p_shift_slot: input.shiftSlot,
      p_remove_user_id: input.removeUserId,
      p_new_user_id: input.newUserId,
      p_new_staff_name: input.newStaffName,
      p_reason: input.reason.trim(),
    });
    if (saved.error) return fail({ ok: false }, saved.error, "เปลี่ยนตัวผู้ปฏิบัติงานไม่สำเร็จ");
    const body = saved.data && typeof saved.data === "object" ? saved.data as Record<string, unknown> : {};
    if (body.ok === false) return result({ ok: false }, text(body.error) || "เปลี่ยนตัวผู้ปฏิบัติงานไม่สำเร็จ");
    return result({ ok: true });
  } catch (error) {
    return caught({ ok: false }, error, "เปลี่ยนตัวผู้ปฏิบัติงานไม่สำเร็จ");
  }
}

export async function leaveUnusedShiftCrewSeatAction(input: {
  branchCode: string;
  workDate: string;
  shiftSlot: "SHIFT_1" | "SHIFT_2";
}): Promise<FnbActionResult<{ ok: boolean }>> {
  noStore();
  try {
    const gate = await requireFnbStoreOperationAccess(input.branchCode);
    if (!gate.ok) return result({ ok: false }, gate.error);
    const saved = await callFnbRpc("leave_unused_shift_crew_seat", {
      p_branch_code: input.branchCode,
      p_work_date: input.workDate,
      p_shift_slot: input.shiftSlot,
      p_user_id: gate.userId,
      p_staff_name: gate.displayActorName,
    });
    if (saved.error) return fail({ ok: false }, saved.error, "ออกจากกะไม่สำเร็จ");
    const body = saved.data && typeof saved.data === "object" ? saved.data as Record<string, unknown> : {};
    if (body.ok === false) return result({ ok: false }, text(body.error) || "ออกจากกะไม่สำเร็จ");
    return result({ ok: true });
  } catch (error) {
    return caught({ ok: false }, error, "ออกจากกะไม่สำเร็จ");
  }
}
