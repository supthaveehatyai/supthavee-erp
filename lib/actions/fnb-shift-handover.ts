"use server";

import { callFnbRpc } from "@/lib/fnb/rpc";
import { fnbMonthLockMessage } from "@/lib/fnb/period-lock";
import { asRows, caught, num, result, text } from "@/lib/fnb/rows";
import { schemaAdmin } from "@/lib/holding/schema-db";
import { requireFnbModuleAccess, requireFnbStoreOperationAccess } from "@/lib/holding/workspace-access";
import type { FnbActionResult, FnbCashHandoverAckInput, FnbShiftBehavior, FnbShiftHandoverInput } from "@/types/fnb";

function rpcBody(data: unknown): Record<string, unknown> {
  return data && typeof data === "object" ? data as Record<string, unknown> : {};
}

export async function submitShiftClosingAndMenuSalesAction(input: FnbShiftHandoverInput): Promise<FnbActionResult<{ ok: boolean; createdMenus: number }>> {
  try {
    const gate = await requireFnbStoreOperationAccess(input.branchCode);
    if (!gate.ok) return result({ ok: false, createdMenus: 0 }, gate.error);
    const locked = await fnbMonthLockMessage(input.branchCode, input.workDate, input.brandLock);
    if (locked) return result({ ok: false, createdMenus: 0 }, locked);
    const supervisor = gate.ctx.isSuperAdmin || gate.ctx.workspaceRole === "FNB_BRANCH_MANAGER";
    const override = supervisor && input.overrideReason.trim().length >= 3 ? input.overrideReason.trim() : "";
    const saved = await callFnbRpc("submit_shift_closing_and_menu_sales_atomic", {
      p_branch_code: input.branchCode,
      p_work_date: input.workDate,
      p_shift_type: input.shiftType,
      p_pos_slip_mode: input.posSlipMode,
      p_menu_slip_is_cumulative: input.menuSlipIsCumulative,
      p_order_count: Math.round(input.orderCount) || 0,
      p_gross_sales: input.grossSales,
      p_discount_total: input.discountTotal || (input.promoCouponDiscount ?? 0) + (input.deliveryDiscount ?? 0) + (input.storeManualDiscount ?? 0),
      p_cash_pos_input: input.cashPos,
      p_qr_input: input.qr,
      p_lineman_input: input.lineman,
      p_grab_input: input.grab,
      p_webapp_input: input.webapp,
      p_drawer_total_cash_counted: input.drawerTotal,
      p_cash_breakdown_json: input.breakdown,
      p_kshop_app_amount: input.kshopApp,
      p_lineman_app_amount: input.linemanApp,
      p_grab_gp_amount: input.grabGp,
      p_grab_net_payout_amount: input.grabNet,
      p_deposit_channel: input.depositChannel || null,
      p_seven_eleven_deposit_amount: input.sevenAmount,
      p_seven_eleven_slip_url: input.sevenSlipUrl || null,
      p_pos_slip_urls: input.posSlipUrls,
      p_menu_slip_urls: input.menuSlipUrls,
      p_app_screen_urls: input.appScreenUrls,
      p_menu_lines_json: input.menuLines,
      p_staff_name: gate.displayActorName,
      p_user_id: gate.userId,
      p_note: input.note || null,
      p_is_supervisor_override: Boolean(override),
      p_override_reason: override || null,
    });
    if (saved.error) return result({ ok: false, createdMenus: 0 }, saved.error.message || "บันทึกส่งยอดกะไม่สำเร็จ");
    const body = rpcBody(saved.data);
    if (body.ok !== true) return result({ ok: false, createdMenus: 0 }, text(body.error) || "บันทึกส่งยอดกะไม่สำเร็จ");
    await schemaAdmin().schema("fnb").from("shift_closings").update({
      report_attachments_json: {
        lineman: input.linemanScreenUrls ?? [],
        grab: input.grabScreenUrls ?? [],
      },
      pos_promo_coupon_discount: input.promoCouponDiscount ?? 0,
      delivery_price_diff_discount: input.deliveryDiscount ?? 0,
      pos_store_manual_discount: input.storeManualDiscount ?? 0,
      no_shift_waste_confirmed: input.noShiftWasteConfirmed === true,
      closed_by_name: gate.displayActorName,
    }).eq("branch_code", input.branchCode).eq("work_date", input.workDate).eq("shift_type", input.shiftType);
    return result({ ok: true, createdMenus: num(body.auto_created_new_menus) });
  } catch (error) {
    return caught({ ok: false, createdMenus: 0 }, error, "บันทึกส่งยอดกะไม่สำเร็จ");
  }
}

export async function acknowledgeMorningCashHandoverAction(input: FnbCashHandoverAckInput): Promise<FnbActionResult<{ ok: boolean }>> {
  try {
    const gate = await requireFnbStoreOperationAccess(input.branchCode);
    if (!gate.ok) return result({ ok: false }, gate.error);
    const locked = await fnbMonthLockMessage(input.branchCode, input.workDate, input.brandLock);
    if (locked) return result({ ok: false }, locked);
    const saved = await callFnbRpc("acknowledge_morning_cash_handover", {
      p_branch_code: input.branchCode,
      p_work_date: input.workDate,
      p_counted_drawer_cash: input.countedDrawerCash,
      p_receiver_name: gate.displayActorName,
      p_receiver_user_id: gate.userId,
      p_photo_url: input.photoUrl || null,
      p_note: input.note || null,
    });
    if (saved.error) return result({ ok: false }, saved.error.message || "กดรับยอดเงินสดไม่สำเร็จ");
    const body = rpcBody(saved.data);
    if (body.ok !== true) return result({ ok: false }, text(body.error) || "กดรับยอดเงินสดไม่สำเร็จ");
    return result({ ok: true });
  } catch (error) {
    return caught({ ok: false }, error, "กดรับยอดเงินสดไม่สำเร็จ");
  }
}

export async function getShiftConsumerBehaviorAction(input: {
  brand: "LUCKY_CUP" | "CHATORN";
  branchCode: string;
  startDate: string;
  endDate: string;
}): Promise<FnbActionResult<FnbShiftBehavior[]>> {
  try {
    await requireFnbModuleAccess("all_branch_analytics");
    const db = schemaAdmin().schema("fnb");
    const branches = await db.from("branches").select("branch_code,brand_code").eq("brand_code", input.brand).limit(20);
    if (branches.error) return result([], branches.error.message || "อ่านสาขาไม่สำเร็จ");
    const allowed = new Set(asRows(branches.data).map((row) => text(row.branch_code)).filter((code) => !input.branchCode || code === input.branchCode));
    const [closings, menus] = await Promise.all([
      db.from("shift_closings").select("branch_code,shift_type,net_sales_inc_vat,order_count,cash_pos_amount,qr_amount,lineman_gross_amount,grab_gross_amount,webapp_amount,total_cups_items_sold").gte("work_date", input.startDate).lte("work_date", input.endDate).limit(4000),
      db.from("shift_menu_sales").select("branch_code,shift_type,raw_menu_name,cup_size,qty_sold,pos_category_name,brand_code").eq("brand_code", input.brand).gte("work_date", input.startDate).lte("work_date", input.endDate).limit(8000),
    ]);
    if (closings.error) return result([], closings.error.message || "อ่านยอดกะไม่สำเร็จ");
    if (menus.error) return result([], menus.error.message || "อ่านยอดเมนูไม่สำเร็จ");
    const byBranch = new Map<string, FnbShiftBehavior>();
    const ensure = (code: string): FnbShiftBehavior => {
      const current = byBranch.get(code);
      if (current) return current;
      const created: FnbShiftBehavior = {
        branchCode: code,
        morningSales: 0,
        afternoonSales: 0,
        morningOrders: 0,
        afternoonOrders: 0,
        morningCups: 0,
        afternoonCups: 0,
        morningStore: 0,
        afternoonStore: 0,
        morningDelivery: 0,
        afternoonDelivery: 0,
        morningApp: 0,
        afternoonApp: 0,
        menus: [],
      };
      byBranch.set(code, created);
      return created;
    };
    for (const row of asRows(closings.data)) {
      const code = text(row.branch_code);
      if (!allowed.has(code)) continue;
      const card = ensure(code);
      const afternoon = text(row.shift_type) === "AFTERNOON";
      const sales = num(row.net_sales_inc_vat);
      const orders = num(row.order_count);
      const store = num(row.cash_pos_amount) + num(row.qr_amount);
      const delivery = num(row.lineman_gross_amount) + num(row.grab_gross_amount);
      const app = num(row.webapp_amount);
      const cups = num(row.total_cups_items_sold);
      if (afternoon) {
        card.afternoonSales += sales;
        card.afternoonOrders += orders;
        card.afternoonStore += store;
        card.afternoonDelivery += delivery;
        card.afternoonApp += app;
        card.afternoonCups += cups;
      } else {
        card.morningSales += sales;
        card.morningOrders += orders;
        card.morningStore += store;
        card.morningDelivery += delivery;
        card.morningApp += app;
        card.morningCups += cups;
      }
    }
    const menuMap = new Map<string, FnbShiftBehavior["menus"][number]>();
    for (const row of asRows(menus.data)) {
      const code = text(row.branch_code);
      if (!allowed.has(code)) continue;
      ensure(code);
      const key = `${code}|${text(row.raw_menu_name)}|${text(row.cup_size)}`;
      const current = menuMap.get(key) ?? {
        name: text(row.raw_menu_name),
        category: text(row.pos_category_name) || "ไม่ระบุหมวด",
        cupSize: text(row.cup_size) || "-",
        morningQty: 0,
        afternoonQty: 0,
        totalQty: 0,
        peak: "TIE" as const,
      };
      const qty = num(row.qty_sold);
      if (text(row.shift_type) === "AFTERNOON") current.afternoonQty += qty;
      else current.morningQty += qty;
      current.totalQty = current.morningQty + current.afternoonQty;
      current.peak = current.morningQty > current.afternoonQty ? "MORNING" : current.afternoonQty > current.morningQty ? "AFTERNOON" : "TIE";
      menuMap.set(key, current);
    }
    for (const [key, menu] of menuMap) {
      const code = key.split("|")[0] || "";
      ensure(code).menus.push(menu);
    }
    for (const card of byBranch.values()) {
      card.menus.sort((left, right) => right.totalQty - left.totalQty);
      card.menus = card.menus.slice(0, 30);
      if (card.morningCups <= 0) card.morningCups = card.menus.reduce((sum, menu) => sum + menu.morningQty, 0);
      if (card.afternoonCups <= 0) card.afternoonCups = card.menus.reduce((sum, menu) => sum + menu.afternoonQty, 0);
    }
    return result([...byBranch.values()].sort((left, right) => left.branchCode.localeCompare(right.branchCode)));
  } catch (error) {
    return caught([], error, "อ่านพฤติกรรมผู้บริโภคไม่สำเร็จ");
  }
}
