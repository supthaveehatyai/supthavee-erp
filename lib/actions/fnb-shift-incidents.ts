"use server";

import { callFnbRpc } from "@/lib/fnb/rpc";
import { asRows, caught, num, result, text } from "@/lib/fnb/rows";
import { schemaAdmin } from "@/lib/holding/schema-db";
import { requireFnbStoreOperationAccess } from "@/lib/holding/workspace-access";
import type { FnbActionResult, FnbShiftIncidentView } from "@/types/fnb";

function bomText(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value.map((item) => {
    const row = item && typeof item === "object" ? item as Record<string, unknown> : {};
    return `${text(row.code)} ${num(row.qty)} ${text(row.uom)}`.trim();
  }).filter(Boolean).join(", ");
}

export async function listShiftIncidentsAction(branchCode: string, workDate: string): Promise<FnbActionResult<FnbShiftIncidentView>> {
  const blank: FnbShiftIncidentView = { remakes: [], writeOffs: [] };
  try {
    const gate = await requireFnbStoreOperationAccess(branchCode);
    if (!gate.ok) return result(blank, gate.error);
    const db = schemaAdmin().schema("fnb");
    const [remakes, offs, items] = await Promise.all([
      db.from("shift_drink_remake_logs").select("id,shift_type,menu_name_th,qty_cups,mistake_category,mistake_staff_name,total_bom_loss_thb,bom_deducted_summary_json,photo_urls").eq("branch_code", branchCode).eq("work_date", workDate).limit(200),
      db.from("item_write_offs").select("id,shift_type,item_id,write_off_reason,qty_in_count_uom,total_loss_cost_thb,reported_by_name,photo_urls").eq("branch_code", branchCode).eq("work_date", workDate).limit(200),
      db.from("items").select("id,short_code,name_th").eq("is_active", true).limit(800),
    ]);
    if (remakes.error) return result(blank, remakes.error.message);
    const names = new Map(asRows(items.data).map((row) => [text(row.id), `${text(row.short_code)} ${text(row.name_th)}`.trim()]));
    return result({
      remakes: asRows(remakes.data).map((row) => ({
        id: text(row.id),
        shift: text(row.shift_type),
        menu: text(row.menu_name_th),
        qty: num(row.qty_cups),
        category: text(row.mistake_category),
        staff: text(row.mistake_staff_name),
        cost: num(row.total_bom_loss_thb),
        summary: bomText(row.bom_deducted_summary_json),
        photos: Array.isArray(row.photo_urls) ? row.photo_urls.map((url) => text(url)).filter(Boolean) : [],
      })),
      writeOffs: asRows(offs.data).map((row) => ({
        id: text(row.id),
        shift: text(row.shift_type),
        item: names.get(text(row.item_id)) || "รายการ",
        reason: text(row.write_off_reason),
        qty: num(row.qty_in_count_uom),
        cost: num(row.total_loss_cost_thb),
        staff: text(row.reported_by_name),
        photos: Array.isArray(row.photo_urls) ? row.photo_urls.map((url) => text(url)).filter(Boolean) : [],
      })),
    });
  } catch (error) {
    return caught(blank, error, "อ่านรายการเสียหายของกะไม่สำเร็จ");
  }
}

export async function recordShiftDrinkRemakeAction(input: {
  branchCode: string;
  workDate: string;
  shiftType: "MORNING" | "AFTERNOON";
  menuId: string;
  customMenuName: string;
  qtyCups: number;
  mistakeCategory: string;
  mistakeStaffName: string;
  photoUrls: string[];
  notes: string;
}): Promise<FnbActionResult<{ ok: boolean; incidentNo: string; cost: number }>> {
  const blank = { ok: false, incidentNo: "", cost: 0 };
  try {
    const gate = await requireFnbStoreOperationAccess(input.branchCode);
    if (!gate.ok) return result(blank, gate.error);
    const saved = await callFnbRpc("record_shift_drink_remake", {
      p_branch_code: input.branchCode,
      p_work_date: input.workDate,
      p_shift_type: input.shiftType,
      p_menu_id: input.menuId || null,
      p_custom_menu_name: input.customMenuName || null,
      p_qty_cups: Math.max(1, Math.round(input.qtyCups) || 1),
      p_mistake_category: input.mistakeCategory,
      p_mistake_staff_name: input.mistakeStaffName || gate.displayActorName,
      p_reported_by_name: gate.displayActorName,
      p_user_id: gate.userId,
      p_photo_urls: input.photoUrls,
      p_notes: input.notes || null,
    });
    if (saved.error) return result(blank, saved.error.message || "บันทึกทำเมนูผิดไม่สำเร็จ");
    const body = saved.data && typeof saved.data === "object" ? saved.data as Record<string, unknown> : {};
    if (body.ok !== true) return result(blank, text(body.error) || "บันทึกทำเมนูผิดไม่สำเร็จ");
    return result({ ok: true, incidentNo: text(body.incident_no), cost: num(body.total_bom_loss_thb) });
  } catch (error) {
    return caught(blank, error, "บันทึกทำเมนูผิดไม่สำเร็จ");
  }
}
