"use server";

import { generateWithGeminiFallback, resolveGeminiApiKey } from "@/lib/ai/gemini-client";
import { parseLuckyCupPosWorkbook } from "@/lib/fnb/excel";
import { callFnbRpc } from "@/lib/fnb/rpc";
import { asRows, caught, fail, num, result, text, todayBangkok } from "@/lib/fnb/rows";
import { schemaAdmin } from "@/lib/holding/schema-db";
import { requireSuperAdmin } from "@/lib/holding/workspace-access";
import type { FnbActionResult, FnbBranchKpi, FnbBranchOption, FnbItemRow, FnbPosImportPreview } from "@/types/fnb";

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

async function filesOf(formData: FormData, field: string): Promise<File[]> {
  return formData.getAll(field).filter((entry): entry is File => entry instanceof File && entry.size > 0);
}

export async function listFnbBranchOptionsAction(): Promise<FnbActionResult<FnbBranchOption[]>> {
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
    })));
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

export async function recordMorningOpeningAction(formData: FormData): Promise<FnbActionResult<{ ok: boolean }>> {
  try {
    const branch = text(formData.get("branch_code"));
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
    });
    if (saved.error) return fail({ ok: false }, saved.error, "บันทึกเปิดร้านไม่สำเร็จ");
    return result({ ok: true });
  } catch (error) {
    return caught({ ok: false }, error, "บันทึกเปิดร้านไม่สำเร็จ");
  }
}

export async function recordShiftClosingAction(formData: FormData): Promise<FnbActionResult<{ ok: boolean }>> {
  try {
    const branch = text(formData.get("branch_code"));
    const slips = await Promise.all((await filesOf(formData, "slips")).map((file) => storeFnbFile(branch, "slip", file)));
    const sevenFiles = await filesOf(formData, "seven_slip");
    const sevenUrl = sevenFiles[0] ? await storeFnbFile(branch, "seven", sevenFiles[0]) : null;
    const breakdown = [1000, 500, 100, 50, 20, 10, 5, 2, 1].map((face) => ({
      face,
      qty: Number(formData.get(`note_${face}`) ?? 0),
    }));
    const saved = await callFnbRpc("record_shift_closing_transaction", {
      p_branch_code: branch,
      p_work_date: text(formData.get("work_date")) || todayBangkok(),
      p_shift_type: text(formData.get("shift_type")) || "FULL_DAY",
      p_entry_mode: text(formData.get("entry_mode")) || "POS_SLIP",
      p_staff_name: text(formData.get("staff_name")),
      p_order_count: Number(formData.get("order_count") ?? 0),
      p_gross_sales: Number(formData.get("gross_sales") ?? 0),
      p_discount_total: Number(formData.get("discount_total") ?? 0),
      p_delivery_price_diff_discount: Number(formData.get("delivery_price_diff_discount") ?? 0),
      p_net_sales_inc_vat: Number(formData.get("net_sales_inc_vat") ?? 0),
      p_cash_pos_amount: Number(formData.get("cash_pos_amount") ?? 0),
      p_cash_counted_amount: Number(formData.get("cash_counted_amount") ?? 0),
      p_morning_cash_quick: Number(formData.get("morning_cash_quick") ?? 0),
      p_afternoon_cash_quick: Number(formData.get("afternoon_cash_quick") ?? 0),
      p_qr_amount: Number(formData.get("qr_amount") ?? 0),
      p_lineman_gross_amount: Number(formData.get("lineman_gross_amount") ?? 0),
      p_lineman_gp_amount: Number(formData.get("lineman_gp_amount") ?? 0),
      p_grab_gross_amount: Number(formData.get("grab_gross_amount") ?? 0),
      p_grab_gp_amount: Number(formData.get("grab_gp_amount") ?? 0),
      p_webapp_amount: Number(formData.get("webapp_amount") ?? 0),
      p_cash_breakdown_json: breakdown,
      p_seven_eleven_deposit_amount: Number(formData.get("seven_eleven_deposit_amount") ?? 0),
      p_seven_eleven_fee_thb: Number(formData.get("seven_eleven_fee_thb") ?? 0),
      p_seven_eleven_tx_id: text(formData.get("seven_eleven_tx_id")) || null,
      p_seven_eleven_slip_url: sevenUrl,
      p_staff_bank_info: text(formData.get("staff_bank_info")),
      p_slip_image_urls: slips,
      p_weather_or_shift_note: text(formData.get("weather_or_shift_note")),
    });
    if (saved.error) return fail({ ok: false }, saved.error, "บันทึกปิดกะไม่สำเร็จ");
    return result({ ok: true });
  } catch (error) {
    return caught({ ok: false }, error, "บันทึกปิดกะไม่สำเร็จ");
  }
}

export async function recordNightWasteAction(formData: FormData): Promise<FnbActionResult<unknown>> {
  try {
    const branch = text(formData.get("branch_code"));
    const photos = await Promise.all((await filesOf(formData, "photos")).map((file) => storeFnbFile(branch, "waste", file)));
    const entries = text(formData.get("waste_entries_json"));
    const saved = await callFnbRpc("record_night_waste_and_reverse_bom", {
      p_branch_code: branch,
      p_work_date: text(formData.get("work_date")) || todayBangkok(),
      p_staff_name: text(formData.get("staff_name")),
      p_waste_entries: entries ? JSON.parse(entries) : [],
      p_photo_urls: photos,
      p_notes: text(formData.get("notes")),
    });
    if (saved.error) return fail(null, saved.error, "บันทึกของทิ้งไม่สำเร็จ");
    return result(saved.data);
  } catch (error) {
    return caught(null, error, "บันทึกของทิ้งไม่สำเร็จ");
  }
}

export async function listFrontBackItemsAction(): Promise<FnbActionResult<FnbItemRow[]>> {
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
    })));
  } catch (error) {
    return caught([], error, "อ่านรายการเช็กของไม่สำเร็จ");
  }
}

export async function saveShelfChecksAction(input: {
  branch_code: string;
  check_date: string;
  staff_name: string;
  lines: { item_id: string; sold_qty: number; front_qty: number; back_qty: number; expiry_date: string }[];
}): Promise<FnbActionResult<{ saved: number }>> {
  try {
    const db = schemaAdmin().schema("fnb");
    let saved = 0;
    for (const line of input.lines) {
      const existing = await db
        .from("daily_shelf_checks")
        .select("id")
        .eq("branch_code", input.branch_code)
        .eq("check_date", input.check_date)
        .eq("item_id", line.item_id)
        .maybeSingle();
      if (existing.error) return fail({ saved }, existing.error, "บันทึกเช็กของไม่สำเร็จ");
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
      const row = existing.data && typeof existing.data === "object" ? existing.data as Record<string, unknown> : null;
      const written = row?.id
        ? await db.from("daily_shelf_checks").update(payload).eq("id", text(row.id))
        : await db.from("daily_shelf_checks").insert(payload);
      if (written.error) return fail({ saved }, written.error, "บันทึกเช็กของไม่สำเร็จ");
      saved += 1;
    }
    return result({ saved });
  } catch (error) {
    return caught({ saved: 0 }, error, "บันทึกเช็กของไม่สำเร็จ");
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
        { text: "Extract POS sales numbers as JSON keys gross_sales, discount_total, delivery_price_diff_discount, net_sales_inc_vat, cash_pos_amount, qr_amount, lineman_gross_amount, grab_gross_amount, webapp_amount. Use 0 when missing. Reply JSON only." },
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
