"use server";

import { callFnbRpc } from "@/lib/fnb/rpc";
import { asRows, caught, fail, num, result, text } from "@/lib/fnb/rows";
import { bangkokWeekday, sectionNumber } from "@/lib/fnb/stage-progress";
import { formatFnbQty, formatPrepPortionPct } from "@/lib/utils/fnb-format";
import { schemaAdmin } from "@/lib/holding/schema-db";
import { requireAnyFnbModule } from "@/lib/holding/workspace-access";
import type {
  FnbActionResult,
  FnbAuditAnomaly,
  FnbAuditPeriodRow,
  FnbAuditPhoto,
  FnbAuditProfile,
  FnbBrandCode,
  FnbInspectorDetail,
  FnbInspectorMatrixRow,
  FnbInspectorOpeningCard,
  FnbQaPack,
  FnbQaSectionKey,
} from "@/types/fnb";
import { FNB_QA_SECTIONS } from "@/types/fnb";

const QA_KEYS = new Set<string>(FNB_QA_SECTIONS.map((row) => row.key));

function brandOf(value: string): FnbBrandCode {
  return value === "CHATORN" ? "CHATORN" : "LUCKY_CUP";
}

function crewNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const name = text((item as Record<string, unknown>).staff_name);
    return name ? [name] : [];
  });
}

function urls(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => text(item)).filter((item) => item.startsWith("http")) : [];
}

function dayLabel(iso: string): string {
  const [year, month, day] = iso.slice(0, 10).split("-");
  if (!year || !month || !day) return iso;
  return `${Number(day)}/${Number(month)}/${year}`;
}

function clock(iso: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
}

async function desk() {
  return requireAnyFnbModule(["all_branch_analytics", "tax_accounting_reports"]);
}

export async function getMonthLockAction(brand: string, workDate: string): Promise<FnbActionResult<{ locked: boolean; label: string }>> {
  try {
    await requireAnyFnbModule(["store_portal", "all_branch_analytics", "tax_accounting_reports"]);
    const year = Number(workDate.slice(0, 4));
    const month = Number(workDate.slice(5, 7));
    const listed = await schemaAdmin().schema("fnb").from("accounting_audit_periods").select("is_locked,locked_by_name,locked_at").eq("brand_code", brandOf(brand)).eq("period_year", year).eq("period_month", month).limit(1);
    const row = asRows(listed.data)[0];
    const locked = row?.is_locked === true;
    const label = locked ? `🔒 งวดเดือนนี้ถูกล็อกปิดงวดแล้ว (อ่านอย่างเดียว) · ${text(row?.locked_by_name)} ${clock(text(row?.locked_at))} น.` : "";
    return result({ locked, label });
  } catch (error) {
    return caught({ locked: false, label: "" }, error, "อ่านสถานะงวดไม่สำเร็จ");
  }
}

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function moneyLabel(value: number): string {
  return `${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท`;
}

function countSummary(rows: { name: string; qty: number; uom: string }[], confirmed: boolean): { lines: string[]; zeroNote: string } {
  const positive = rows.filter((row) => row.qty > 0);
  const zeros = rows.filter((row) => row.qty <= 0);
  if (positive.length === 0) return { lines: [confirmed || rows.length > 0 ? "ยืนยันตรวจนับแล้ว: หน้าตู้ 0 ชิ้นทุกรายการ" : "ยังไม่บันทึกยอดนับ"], zeroNote: "" };
  return {
    lines: positive.map((row) => `${row.name}: ${formatFnbQty(row.qty, row.uom, false)}`),
    zeroNote: `(มีของหน้าตู้ ${positive.length} รายการ · 0 ชิ้น ${zeros.length} รายการ)`,
  };
}

function openingCountRows(payload: unknown, fallback: { id: string; name: string; qty: number; uom: string }[]): { name: string; qty: number; uom: string }[] {
  const raw = Array.isArray(recordOf(payload).items) ? recordOf(payload).items as unknown[] : [];
  const parsed = raw.flatMap((item) => {
    const rec = recordOf(item);
    const id = text(rec.item_id || rec.itemId);
    const name = text(rec.name_th || rec.nameTh || rec.name);
    const qty = Number(rec.counted_qty ?? rec.countedQty ?? rec.qty ?? 0);
    if (!id && !name) return [];
    return [{ id, name: name || id, qty: Number.isFinite(qty) ? qty : 0, uom: text(rec.count_uom || rec.uom) || "ชิ้น" }];
  });
  if (parsed.length === 0) return fallback;
  const merged = new Map(fallback.map((row) => [row.id, row]));
  for (const row of parsed) merged.set(row.id || row.name, row);
  return [...merged.values()];
}

export async function getExecutiveInspectorAction(brand: string, workDate: string, branchCode: string): Promise<FnbActionResult<{ matrix: FnbInspectorMatrixRow[]; anomalies: FnbAuditAnomaly[]; detail: FnbInspectorDetail }>> {
  const empty = { matrix: [] as FnbInspectorMatrixRow[], anomalies: [] as FnbAuditAnomaly[], detail: { sections: [], openingCards: [] as FnbInspectorOpeningCard[], wip: [], prepRows: [], openRows: [], replenishments: [], shifts: [], photos: [] } };
  try {
    await desk();
    const scope = brandOf(brand);
    const db = schemaAdmin().schema("fnb");
    const [branches, confirms, batches, transfers, shifts, sales, equipment, writeOffs, counts, items, rosters, bases, cleaningLogs, cleaningSpots] = await Promise.all([
      db.from("branches").select("branch_code,branch_name_th,brand_code,branch_status,coffee_dose_min_g,coffee_dose_max_g,espresso_time_min_s,espresso_time_max_s,espresso_yield_min_g,espresso_yield_max_g").eq("brand_code", scope).neq("branch_status", "INACTIVE").limit(20),
      db.from("daily_stage_section_confirmations").select("id,branch_code,stage_code,section_key,section_title_th,status_flag,numeric_amount,expected_amount,confirmed_by_name,confirmed_at,photo_urls,payload_json").eq("work_date", workDate).limit(2000),
      db.from("bar_wip_batches").select("id,branch_code,batch_kind,prep_base_code,item_id,brew_portion_mode,packs_deducted,pack_uom,opened_at,opened_by_name,expires_at,sticker_label_text,open_photo_urls,batch_status,notes,is_voided_duplicate,sliced_piece_count,actual_usable_qty,is_estimated_net_weight").eq("work_date", workDate).limit(1000),
      db.from("internal_zone_transfers").select("branch_code,item_id,qty_in_count_uom,created_at").eq("work_date", workDate).limit(1000),
      db.from("shift_closings").select("branch_code,shift_type,staff_name,cash_variance,created_at").eq("work_date", workDate).limit(200),
      db.from("daily_menu_sales_headers").select("branch_code,created_at").eq("work_date", workDate).limit(50),
      db.from("daily_equipment_calibrations").select("branch_code,grinder_dose_g,espresso_time_sec,espresso_yield_g,syrup_random_target_g,syrup_measured_actual_g,photo_urls").eq("work_date", workDate).limit(20),
      db.from("item_write_offs").select("id,branch_code,item_id,write_off_reason,qty_in_count_uom,photo_urls,reported_by_name,created_at").eq("work_date", workDate).limit(500),
      db.from("zone_stock_counts").select("branch_code,item_id,counted_qty,shrinkage_diff_qty,count_stage,staff_name").eq("count_date", workDate).limit(2000),
      db.from("items").select("id,short_code,name_th,item_category,count_uom,brand_scope").eq("is_active", true).limit(2000),
      db.from("shift_crew_rosters").select("branch_code,shift_slot,crew_members_json").eq("work_date", workDate).limit(40),
      db.from("prep_bases").select("base_code,base_name_th,yield_qty_ml").eq("brand_code", scope).limit(40),
      db.from("daily_cleaning_spot_logs").select("branch_code,stage_code,spot_id,spot_name_th,photo_url,checked_by_name,checked_at").eq("work_date", workDate).limit(2000),
      db.from("branch_cleaning_spots").select("id,branch_code,stage_code,schedule_type,schedule_weekdays,is_active").eq("is_active", true).limit(500),
    ]);
    if (branches.error) return fail(empty, branches.error, "อ่านสาขาไม่สำเร็จ");
    const branchRows = asRows(branches.data);
    const codes = new Set(branchRows.map((row) => text(row.branch_code)));
    const itemRows = asRows(items.data).filter((row) => {
      const itemBrand = text(row.brand_scope);
      return !itemBrand || itemBrand === scope || itemBrand === "ALL";
    });
    const itemName = new Map(itemRows.map((row) => [text(row.id), `${text(row.short_code)} · ${text(row.name_th)}`]));
    const itemMeta = new Map(itemRows.map((row) => [text(row.id), { name: text(row.name_th) || text(row.short_code), category: text(row.item_category), uom: text(row.count_uom) || "ชิ้น" }]));
    const displayIds = new Set(asRows(items.data).filter((row) => ["BAKERY_FROZEN", "ICE_CREAM", "MERCHANDISE"].includes(text(row.item_category))).map((row) => text(row.id)));
    const anomalies: FnbAuditAnomaly[] = [];
    const limits = new Map(branchRows.map((branch) => [text(branch.branch_code), {
      doseMin: num(branch.coffee_dose_min_g) || 19.8,
      doseMax: num(branch.coffee_dose_max_g) || 20,
      timeMin: num(branch.espresso_time_min_s) || 22,
      timeMax: num(branch.espresso_time_max_s) || 28,
      yieldMin: num(branch.espresso_yield_min_g) || 38,
      yieldMax: num(branch.espresso_yield_max_g) || 40,
    }]));
    for (const row of asRows(equipment.data).filter((item) => codes.has(text(item.branch_code)))) {
      const code = text(row.branch_code);
      const band = limits.get(code) ?? { doseMin: 19.8, doseMax: 20, timeMin: 22, timeMax: 28, yieldMin: 38, yieldMax: 40 };
      const dose = row.grinder_dose_g == null ? null : num(row.grinder_dose_g);
      const seconds = row.espresso_time_sec == null ? null : num(row.espresso_time_sec);
      const shot = row.espresso_yield_g == null ? null : num(row.espresso_yield_g);
      const target = row.syrup_random_target_g == null ? null : num(row.syrup_random_target_g);
      const actual = row.syrup_measured_actual_g == null ? null : num(row.syrup_measured_actual_g);
      if (dose != null && (dose < band.doseMin || dose > band.doseMax)) anomalies.push({ branchCode: code, kind: "อุปกรณ์", detail: `โดสกาแฟนอก ${band.doseMin}–${band.doseMax}g (${dose} g)` });
      if (seconds != null && (seconds < band.timeMin || seconds > band.timeMax)) anomalies.push({ branchCode: code, kind: "อุปกรณ์", detail: `ช็อตนอก ${band.timeMin}–${band.timeMax} วินาที (${seconds} s)` });
      if (shot != null && (shot < band.yieldMin || shot > band.yieldMax)) anomalies.push({ branchCode: code, kind: "อุปกรณ์", detail: `น้ำหนักช็อตนอก ${band.yieldMin}–${band.yieldMax}g (${shot} g)` });
      if (target != null && actual != null && Math.abs(actual - target) > 1) anomalies.push({ branchCode: code, kind: "อุปกรณ์", detail: `เครื่องน้ำเชื่อมคลาดเคลื่อน เป้า ${target} g จริง ${actual} g` });
    }
    for (const row of asRows(shifts.data).filter((item) => codes.has(text(item.branch_code)))) {
      const variance = num(row.cash_variance);
      if (variance !== 0) anomalies.push({ branchCode: text(row.branch_code), kind: "เงินสด", detail: `${text(row.shift_type)} คลาดเคลื่อน ${variance.toFixed(2)} บาท` });
    }
    for (const row of asRows(confirms.data).filter((item) => codes.has(text(item.branch_code)) && text(item.status_flag) === "ISSUE_REPORTED")) {
      anomalies.push({ branchCode: text(row.branch_code), kind: "แจ้งซ่อม", detail: text(row.section_title_th) || "พบจุดชำรุด" });
    }
    for (const row of asRows(counts.data).filter((item) => codes.has(text(item.branch_code)) && displayIds.has(text(item.item_id)) && num(item.shrinkage_diff_qty) > 0)) {
      anomalies.push({ branchCode: text(row.branch_code), kind: "ของหาย", detail: `${itemName.get(text(row.item_id)) || "สินค้าโชว์"} หาย ${num(row.shrinkage_diff_qty)}` });
    }
    for (const row of asRows(writeOffs.data).filter((item) => codes.has(text(item.branch_code)))) {
      anomalies.push({ branchCode: text(row.branch_code), kind: "ตัดเสีย", detail: `${itemName.get(text(row.item_id)) || "รายการ"} · ${text(row.write_off_reason)} ${num(row.qty_in_count_uom)}` });
    }
    const matrix: FnbInspectorMatrixRow[] = branchRows.map((branch) => {
      const code = text(branch.branch_code);
      const opening = asRows(confirms.data).filter((row) => text(row.branch_code) === code && text(row.stage_code) === "OPENING");
      const done = new Set(opening.map((row) => sectionNumber("OPENING", text(row.section_key))).filter((value): value is number => value != null));
      const finished = opening.map((row) => text(row.confirmed_at)).filter(Boolean).sort().at(-1) ?? null;
      const wip = asRows(batches.data).filter((row) => text(row.branch_code) === code && text(row.batch_kind) === "PREP_BASE" && row.is_voided_duplicate !== true);
      const moved = asRows(transfers.data).filter((row) => text(row.branch_code) === code);
      const shiftRows = asRows(shifts.data).filter((row) => text(row.branch_code) === code);
      const first = shiftRows.find((row) => text(row.shift_type) === "MORNING");
      const second = shiftRows.find((row) => text(row.shift_type) === "AFTERNOON");
      const closingRows = asRows(confirms.data).filter((row) => text(row.branch_code) === code && text(row.stage_code) === "CLOSING");
      const sale = asRows(sales.data).find((row) => text(row.branch_code) === code);
      return {
        branchCode: code,
        branchName: text(branch.branch_name_th),
        openingDone: done.size,
        openingFinishedAt: finished,
        staffNames: [...new Set(opening.map((row) => text(row.confirmed_by_name)).filter(Boolean))],
        shift1Crew: crewNames(asRows(rosters.data).find((row) => text(row.branch_code) === code && text(row.shift_slot) === "SHIFT_1")?.crew_members_json),
        shift2Crew: crewNames(asRows(rosters.data).find((row) => text(row.branch_code) === code && text(row.shift_slot) === "SHIFT_2")?.crew_members_json),
        wipCount: wip.length + moved.length,
        wipAt: text(wip[0]?.opened_at) || text(moved[0]?.created_at) || null,
        shift1Staff: first ? text(first.staff_name) : null,
        shift1At: first ? text(first.created_at) : null,
        shift2Staff: second ? text(second.staff_name) : null,
        shift2At: second ? text(second.created_at) : null,
        closingDone: closingRows.length > 0 || Boolean(sale),
        closingAt: text(closingRows[0]?.confirmed_at) || text(sale?.created_at) || null,
      };
    });
    const focus = codes.has(branchCode) ? branchCode : text(branchRows[0]?.branch_code);
    const photos: FnbAuditPhoto[] = [];
    const seenPhotos = new Set<string>();
    function pushPhoto(photo: FnbAuditPhoto) {
      if (!photo.url || seenPhotos.has(photo.url)) return;
      seenPhotos.add(photo.url);
      photos.push(photo);
    }
    const baseName = new Map(asRows(bases.data).map((row) => [text(row.base_code), { name: text(row.base_name_th), yieldMl: num(row.yield_qty_ml) }]));
    const sections = asRows(confirms.data).filter((row) => text(row.branch_code) === focus).map((row) => {
      const shot = urls(row.photo_urls);
      const sectionNo = sectionNumber(text(row.stage_code) === "CLOSING" ? "CLOSING" : "OPENING", text(row.section_key));
      const caption = `${sectionNo ? `หมวด ${sectionNo}` : text(row.section_title_th)} · ${clock(text(row.confirmed_at))} น.`;
      shot.forEach((url) => pushPhoto({ url, staff: text(row.confirmed_by_name), at: text(row.confirmed_at), caption, confirmationId: text(row.id), submissionId: null }));
      return { key: text(row.section_key), title: text(row.section_title_th), staff: text(row.confirmed_by_name), at: text(row.confirmed_at), status: text(row.status_flag), photos: shot };
    });
    const focusBatches = asRows(batches.data).filter((row) => text(row.branch_code) === focus && row.is_voided_duplicate !== true);
    const wip = focusBatches.map((row) => {
      const shot = urls(row.open_photo_urls);
      const label = text(row.prep_base_code) || itemName.get(text(row.item_id)) || "รายการ";
      shot.forEach((url) => pushPhoto({ url, staff: text(row.opened_by_name), at: text(row.opened_at), caption: `${label} · ${clock(text(row.opened_at))} น.`, confirmationId: null, submissionId: null }));
      return { label, portion: formatPrepPortionPct(num(row.packs_deducted), text(row.brew_portion_mode)), staff: text(row.opened_by_name), at: text(row.opened_at), sticker: text(row.sticker_label_text), photos: shot };
    });
    const prepRows = focusBatches.filter((row) => text(row.batch_kind) === "PREP_BASE").map((row) => {
      const code = text(row.prep_base_code);
      const base = baseName.get(code);
      const packs = num(row.packs_deducted);
      const yieldMl = base && packs > 0 && packs <= 1 ? base.yieldMl * packs : base?.yieldMl || 0;
      return {
        id: text(row.id),
        label: `${code}${base?.name ? ` · ${base.name}` : ""}`,
        portion: formatPrepPortionPct(packs, text(row.brew_portion_mode)),
        yieldLabel: yieldMl > 0 ? formatFnbQty(yieldMl, "ml") : "",
        staff: text(row.opened_by_name),
        at: text(row.opened_at),
      };
    });
    const openRows = focusBatches.filter((row) => text(row.batch_kind) === "OPEN_ITEM").map((row) => {
      const note = text(row.notes);
      const expiry = text(row.expires_at);
      const sticker = text(row.sticker_label_text);
      return {
        id: text(row.id),
        label: itemName.get(text(row.item_id)) || text(row.prep_base_code) || "วัตถุดิบ",
        qtyLabel: num(row.sliced_piece_count) > 0
          ? `${num(row.sliced_piece_count)} ${text(row.pack_uom) || "ลูก"} (เนื้อ ${num(row.actual_usable_qty)} g · ${row.is_estimated_net_weight === false ? "ชั่งจริง" : "ค่าเฉลี่ย"})`
          : note.match(/(\d+)\s*ลูก/) ? `${Number(note.match(/(\d+)\s*ลูก/)?.[1] || 0)} ลูก` : formatFnbQty(num(row.packs_deducted) || 1, text(row.pack_uom) || "ชิ้น", false),
        badge: note.includes("เปิดใช้") ? "เปิดใช้อยู่" : "เบิกใหม่",
        expiryLabel: expiry ? dayLabel(expiry) : (sticker || "เคลียร์สิ้นวัน"),
        staff: text(row.opened_by_name),
        at: text(row.opened_at),
      };
    });
    for (const row of asRows(writeOffs.data).filter((item) => text(item.branch_code) === focus)) {
      urls(row.photo_urls).forEach((url) => pushPhoto({ url, staff: text(row.reported_by_name), at: text(row.created_at), caption: text(row.write_off_reason), confirmationId: null, submissionId: null }));
    }
    const focusOpening = asRows(confirms.data).filter((row) => text(row.branch_code) === focus && text(row.stage_code) === "OPENING");
    const sectionRow = (key: string) => focusOpening.find((row) => text(row.section_key) === key);
    const photoCards = (row: Record<string, unknown> | undefined, caption: string) => urls(row?.photo_urls).map((url) => ({ url, caption }));
    const band = limits.get(focus) ?? { doseMin: 19.8, doseMax: 20, timeMin: 22, timeMax: 28, yieldMin: 38, yieldMax: 40 };
    const equip = asRows(equipment.data).find((row) => text(row.branch_code) === focus);
    const sec1 = sectionRow("SEC_1_PREP");
    const sec1Payload = recordOf(sec1?.payload_json);
    const sec1Lines = (Array.isArray(sec1Payload.bases) ? sec1Payload.bases : []).flatMap((item) => {
      const rec = recordOf(item);
      const code = text(rec.code);
      if (!code) return [];
      const portion = text(rec.portion);
      const portionLabel = portion === "SKIP" || portion === "SKIP_EXISTING" ? "มีของเดิม" : formatPrepPortionPct(Number(portion), portion);
      const ml = num(rec.ml);
      return [`${code} ${portionLabel}${ml > 0 ? ` · ${formatFnbQty(ml, "ml")}` : ""}`];
    });
    if (Array.isArray(sec1Payload.produce)) {
      for (const item of sec1Payload.produce) {
        const rec = recordOf(item);
        const pieces = num(rec.pieces);
        if (pieces <= 0) continue;
        const grams = num(rec.grams);
        const label = text(rec.label) || "ลูก";
        sec1Lines.push(`${text(rec.name) || "ผลไม้สด"} ${pieces} ${label} (เนื้อ ${grams > 0 ? grams : num(rec.usable)} g · ${rec.estimated === false ? "ชั่งจริง" : "ค่าเฉลี่ย"})`);
      }
    } else if (sec1Payload.lemons != null) sec1Lines.push(`เลมอน ${num(sec1Payload.lemons)} ลูก`);
    const prepLines = sec1Lines.length > 0 ? sec1Lines : prepRows.map((row) => `${row.label}: ${row.portion}${row.yieldLabel ? ` · ${row.yieldLabel}` : ""}`);
    const metric = (value: number | null, min: number, max: number, label: string, unit: string) => {
      if (value == null) return `${label} ยังไม่กรอก`;
      return `${label} ${value} ${unit}${value < min || value > max ? " · นอกช่วง" : ""}`;
    };
    const dose = equip?.grinder_dose_g == null ? null : num(equip.grinder_dose_g);
    const seconds = equip?.espresso_time_sec == null ? null : num(equip.espresso_time_sec);
    const shot = equip?.espresso_yield_g == null ? null : num(equip.espresso_yield_g);
    const syrupTarget = equip?.syrup_random_target_g == null ? null : num(equip.syrup_random_target_g);
    const syrupActual = equip?.syrup_measured_actual_g == null ? null : num(equip.syrup_measured_actual_g);
    const sec2 = sectionRow("SEC_2_EQUIP") ?? sectionRow("SEC_2_EQUIPMENT");
    const zoneFallback = (categories: string[]) => asRows(counts.data).filter((row) => text(row.branch_code) === focus && text(row.count_stage) === "OPENING").flatMap((row) => {
      const meta = itemMeta.get(text(row.item_id));
      if (!meta || !categories.includes(meta.category)) return [];
      return [{ id: text(row.item_id), name: meta.name, qty: num(row.counted_qty), uom: meta.uom }];
    });
    const sec4 = sectionRow("SEC_4_BAKERY_ICE");
    const sec5 = sectionRow("SEC_5_MERCH");
    const sec4Summary = countSummary(openingCountRows(sec4?.payload_json, zoneFallback(["BAKERY_FROZEN", "ICE_CREAM", "CONE"])), Boolean(sec4));
    const sec5Summary = countSummary(openingCountRows(sec5?.payload_json, zoneFallback(["MERCHANDISE"])), Boolean(sec5));
    const sec6 = sectionRow("SEC_6_CASH_FLOAT");
    const weekday = bangkokWeekday(workDate);
    const openingSpots = asRows(cleaningSpots.data).filter((row) => {
      if (text(row.branch_code) !== focus || text(row.stage_code) !== "OPENING") return false;
      if (text(row.schedule_type) !== "WEEKLY") return true;
      const days = Array.isArray(row.schedule_weekdays) ? row.schedule_weekdays.map((day) => Number(day)) : [];
      return days.length === 0 || days.includes(weekday);
    });
    const openingLogs = asRows(cleaningLogs.data).filter((row) => text(row.branch_code) === focus && text(row.stage_code) === "OPENING" && text(row.photo_url).startsWith("http"));
    const sec7 = sectionRow("SEC_7_CLEANING");
    const sec7PayloadSpots = Array.isArray(recordOf(sec7?.payload_json).spots) ? recordOf(sec7?.payload_json).spots as unknown[] : [];
    const sec7Photos = new Map<string, string>();
    for (const row of openingLogs) sec7Photos.set(text(row.photo_url), text(row.spot_name_th) || "หมวด 7");
    for (const item of sec7PayloadSpots) {
      const rec = recordOf(item);
      const photo = text(rec.photoUrl || rec.photo_url);
      if (photo.startsWith("http")) sec7Photos.set(photo, text(rec.name || rec.spot_name_th) || "หมวด 7");
    }
    urls(sec7?.photo_urls).forEach((url) => { if (!sec7Photos.has(url)) sec7Photos.set(url, "หมวด 7"); });
    const sec7Total = Math.max(openingSpots.length, sec7PayloadSpots.length, sec7Photos.size);
    const openingCards: FnbInspectorOpeningCard[] = [
      { no: 1, title: "หมวดที่ 1: เบสและเลมอน", staff: text(sec1?.confirmed_by_name), at: text(sec1?.confirmed_at), lines: prepLines.length ? prepLines : ["ยังไม่บันทึก"], zeroNote: "", photos: photoCards(sec1, "หมวด 1") },
      { no: 2, title: "หมวดที่ 2: มาตรฐานอุปกรณ์", staff: text(sec2?.confirmed_by_name), at: text(sec2?.confirmed_at), lines: [metric(dose, band.doseMin, band.doseMax, "โดสกาแฟ", "g"), metric(seconds, band.timeMin, band.timeMax, "เวลาช็อต", "s"), metric(shot, band.yieldMin, band.yieldMax, "น้ำหนักช็อต", "g"), `เครื่องน้ำเชื่อมสุ่ม ${syrupTarget ?? "-"} g · ชั่งจริง ${syrupActual ?? "-"} g`], zeroNote: "", photos: [...photoCards(sec2, "หมวด 2"), ...photoCards(equip, "หมวด 2")] },
      { no: 3, title: "หมวดที่ 3: ซอสหน้าบาร์", staff: text(sectionRow("SEC_3_SAUCE")?.confirmed_by_name), at: text(sectionRow("SEC_3_SAUCE")?.confirmed_at), lines: [`เปิดใช้อยู่ ${openRows.length} ภาชนะ`], zeroNote: "", photos: photoCards(sectionRow("SEC_3_SAUCE"), "หมวด 3") },
      { no: 4, title: "หมวดที่ 4: ตู้แช่เบเกอรี่และไอศกรีม", staff: text(sec4?.confirmed_by_name), at: text(sec4?.confirmed_at), lines: sec4Summary.lines, zeroNote: sec4Summary.zeroNote, photos: photoCards(sec4, "หมวด 4") },
      { no: 5, title: "หมวดที่ 5: ชั้นโชว์ของพรีเมียม", staff: text(sec5?.confirmed_by_name), at: text(sec5?.confirmed_at), lines: sec5Summary.lines, zeroNote: sec5Summary.zeroNote, photos: photoCards(sec5, "หมวด 5") },
      { no: 6, title: "หมวดที่ 6: เงินสดในเก๊ะ", staff: text(sec6?.confirmed_by_name), at: text(sec6?.confirmed_at), lines: [sec6 ? moneyLabel(num(sec6.numeric_amount)) : "ยังไม่บันทึกเงินสด"], zeroNote: "", photos: photoCards(sec6, "หมวด 6") },
      { no: 7, title: "หมวดที่ 7: ความสะอาดเปิดร้าน", staff: text(sec7?.confirmed_by_name) || text(openingLogs[0]?.checked_by_name), at: text(sec7?.confirmed_at) || text(openingLogs[0]?.checked_at), lines: [sec7 ? `ยืนยันแล้ว ${sec7Photos.size} / ${sec7Total} จุด` : `ถ่ายแล้ว ${openingLogs.length} / ${openingSpots.length} จุด`], zeroNote: "", photos: [...sec7Photos.entries()].map(([url, caption]) => ({ url, caption })) },
    ];
    for (const card of openingCards) {
      card.photos.forEach((photo) => pushPhoto({ url: photo.url, staff: card.staff, at: card.at, caption: photo.caption, confirmationId: null, submissionId: null }));
    }
    return result({
      matrix,
      anomalies,
      detail: {
        sections,
        openingCards,
        wip,
        prepRows,
        openRows,
        replenishments: asRows(transfers.data).filter((row) => text(row.branch_code) === focus).map((row) => ({ item: itemName.get(text(row.item_id)) || "สินค้า", qty: num(row.qty_in_count_uom), at: text(row.created_at) })),
        shifts: asRows(shifts.data).filter((row) => text(row.branch_code) === focus).map((row) => ({ shift: text(row.shift_type), staff: text(row.staff_name), variance: num(row.cash_variance) })),
        photos,
      },
    });
  } catch (error) {
    return caught(empty, error, "อ่านภาพรวมสาขาไม่สำเร็จ");
  }
}

export async function voidDuplicateWipBatchAction(batchId: string): Promise<FnbActionResult<{ ok: boolean }>> {
  try {
    const ctx = await desk();
    if (!ctx.isSuperAdmin) return result({ ok: false }, "เฉพาะ Super Admin ซ่อนรายการกดซ้ำได้");
    const updated = await schemaAdmin().schema("fnb").from("bar_wip_batches").update({ is_voided_duplicate: true }).eq("id", batchId);
    if (updated.error) return fail({ ok: false }, updated.error, "ซ่อนรายการกดซ้ำไม่สำเร็จ");
    return result({ ok: true });
  } catch (error) {
    return caught({ ok: false }, error, "ซ่อนรายการกดซ้ำไม่สำเร็จ");
  }
}

export async function flagInspectionRetakeAction(confirmationId: string): Promise<FnbActionResult<{ ok: boolean }>> {
  try {
    const ctx = await desk();
    if (!ctx.isSuperAdmin) return result({ ok: false }, "เฉพาะ Super Admin สั่งถ่ายซ่อมได้");
    const updated = await schemaAdmin().schema("fnb").from("daily_stage_section_confirmations").update({ last_edit_reason: "สั่งถ่ายซ่อม" }).eq("id", confirmationId);
    if (updated.error) return fail({ ok: false }, updated.error, "สั่งถ่ายซ่อมไม่สำเร็จ");
    return result({ ok: true });
  } catch (error) {
    return caught({ ok: false }, error, "สั่งถ่ายซ่อมไม่สำเร็จ");
  }
}

function bucketOf(date: string, grain: string): string {
  if (grain === "month") return date.slice(0, 7);
  if (grain === "year") return date.slice(0, 4);
  if (grain === "week") {
    const dateValue = new Date(`${date}T12:00:00+07:00`);
    const monday = new Date(dateValue);
    monday.setDate(dateValue.getDate() - ((dateValue.getDay() + 6) % 7));
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(monday);
  }
  return date;
}

export async function getAuditSummaryAction(brand: string, startDate: string, endDate: string, grain: string): Promise<FnbActionResult<{ period: string; branchCode: string; punctualPct: number; openingPct: number; closingPct: number; posSales: number; cashDeposited: number; wasteBaht: number; wastePct: number; shrinkageCount: number; vendorClaims: number }[]>> {
  try {
    await desk();
    const scope = brandOf(brand);
    const db = schemaAdmin().schema("fnb");
    const branches = await db.from("branches").select("branch_code,branch_status").eq("brand_code", scope).neq("branch_status", "INACTIVE").limit(20);
    const codes = new Set(asRows(branches.data).map((row) => text(row.branch_code)));
    const [confirms, shifts, waste, writeOffs, counts] = await Promise.all([
      db.from("daily_stage_section_confirmations").select("branch_code,work_date,stage_code,section_key,confirmed_at").gte("work_date", startDate).lte("work_date", endDate).limit(8000),
      db.from("shift_closings").select("branch_code,work_date,net_sales_inc_vat,bank_deposit_amount,seven_eleven_deposit_amount").gte("work_date", startDate).lte("work_date", endDate).limit(4000),
      db.from("daily_waste_logs").select("branch_code,work_date,total_waste_cost_thb").gte("work_date", startDate).lte("work_date", endDate).limit(4000),
      db.from("item_write_offs").select("branch_code,work_date,total_loss_cost_thb,is_vendor_claimable").gte("work_date", startDate).lte("work_date", endDate).limit(4000),
      db.from("zone_stock_counts").select("branch_code,count_date,shrinkage_diff_qty").gte("count_date", startDate).lte("count_date", endDate).limit(8000),
    ]);
    const groups = new Map<string, { days: Set<string>; punctual: number; opening: number; closing: number; sales: number; deposited: number; waste: number; shrink: number; claims: number }>();
    const ensure = (period: string, code: string) => {
      const key = `${period}|${code}`;
      const found = groups.get(key) ?? { days: new Set<string>(), punctual: 0, opening: 0, closing: 0, sales: 0, deposited: 0, waste: 0, shrink: 0, claims: 0 };
      groups.set(key, found);
      return found;
    };
    const openingDays = new Map<string, { done: Set<number>; at: string }>();
    const closingDays = new Set<string>();
    for (const row of asRows(confirms.data).filter((item) => codes.has(text(item.branch_code)))) {
      const code = text(row.branch_code);
      const date = text(row.work_date);
      const stage = text(row.stage_code) === "CLOSING" ? "CLOSING" : "OPENING";
      const number = sectionNumber(stage, text(row.section_key));
      if (stage === "CLOSING" && number) closingDays.add(`${code}|${date}`);
      if (stage !== "OPENING" || !number) continue;
      const slot = openingDays.get(`${code}|${date}`) ?? { done: new Set<number>(), at: "" };
      slot.done.add(number);
      const at = text(row.confirmed_at);
      if (at > slot.at) slot.at = at;
      openingDays.set(`${code}|${date}`, slot);
    }
    for (const [key, slot] of openingDays) {
      const [code, date] = key.split("|");
      const bucket = ensure(bucketOf(date, grain), code);
      bucket.days.add(date);
      if (slot.done.size >= 7) {
        bucket.opening += 1;
        if (clock(slot.at) <= "09:30") bucket.punctual += 1;
      }
    }
    for (const key of closingDays) {
      const [code, date] = key.split("|");
      ensure(bucketOf(date, grain), code).closing += 1;
      ensure(bucketOf(date, grain), code).days.add(date);
    }
    for (const row of asRows(shifts.data).filter((item) => codes.has(text(item.branch_code)))) {
      const bucket = ensure(bucketOf(text(row.work_date), grain), text(row.branch_code));
      bucket.sales += num(row.net_sales_inc_vat);
      bucket.deposited += num(row.bank_deposit_amount) + num(row.seven_eleven_deposit_amount);
      bucket.days.add(text(row.work_date));
    }
    for (const row of asRows(waste.data).filter((item) => codes.has(text(item.branch_code)))) ensure(bucketOf(text(row.work_date), grain), text(row.branch_code)).waste += num(row.total_waste_cost_thb);
    for (const row of asRows(writeOffs.data).filter((item) => codes.has(text(item.branch_code)))) {
      const bucket = ensure(bucketOf(text(row.work_date), grain), text(row.branch_code));
      bucket.waste += num(row.total_loss_cost_thb);
      if (row.is_vendor_claimable === true) bucket.claims += 1;
    }
    for (const row of asRows(counts.data).filter((item) => codes.has(text(item.branch_code)) && num(item.shrinkage_diff_qty) > 0)) {
      ensure(bucketOf(text(row.count_date), grain), text(row.branch_code)).shrink += 1;
    }
    return result([...groups.entries()].map(([key, row]) => {
      const [period, branchCode] = key.split("|");
      const days = Math.max(row.days.size, 1);
      return {
        period,
        branchCode,
        punctualPct: (row.punctual / days) * 100,
        openingPct: (row.opening / days) * 100,
        closingPct: (row.closing / days) * 100,
        posSales: row.sales,
        cashDeposited: row.deposited,
        wasteBaht: row.waste,
        wastePct: row.sales > 0 ? (row.waste / row.sales) * 100 : 0,
        shrinkageCount: row.shrink,
        vendorClaims: row.claims,
      };
    }));
  } catch (error) {
    return caught([], error, "สรุปงวดตรวจไม่สำเร็จ");
  }
}

export async function getForensicDossierAction(input: { brand: string; branchCode: string; workDate: string; fromTime?: string; toTime?: string; query?: string }): Promise<FnbActionResult<{ staff: string[]; confirms: { title: string; staff: string; at: string }[]; brews: { label: string; portion: string; staff: string; at: string; photos: string[] }[]; containers: { label: string; openedAt: string; expiresAt: string; grNo: string; vendor: string; lotExpiry: string }[]; displayLots: { item: string; qty: number; expiry: string }[]; photos: FnbAuditPhoto[] }>> {
  const empty = { staff: [] as string[], confirms: [], brews: [], containers: [], displayLots: [], photos: [] as FnbAuditPhoto[] };
  try {
    await desk();
    const db = schemaAdmin().schema("fnb");
    const branch = await db.from("branches").select("brand_code").eq("branch_code", input.branchCode).limit(1);
    if (text(asRows(branch.data)[0]?.brand_code) !== brandOf(input.brand)) return result(empty, "สาขานี้ไม่อยู่ในแบรนด์ที่เปิดอยู่");
    const [confirms, batches, items, lots, receipts, display] = await Promise.all([
      db.from("daily_stage_section_confirmations").select("section_title_th,confirmed_by_name,confirmed_at,photo_urls").eq("branch_code", input.branchCode).eq("work_date", input.workDate).limit(400),
      db.from("bar_wip_batches").select("batch_kind,prep_base_code,item_id,brew_portion_mode,opened_at,opened_by_name,expires_at,sticker_label_text,open_photo_urls,batch_status,closed_at").eq("branch_code", input.branchCode).limit(800),
      db.from("items").select("id,short_code,name_th").eq("brand_scope", brandOf(input.brand)).limit(2000),
      db.from("item_expiry_lots").select("item_id,expiry_date,gr_id,remaining_pack_qty").eq("branch_code", input.branchCode).limit(800),
      db.from("goods_receipts").select("id,gr_no,vendor_name,receiving_branch_code").eq("receiving_branch_code", input.branchCode).limit(400),
      db.from("display_chiller_lots").select("item_id,remaining_qty,display_expiry_date,effective_day_1,placed_at").eq("branch_code", input.branchCode).limit(400),
    ]);
    const names = new Map(asRows(items.data).map((row) => [text(row.id), `${text(row.short_code)} ${text(row.name_th)}`]));
    const receiptById = new Map(asRows(receipts.data).map((row) => [text(row.id), row]));
    const needle = text(input.query).toLowerCase();
    const inTime = (iso: string) => {
      const hm = clock(iso);
      if (!hm) return true;
      if (input.fromTime && hm < input.fromTime) return false;
      if (input.toTime && hm > input.toTime) return false;
      return true;
    };
    const confirmsRows = asRows(confirms.data).filter((row) => inTime(text(row.confirmed_at))).map((row) => ({ title: text(row.section_title_th), staff: text(row.confirmed_by_name), at: text(row.confirmed_at) }));
    const photos: FnbAuditPhoto[] = [];
    asRows(confirms.data).forEach((row) => urls(row.photo_urls).forEach((url) => photos.push({ url, staff: text(row.confirmed_by_name), at: text(row.confirmed_at), caption: text(row.section_title_th), confirmationId: null, submissionId: null })));
    const end = `${input.workDate}T23:59:59+07:00`;
    const brews = asRows(batches.data).filter((row) => text(row.batch_kind) === "PREP_BASE" && text(row.opened_at).slice(0, 10) === input.workDate && inTime(text(row.opened_at))).map((row) => {
      const shot = urls(row.open_photo_urls);
      shot.forEach((url) => photos.push({ url, staff: text(row.opened_by_name), at: text(row.opened_at), caption: text(row.prep_base_code), confirmationId: null, submissionId: null }));
      return { label: text(row.prep_base_code), portion: text(row.brew_portion_mode), staff: text(row.opened_by_name), at: text(row.opened_at), photos: shot };
    });
    const containers = asRows(batches.data).filter((row) => text(row.batch_kind) === "OPEN_ITEM" && text(row.opened_at) <= end && (!text(row.closed_at) || text(row.closed_at) >= `${input.workDate}T00:00:00+07:00`)).map((row) => {
      const label = names.get(text(row.item_id)) || text(row.sticker_label_text);
      const lot = asRows(lots.data).filter((item) => text(item.item_id) === text(row.item_id)).sort((left, right) => text(left.expiry_date).localeCompare(text(right.expiry_date)))[0];
      const receipt = lot ? receiptById.get(text(lot.gr_id)) : null;
      return { label, openedAt: text(row.opened_at), expiresAt: text(row.expires_at), grNo: text(receipt?.gr_no), vendor: text(receipt?.vendor_name), lotExpiry: text(lot?.expiry_date) };
    }).filter((row) => !needle || `${row.label} ${row.vendor}`.toLowerCase().includes(needle));
    const displayLots = asRows(display.data).filter((row) => text(row.effective_day_1) <= input.workDate && text(row.display_expiry_date) >= input.workDate).map((row) => ({ item: names.get(text(row.item_id)) || "เบเกอรี่", qty: num(row.remaining_qty), expiry: text(row.display_expiry_date) }));
    return result({
      staff: [...new Set(confirmsRows.map((row) => row.staff).filter(Boolean))],
      confirms: confirmsRows,
      brews,
      containers,
      displayLots,
      photos,
    });
  } catch (error) {
    return caught(empty, error, "เปิดแฟ้มเหตุการณ์ไม่สำเร็จ");
  }
}

function sectionsFrom(value: unknown): Record<string, boolean> {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const sections: Record<string, boolean> = {};
  for (const row of FNB_QA_SECTIONS) sections[row.key] = source[row.key] === true || (source[row.key] == null && row.defaultOn);
  return sections;
}

export async function getAuditProfileAction(brand: string): Promise<FnbActionResult<FnbAuditProfile>> {
  const empty: FnbAuditProfile = { profileCode: "QA_STANDARD", profileName: "", sections: sectionsFrom(null), spotIds: [], extraTopics: [], headerTitle: "", signoffTitles: [], spots: [] };
  try {
    await desk();
    const scope = brandOf(brand);
    const db = schemaAdmin().schema("fnb");
    const [profile, spots, branches] = await Promise.all([
      db.from("audit_export_profiles").select("profile_code,profile_name_th,included_sections,selected_cleaning_spot_ids,custom_extra_topics,report_header_title,signoff_titles").eq("brand_code", scope).eq("profile_code", "QA_STANDARD").limit(1),
      db.from("branch_cleaning_spots").select("id,branch_code,spot_name_th,is_active").eq("is_active", true).limit(200),
      db.from("branches").select("branch_code,brand_code,branch_status").eq("brand_code", scope).neq("branch_status", "INACTIVE").limit(20),
    ]);
    const codes = new Set(asRows(branches.data).map((row) => text(row.branch_code)));
    const row = asRows(profile.data)[0] ?? {};
    const extras = Array.isArray(row.custom_extra_topics) ? row.custom_extra_topics.map((item) => typeof item === "string" ? item : text((item as { title?: string }).title)).filter(Boolean) : [];
    return result({
      profileCode: "QA_STANDARD",
      profileName: text(row.profile_name_th),
      sections: sectionsFrom(row.included_sections),
      spotIds: Array.isArray(row.selected_cleaning_spot_ids) ? row.selected_cleaning_spot_ids.map((item) => text(item)) : [],
      extraTopics: extras,
      headerTitle: text(row.report_header_title),
      signoffTitles: Array.isArray(row.signoff_titles) ? row.signoff_titles.map((item) => text(item)) : [],
      spots: asRows(spots.data).filter((item) => codes.has(text(item.branch_code))).map((item) => ({ id: text(item.id), branchCode: text(item.branch_code), name: text(item.spot_name_th) })),
    });
  } catch (error) {
    return caught(empty, error, "อ่านแม่แบบรายงานไม่สำเร็จ");
  }
}

export async function saveAuditProfileAction(input: { brand: string; sections: Record<string, boolean>; spotIds: string[]; extraTopics: string[]; headerTitle: string; signoffTitles: string[] }): Promise<FnbActionResult<{ ok: boolean }>> {
  try {
    const ctx = await desk();
    const scope = brandOf(input.brand);
    const sections: Record<string, boolean> = {};
    for (const key of QA_KEYS) sections[key] = input.sections[key] === true;
    const payload = {
      brand_code: scope,
      profile_code: "QA_STANDARD",
      profile_name_th: scope === "CHATORN" ? "ชุดมาตรฐานตรวจคุณภาพสาขา ชาทรตะโหมด" : "ชุดมาตรฐานส่งตรวจแฟรนไชส์ Lucky Cup (QA Pack)",
      included_sections: sections,
      selected_cleaning_spot_ids: input.spotIds,
      custom_extra_topics: input.extraTopics.map((title) => ({ title })),
      report_header_title: input.headerTitle,
      signoff_titles: input.signoffTitles,
      is_default: true,
      updated_by: ctx.userId,
      updated_at: new Date().toISOString(),
    };
    const db = schemaAdmin().schema("fnb");
    const existing = await db.from("audit_export_profiles").select("id").eq("brand_code", scope).eq("profile_code", "QA_STANDARD").limit(1);
    const id = text(asRows(existing.data)[0]?.id);
    const saved = id ? await db.from("audit_export_profiles").update(payload).eq("id", id) : await db.from("audit_export_profiles").insert(payload);
    if (saved.error) return fail({ ok: false }, saved.error, "บันทึกแม่แบบไม่สำเร็จ");
    return result({ ok: true });
  } catch (error) {
    return caught({ ok: false }, error, "บันทึกแม่แบบไม่สำเร็จ");
  }
}

export async function getFranchiseQaPackAction(input: { brand: string; branchCode: string; startDate: string; endDate: string; sections: Record<string, boolean>; spotIds: string[] }): Promise<FnbActionResult<FnbQaPack>> {
  const empty: FnbQaPack = { headerTitle: "", signoffTitles: [], extraTopics: [], equipment: [], sauces: [], lots: [], cleaning: [], wip: [], displayLots: [], destructions: [] };
  try {
    await desk();
    const scope = brandOf(input.brand);
    const db = schemaAdmin().schema("fnb");
    const branch = await db.from("branches").select("brand_code").eq("branch_code", input.branchCode).limit(1);
    if (text(asRows(branch.data)[0]?.brand_code) !== scope) return result(empty, "สาขานี้ไม่อยู่ในแบรนด์ที่เปิดอยู่");
    const profile = await getAuditProfileAction(scope);
    const on = (key: FnbQaSectionKey) => input.sections[key] === true && QA_KEYS.has(key);
    const spots = new Set(input.spotIds);
    const [equipment, batches, items, lots, confirms, display, writeOffs] = await Promise.all([
      db.from("daily_equipment_calibrations").select("branch_code,work_date,grinder_dose_g,espresso_time_sec,espresso_yield_g,syrup_random_target_g,syrup_measured_actual_g").eq("branch_code", input.branchCode).gte("work_date", input.startDate).lte("work_date", input.endDate).limit(400),
      db.from("bar_wip_batches").select("branch_code,batch_kind,prep_base_code,item_id,brew_portion_mode,opened_at,opened_by_name,expires_at,sticker_label_text,open_photo_urls").eq("branch_code", input.branchCode).gte("work_date", input.startDate).lte("work_date", input.endDate).limit(800),
      db.from("items").select("id,short_code,name_th").eq("brand_scope", scope).limit(2000),
      db.from("item_expiry_lots").select("branch_code,item_id,remaining_pack_qty,pack_uom,expiry_date,lot_status").eq("branch_code", input.branchCode).eq("lot_status", "ACTIVE").limit(800),
      db.from("daily_stage_section_confirmations").select("branch_code,section_key,section_title_th,confirmed_by_name,confirmed_at,status_flag,photo_urls").eq("branch_code", input.branchCode).gte("work_date", input.startDate).lte("work_date", input.endDate).limit(2000),
      db.from("display_chiller_lots").select("item_id,remaining_qty,display_expiry_date").eq("branch_code", input.branchCode).limit(400),
      db.from("item_write_offs").select("item_id,write_off_reason,qty_in_count_uom,is_destroyed_verified,photo_urls").eq("branch_code", input.branchCode).gte("work_date", input.startDate).lte("work_date", input.endDate).limit(400),
    ]);
    const names = new Map(asRows(items.data).map((row) => [text(row.id), `${text(row.short_code)} ${text(row.name_th)}`]));
    const pack: FnbQaPack = {
      headerTitle: profile.data.headerTitle,
      signoffTitles: profile.data.signoffTitles,
      extraTopics: profile.data.extraTopics,
      equipment: on("grinder_and_syrup_calibration") || on("espresso_shot_calibration") ? asRows(equipment.data).map((row) => ({
        branchCode: text(row.branch_code),
        workDate: text(row.work_date),
        doseG: on("espresso_shot_calibration") && row.grinder_dose_g != null ? num(row.grinder_dose_g) : null,
        shotSec: on("espresso_shot_calibration") && row.espresso_time_sec != null ? num(row.espresso_time_sec) : null,
        shotG: on("espresso_shot_calibration") && row.espresso_yield_g != null ? num(row.espresso_yield_g) : null,
        syrupTargetG: on("grinder_and_syrup_calibration") && row.syrup_random_target_g != null ? num(row.syrup_random_target_g) : null,
        syrupActualG: on("grinder_and_syrup_calibration") && row.syrup_measured_actual_g != null ? num(row.syrup_measured_actual_g) : null,
      })) : [],
      sauces: on("open_sauce_bar_expiry") ? asRows(batches.data).filter((row) => text(row.batch_kind) === "OPEN_ITEM").map((row) => ({ branchCode: text(row.branch_code), label: names.get(text(row.item_id)) || text(row.sticker_label_text), openedAt: text(row.opened_at), expiresAt: text(row.expires_at), sticker: text(row.sticker_label_text) })) : [],
      lots: on("backroom_fefo_expiry_lots") ? asRows(lots.data).map((row) => ({ branchCode: text(row.branch_code), item: names.get(text(row.item_id)) || "วัตถุดิบ", qty: num(row.remaining_pack_qty), uom: text(row.pack_uom), expiry: text(row.expiry_date) })) : [],
      cleaning: on("cleaning_spot_photos") ? asRows(confirms.data).filter((row) => text(row.section_key).includes("SPOT") && (spots.size === 0 || [...spots].some((id) => text(row.section_key).includes(id)))).map((row) => ({ branchCode: text(row.branch_code), spot: text(row.section_title_th), staff: text(row.confirmed_by_name), at: text(row.confirmed_at), status: text(row.status_flag), photos: urls(row.photo_urls) })) : [],
      wip: on("prep_base_wip_logs") ? asRows(batches.data).filter((row) => text(row.batch_kind) === "PREP_BASE").map((row) => ({ branchCode: text(row.branch_code), label: text(row.prep_base_code), portion: text(row.brew_portion_mode), staff: text(row.opened_by_name), at: text(row.opened_at), photos: urls(row.open_photo_urls) })) : [],
      displayLots: on("bakery_display_waves") ? asRows(display.data).map((row) => ({ branchCode: input.branchCode, item: names.get(text(row.item_id)) || "เบเกอรี่", qty: num(row.remaining_qty), expiry: text(row.display_expiry_date) })) : [],
      destructions: on("expired_destruction_photos") ? asRows(writeOffs.data).map((row) => ({ branchCode: input.branchCode, item: names.get(text(row.item_id)) || "รายการ", reason: text(row.write_off_reason), qty: num(row.qty_in_count_uom), destroyed: row.is_destroyed_verified === true, photos: urls(row.photo_urls) })) : [],
    };
    return result(pack);
  } catch (error) {
    return caught(empty, error, "ประกอบรายงานแฟรนไชส์ไม่สำเร็จ");
  }
}

export async function listAuditPeriodsAction(brand: string, year: number): Promise<FnbActionResult<FnbAuditPeriodRow[]>> {
  try {
    await desk();
    const listed = await schemaAdmin().schema("fnb").from("accounting_audit_periods").select("period_year,period_month,is_locked,locked_by_name,locked_at,last_backup_exported_at").eq("brand_code", brandOf(brand)).eq("period_year", year).limit(12);
    const byMonth = new Map(asRows(listed.data).map((row) => [num(row.period_month), row]));
    return result(Array.from({ length: 12 }, (_, index) => {
      const month = index + 1;
      const row = byMonth.get(month);
      return { year, month, isLocked: row?.is_locked === true, lockedByName: text(row?.locked_by_name), lockedAt: text(row?.locked_at) || null, lastBackupAt: text(row?.last_backup_exported_at) || null };
    }));
  } catch (error) {
    return caught([], error, "อ่านงวดเดือนไม่สำเร็จ");
  }
}

export async function setAuditPeriodLockAction(input: { brand: string; year: number; month: number; lock: boolean; reason: string }): Promise<FnbActionResult<{ ok: boolean }>> {
  try {
    const ctx = await desk();
    if (!ctx.isSuperAdmin) return result({ ok: false }, "เฉพาะ Super Admin ล็อกหรือปลดล็อกงวดได้");
    const saved = await callFnbRpc("set_fnb_monthly_period_lock", {
      p_actor_user_id: ctx.userId,
      p_brand_code: brandOf(input.brand),
      p_period_year: input.year,
      p_period_month: input.month,
      p_lock: input.lock,
      p_reason_or_note: input.reason,
      p_summary_snapshot: {},
    });
    if (saved.error) return fail({ ok: false }, saved.error, "บันทึกงวดไม่สำเร็จ");
    const body = saved.data && typeof saved.data === "object" ? saved.data as Record<string, unknown> : {};
    if (body.ok === false) return result({ ok: false }, text(body.error) || "บันทึกงวดไม่สำเร็จ");
    return result({ ok: true });
  } catch (error) {
    return caught({ ok: false }, error, "บันทึกงวดไม่สำเร็จ");
  }
}

export async function listMonthBackupAction(brand: string, year: number, month: number): Promise<FnbActionResult<{ sheets: Record<string, Record<string, string | number>[]>; photos: { name: string; url: string }[] }>> {
  const empty = { sheets: {}, photos: [] as { name: string; url: string }[] };
  try {
    const ctx = await desk();
    const scope = brandOf(brand);
    const start = `${year}-${String(month).padStart(2, "0")}-01`;
    const end = new Date(year, month, 0);
    const endDate = `${year}-${String(month).padStart(2, "0")}-${String(end.getDate()).padStart(2, "0")}`;
    const db = schemaAdmin().schema("fnb");
    const branches = await db.from("branches").select("branch_code,branch_status").eq("brand_code", scope).neq("branch_status", "INACTIVE").limit(20);
    const codes = new Set(asRows(branches.data).map((row) => text(row.branch_code)));
    const [confirms, equipment, shifts] = await Promise.all([
      db.from("daily_stage_section_confirmations").select("branch_code,work_date,stage_code,section_title_th,status_flag,confirmed_by_name,confirmed_at,photo_urls").gte("work_date", start).lte("work_date", endDate).limit(5000),
      db.from("daily_equipment_calibrations").select("branch_code,work_date,grinder_dose_g,espresso_time_sec,espresso_yield_g").gte("work_date", start).lte("work_date", endDate).limit(500),
      db.from("shift_closings").select("branch_code,work_date,shift_type,staff_name,net_sales_inc_vat,cash_variance,bank_deposit_amount").gte("work_date", start).lte("work_date", endDate).limit(1000),
    ]);
    const own = (row: Record<string, unknown>) => codes.has(text(row.branch_code));
    const photos: { name: string; url: string }[] = [];
    for (const row of asRows(confirms.data).filter(own)) {
      urls(row.photo_urls).forEach((url, index) => photos.push({ name: `${text(row.branch_code)}-${text(row.work_date)}-${text(row.section_title_th)}-${index + 1}.jpg`.replace(/[^\w.\-ก-๙]+/g, "_"), url }));
    }
    void ctx;
    return result({
      sheets: {
        confirmations: asRows(confirms.data).filter(own).map((row) => ({ branch: text(row.branch_code), date: text(row.work_date), stage: text(row.stage_code), section: text(row.section_title_th), status: text(row.status_flag), staff: text(row.confirmed_by_name), at: text(row.confirmed_at) })),
        equipment: asRows(equipment.data).filter(own).map((row) => ({ branch: text(row.branch_code), date: text(row.work_date), dose_g: num(row.grinder_dose_g), shot_sec: num(row.espresso_time_sec), shot_g: num(row.espresso_yield_g) })),
        shifts: asRows(shifts.data).filter(own).map((row) => ({ branch: text(row.branch_code), date: text(row.work_date), shift: text(row.shift_type), staff: text(row.staff_name), pos_sales: num(row.net_sales_inc_vat), cash_variance: num(row.cash_variance), deposited: num(row.bank_deposit_amount) })),
      },
      photos: photos.slice(0, 400),
    });
  } catch (error) {
    return caught(empty, error, "เตรียมชุดสำรองเดือนไม่สำเร็จ");
  }
}

export async function markMonthBackupAction(input: { brand: string; year: number; month: number; fileName: string; photoCount: number }): Promise<FnbActionResult<{ ok: boolean }>> {
  try {
    const ctx = await desk();
    const scope = brandOf(input.brand);
    const db = schemaAdmin().schema("fnb");
    const now = new Date().toISOString();
    const existing = await db.from("accounting_audit_periods").select("id").eq("brand_code", scope).eq("period_year", input.year).eq("period_month", input.month).limit(1);
    const id = text(asRows(existing.data)[0]?.id);
    const stamp = id
      ? await db.from("accounting_audit_periods").update({ last_backup_exported_at: now, updated_at: now }).eq("id", id)
      : await db.from("accounting_audit_periods").insert({ brand_code: scope, period_year: input.year, period_month: input.month, is_locked: false, last_backup_exported_at: now });
    if (stamp.error) return fail({ ok: false }, stamp.error, "บันทึกเวลาสำรองไม่สำเร็จ");
    const logged = await schemaAdmin().schema("holding").from("backup_logs").insert({
      backup_scope: "FNB_MONTHLY_PACK",
      brand_code: scope,
      period_year: input.year,
      period_month: input.month,
      file_name: input.fileName,
      included_photos: input.photoCount > 0,
      row_counts_json: { photos: input.photoCount },
      triggered_by_user_id: ctx.userId,
      triggered_by_name: ctx.displayActorName,
      notes: "ชุดสำรองรายเดือนหน้าร้าน",
    });
    if (logged.error) return fail({ ok: false }, logged.error, "บันทึกประวัติสำรองไม่สำเร็จ");
    return result({ ok: true });
  } catch (error) {
    return caught({ ok: false }, error, "บันทึกประวัติสำรองไม่สำเร็จ");
  }
}
