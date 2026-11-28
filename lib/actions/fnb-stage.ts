"use server";

import { resolveFnbActor } from "@/lib/fnb/actor";
import { fnbMonthLockMessage } from "@/lib/fnb/period-lock";
import { callFnbRpc } from "@/lib/fnb/rpc";
import { asRows, caught, fail, num, result, text } from "@/lib/fnb/rows";
import { schemaAdmin } from "@/lib/holding/schema-db";
import { requireAnyFnbModule, requireFnbStoreOperationAccess } from "@/lib/holding/workspace-access";
import type { FnbActionResult, FnbBrandCode, FnbStageConfirmation } from "@/types/fnb";

function rpcBody(data: unknown): Record<string, unknown> {
  return data && typeof data === "object" ? data as Record<string, unknown> : {};
}

export async function confirmStageSectionAction(input: {
  branchCode: string;
  workDate: string;
  stageCode: "OPENING" | "CLOSING";
  sectionKey: string;
  sectionTitle: string;
  statusFlag?: "PASSED" | "ISSUE_REPORTED";
  numericAmount?: number | null;
  expectedAmount?: number | null;
  varianceReason?: string;
  photoUrls?: string[];
  payload?: Record<string, unknown>;
  actorSource: string;
  brandLock: string;
  isEdit?: boolean;
  editReason?: string;
  assistReason?: string;
  shiftSlot?: "SHIFT_1" | "SHIFT_2";
}): Promise<FnbActionResult<{ ok: boolean }>> {
  try {
    const actor = await resolveFnbActor({ actorSource: input.actorSource, brandLock: input.brandLock, branchCode: input.branchCode });
    if (!actor.ok) return result({ ok: false }, actor.error);
    const gate = await requireFnbStoreOperationAccess(input.branchCode);
    if (!gate.ok) return result({ ok: false }, gate.error);
    const manager = gate.ctx.workspaceRole === "FNB_BRANCH_MANAGER";
    const assistReason = (input.assistReason || "").trim();
    const override = assistReason.length >= 3 && (gate.ctx.isSuperAdmin || manager);
    if (gate.ctx.isSuperAdmin && !override) return result({ ok: false }, "ระบุเหตุผลการเข้าช่วยเหลือ/แก้ไข (อย่างน้อย 3 ตัวอักษร)");
    if ((gate.ctx.isSuperAdmin || manager) && assistReason.length > 0 && assistReason.length < 3) {
      return result({ ok: false }, "ระบุเหตุผลการเข้าช่วยเหลือ/แก้ไข (อย่างน้อย 3 ตัวอักษร)");
    }
    const locked = await fnbMonthLockMessage(input.branchCode, input.workDate, input.brandLock);
    if (locked) return result({ ok: false }, locked);
    const seatedRows = gate.userId
      ? await schemaAdmin().schema("fnb").from("shift_crew_rosters").select("crew_members_json").eq("branch_code", input.branchCode).eq("work_date", input.workDate).limit(4)
      : null;
    const alreadySeated = asRows(seatedRows?.data).some((row) => Array.isArray(row.crew_members_json) && row.crew_members_json.some((member) => text((member as Record<string, unknown>).user_id) === gate.userId));
    if (!override && gate.userId && !alreadySeated) {
      const slot = input.shiftSlot ?? (input.stageCode === "CLOSING" ? "SHIFT_2" : "SHIFT_1");
      const seated = await callFnbRpc("check_in_shift_crew_seat", {
        p_branch_code: input.branchCode,
        p_work_date: input.workDate,
        p_shift_slot: slot,
        p_user_id: gate.userId,
        p_staff_name: actor.actor.name,
        p_workspace_role: gate.ctx.workspaceRole || "FNB_STORE_STAFF",
      });
      const seatBody = rpcBody(seated.data);
      if (seated.error) return fail({ ok: false }, seated.error, "ลงชื่อเข้ากะไม่สำเร็จ");
      if (seatBody.ok === false) return result({ ok: false }, text(seatBody.error) || "กะนี้มีผู้ปฏิบัติงานครบแล้ว");
    }
    const payload = {
      ...(input.payload ?? {}),
      ...(override ? { override_by_name: actor.actor.name, override_reason: assistReason } : {}),
    };
    const saved = await callFnbRpc("confirm_stage_section_atomic", {
      p_branch_code: input.branchCode,
      p_work_date: input.workDate,
      p_stage_code: input.stageCode,
      p_section_key: input.sectionKey,
      p_section_title_th: input.sectionTitle,
      p_status_flag: input.statusFlag ?? "PASSED",
      p_numeric_amount: input.numericAmount ?? null,
      p_expected_amount: input.expectedAmount ?? null,
      p_variance_reason: input.varianceReason || null,
      p_photo_urls: input.photoUrls ?? [],
      p_payload_json: payload,
      p_staff_name: actor.actor.name,
      p_user_id: actor.actor.userId,
      p_is_edit: override || Boolean(input.isEdit),
      p_edit_reason: override ? assistReason : (input.editReason || null),
      p_is_supervisor: override,
    });
    if (saved.error) return fail({ ok: false }, saved.error, "ยืนยันหมวดไม่สำเร็จ");
    const body = rpcBody(saved.data);
    if (body.ok === false) return result({ ok: false }, text(body.error) || "ยืนยันหมวดไม่สำเร็จ");
    return result({ ok: true });
  } catch (error) {
    return caught({ ok: false }, error, "ยืนยันหมวดไม่สำเร็จ");
  }
}

export async function listStageConfirmationsAction(
  branchCode: string,
  workDate: string,
  stageCode: "OPENING" | "CLOSING",
  actorSource = "desktop",
  brandLock = "",
): Promise<FnbActionResult<FnbStageConfirmation[]>> {
  try {
    const actor = await resolveFnbActor({ actorSource, brandLock, branchCode });
    if (!actor.ok) return result([], actor.error);
    const listed = await schemaAdmin().schema("fnb").from("daily_stage_section_confirmations")
      .select("id,section_key,section_title_th,stage_code,status_flag,numeric_amount,expected_amount,variance_reason,photo_urls,confirmed_by_name,confirmed_at,last_edit_reason,payload_json")
      .eq("branch_code", branchCode)
      .eq("work_date", workDate)
      .eq("stage_code", stageCode)
      .order("confirmed_at", { ascending: true })
      .limit(200);
    if (listed.error) return fail([], listed.error, "อ่านสถานะเพื่อนร่วมกะไม่สำเร็จ");
    return result(asRows(listed.data).map((row) => ({
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
    })));
  } catch (error) {
    return caught([], error, "อ่านสถานะเพื่อนร่วมกะไม่สำเร็จ");
  }
}

export async function listBrandStagePhotosAction(workDate: string, brand: FnbBrandCode): Promise<FnbActionResult<{ branchCode: string; sectionTitle: string; staff: string; at: string; urls: string[] }[]>> {
  try {
    await requireAnyFnbModule(["sop_shift_settings", "all_branch_analytics", "store_portal"]);
    const branches = await schemaAdmin().schema("fnb").from("branches").select("branch_code,branch_status").eq("brand_code", brand).neq("branch_status", "INACTIVE").limit(20);
    const codes = asRows(branches.data).map((row) => text(row.branch_code));
    if (codes.length === 0) return result([]);
    const listed = await schemaAdmin().schema("fnb").from("daily_stage_section_confirmations")
      .select("branch_code,section_title_th,confirmed_by_name,confirmed_at,photo_urls")
      .eq("work_date", workDate)
      .limit(400);
    if (listed.error) return fail([], listed.error, "อ่านรูปยืนยันหมวดไม่สำเร็จ");
    return result(asRows(listed.data).filter((row) => codes.includes(text(row.branch_code))).map((row) => ({
      branchCode: text(row.branch_code),
      sectionTitle: text(row.section_title_th),
      staff: text(row.confirmed_by_name),
      at: text(row.confirmed_at),
      urls: Array.isArray(row.photo_urls) ? row.photo_urls.map((url) => text(url)).filter(Boolean) : [],
    })).filter((row) => row.urls.length > 0));
  } catch (error) {
    return caught([], error, "อ่านรูปยืนยันหมวดไม่สำเร็จ");
  }
}

export async function recordItemWriteOffAction(input: {
  branchCode: string;
  locationCode: string;
  workDate: string;
  itemId: string;
  reason: string;
  qty: number;
  displayLotId?: string;
  observedExpiryDate?: string;
  destroyedVerified?: boolean;
  vendorClaimable?: boolean;
  photoUrls: string[];
  notes?: string;
  shiftType?: "MORNING" | "AFTERNOON";
  actorSource: string;
  brandLock: string;
}): Promise<FnbActionResult<{ ok: boolean; writeOffNo: string }>> {
  try {
    const actor = await resolveFnbActor({ actorSource: input.actorSource, brandLock: input.brandLock, branchCode: input.branchCode });
    if (!actor.ok) return result({ ok: false, writeOffNo: "" }, actor.error);
    const locked = await fnbMonthLockMessage(input.branchCode, input.workDate, input.brandLock);
    if (locked) return result({ ok: false, writeOffNo: "" }, locked);
    const saved = await callFnbRpc("record_item_write_off", {
      p_branch_code: input.branchCode,
      p_location_code: input.locationCode,
      p_work_date: input.workDate,
      p_item_id: input.itemId,
      p_write_off_reason: input.reason,
      p_qty_in_count_uom: input.qty,
      p_display_lot_id: input.displayLotId || null,
      p_observed_expiry_date: input.observedExpiryDate || null,
      p_is_destroyed_verified: Boolean(input.destroyedVerified),
      p_is_vendor_claimable: Boolean(input.vendorClaimable),
      p_photo_urls: input.photoUrls,
      p_staff_name: actor.actor.name,
      p_user_id: actor.actor.userId,
      p_notes: input.notes || null,
    });
    if (saved.error) return fail({ ok: false, writeOffNo: "" }, saved.error, "บันทึกตัดของเสียไม่สำเร็จ");
    const body = rpcBody(saved.data);
    if (body.ok === false) return result({ ok: false, writeOffNo: "" }, text(body.error) || "บันทึกตัดของเสียไม่สำเร็จ");
    const writeOffNo = text(body.write_off_no);
    if (input.shiftType && writeOffNo) {
      await schemaAdmin().schema("fnb").from("item_write_offs").update({ shift_type: input.shiftType }).eq("write_off_no", writeOffNo);
    }
    return result({ ok: true, writeOffNo });
  } catch (error) {
    return caught({ ok: false, writeOffNo: "" }, error, "บันทึกตัดของเสียไม่สำเร็จ");
  }
}

export async function listVendorClaimsAction(brand: FnbBrandCode): Promise<FnbActionResult<{ id: string; writeOffNo: string; branchCode: string; itemLabel: string; reason: string; qty: number; uom: string; status: string; photos: string[] }[]>> {
  try {
    await requireAnyFnbModule(["goods_receipt_expiry", "hq_tax_reimburse", "master_items_bom"]);
    const listed = await schemaAdmin().schema("fnb").from("item_write_offs")
      .select("id,write_off_no,branch_code,brand_code,item_id,write_off_reason,qty_in_count_uom,count_uom,vendor_claim_status,photo_urls,is_vendor_claimable")
      .eq("brand_code", brand)
      .eq("is_vendor_claimable", true)
      .order("created_at", { ascending: false })
      .limit(200);
    if (listed.error) return fail([], listed.error, "อ่านรายการเคลมไม่สำเร็จ");
    const rows = asRows(listed.data);
    const itemIds = [...new Set(rows.map((row) => text(row.item_id)).filter(Boolean))];
    const items = itemIds.length
      ? await schemaAdmin().schema("fnb").from("items").select("id,short_code,name_th").limit(800)
      : { data: [], error: null };
    const labels = new Map(asRows(items.data).map((row) => [text(row.id), `${text(row.short_code)} ${text(row.name_th)}`]));
    return result(rows.map((row) => ({
      id: text(row.id),
      writeOffNo: text(row.write_off_no),
      branchCode: text(row.branch_code),
      itemLabel: labels.get(text(row.item_id)) || text(row.item_id),
      reason: text(row.write_off_reason),
      qty: num(row.qty_in_count_uom),
      uom: text(row.count_uom),
      status: text(row.vendor_claim_status),
      photos: Array.isArray(row.photo_urls) ? row.photo_urls.map((url) => text(url)).filter(Boolean) : [],
    })));
  } catch (error) {
    return caught([], error, "อ่านรายการเคลมไม่สำเร็จ");
  }
}

export async function settleVendorClaimAction(id: string, status: "CLAIMED_REPLACED" | "CLAIMED_CREDIT_NOTE"): Promise<FnbActionResult<{ ok: boolean }>> {
  try {
    await requireAnyFnbModule(["goods_receipt_expiry", "hq_tax_reimburse"]);
    const note = status === "CLAIMED_REPLACED" ? "ได้รับของชดเชยแล้ว" : "ได้รับส่วนลด/ใบลดหนี้แล้ว";
    const saved = await schemaAdmin().schema("fnb").from("item_write_offs").update({
      vendor_claim_status: status,
      vendor_claim_note: note,
      updated_at: new Date().toISOString(),
    }).eq("id", id);
    if (saved.error) return fail({ ok: false }, saved.error, "อัปเดตสถานะเคลมไม่สำเร็จ");
    return result({ ok: true });
  } catch (error) {
    return caught({ ok: false }, error, "อัปเดตสถานะเคลมไม่สำเร็จ");
  }
}
