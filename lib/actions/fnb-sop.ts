"use server";

import { createHash, randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { resolveFnbActor } from "@/lib/fnb/actor";
import { callFnbRpc } from "@/lib/fnb/rpc";
import { asRows, caught, fail, num, result, text, todayBangkok } from "@/lib/fnb/rows";
import { issueOpeningPrepFromSopAction } from "@/lib/actions/fnb-wip";
import { requireAnyFnbModule, requireFnbModuleAccess } from "@/lib/holding/workspace-access";
import { schemaAdmin } from "@/lib/holding/schema-db";
import type {
  FnbActionResult,
  FnbBrandCode,
  FnbCashFloatContext,
  FnbExpiryAlert,
  FnbParLevelRow,
  FnbSopBoard,
  FnbSopInputType,
  FnbSopSchedule,
  FnbSopStage,
  FnbSopStageInstance,
  FnbSopTemplate,
  FnbSubmitResult,
} from "@/types/fnb";

const INPUTS = new Set<FnbSopInputType>(["PHOTO_ONLY", "COFFEE_CALIBRATION", "CASH_FLOAT_CHECK", "PREP_BATCH", "ITEM_PAR_CHECK", "EXPIRY_AUDIT", "NUMBER_METRIC", "PASS_FAIL_PHOTO"]);
const STAGES = new Set<FnbSopStage>(["OPENING", "SHIFT_HANDOVER", "CLOSING"]);
const SCHEDULES = new Set<FnbSopSchedule>(["DAILY", "WEEKLY_DAYS", "MONTHLY_DATES"]);

function brandOf(value: unknown): FnbBrandCode | null {
  const brand = text(value);
  return brand === "LUCKY_CUP" || brand === "CHATORN" ? brand : null;
}

function ints(value: unknown): number[] {
  if (Array.isArray(value)) return value.map((item) => Number(item)).filter((item) => Number.isInteger(item));
  return text(value).split(/[^0-9]+/).map((item) => Number(item)).filter((item) => Number.isInteger(item) && item > 0);
}

function weekdayBangkok(isoDate: string): number {
  const label = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "Asia/Bangkok" }).format(new Date(`${isoDate}T12:00:00+07:00`));
  const map: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  return map[label] ?? 1;
}

function dueToday(schedule: string, days: number[], isoDate: string): boolean {
  if (schedule === "WEEKLY_DAYS") return days.includes(weekdayBangkok(isoDate));
  if (schedule === "MONTHLY_DATES") return days.includes(Number(isoDate.slice(8, 10)));
  return true;
}

function stageMatches(templateStage: string, instance: FnbSopStageInstance): boolean {
  if (instance === "OPENING") return templateStage === "OPENING";
  if (instance === "CLOSING") return templateStage === "CLOSING";
  return templateStage === "SHIFT_HANDOVER";
}

function otherBrand(title: string, brand: FnbBrandCode | null): boolean {
  if (!brand) return false;
  if (brand === "LUCKY_CUP") return /ชาทร|chatorn/i.test(title);
  return /lucky\s*cup|ลัคกี้|luckycup/i.test(title);
}

async function actorOf(formData: FormData) {
  return resolveFnbActor({
    actorSource: text(formData.get("actor_source")),
    brandLock: text(formData.get("brand_lock")),
    branchCode: text(formData.get("branch_code")),
  });
}

export async function listSopTemplatesAction(): Promise<FnbActionResult<FnbSopTemplate[]>> {
  try {
    await requireAnyFnbModule(["sop_shift_settings", "store_portal"]);
    const db = schemaAdmin().schema("fnb");
    const [templates, assignments] = await Promise.all([
      db.from("sop_templates").select("*").order("sort_order", { ascending: true }).limit(500),
      db.from("sop_branch_assignments").select("template_id, branch_code, is_enabled").limit(5000),
    ]);
    if (templates.error) return fail([], templates.error, "อ่านระเบียบไม่สำเร็จ");
    if (assignments.error) return fail([], assignments.error, "อ่านการมอบหมายสาขาไม่สำเร็จ");
    const enabled = new Map<string, string[]>();
    for (const row of asRows(assignments.data)) {
      if (row.is_enabled === false) continue;
      const id = text(row.template_id);
      enabled.set(id, [...(enabled.get(id) ?? []), text(row.branch_code)]);
    }
    return result(asRows(templates.data).map((row) => ({
      id: text(row.id),
      task_code: text(row.task_code),
      stage_code: (STAGES.has(text(row.stage_code) as FnbSopStage) ? text(row.stage_code) : "OPENING") as FnbSopStage,
      brand_scope: text(row.brand_scope) || "ALL",
      title_th: text(row.title_th),
      description_instruction: row.description_instruction == null ? null : text(row.description_instruction),
      reference_photo_url: row.reference_photo_url == null ? null : text(row.reference_photo_url),
      input_type: (INPUTS.has(text(row.input_type) as FnbSopInputType) ? text(row.input_type) : "PHOTO_ONLY") as FnbSopInputType,
      linked_item_id: row.linked_item_id == null ? null : text(row.linked_item_id),
      live_camera_only: row.live_camera_only !== false,
      is_mandatory: row.is_mandatory !== false,
      schedule_type: (SCHEDULES.has(text(row.schedule_type) as FnbSopSchedule) ? text(row.schedule_type) : "DAILY") as FnbSopSchedule,
      schedule_days: ints(row.schedule_days),
      sort_order: num(row.sort_order),
      is_active: row.is_active !== false,
      branches: enabled.get(text(row.id)) ?? [],
    })));
  } catch (error) {
    return caught([], error, "อ่านระเบียบไม่สำเร็จ");
  }
}

export async function saveSopTemplateAction(formData: FormData): Promise<FnbActionResult<{ id: string }>> {
  try {
    await requireFnbModuleAccess("sop_shift_settings");
    const db = schemaAdmin().schema("fnb");
    const id = text(formData.get("id"));
    const stage = text(formData.get("stage_code"));
    const inputType = text(formData.get("input_type"));
    const schedule = text(formData.get("schedule_type"));
    const brand = text(formData.get("brand_scope"));
    const file = formData.get("reference_photo");
    let photo = text(formData.get("reference_photo_url")) || null;
    if (file instanceof File && file.size > 0) photo = await storePhoto("SOP", "ref", file);
    const payload = {
      task_code: text(formData.get("task_code")) || `SOP-${stage.slice(0, 3)}-${randomUUID().slice(0, 8).toUpperCase()}`,
      stage_code: STAGES.has(stage as FnbSopStage) ? stage : "OPENING",
      brand_scope: brand === "LUCKY_CUP" || brand === "CHATORN" ? brand : "ALL",
      title_th: text(formData.get("title_th")),
      description_instruction: text(formData.get("description_instruction")) || null,
      reference_photo_url: photo,
      input_type: INPUTS.has(inputType as FnbSopInputType) ? inputType : "PHOTO_ONLY",
      linked_item_id: text(formData.get("linked_item_id")) || null,
      live_camera_only: formData.get("live_camera_only") === "true",
      is_mandatory: formData.get("is_mandatory") === "true",
      schedule_type: SCHEDULES.has(schedule as FnbSopSchedule) ? schedule : "DAILY",
      schedule_days: ints(formData.get("schedule_days")),
      sort_order: Number(formData.get("sort_order") ?? 100) || 100,
      is_active: formData.get("is_active") !== "false",
      updated_at: new Date().toISOString(),
    };
    if (!payload.title_th) return result({ id: "" }, "กรุณาใส่ชื่อหัวข้องาน");
    const written = id
      ? await db.from("sop_templates").update(payload).eq("id", id)
      : await db.from("sop_templates").insert(payload);
    if (written.error) return fail({ id: "" }, written.error, "บันทึกระเบียบไม่สำเร็จ");
    revalidatePath("/fnb/sop-settings");
    return result({ id: id || payload.task_code });
  } catch (error) {
    return caught({ id: "" }, error, "บันทึกระเบียบไม่สำเร็จ");
  }
}

export async function toggleSopAssignmentAction(templateId: string, branchCode: string, enabled: boolean): Promise<FnbActionResult<{ ok: boolean }>> {
  try {
    await requireFnbModuleAccess("sop_shift_settings");
    const db = schemaAdmin().schema("fnb");
    const payload = { template_id: templateId, branch_code: branchCode, is_enabled: enabled, updated_at: new Date().toISOString() };
    const existing = await db.from("sop_branch_assignments").select("template_id").eq("template_id", templateId).eq("branch_code", branchCode).maybeSingle();
    const written = existing.data
      ? await db.from("sop_branch_assignments").update(payload).eq("template_id", templateId).eq("branch_code", branchCode)
      : await db.from("sop_branch_assignments").insert(payload);
    if (written.error) return fail({ ok: false }, written.error, "บันทึกสาขาไม่สำเร็จ");
    return result({ ok: true });
  } catch (error) {
    return caught({ ok: false }, error, "บันทึกสาขาไม่สำเร็จ");
  }
}

export async function saveBranchShiftSettingsAction(formData: FormData): Promise<FnbActionResult<{ ok: boolean }>> {
  try {
    await requireFnbModuleAccess("sop_shift_settings");
    const branch = text(formData.get("branch_code"));
    const updated = await schemaAdmin().schema("fnb").from("branches").update({
      standard_cash_float: Number(formData.get("standard_cash_float") ?? 0) || 0,
      opening_time: text(formData.get("opening_time")) || null,
      closing_time: text(formData.get("closing_time")) || null,
      opening_deadline_time: text(formData.get("opening_deadline_time")) || null,
      shift_1_start: text(formData.get("shift_1_start")) || null,
      shift_1_end: text(formData.get("shift_1_end")) || null,
      shift_2_start: text(formData.get("shift_2_start")) || null,
      shift_2_end: text(formData.get("shift_2_end")) || null,
      enable_shift_3: formData.get("enable_shift_3") === "true",
      shift_3_start: text(formData.get("shift_3_start")) || null,
      shift_3_end: text(formData.get("shift_3_end")) || null,
      updated_at: new Date().toISOString(),
    }).eq("branch_code", branch);
    if (updated.error) return fail({ ok: false }, updated.error, "บันทึกกะสาขาไม่สำเร็จ");
    revalidatePath("/fnb/sop-settings");
    return result({ ok: true });
  } catch (error) {
    return caught({ ok: false }, error, "บันทึกกะสาขาไม่สำเร็จ");
  }
}

export async function listParLevelsAction(branchCode: string): Promise<FnbActionResult<FnbParLevelRow[]>> {
  try {
    await requireFnbModuleAccess("sop_shift_settings");
    const db = schemaAdmin().schema("fnb");
    const [pars, items] = await Promise.all([
      db.from("branch_item_par_levels").select("*").eq("branch_code", branchCode).limit(500),
      db.from("items").select("id, short_code, name_th").limit(2000),
    ]);
    if (pars.error) return fail([], pars.error, "อ่านจุดเตือนไม่สำเร็จ");
    const names = new Map(asRows(items.data).map((row) => [text(row.id), row]));
    return result(asRows(pars.data).map((row) => {
      const item = names.get(text(row.item_id));
      return {
        branch_code: text(row.branch_code),
        item_id: text(row.item_id),
        short_code: text(item?.short_code),
        name_th: text(item?.name_th),
        min_par_count_qty: num(row.min_par_count_qty),
        lead_time_days: num(row.lead_time_days),
        is_below_par: row.is_below_par === true,
        last_observed_count_qty: row.last_observed_count_qty == null ? null : num(row.last_observed_count_qty),
      };
    }));
  } catch (error) {
    return caught([], error, "อ่านจุดเตือนไม่สำเร็จ");
  }
}

export async function saveParLevelAction(formData: FormData): Promise<FnbActionResult<{ ok: boolean }>> {
  try {
    await requireFnbModuleAccess("sop_shift_settings");
    const db = schemaAdmin().schema("fnb");
    const branchCode = text(formData.get("branch_code"));
    const itemId = text(formData.get("item_id"));
    const payload = {
      branch_code: branchCode,
      item_id: itemId,
      min_par_count_qty: Number(formData.get("min_par_count_qty") ?? 0) || 0,
      lead_time_days: Number(formData.get("lead_time_days") ?? 2) || 0,
      alert_enabled: true,
      updated_at: new Date().toISOString(),
    };
    const existing = await db.from("branch_item_par_levels").select("item_id").eq("branch_code", branchCode).eq("item_id", itemId).maybeSingle();
    const written = existing.data
      ? await db.from("branch_item_par_levels").update(payload).eq("branch_code", branchCode).eq("item_id", itemId)
      : await db.from("branch_item_par_levels").insert(payload);
    if (written.error) return fail({ ok: false }, written.error, "บันทึกจุดเตือนไม่สำเร็จ");
    return result({ ok: true });
  } catch (error) {
    return caught({ ok: false }, error, "บันทึกจุดเตือนไม่สำเร็จ");
  }
}

export async function getSopBoardAction(input: {
  branch_code: string;
  work_date: string;
  stage_instance: FnbSopStageInstance;
  brand_lock?: FnbBrandCode | null;
  actor_source: string;
}): Promise<FnbActionResult<FnbSopBoard>> {
  const empty: FnbSopBoard = { session_status: "IN_PROGRESS", contributors: [], mandatory_done: 0, mandatory_total: 0, tasks: [] };
  try {
    const actor = await resolveFnbActor({ actorSource: input.actor_source, brandLock: input.brand_lock ?? null, branchCode: input.branch_code });
    if (!actor.ok) return result(empty, actor.error);
    const brand = input.brand_lock ?? actor.actor.brandCode;
    const db = schemaAdmin().schema("fnb");
    const [templates, assignments, session, submissions] = await Promise.all([
      db.from("sop_templates").select("*").eq("is_active", true).order("sort_order", { ascending: true }).limit(500),
      db.from("sop_branch_assignments").select("template_id, is_enabled").eq("branch_code", input.branch_code).eq("is_enabled", true).limit(500),
      db.from("sop_stage_sessions").select("session_status, contributor_summary_json").eq("branch_code", input.branch_code).eq("work_date", input.work_date).eq("stage_instance", input.stage_instance).maybeSingle(),
      db.from("sop_task_submissions").select("id, template_id, submitted_by_name, server_submitted_at, status_value, numeric_value, note_text, photo_urls, manager_review_status").eq("branch_code", input.branch_code).eq("work_date", input.work_date).eq("stage_instance", input.stage_instance).limit(500),
    ]);
    if (templates.error) return fail(empty, templates.error, "อ่านงาน SOP ไม่สำเร็จ");
    const assigned = new Set(asRows(assignments.data).map((row) => text(row.template_id)));
    const submitted = new Map(asRows(submissions.data).map((row) => [text(row.template_id), row]));
    const tasks = asRows(templates.data).filter((row) => {
      if (!assigned.has(text(row.id))) return false;
      if (!stageMatches(text(row.stage_code), input.stage_instance)) return false;
      const scope = text(row.brand_scope);
      if (brand && scope !== "ALL" && scope !== brand) return false;
      if (otherBrand(text(row.title_th), brand)) return false;
      return dueToday(text(row.schedule_type), ints(row.schedule_days), input.work_date || todayBangkok());
    }).map((row) => {
      const found = submitted.get(text(row.id));
      return {
        id: text(row.id),
        task_code: text(row.task_code),
        stage_code: text(row.stage_code) as FnbSopStage,
        brand_scope: text(row.brand_scope),
        title_th: text(row.title_th),
        description_instruction: row.description_instruction == null ? null : text(row.description_instruction),
        reference_photo_url: row.reference_photo_url == null ? null : text(row.reference_photo_url),
        input_type: text(row.input_type) as FnbSopInputType,
        linked_item_id: row.linked_item_id == null ? null : text(row.linked_item_id),
        live_camera_only: row.live_camera_only !== false,
        is_mandatory: row.is_mandatory !== false,
        schedule_type: text(row.schedule_type) as FnbSopSchedule,
        schedule_days: ints(row.schedule_days),
        sort_order: num(row.sort_order),
        is_active: true,
        branches: [input.branch_code],
        submission: found ? {
          id: text(found.id),
          template_id: text(found.template_id),
          submitted_by_name: text(found.submitted_by_name),
          server_submitted_at: text(found.server_submitted_at),
          status_value: text(found.status_value),
          numeric_value: found.numeric_value == null ? null : num(found.numeric_value),
          note_text: found.note_text == null ? null : text(found.note_text),
          photo_urls: Array.isArray(found.photo_urls) ? found.photo_urls.map((item) => text(item)) : [],
          manager_review_status: text(found.manager_review_status),
        } : null,
      };
    });
    const mandatory = tasks.filter((task) => task.is_mandatory);
    const sessionRow = session.data && typeof session.data === "object" ? session.data as Record<string, unknown> : null;
    const contributors = Array.isArray(sessionRow?.contributor_summary_json)
      ? (sessionRow.contributor_summary_json as Record<string, unknown>[]).map((row) => ({ staff_name: text(row.staff_name), task_count: num(row.task_count) }))
      : [];
    return result({
      session_status: text(sessionRow?.session_status) || "IN_PROGRESS",
      contributors,
      mandatory_total: mandatory.length,
      mandatory_done: mandatory.filter((task) => task.submission && task.submission.manager_review_status !== "RETAKE_REQUIRED" && task.submission.status_value !== "REJECTED_RETAKE").length,
      tasks,
    });
  } catch (error) {
    return caught(empty, error, "อ่านงาน SOP ไม่สำเร็จ");
  }
}

export async function uploadFnbEvidenceAction(formData: FormData): Promise<FnbActionResult<{ url: string; hash: string }>> {
  try {
    const actor = await actorOf(formData);
    if (!actor.ok) return result({ url: "", hash: "" }, actor.error);
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) return result({ url: "", hash: "" }, "ไม่พบรูป");
    const bytes = Buffer.from(await file.arrayBuffer());
    const hash = createHash("sha256").update(bytes).digest("hex");
    const live = formData.get("live_capture") === "true";
    const db = schemaAdmin().schema("fnb");
    if (!live) {
      const existing = await db.from("uploaded_media_hashes").select("sha256_hash").eq("sha256_hash", hash).maybeSingle();
      if (existing.data) return result({ url: "", hash }, "รูปนี้ถูกใช้แล้ว ห้ามส่งภาพหน้าจอซ้ำ");
    }
    const branch = text(formData.get("branch_code"));
    const url = await storeBuffer(branch, live ? "live" : "photo", bytes, "webp");
    const recorded = await db.from("uploaded_media_hashes").insert({
      sha256_hash: hash,
      branch_code: branch,
      work_date: text(formData.get("work_date")) || todayBangkok(),
      stage_instance: text(formData.get("stage_instance")) || null,
      uploaded_by_name: actor.actor.name,
      storage_url: url,
    });
    if (recorded.error && !live) return fail({ url: "", hash }, recorded.error, "บันทึกรหัสรูปไม่สำเร็จ");
    return result({ url, hash });
  } catch (error) {
    return caught({ url: "", hash: "" }, error, "อัปโหลดรูปไม่สำเร็จ");
  }
}

export async function submitSopTaskAction(formData: FormData): Promise<FnbActionResult<FnbSubmitResult>> {
  const blank: FnbSubmitResult = { ok: false, mode: null, request_no: null, message: null };
  try {
    const actor = await actorOf(formData);
    if (!actor.ok) return result({ ...blank, message: actor.error }, actor.error);
    const saved = await callFnbRpc("submit_sop_task_atomic", {
      p_branch_code: text(formData.get("branch_code")),
      p_work_date: text(formData.get("work_date")) || todayBangkok(),
      p_stage_instance: text(formData.get("stage_instance")),
      p_template_id: text(formData.get("template_id")),
      p_staff_name: actor.actor.name,
      p_line_user_id: actor.actor.lineUserId,
      p_user_id: actor.actor.userId,
      p_status_value: text(formData.get("status_value")) || "DONE",
      p_numeric_value: text(formData.get("numeric_value")) ? Number(formData.get("numeric_value")) : null,
      p_secondary_value_1: null,
      p_secondary_value_2: null,
      p_note_text: text(formData.get("note_text")) || null,
      p_photo_urls: text(formData.get("photo_urls")).split("|").filter(Boolean),
      p_photo_hashes: text(formData.get("photo_hashes")).split("|").filter(Boolean),
      p_watermark_meta: { live: formData.get("live_capture") === "true", staff: actor.actor.name },
    });
    if (saved.error) return fail(blank, saved.error, "ส่งหัวข้อไม่สำเร็จ");
    const body = saved.data && typeof saved.data === "object" ? saved.data as Record<string, unknown> : {};
    if (body.ok === false) return result({ ...blank, message: text(body.error) }, text(body.error) || "ส่งหัวข้อไม่สำเร็จ");
    const sticker = await issueOpeningPrepFromSopAction({
      branch_code: text(formData.get("branch_code")),
      work_date: text(formData.get("work_date")) || todayBangkok(),
      stage_instance: text(formData.get("stage_instance")),
      template_id: text(formData.get("template_id")),
      staff_name: actor.actor.name,
      line_user_id: actor.actor.lineUserId,
      photo_urls: text(formData.get("photo_urls")).split("|").filter(Boolean),
    });
    return result({ ok: true, mode: "CREATED", request_no: null, message: sticker });
  } catch (error) {
    return caught(blank, error, "ส่งหัวข้อไม่สำเร็จ");
  }
}

export async function lockSopStageAction(formData: FormData): Promise<FnbActionResult<FnbSubmitResult>> {
  const blank: FnbSubmitResult = { ok: false, mode: null, request_no: null, message: null };
  try {
    const actor = await actorOf(formData);
    if (!actor.ok) return result({ ...blank, message: actor.error }, actor.error);
    const branch = text(formData.get("branch_code"));
    const workDate = text(formData.get("work_date"));
    const stage = text(formData.get("stage_instance")) as FnbSopStageInstance;
    const board = await getSopBoardAction({ branch_code: branch, work_date: workDate, stage_instance: stage, brand_lock: brandOf(formData.get("brand_lock")), actor_source: text(formData.get("actor_source")) });
    if (board.error) return result(blank, board.error);
    const reopen = formData.get("reopen") === "true";
    const reason = text(formData.get("edit_reason"));
    const db = schemaAdmin().schema("fnb");
    if (reopen) {
      if (reason.length < 3) return result(blank, "กรุณาระบุสาเหตุการแก้ไข");
      const updated = await db.from("sop_stage_sessions").update({
        session_status: "REOPENED_EDIT",
        last_edit_reason: reason,
        revision_count: 1,
        updated_at: new Date().toISOString(),
      }).eq("branch_code", branch).eq("work_date", workDate).eq("stage_instance", stage);
      if (updated.error) return fail(blank, updated.error, "เปิดแก้ไขไม่สำเร็จ");
      return result({ ok: true, mode: "REOPENED_EDIT", request_no: null, message: null });
    }
    if (board.data.mandatory_done < board.data.mandatory_total) return result(blank, "ยังส่งหัวข้อบังคับไม่ครบ");
    const updated = await db.from("sop_stage_sessions").update({
      session_status: "LOCKED",
      locked_at: new Date().toISOString(),
      locked_by_name: actor.actor.name,
      locked_by_line_user_id: actor.actor.lineUserId,
      updated_at: new Date().toISOString(),
    }).eq("branch_code", branch).eq("work_date", workDate).eq("stage_instance", stage);
    if (updated.error) return fail(blank, updated.error, "ปิดเช็คลิสต์ไม่สำเร็จ");
    return result({ ok: true, mode: "LOCKED", request_no: null, message: null });
  } catch (error) {
    return caught(blank, error, "ปิดเช็คลิสต์ไม่สำเร็จ");
  }
}

export async function requestSopRetakeAction(submissionId: string): Promise<FnbActionResult<{ ok: boolean }>> {
  try {
    await requireFnbModuleAccess("sop_shift_settings");
    const actor = await readDesktopName();
    const updated = await schemaAdmin().schema("fnb").from("sop_task_submissions").update({
      manager_review_status: "RETAKE_REQUIRED",
      status_value: "REJECTED_RETAKE",
      reviewed_by_name: actor,
      reviewed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", submissionId);
    if (updated.error) return fail({ ok: false }, updated.error, "สั่งถ่ายซ่อมไม่สำเร็จ");
    return result({ ok: true });
  } catch (error) {
    return caught({ ok: false }, error, "สั่งถ่ายซ่อมไม่สำเร็จ");
  }
}

export async function listSopPhotoBoardAction(templateId: string, workDate: string): Promise<FnbActionResult<{ branch_code: string; staff: string; at: string; urls: string[] }[]>> {
  try {
    await requireAnyFnbModule(["sop_shift_settings", "store_portal"]);
    const listed = await schemaAdmin().schema("fnb").from("sop_task_submissions")
      .select("branch_code, submitted_by_name, server_submitted_at, photo_urls")
      .eq("template_id", templateId)
      .eq("work_date", workDate)
      .limit(100);
    if (listed.error) return fail([], listed.error, "อ่านรูป SOP ไม่สำเร็จ");
    return result(asRows(listed.data).map((row) => ({
      branch_code: text(row.branch_code),
      staff: text(row.submitted_by_name),
      at: text(row.server_submitted_at),
      urls: Array.isArray(row.photo_urls) ? row.photo_urls.map((item) => text(item)).filter(Boolean) : [],
    })));
  } catch (error) {
    return caught([], error, "อ่านรูป SOP ไม่สำเร็จ");
  }
}

export async function getCashFloatContextAction(branchCode: string, workDate: string, shiftType: "MORNING" | "AFTERNOON" | "SHIFT_3"): Promise<FnbActionResult<FnbCashFloatContext>> {
  const empty = { standard_cash_float: 0, prev_shift_held_cash: 0, closing_time: null };
  try {
    const db = schemaAdmin().schema("fnb");
    const branch = await db.from("branches").select("standard_cash_float, closing_time").eq("branch_code", branchCode).maybeSingle();
    if (branch.error) return fail(empty, branch.error, "อ่านเงินทอนไม่สำเร็จ");
    const row = branch.data && typeof branch.data === "object" ? branch.data as Record<string, unknown> : {};
    const previous = shiftType === "AFTERNOON" ? "MORNING" : shiftType === "SHIFT_3" ? "AFTERNOON" : null;
    let held = 0;
    if (previous) {
      const prior = await db.from("shift_closings").select("deposit_method, cash_counted_amount").eq("branch_code", branchCode).eq("work_date", workDate).eq("shift_type", previous).maybeSingle();
      const priorRow = prior.data && typeof prior.data === "object" ? prior.data as Record<string, unknown> : null;
      if (text(priorRow?.deposit_method) === "HOLD_NEXT_SHIFT") held = num(priorRow?.cash_counted_amount);
    }
    return result({
      standard_cash_float: num(row.standard_cash_float),
      prev_shift_held_cash: held,
      closing_time: row.closing_time == null ? null : text(row.closing_time),
    });
  } catch (error) {
    return caught(empty, error, "อ่านเงินทอนไม่สำเร็จ");
  }
}

export async function saveShift3HandoverAction(formData: FormData): Promise<FnbActionResult<FnbSubmitResult>> {
  const blank: FnbSubmitResult = { ok: false, mode: null, request_no: null, message: null };
  try {
    const actor = await actorOf(formData);
    if (!actor.ok) return result({ ...blank, message: actor.error }, actor.error);
    const branch = text(formData.get("branch_code"));
    const workDate = text(formData.get("work_date")) || todayBangkok();
    const counted = Number(formData.get("cash_counted_amount") ?? 0) || 0;
    const context = await getCashFloatContextAction(branch, workDate, "SHIFT_3");
    const expected = context.data.standard_cash_float;
    const db = schemaAdmin().schema("fnb");
    await db.from("sop_stage_sessions").insert({
      branch_code: branch,
      work_date: workDate,
      stage_instance: "SHIFT_3",
      session_status: "IN_PROGRESS",
      cash_float_expected: expected,
    });
    const updated = await db.from("sop_stage_sessions").update({
      cash_float_expected: expected,
      cash_float_counted: counted,
      cash_float_variance: expected > 0 ? counted - expected : 0,
      edit_history_json: [{
        kind: "SHIFT3_HANDOVER",
        staff: actor.actor.name,
        deposit_method: text(formData.get("deposit_method")),
        counted,
        float_kept: expected,
        prev_held: context.data.prev_shift_held_cash,
        net_deposit: counted - expected,
        at: new Date().toISOString(),
      }],
      updated_at: new Date().toISOString(),
    }).eq("branch_code", branch).eq("work_date", workDate).eq("stage_instance", "SHIFT_3");
    if (updated.error) return fail(blank, updated.error, "บันทึกส่งเงินกะสามไม่สำเร็จ");
    return result({ ok: true, mode: "CREATED", request_no: null, message: null });
  } catch (error) {
    return caught(blank, error, "บันทึกส่งเงินกะสามไม่สำเร็จ");
  }
}

export async function listEarlyWarningsAction(): Promise<FnbActionResult<{ par: FnbParLevelRow[]; expiry: FnbExpiryAlert[] }>> {
  const empty = { par: [] as FnbParLevelRow[], expiry: [] as FnbExpiryAlert[] };
  try {
    await requireFnbModuleAccess("all_branch_analytics");
    const db = schemaAdmin().schema("fnb");
    const [pars, lots, items] = await Promise.all([
      db.from("branch_item_par_levels").select("*").eq("is_below_par", true).limit(200),
      db.from("item_expiry_lots").select("branch_code, item_id, expiry_date, remaining_pack_qty, lot_status").eq("lot_status", "ACTIVE").limit(500),
      db.from("items").select("id, short_code, name_th").limit(2000),
    ]);
    if (pars.error) return fail(empty, pars.error, "อ่านจุดเตือนไม่สำเร็จ");
    const names = new Map(asRows(items.data).map((row) => [text(row.id), row]));
    const today = new Date(`${todayBangkok()}T00:00:00+07:00`).getTime();
    const expiry = asRows(lots.data).map((row) => {
      const expiryDate = text(row.expiry_date).slice(0, 10);
      const days = Math.ceil((new Date(`${expiryDate}T00:00:00+07:00`).getTime() - today) / 86400000);
      const item = names.get(text(row.item_id));
      return {
        branch_code: text(row.branch_code),
        name_th: text(item?.name_th) || text(item?.short_code),
        expiry_date: expiryDate,
        remaining_pack_qty: num(row.remaining_pack_qty),
        days_left: days,
      };
    }).filter((row) => row.days_left <= 14 && row.remaining_pack_qty > 0);
    return result({
      par: asRows(pars.data).map((row) => {
        const item = names.get(text(row.item_id));
        return {
          branch_code: text(row.branch_code),
          item_id: text(row.item_id),
          short_code: text(item?.short_code),
          name_th: text(item?.name_th),
          min_par_count_qty: num(row.min_par_count_qty),
          lead_time_days: num(row.lead_time_days),
          is_below_par: true,
          last_observed_count_qty: row.last_observed_count_qty == null ? null : num(row.last_observed_count_qty),
        };
      }),
      expiry,
    });
  } catch (error) {
    return caught(empty, error, "อ่านจุดเตือนไม่สำเร็จ");
  }
}

async function readDesktopName(): Promise<string> {
  const actor = await resolveFnbActor({ actorSource: "desktop", brandLock: null, branchCode: null });
  return actor.ok ? actor.actor.name : "ผู้บริหาร";
}

async function storePhoto(branch: string, kind: string, file: File): Promise<string> {
  return storeBuffer(branch, kind, Buffer.from(await file.arrayBuffer()), (file.name.split(".").pop() || "webp").toLowerCase().replace(/[^a-z0-9]/g, "") || "webp");
}

async function storeBuffer(branch: string, kind: string, bytes: Buffer, ext: string): Promise<string> {
  const path = `fnb/${branch.replace(/[^A-Za-z0-9_-]/g, "") || "branch"}/${kind}_${randomUUID()}.${ext}`;
  const uploaded = await schemaAdmin().storage.from("fnb_operations").upload(path, bytes, { contentType: ext === "webp" ? "image/webp" : "application/octet-stream", upsert: false });
  if (uploaded.error) throw new Error(uploaded.error.message || "อัปโหลดไฟล์ไม่สำเร็จ");
  return schemaAdmin().storage.from("fnb_operations").getPublicUrl(path).data.publicUrl;
}
