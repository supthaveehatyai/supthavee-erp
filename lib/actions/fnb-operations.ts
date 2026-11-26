"use server";

import { generateWithGeminiFallback, resolveGeminiApiKey } from "@/lib/ai/gemini-client";
import { parseLuckyCupPosWorkbook } from "@/lib/fnb/excel";
import { callFnbRpc } from "@/lib/fnb/rpc";
import { asRows, caught, fail, num, result, text, todayBangkok } from "@/lib/fnb/rows";
import { schemaAdmin } from "@/lib/holding/schema-db";
import { requireSuperAdmin } from "@/lib/holding/workspace-access";
import type {
  FnbActionResult,
  FnbBranchKpi,
  FnbBranchOption,
  FnbBrandCode,
  FnbChangeRequestRow,
  FnbDayState,
  FnbItemRow,
  FnbPosImportPreview,
  FnbSubmitResult,
} from "@/types/fnb";

function asciiBranch(code: string): string {
  return code.replace(/[^A-Za-z0-9-]/g, "").slice(0, 16) || "BRANCH";
}

async function storeFnbFile(branchCode: string, kind: string, file: File): Promise<string> {
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  const path = `fnb/${asciiBranch(branchCode)}/${kind}_${crypto.randomUUID()}.${ext}`;
  const uploaded = await schemaAdmin().storage.from("fnb_operations").upload(path, Buffer.from(await file.arrayBuffer()), {
    contentType: file.type || "application/octet-stream",
    upsert: false,
  });
  if (uploaded.error) throw new Error(uploaded.error.message || "อัปโหลดไฟล์ไม่สำเร็จ");
  return schemaAdmin().storage.from("fnb_operations").getPublicUrl(path).data.publicUrl;
}

function brandLockOf(value: FormDataEntryValue | null): FnbBrandCode | null {
  const brand = text(value);
  return brand === "LUCKY_CUP" || brand === "CHATORN" ? brand : null;
}

function rpcPayload(data: unknown): Record<string, unknown> {
  return data && typeof data === "object" ? data as Record<string, unknown> : {};
}

function submitFromRpc(data: unknown, error: { message?: string } | null, fallback: string): FnbActionResult<FnbSubmitResult> {
  if (error) return fail({ ok: false, mode: null, request_no: null, message: null }, error, fallback);
  const body = rpcPayload(data);
  if (body.ok === false) {
    return result({ ok: false, mode: null, request_no: null, message: text(body.error) || fallback }, text(body.error) || fallback);
  }
  return result({
    ok: true,
    mode: body.mode == null ? null : text(body.mode),
    request_no: body.request_no == null ? null : text(body.request_no),
    message: body.message == null ? null : text(body.message),
  });
}

async function assertBranchBrand(branchCode: string, brand: FnbBrandCode | null): Promise<string | null> {
  const listed = await schemaAdmin().schema("fnb").from("branches").select("brand_code").eq("branch_code", branchCode).maybeSingle();
  if (listed.error) return listed.error.message || "อ่านสาขาไม่สำเร็จ";
  const row = listed.data && typeof listed.data === "object" ? listed.data as Record<string, unknown> : null;
  if (!row) return "ไม่พบสาขา";
  if (brand && text(row.brand_code) !== brand) return "สาขานี้ไม่อยู่ในแบรนด์ที่เปิดใช้งาน";
  return null;
}

async function filesOf(formData: FormData, field: string): Promise<File[]> {
  return formData.getAll(field).filter((entry): entry is File => entry instanceof File && entry.size > 0);
}

export async function listFnbBranchOptionsAction(brandLock?: FnbBrandCode | null): Promise<FnbActionResult<FnbBranchOption[]>> {
  try {
    const listed = await schemaAdmin().schema("fnb").from("branches").select("*").order("sort_order", { ascending: true }).limit(20);
    if (listed.error) return fail([], listed.error, "อ่านสาขาไม่สำเร็จ");
    return result(asRows(listed.data).map((row) => ({
      branch_code: text(row.branch_code),
      branch_name_th: text(row.branch_name_th),
      brand_code: text(row.brand_code),
      legal_entity_id: text(row.legal_entity_id),
      vat_branch_code: text(row.vat_branch_code),
      branch_status: text(row.branch_status),
      target_open_date: row.target_open_date == null ? null : text(row.target_open_date),
    })).filter((branch) => !brandLock || branch.brand_code === brandLock));
  } catch (error) {
    return caught([], error, "อ่านสาขาไม่สำเร็จ");
  }
}

export async function getFnbDashboardAction(): Promise<FnbActionResult<FnbBranchKpi[]>> {
  try {
    await requireSuperAdmin();
    const db = schemaAdmin().schema("fnb");
    const today = todayBangkok();
    const month = today.slice(0, 7);
    const [shifts, waste, payouts] = await Promise.all([
      db.from("shift_closings").select("branch_code,work_date,net_sales_inc_vat,cash_pos_amount,qr_amount,lineman_gross_amount,grab_gross_amount").limit(1000),
      db.from("daily_waste_logs").select("branch_code,work_date,total_waste_cost_thb").limit(1000),
      db.from("store_reimbursements").select("branch_code,total_amount,payout_status").eq("payout_status", "PENDING_PAYOUT").limit(500),
    ]);
    if (shifts.error) return fail([], shifts.error, "อ่านยอดปิดกะไม่สำเร็จ");
    const map = new Map<string, FnbBranchKpi>();
    const ensure = (code: string) => {
      const current = map.get(code) ?? { branch_code: code, todaySales: 0, monthSales: 0, cash: 0, qr: 0, lineman: 0, grab: 0, wasteCost: 0, pendingReimburse: 0 };
      map.set(code, current);
      return current;
    };
    for (const row of asRows(shifts.data)) {
      const bucket = ensure(text(row.branch_code));
      const when = text(row.work_date);
      if (when.startsWith(month)) {
        bucket.monthSales += num(row.net_sales_inc_vat);
        bucket.cash += num(row.cash_pos_amount);
        bucket.qr += num(row.qr_amount);
        bucket.lineman += num(row.lineman_gross_amount);
        bucket.grab += num(row.grab_gross_amount);
      }
      if (when === today) bucket.todaySales += num(row.net_sales_inc_vat);
    }
    for (const row of asRows(waste.data)) {
      if (text(row.work_date).startsWith(month)) ensure(text(row.branch_code)).wasteCost += num(row.total_waste_cost_thb);
    }
    for (const row of asRows(payouts.data)) {
      ensure(text(row.branch_code)).pendingReimburse += num(row.total_amount);
    }
    return result([...map.values()]);
  } catch (error) {
    return caught([], error, "อ่านภาพรวมไม่สำเร็จ");
  }
}

export async function recordMorningOpeningAction(formData: FormData): Promise<FnbActionResult<FnbSubmitResult>> {
  try {
    const branch = text(formData.get("branch_code"));
    const denied = await assertBranchBrand(branch, brandLockOf(formData.get("brand_lock")));
    if (denied) return result({ ok: false, mode: null, request_no: null, message: denied }, denied);
    const photos = await Promise.all((await filesOf(formData, "photos")).map((file) => storeFnbFile(branch, "open", file)));
    const saved = await callFnbRpc("record_morning_opening_and_calibration", {
      p_branch_code: branch,
      p_work_date: text(formData.get("work_date")) || todayBangkok(),
      p_staff_name: text(formData.get("staff_name")),
      p_calibration_shots: Number(formData.get("calibration_shots") ?? 0),
      p_dose_per_shot_g: Number(formData.get("dose_per_shot_g") ?? 20),
      p_extraction_time_sec: Number(formData.get("extraction_time_sec") ?? 0),
      p_liquid_yield_g: Number(formData.get("liquid_yield_g") ?? 0),
      p_photo_urls: photos,
      p_checklist_json: { scale: true, bar: true, pastry: true, restroom: true },
      p_notes: text(formData.get("notes")),
      p_actor_id: null,
      p_is_edit: formData.get("is_edit") === "true",
      p_edit_reason: text(formData.get("edit_reason")),
    });
    return submitFromRpc(saved.data, saved.error, "บันทึกเปิดร้านไม่สำเร็จ");
  } catch (error) {
    return caught({ ok: false, mode: null, request_no: null, message: null }, error, "บันทึกเปิดร้านไม่สำเร็จ");
  }
}

export async function recordShiftClosingAction(formData: FormData): Promise<FnbActionResult<FnbSubmitResult>> {
  try {
    const branch = text(formData.get("branch_code"));
    const denied = await assertBranchBrand(branch, brandLockOf(formData.get("brand_lock")));
    if (denied) return result({ ok: false, mode: null, request_no: null, message: denied }, denied);
    const slips = await Promise.all((await filesOf(formData, "slips")).map((file) => storeFnbFile(branch, "slip", file)));
    const evidence = await Promise.all((await filesOf(formData, "evidence")).map((file) => storeFnbFile(branch, "edit", file)));
    const sevenFiles = await filesOf(formData, "seven_slip");
    const sevenUrl = sevenFiles[0] ? await storeFnbFile(branch, "seven", sevenFiles[0]) : null;
    const bankFiles = await filesOf(formData, "bank_slip");
    const bankUrl = bankFiles[0] ? await storeFnbFile(branch, "bank", bankFiles[0]) : null;
    const breakdown = [1000, 500, 100, 50, 20, 10, 5, 2, 1].map((face) => ({
      face,
      qty: Number(formData.get(`note_${face}`) ?? 0),
    }));
    let superAdmin = false;
    let actorId: string | null = null;
    if (formData.get("is_super_admin") === "true") {
      const admin = await requireSuperAdmin();
      superAdmin = true;
      actorId = admin.userId;
    }
    const qr = Number(formData.get("qr_amount") ?? 0);
    const lineman = Number(formData.get("lineman_gross_amount") ?? 0);
    const grab = Number(formData.get("grab_gross_amount") ?? 0);
    const webapp = Number(formData.get("webapp_amount") ?? 0);
    const saved = await callFnbRpc("record_shift_closing_transaction", {
      p_branch_code: branch,
      p_work_date: text(formData.get("work_date")) || todayBangkok(),
      p_shift_type: text(formData.get("shift_type")) || "MORNING",
      p_entry_mode: text(formData.get("entry_mode")) || "POS_SLIP",
      p_staff_name: text(formData.get("staff_name")),
      p_order_count: Number(formData.get("order_count") ?? 0),
      p_gross_sales: Number(formData.get("gross_sales") ?? 0),
      p_discount_total: Number(formData.get("discount_total") ?? 0),
      p_delivery_price_diff_discount: Number(formData.get("delivery_price_diff_discount") ?? 0),
      p_net_sales_inc_vat: Number(formData.get("net_sales_inc_vat") ?? 0),
      p_cash_pos_amount: Number(formData.get("cash_pos_amount") ?? 0),
      p_cash_counted_amount: Number(formData.get("cash_counted_amount") ?? 0),
      p_cash_variance_reason: text(formData.get("cash_variance_reason")),
      p_pos_qr_amount: qr,
      p_pos_lineman_amount: lineman,
      p_pos_grab_amount: grab,
      p_pos_webapp_amount: webapp,
      p_morning_cash_quick: Number(formData.get("morning_cash_quick") ?? 0),
      p_afternoon_cash_quick: Number(formData.get("afternoon_cash_quick") ?? 0),
      p_qr_amount: qr,
      p_lineman_gross_amount: lineman,
      p_grab_gross_amount: grab,
      p_webapp_amount: webapp,
      p_cash_breakdown_json: breakdown,
      p_deposit_method: text(formData.get("deposit_method")) || "HOLD_NEXT_SHIFT",
      p_bank_deposit_amount: Number(formData.get("bank_deposit_amount") ?? 0),
      p_bank_deposit_slip_url: bankUrl,
      p_seven_eleven_deposit_amount: Number(formData.get("seven_eleven_deposit_amount") ?? 0),
      p_seven_eleven_fee_thb: Number(formData.get("seven_eleven_fee_thb") ?? 0),
      p_seven_eleven_tx_id: text(formData.get("seven_eleven_tx_id")) || null,
      p_seven_eleven_slip_url: sevenUrl,
      p_staff_bank_info: text(formData.get("staff_bank_info")),
      p_slip_image_urls: [...slips, ...evidence],
      p_weather_or_shift_note: text(formData.get("weather_or_shift_note")),
      p_is_edit: formData.get("is_edit") === "true",
      p_edit_reason: text(formData.get("edit_reason")),
      p_is_super_admin: superAdmin,
      p_actor_user_id: actorId,
    });
    return submitFromRpc(saved.data, saved.error, "บันทึกปิดกะไม่สำเร็จ");
  } catch (error) {
    return caught({ ok: false, mode: null, request_no: null, message: null }, error, "บันทึกปิดกะไม่สำเร็จ");
  }
}

export async function recordNightWasteAction(formData: FormData): Promise<FnbActionResult<FnbSubmitResult & { detail: unknown }>> {
  try {
    const branch = text(formData.get("branch_code"));
    const denied = await assertBranchBrand(branch, brandLockOf(formData.get("brand_lock")));
    if (denied) return result({ ok: false, mode: null, request_no: null, message: denied, detail: null }, denied);
    const photos = await Promise.all((await filesOf(formData, "photos")).map((file) => storeFnbFile(branch, "waste", file)));
    const entries = text(formData.get("waste_entries_json"));
    const saved = await callFnbRpc("record_night_waste_and_reverse_bom", {
      p_branch_code: branch,
      p_work_date: text(formData.get("work_date")) || todayBangkok(),
      p_staff_name: text(formData.get("staff_name")),
      p_waste_entries: entries ? JSON.parse(entries) : [],
      p_photo_urls: photos,
      p_notes: text(formData.get("notes")),
      p_is_edit: formData.get("is_edit") === "true",
      p_edit_reason: text(formData.get("edit_reason")),
    });
    const parsed = submitFromRpc(saved.data, saved.error, "บันทึกของทิ้งไม่สำเร็จ");
    return { ...parsed, data: { ...parsed.data, detail: parsed.error ? null : saved.data } };
  } catch (error) {
    return caught({ ok: false, mode: null, request_no: null, message: null, detail: null }, error, "บันทึกของทิ้งไม่สำเร็จ");
  }
}

export async function listFrontBackItemsAction(brandLock?: FnbBrandCode | null): Promise<FnbActionResult<FnbItemRow[]>> {
  try {
    const listed = await schemaAdmin().schema("fnb").from("items").select("*").eq("is_front_back_checked", true).order("short_code", { ascending: true }).limit(200);
    if (listed.error) return fail([], listed.error, "อ่านรายการเช็กของไม่สำเร็จ");
    return result(asRows(listed.data).map((row) => ({
      id: text(row.id),
      short_code: text(row.short_code),
      external_code: null,
      brand_scope: text(row.brand_scope),
      item_category: text(row.item_category),
      name_th: text(row.name_th),
      name_cn: null,
      recipe_uom: text(row.recipe_uom),
      count_uom: text(row.count_uom),
      recipe_per_count_uom: num(row.recipe_per_count_uom),
      default_purchase_uom: text(row.default_purchase_uom),
      recipe_per_purchase_uom: num(row.recipe_per_purchase_uom),
      specific_gravity: num(row.specific_gravity) || 1,
      tare_weight_g: num(row.tare_weight_g),
      reference_purchase_price: 0,
      default_vat_mode: text(row.default_vat_mode),
      moving_avg_cost_per_recipe_unit: 0,
      is_front_back_checked: true,
      front_back_group: row.front_back_group == null ? null : text(row.front_back_group),
      is_active: true,
      shelf_life_months: row.shelf_life_months == null ? null : num(row.shelf_life_months),
      requires_expiry_tracking: row.requires_expiry_tracking !== false,
    })).filter((item) => {
      if (!brandLock) return true;
      if (item.brand_scope !== "ALL" && item.brand_scope !== brandLock) return false;
      const label = `${item.short_code} ${item.name_th}`;
      return brandLock === "LUCKY_CUP" ? !/ชาทร|chatorn/i.test(label) : !/lucky\s*cup|ลัคกี้|luckycup/i.test(label);
    }));
  } catch (error) {
    return caught([], error, "อ่านรายการเช็กของไม่สำเร็จ");
  }
}

export async function saveShelfChecksAction(input: {
  branch_code: string;
  check_date: string;
  staff_name: string;
  brand_lock?: FnbBrandCode | null;
  is_edit?: boolean;
  edit_reason?: string;
  lines: { item_id: string; sold_qty: number; front_qty: number; back_qty: number; expiry_date: string }[];
}): Promise<FnbActionResult<FnbSubmitResult>> {
  try {
    const denied = await assertBranchBrand(input.branch_code, input.brand_lock ?? null);
    if (denied) return result({ ok: false, mode: null, request_no: null, message: denied }, denied);
    const db = schemaAdmin().schema("fnb");
    const existing = await db.from("daily_shelf_check_submissions").select("id,revision_count").eq("branch_code", input.branch_code).eq("check_date", input.check_date).maybeSingle();
    if (existing.error) return fail({ ok: false, mode: null, request_no: null, message: null }, existing.error, "บันทึกเช็กของไม่สำเร็จ");
    const current = existing.data && typeof existing.data === "object" ? existing.data as Record<string, unknown> : null;
    if (current?.id && !input.is_edit) {
      return result({ ok: false, mode: null, request_no: null, message: "บันทึกเช็กของวันนี้ไปแล้ว" }, "บันทึกเช็กของวันนี้ไปแล้ว (บันทึกได้วันละ 1 ครั้ง)");
    }
    if (current?.id && text(input.edit_reason).length < 3) {
      return result({ ok: false, mode: null, request_no: null, message: "กรุณาระบุสาเหตุการแก้ไข" }, "กรุณาระบุสาเหตุการแก้ไข");
    }
    let saved = 0;
    for (const line of input.lines) {
      const found = await db
        .from("daily_shelf_checks")
        .select("id")
        .eq("branch_code", input.branch_code)
        .eq("check_date", input.check_date)
        .eq("item_id", line.item_id)
        .maybeSingle();
      if (found.error) return fail({ ok: false, mode: null, request_no: null, message: null }, found.error, "บันทึกเช็กของไม่สำเร็จ");
      const payload = {
        branch_code: input.branch_code,
        check_date: input.check_date,
        staff_name: input.staff_name,
        item_id: line.item_id,
        sold_qty: Number(line.sold_qty) || 0,
        front_qty: Number(line.front_qty) || 0,
        back_qty: Number(line.back_qty) || 0,
        expiry_date: line.expiry_date || null,
      };
      const row = found.data && typeof found.data === "object" ? found.data as Record<string, unknown> : null;
      const written = row?.id
        ? await db.from("daily_shelf_checks").update(payload).eq("id", text(row.id))
        : await db.from("daily_shelf_checks").insert(payload);
      if (written.error) return fail({ ok: false, mode: null, request_no: null, message: null }, written.error, "บันทึกเช็กของไม่สำเร็จ");
      saved += 1;
    }
    const header = current?.id
      ? await db.from("daily_shelf_check_submissions").update({
          staff_name: input.staff_name,
          item_count: saved,
          revision_count: num(current.revision_count) + 1,
          last_edit_reason: text(input.edit_reason),
          updated_at: new Date().toISOString(),
        }).eq("id", text(current.id))
      : await db.from("daily_shelf_check_submissions").insert({
          branch_code: input.branch_code,
          check_date: input.check_date,
          staff_name: input.staff_name,
          item_count: saved,
        });
    if (header.error) return fail({ ok: false, mode: null, request_no: null, message: null }, header.error, "บันทึกเช็กของไม่สำเร็จ");
    return result({ ok: true, mode: current?.id ? "UPDATED" : "CREATED", request_no: null, message: null });
  } catch (error) {
    return caught({ ok: false, mode: null, request_no: null, message: null }, error, "บันทึกเช็กของไม่สำเร็จ");
  }
}

export async function prefillPosSlipAction(formData: FormData): Promise<FnbActionResult<Record<string, number>>> {
  try {
    const file = formData.get("file");
    if (!(file instanceof File)) return result({}, "ไม่พบรูปสลิป");
    const apiKey = resolveGeminiApiKey();
    if (!apiKey) return result({}, "ยังไม่ได้ตั้งค่า Gemini");
    const generated = await generateWithGeminiFallback({
      apiKey,
      parts: [
        { text: "อ่านสลิปปิดกะ Lucky Cup หรือ Wongnai แล้วตอบ JSON เท่านั้น คีย์คือ gross_sales, discount_total, delivery_price_diff_discount, net_sales_inc_vat, cash_pos_amount, qr_amount, lineman_gross_amount, grab_gross_amount, webapp_amount. จับคู่แบบนี้: ยอดขายรวม(หักบิลยกเลิก)=gross_sales เช่น 2729, ยอดรวมส่วนลดทั้งหมด=discount_total เช่น 503, ยอดขายสุทธิหรือยอดรวมที่รับจริง=net_sales_inc_vat เช่น 2226, 1. Cash=cash_pos_amount, 2. THAI QR=qr_amount, 3. LINEMAN=lineman_gross_amount, 4. GRABFOOD=grab_gross_amount, 5. Web & App=webapp_amount. ไม่พบให้ใส่ 0." },
        { inlineData: { mimeType: file.type || "image/jpeg", data: Buffer.from(await file.arrayBuffer()).toString("base64") } },
      ],
    });
    const match = generated.text.match(/\{[\s\S]*\}/);
    const parsed = match ? JSON.parse(match[0]) as Record<string, unknown> : {};
    const numbers: Record<string, number> = {};
    for (const key of ["gross_sales", "discount_total", "delivery_price_diff_discount", "net_sales_inc_vat", "cash_pos_amount", "qr_amount", "lineman_gross_amount", "grab_gross_amount", "webapp_amount"]) {
      numbers[key] = num(parsed[key]);
    }
    return result(numbers);
  } catch (error) {
    return caught({}, error, "อ่านสลิปไม่สำเร็จ");
  }
}

export async function previewPosExcelAction(formData: FormData): Promise<FnbActionResult<FnbPosImportPreview | null>> {
  try {
    await requireSuperAdmin();
    const file = formData.get("file");
    if (!(file instanceof File)) return result(null, "ไม่พบไฟล์ Excel");
    return result(parseLuckyCupPosWorkbook(await file.arrayBuffer(), file.name));
  } catch (error) {
    return caught(null, error, "อ่านไฟล์ POS ไม่สำเร็จ");
  }
}

export async function commitPosExcelAction(input: FnbPosImportPreview & { branch_code: string }): Promise<FnbActionResult<{ ok: boolean }>> {
  try {
    const admin = await requireSuperAdmin();
    const denied = await assertBranchBrand(input.branch_code, "LUCKY_CUP");
    if (denied) return result({ ok: false }, denied);
    const saved = await schemaAdmin().schema("fnb").from("pos_excel_imports").insert({
      branch_code: input.branch_code,
      file_name: input.file_name,
      valid_order_count: input.valid_order_count,
      cancelled_order_count: input.cancelled_order_count,
      gross_sales_total: input.gross_sales_total,
      net_sales_total: input.net_sales_total,
      cancelled_orders_json: input.cancelled_orders_json,
      imported_by: admin.userId,
    });
    if (saved.error) return fail({ ok: false }, saved.error, "บันทึกนำเข้า POS ไม่สำเร็จ");
    return result({ ok: true });
  } catch (error) {
    return caught({ ok: false }, error, "บันทึกนำเข้า POS ไม่สำเร็จ");
  }
}

function objectPayload(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export async function getFnbDayStateAction(branchCode: string, workDate: string, brandLock?: FnbBrandCode | null): Promise<FnbActionResult<FnbDayState>> {
  const emptyState: FnbDayState = { opening: null, shifts: [], waste: null, shelf: null, pending: [] };
  try {
    const denied = await assertBranchBrand(branchCode, brandLock ?? null);
    if (denied) return result(emptyState, denied);
    const db = schemaAdmin().schema("fnb");
    const [opening, shifts, waste, shelf, pending] = await Promise.all([
      db.from("daily_openings").select("staff_name,calibration_shots,dose_per_shot_g,extraction_time_sec,liquid_yield_g,total_coffee_used_g,last_edit_reason").eq("branch_code", branchCode).eq("work_date", workDate).maybeSingle(),
      db.from("shift_closings").select("id,shift_type,entry_mode,staff_name,gross_sales,discount_total,net_sales_inc_vat,cash_pos_amount,cash_counted_amount,cash_variance,cash_variance_reason,qr_amount,lineman_gross_amount,grab_gross_amount,webapp_amount,morning_cash_quick,afternoon_cash_quick,deposit_method,bank_deposit_amount,seven_eleven_deposit_amount,seven_eleven_fee_thb,platform_settlement_status,lineman_net_payout,grab_net_payout,webapp_net_payout,weather_or_shift_note").eq("branch_code", branchCode).eq("work_date", workDate).limit(5),
      db.from("daily_waste_logs").select("staff_name,total_waste_cost_thb,last_edit_reason,waste_summary_json").eq("branch_code", branchCode).eq("work_date", workDate).limit(1),
      db.from("daily_shelf_check_submissions").select("staff_name,item_count,last_edit_reason").eq("branch_code", branchCode).eq("check_date", workDate).maybeSingle(),
      db.from("operation_change_requests").select("request_no,shift_type,approval_status").eq("branch_code", branchCode).eq("work_date", workDate).eq("approval_status", "PENDING").limit(10),
    ]);
    if (opening.error) return fail(emptyState, opening.error, "อ่านสถานะประจำวันไม่สำเร็จ");
    const openRow = opening.data && typeof opening.data === "object" ? opening.data as Record<string, unknown> : null;
    const shelfRow = shelf.data && typeof shelf.data === "object" ? shelf.data as Record<string, unknown> : null;
    const wasteRow = asRows(waste.data)[0] ?? null;
    return result({
      opening: openRow ? {
        staff_name: text(openRow.staff_name),
        calibration_shots: num(openRow.calibration_shots),
        dose_per_shot_g: num(openRow.dose_per_shot_g),
        extraction_time_sec: openRow.extraction_time_sec == null ? null : num(openRow.extraction_time_sec),
        liquid_yield_g: openRow.liquid_yield_g == null ? null : num(openRow.liquid_yield_g),
        total_coffee_used_g: num(openRow.total_coffee_used_g),
        last_edit_reason: openRow.last_edit_reason == null ? null : text(openRow.last_edit_reason),
      } : null,
      shifts: asRows(shifts.data).map((row) => ({
        id: text(row.id),
        shift_type: text(row.shift_type),
        entry_mode: text(row.entry_mode),
        staff_name: text(row.staff_name),
        gross_sales: num(row.gross_sales),
        discount_total: num(row.discount_total),
        net_sales_inc_vat: num(row.net_sales_inc_vat),
        cash_pos_amount: num(row.cash_pos_amount),
        cash_counted_amount: num(row.cash_counted_amount),
        cash_variance: row.cash_variance == null ? null : num(row.cash_variance),
        cash_variance_reason: row.cash_variance_reason == null ? null : text(row.cash_variance_reason),
        qr_amount: num(row.qr_amount),
        lineman_gross_amount: num(row.lineman_gross_amount),
        grab_gross_amount: num(row.grab_gross_amount),
        webapp_amount: num(row.webapp_amount),
        morning_cash_quick: num(row.morning_cash_quick),
        afternoon_cash_quick: num(row.afternoon_cash_quick),
        deposit_method: text(row.deposit_method),
        bank_deposit_amount: num(row.bank_deposit_amount),
        seven_eleven_deposit_amount: num(row.seven_eleven_deposit_amount),
        seven_eleven_fee_thb: num(row.seven_eleven_fee_thb),
        platform_settlement_status: text(row.platform_settlement_status),
        lineman_net_payout: row.lineman_net_payout == null ? null : num(row.lineman_net_payout),
        grab_net_payout: row.grab_net_payout == null ? null : num(row.grab_net_payout),
        webapp_net_payout: row.webapp_net_payout == null ? null : num(row.webapp_net_payout),
        weather_or_shift_note: row.weather_or_shift_note == null ? null : text(row.weather_or_shift_note),
      })),
      waste: wasteRow ? {
        staff_name: text(wasteRow.staff_name),
        total_waste_cost_thb: num(wasteRow.total_waste_cost_thb),
        last_edit_reason: wasteRow.last_edit_reason == null ? null : text(wasteRow.last_edit_reason),
        summary: wasteRow.waste_summary_json ?? null,
      } : null,
      shelf: shelfRow ? {
        staff_name: text(shelfRow.staff_name),
        item_count: num(shelfRow.item_count),
        last_edit_reason: shelfRow.last_edit_reason == null ? null : text(shelfRow.last_edit_reason),
      } : null,
      pending: asRows(pending.data).map((row) => ({ request_no: text(row.request_no), shift_type: text(row.shift_type) })),
    });
  } catch (error) {
    return caught(emptyState, error, "อ่านสถานะประจำวันไม่สำเร็จ");
  }
}

export async function listPendingShiftApprovalsAction(): Promise<FnbActionResult<FnbChangeRequestRow[]>> {
  try {
    await requireSuperAdmin();
    const listed = await schemaAdmin().schema("fnb").from("operation_change_requests").select("id,request_no,branch_code,work_date,shift_type,requested_by_name,edit_reason,old_payload,proposed_payload,approval_status").eq("approval_status", "PENDING").limit(100);
    if (listed.error) return fail([], listed.error, "อ่านคิวอนุมัติไม่สำเร็จ");
    return result(asRows(listed.data).map((row) => ({
      id: text(row.id),
      request_no: text(row.request_no),
      branch_code: text(row.branch_code),
      work_date: text(row.work_date),
      shift_type: text(row.shift_type),
      requested_by_name: text(row.requested_by_name),
      edit_reason: text(row.edit_reason),
      old_payload: objectPayload(row.old_payload),
      proposed_payload: objectPayload(row.proposed_payload),
    })));
  } catch (error) {
    return caught([], error, "อ่านคิวอนุมัติไม่สำเร็จ");
  }
}

export async function reviewShiftChangeAction(requestId: string, decision: "APPROVED" | "REJECTED", comment: string): Promise<FnbActionResult<FnbSubmitResult>> {
  try {
    const admin = await requireSuperAdmin();
    const saved = await callFnbRpc("review_shift_change_request", {
      p_request_id: requestId,
      p_decision: decision,
      p_reviewer_user_id: admin.userId,
      p_reviewer_name: "Super Admin",
      p_review_comment: comment,
    });
    return submitFromRpc(saved.data, saved.error, "บันทึกผลการอนุมัติไม่สำเร็จ");
  } catch (error) {
    return caught({ ok: false, mode: null, request_no: null, message: null }, error, "บันทึกผลการอนุมัติไม่สำเร็จ");
  }
}

export async function settlePlatformPayoutAction(input: {
  shift_id: string;
  lineman_net_payout: number;
  grab_net_payout: number;
  webapp_net_payout: number;
  platform_deduction_note: string;
}): Promise<FnbActionResult<{ ok: boolean }>> {
  try {
    const admin = await requireSuperAdmin();
    const updated = await schemaAdmin().schema("fnb").from("shift_closings").update({
      lineman_net_payout: Number(input.lineman_net_payout) || 0,
      grab_net_payout: Number(input.grab_net_payout) || 0,
      webapp_net_payout: Number(input.webapp_net_payout) || 0,
      platform_deduction_note: input.platform_deduction_note || null,
      platform_settlement_status: "SETTLED",
      platform_settled_at: new Date().toISOString(),
      platform_settled_by: admin.userId,
    }).eq("id", input.shift_id);
    if (updated.error) return fail({ ok: false }, updated.error, "บันทึกกระทบยอดแพลตฟอร์มไม่สำเร็จ");
    return result({ ok: true });
  } catch (error) {
    return caught({ ok: false }, error, "บันทึกกระทบยอดแพลตฟอร์มไม่สำเร็จ");
  }
}
