"use server";

import { fnbMonthLockMessage } from "@/lib/fnb/period-lock";
import { callFnbRpc } from "@/lib/fnb/rpc";
import { asRows, caught, fail, num, result, text, todayBangkok } from "@/lib/fnb/rows";
import { schemaAdmin } from "@/lib/holding/schema-db";
import { requireFnbStoreOperationAccess } from "@/lib/holding/workspace-access";
import type { FnbActionResult } from "@/types/fnb";

function money(value: number): string {
  return value.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export async function issueCatchWeightProduceSliceAction(input: {
  branch_code: string;
  work_date: string;
  shift_instance: string;
  item_id: string;
  piece_count: number;
  actual_sliced_grams: number | null;
  photo_urls: string[];
  notes: string;
  actor_source: string;
  brand_lock: string;
}): Promise<FnbActionResult<{ ok: boolean; sticker: string; message: string }>> {
  const blank = { ok: false, sticker: "", message: "" };
  try {
    const access = await requireFnbStoreOperationAccess(input.branch_code);
    if (!access.ok) return result(blank, access.error);
    const workDate = input.work_date || todayBangkok();
    const locked = await fnbMonthLockMessage(input.branch_code, workDate, input.brand_lock);
    if (locked) return result({ ...blank, message: locked }, locked);
    const pieces = Math.trunc(Number(input.piece_count) || 0);
    if (pieces <= 0) return result(blank, "กรอกจำนวนผลที่หั่นเป็นจำนวนเต็มมากกว่า 0");
    const grams = Number(input.actual_sliced_grams);
    const saved = await callFnbRpc("issue_catch_weight_produce_slice", {
      p_branch_code: input.branch_code,
      p_work_date: workDate,
      p_shift_instance: input.shift_instance || "SHIFT_1",
      p_item_id: input.item_id,
      p_piece_count: pieces,
      p_actual_sliced_grams: Number.isFinite(grams) && grams > 0 ? grams : null,
      p_staff_name: access.displayActorName,
      p_line_user_id: null,
      p_photo_urls: input.photo_urls.filter(Boolean),
      p_notes: input.notes || null,
      p_source_ref_type: "FRUIT_SLICE_ISSUE",
    });
    if (saved.error) return fail(blank, saved.error, "บันทึกหั่นผลไม้ไม่สำเร็จ");
    const body = saved.data && typeof saved.data === "object" ? saved.data as Record<string, unknown> : {};
    if (body.ok !== true) return result({ ...blank, message: text(body.error) }, text(body.error) || "บันทึกหั่นผลไม้ไม่สำเร็จ");
    return result({ ok: true, sticker: text(body.sticker_label_text), message: "" });
  } catch (error) {
    return caught(blank, error, "บันทึกหั่นผลไม้ไม่สำเร็จ");
  }
}

export async function previewProduceWasteAction(input: {
  branch_code: string;
  item_id: string;
  leftover_sliced_grams: number;
}): Promise<FnbActionResult<{ ok: boolean; sentence: string; equiv_whole_pieces: number; yield_adjusted_loss_thb: number }>> {
  const blank = { ok: false, sentence: "", equiv_whole_pieces: 0, yield_adjusted_loss_thb: 0 };
  try {
    const access = await requireFnbStoreOperationAccess(input.branch_code);
    if (!access.ok) return result(blank, access.error);
    const grams = Number(input.leftover_sliced_grams);
    if (!Number.isFinite(grams) || grams <= 0) return result(blank, "กรอกน้ำหนักเนื้อที่เททิ้งเป็นกรัม");
    const saved = await callFnbRpc("preview_or_calc_produce_waste", {
      p_branch_code: input.branch_code,
      p_item_id: input.item_id,
      p_leftover_sliced_grams: grams,
    });
    if (saved.error) return fail(blank, saved.error, "คำนวณของทิ้งผลไม้ไม่สำเร็จ");
    const body = saved.data && typeof saved.data === "object" ? saved.data as Record<string, unknown> : {};
    if (body.ok !== true) return result(blank, text(body.error) || "คำนวณของทิ้งผลไม้ไม่สำเร็จ");
    const label = text(body.piece_uom_label) || "ลูก";
    const pieces = num(body.equiv_whole_pieces);
    const loss = num(body.yield_adjusted_loss_thb);
    return result({
      ok: true,
      sentence: `เททิ้งเนื้อหั่น ${Math.round(grams)} g (คิดเป็นผลเต็ม ~${pieces} ${label} · มูลค่าสูญเสียจริง ${money(loss)} ฿)`,
      equiv_whole_pieces: pieces,
      yield_adjusted_loss_thb: loss,
    });
  } catch (error) {
    return caught(blank, error, "คำนวณของทิ้งผลไม้ไม่สำเร็จ");
  }
}

export async function saveProduceWasteSummaryAction(input: {
  branch_code: string;
  work_date: string;
  brand_lock: string;
  lines: { item_id: string; leftover_sliced_grams: number }[];
  photo_urls: string[];
}): Promise<FnbActionResult<{ ok: boolean; sentence: string }>> {
  const blank = { ok: false, sentence: "" };
  try {
    const access = await requireFnbStoreOperationAccess(input.branch_code);
    if (!access.ok) return result(blank, access.error);
    const workDate = input.work_date || todayBangkok();
    const locked = await fnbMonthLockMessage(input.branch_code, workDate, input.brand_lock);
    if (locked) return result(blank, locked);
    const ready = input.lines.filter((line) => Number(line.leftover_sliced_grams) > 0);
    if (ready.length === 0) return result(blank, "กรอกน้ำหนักเนื้อหั่นที่เททิ้งเป็นกรัม");
    const sentences: string[] = [];
    let grams = 0;
    let pieces = 0;
    let loss = 0;
    const stored: { item_id: string; leftover_sliced_grams: number; sentence: string }[] = [];
    for (const line of ready) {
      const preview = await previewProduceWasteAction({
        branch_code: input.branch_code,
        item_id: line.item_id,
        leftover_sliced_grams: Number(line.leftover_sliced_grams),
      });
      if (preview.error || !preview.data.ok) return result(blank, preview.error || "คำนวณของทิ้งผลไม้ไม่สำเร็จ");
      sentences.push(preview.data.sentence);
      grams += Number(line.leftover_sliced_grams);
      pieces += preview.data.equiv_whole_pieces;
      loss += preview.data.yield_adjusted_loss_thb;
      stored.push({ item_id: line.item_id, leftover_sliced_grams: Number(line.leftover_sliced_grams), sentence: preview.data.sentence });
    }
    const db = schemaAdmin().schema("fnb");
    const existing = await db.from("daily_waste_logs").select("id,notes,total_waste_cost_thb,waste_summary_json,photo_urls").eq("branch_code", input.branch_code).eq("work_date", workDate).limit(1);
    if (existing.error) return fail(blank, existing.error, "บันทึกของทิ้งผลไม้ไม่สำเร็จ");
    const row = asRows(existing.data)[0];
    const summary = row?.waste_summary_json && typeof row.waste_summary_json === "object" ? { ...(row.waste_summary_json as Record<string, unknown>) } : {};
    const previous = num(summary.produce_loss_thb);
    const nextSummary = { ...summary, produce_lines: stored, produce_loss_thb: loss };
    const kept = text(row?.notes).split("\n").map((line) => line.trim()).filter((line) => line && !line.startsWith("เททิ้งเนื้อหั่น"));
    const notes = [...sentences, ...kept].join("\n");
    const photos = [...input.photo_urls, ...(Array.isArray(row?.photo_urls) ? row.photo_urls.map((url) => text(url)) : [])].filter(Boolean);
    const payload = {
      notes,
      photo_urls: photos,
      equiv_whole_grams: grams,
      equiv_whole_pieces: Number(pieces.toFixed(1)),
      yield_adjusted_loss_thb: Number(loss.toFixed(2)),
      total_waste_cost_thb: Number((num(row?.total_waste_cost_thb) - previous + loss).toFixed(2)),
      waste_summary_json: nextSummary,
    };
    const saved = row
      ? await db.from("daily_waste_logs").update(payload).eq("id", text(row.id))
      : await db.from("daily_waste_logs").insert({
        ...payload,
        branch_code: input.branch_code,
        work_date: workDate,
        staff_name: access.displayActorName,
      });
    if (saved.error) return fail(blank, saved.error, "บันทึกของทิ้งผลไม้ไม่สำเร็จ");
    return result({ ok: true, sentence: sentences.join(" · ") });
  } catch (error) {
    return caught(blank, error, "บันทึกของทิ้งผลไม้ไม่สำเร็จ");
  }
}
