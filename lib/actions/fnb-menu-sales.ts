"use server";

import { resolveFnbActor } from "@/lib/fnb/actor";
import { asRows, caught, fail, num, result, text, todayBangkok } from "@/lib/fnb/rows";
import { generateWithGeminiFallback, resolveGeminiApiKey } from "@/lib/ai/gemini-client";
import { getUserAccessContext, requireFnbModuleAccess } from "@/lib/holding/workspace-access";
import { requireSessionUserId } from "@/lib/auth/current-user";
import { schemaAdmin } from "@/lib/holding/schema-db";
import type { FnbActionResult, FnbBrandCode, FnbMenuRank, FnbMenuSalesDraft, FnbMenuSalesLine, FnbPromoHint, FnbScopedMenuSales } from "@/types/fnb";

const PROMPT = `อ่านสลิป POS ภาษาไทย "รายงานยอดขายสินค้า" คืน JSON เท่านั้น
fields: summary_only (true เมื่อหัวสลิปเป็น จัดกลุ่มตาม: สินค้า และไม่มีรายการเมนูย่อย), slip_printed_at (ISO หรือ null), reported_total_qty, reported_total_amount, lines[{line_seq, menu_name_th, category_name, cup_size (R หรือ L หรือ null), qty_sold, gross_amount}]
กฎ: ห้ามใส่บรรทัดยอดรวม(...) ของหมวด เพราะจะนับซ้ำ. เก็บเฉพาะรายการมีเลขลำดับ. ถ้ามีหลายรูป ให้รวมบรรทัดที่เลขและชื่อซ้ำเป็นแถวเดียว.`;

function brandOf(value: unknown): FnbBrandCode | null {
  const brand = text(value);
  return brand === "LUCKY_CUP" || brand === "CHATORN" ? brand : null;
}

function cleanLines(lines: FnbMenuSalesLine[]): FnbMenuSalesLine[] {
  const seen = new Set<string>();
  return lines.filter((line) => {
    if (/^ยอดรวม/i.test(line.menu_name_th)) return false;
    const key = `${line.line_seq}|${line.menu_name_th}|${line.cup_size ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function parseMenuSlipAction(formData: FormData): Promise<FnbActionResult<FnbMenuSalesDraft>> {
  const empty: FnbMenuSalesDraft = { summary_only: false, slip_printed_at: null, reported_total_qty: 0, reported_total_amount: 0, early_print_note: null, lines: [] };
  try {
    const actor = await resolveFnbActor({
      actorSource: text(formData.get("actor_source")),
      brandLock: text(formData.get("brand_lock")),
      branchCode: text(formData.get("branch_code")),
    });
    if (!actor.ok) return result(empty, actor.error);
    const files = formData.getAll("slips").filter((entry): entry is File => entry instanceof File && entry.size > 0).slice(0, 3);
    if (files.length === 0) return result(empty, "ไม่พบรูปสลิป");
    const apiKey = resolveGeminiApiKey();
    if (!apiKey) return result(empty, "ยังไม่ได้ตั้งค่า Gemini");
    const parts: ({ text: string } | { inlineData: { mimeType: string; data: string } })[] = [{ text: PROMPT }];
    for (const file of files) {
      parts.push({ inlineData: { mimeType: file.type || "image/jpeg", data: Buffer.from(await file.arrayBuffer()).toString("base64") } });
    }
    const generated = await generateWithGeminiFallback({ apiKey, parts });
    const match = generated.text.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(match?.[0] ?? "{}") as Record<string, unknown>;
    const lines = cleanLines((Array.isArray(parsed.lines) ? parsed.lines : []).map((row, index) => {
      const line = row && typeof row === "object" ? row as Record<string, unknown> : {};
      const size = text(line.cup_size).toUpperCase();
      return {
        line_seq: Number(line.line_seq) || index + 1,
        menu_id: null,
        menu_name_th: text(line.menu_name_th),
        category_name: text(line.category_name) || null,
        cup_size: size === "R" || size === "L" ? size : null,
        qty_sold: num(line.qty_sold),
        gross_amount: num(line.gross_amount),
      };
    }).filter((line) => line.menu_name_th));
    const draft: FnbMenuSalesDraft = {
      summary_only: parsed.summary_only === true || (lines.length > 0 && lines.length <= 12 && lines.every((line) => /ยอดรวม|หมวด|สินค้า$/.test(line.menu_name_th))),
      slip_printed_at: text(parsed.slip_printed_at) || null,
      reported_total_qty: num(parsed.reported_total_qty),
      reported_total_amount: num(parsed.reported_total_amount),
      early_print_note: null,
      lines,
    };
    draft.early_print_note = await earlyNote(text(formData.get("branch_code")), text(formData.get("work_date")) || todayBangkok(), draft);
    return result(draft);
  } catch (error) {
    return caught(empty, error, "อ่านสลิปเมนูไม่สำเร็จ");
  }
}

export async function saveMenuSalesAction(input: {
  branch_code: string;
  work_date: string;
  brand_lock: FnbBrandCode | null;
  actor_source: string;
  entry_source: "OCR_SLIP" | "MANUAL_GRID";
  draft: FnbMenuSalesDraft;
  edit_reason?: string;
}): Promise<FnbActionResult<{ ok: boolean }>> {
  try {
    const actor = await resolveFnbActor({ actorSource: input.actor_source, brandLock: input.brand_lock, branchCode: input.branch_code });
    if (!actor.ok) return result({ ok: false }, actor.error);
    const brand = input.brand_lock ?? actor.actor.brandCode;
    if (!brand) return result({ ok: false }, "ไม่พบแบรนด์ของสาขา");
    const db = schemaAdmin().schema("fnb");
    const existing = await db.from("daily_menu_sales_headers").select("id, revision_count").eq("branch_code", input.branch_code).eq("work_date", input.work_date).maybeSingle();
    if (existing.error) return fail({ ok: false }, existing.error, "บันทึกยอดขายเมนูไม่สำเร็จ");
    const current = existing.data && typeof existing.data === "object" ? existing.data as Record<string, unknown> : null;
    if (current?.id && text(input.edit_reason).length < 3) return result({ ok: false }, "ยอดขายรายเมนูวันนี้ถูกล็อกแล้ว กรุณาระบุสาเหตุการแก้ไข");
    const lines = cleanLines(input.draft.lines);
    const qty = lines.reduce((sum, line) => sum + line.qty_sold, 0);
    const amount = lines.reduce((sum, line) => sum + line.gross_amount, 0);
    const payload = {
      branch_code: input.branch_code,
      work_date: input.work_date,
      brand_code: brand,
      entry_source: input.entry_source,
      slip_printed_at: input.draft.slip_printed_at,
      is_early_print_warning: Boolean(input.draft.early_print_note),
      early_print_note: input.draft.early_print_note,
      reported_total_qty: input.draft.reported_total_qty,
      reported_total_amount: input.draft.reported_total_amount,
      calculated_total_qty: qty,
      calculated_total_amount: amount,
      submitted_by_name: actor.actor.name,
      submitted_by_line_user_id: actor.actor.lineUserId,
      revision_count: current?.id ? num(current.revision_count) + 1 : 0,
      last_edit_reason: text(input.edit_reason) || null,
      updated_at: new Date().toISOString(),
    };
    const header = current?.id
      ? await db.from("daily_menu_sales_headers").update(payload).eq("id", text(current.id))
      : await db.from("daily_menu_sales_headers").insert(payload);
    if (header.error) return fail({ ok: false }, header.error, "บันทึกยอดขายเมนูไม่สำเร็จ");
    const created = current?.id
      ? { data: { id: text(current.id) } }
      : await db.from("daily_menu_sales_headers").select("id").eq("branch_code", input.branch_code).eq("work_date", input.work_date).maybeSingle();
    const headerId = text((created.data as Record<string, unknown> | null)?.id);
    if (current?.id) await db.from("daily_menu_sales_lines").delete().eq("header_id", headerId);
    if (lines.length > 0) {
      const inserted = await db.from("daily_menu_sales_lines").insert(lines.map((line, index) => ({
        header_id: headerId,
        branch_code: input.branch_code,
        work_date: input.work_date,
        line_seq: line.line_seq || index + 1,
        menu_id: line.menu_id,
        menu_name_th: line.menu_name_th,
        category_name: line.category_name,
        cup_size: line.cup_size,
        qty_sold: line.qty_sold,
        gross_amount: line.gross_amount,
      })));
      if (inserted.error) return fail({ ok: false }, inserted.error, "บันทึกรายการเมนูไม่สำเร็จ");
    }
    return result({ ok: true });
  } catch (error) {
    return caught({ ok: false }, error, "บันทึกยอดขายเมนูไม่สำเร็จ");
  }
}

export async function listBrandMenusAction(brand: FnbBrandCode): Promise<FnbActionResult<{ id: string; menu_name_th: string; cup_size: string }[]>> {
  try {
    const listed = await schemaAdmin().schema("fnb").from("menus").select("id, menu_name_th, cup_size, brand_code, is_active").eq("brand_code", brand).eq("is_active", true).order("menu_name_th", { ascending: true }).limit(500);
    if (listed.error) return fail([], listed.error, "อ่านเมนูไม่สำเร็จ");
    return result(asRows(listed.data).map((row) => ({ id: text(row.id), menu_name_th: text(row.menu_name_th), cup_size: text(row.cup_size) })));
  } catch (error) {
    return caught([], error, "อ่านเมนูไม่สำเร็จ");
  }
}

export async function getMenuAnalyticsAction(startDate: string, endDate: string): Promise<FnbActionResult<{ ranks: FnbMenuRank[]; promos: FnbPromoHint[] }>> {
  const empty = { ranks: [] as FnbMenuRank[], promos: [] as FnbPromoHint[] };
  try {
    await requireFnbModuleAccess("all_branch_analytics");
    const db = schemaAdmin().schema("fnb");
    const [lines, lots, items, bom, menus] = await Promise.all([
      db.from("daily_menu_sales_lines").select("branch_code, work_date, menu_name_th, category_name, cup_size, qty_sold, gross_amount").gte("work_date", startDate).lte("work_date", endDate).limit(5000),
      db.from("item_expiry_lots").select("branch_code, item_id, expiry_date, remaining_pack_qty, lot_status").eq("lot_status", "ACTIVE").limit(500),
      db.from("items").select("id, name_th").limit(2000),
      db.from("menu_bom_lines").select("menu_id, item_id").limit(5000),
      db.from("menus").select("id, menu_name_th").limit(1000),
    ]);
    if (lines.error) return fail(empty, lines.error, "อ่านยอดขายเมนูไม่สำเร็จ");
    const grouped = new Map<string, FnbMenuRank>();
    for (const row of asRows(lines.data)) {
      const rank: FnbMenuRank = {
        branch_code: text(row.branch_code),
        menu_name_th: text(row.menu_name_th),
        cup_size: row.cup_size == null ? null : text(row.cup_size),
        category_name: row.category_name == null ? null : text(row.category_name),
        qty_sold: num(row.qty_sold),
        gross_amount: num(row.gross_amount),
      };
      const key = `${rank.branch_code}|${rank.menu_name_th}|${rank.cup_size ?? ""}`;
      const found = grouped.get(key);
      if (found) {
        found.qty_sold += rank.qty_sold;
        found.gross_amount += rank.gross_amount;
      } else grouped.set(key, rank);
    }
    const names = new Map(asRows(items.data).map((row) => [text(row.id), text(row.name_th)]));
    const menuNames = new Map(asRows(menus.data).map((row) => [text(row.id), text(row.menu_name_th)]));
    const today = new Date(`${todayBangkok()}T00:00:00+07:00`).getTime();
    const promos: FnbPromoHint[] = [];
    for (const lot of asRows(lots.data)) {
      const expiryDate = text(lot.expiry_date).slice(0, 10);
      const days = Math.ceil((new Date(`${expiryDate}T00:00:00+07:00`).getTime() - today) / 86400000);
      if (days > 14 || num(lot.remaining_pack_qty) <= 0) continue;
      const itemId = text(lot.item_id);
      for (const line of asRows(bom.data)) {
        if (text(line.item_id) !== itemId) continue;
        promos.push({
          branch_code: text(lot.branch_code),
          item_name: names.get(itemId) || itemId,
          expiry_date: expiryDate,
          days_left: days,
          menu_name_th: menuNames.get(text(line.menu_id)) || "เมนูที่ใช้วัตถุดิบนี้",
        });
      }
    }
    return result({ ranks: [...grouped.values()], promos: promos.slice(0, 40) });
  } catch (error) {
    return caught(empty, error, "อ่านวิเคราะห์เมนูไม่สำเร็จ");
  }
}

export async function getScopedBranchMenuSalesAction(input: { branchCode: string; dateFrom: string; dateTo: string }): Promise<FnbActionResult<FnbScopedMenuSales | null>> {
  const empty = null;
  try {
    const owner = await requireSessionUserId();
    if (!owner.ok) return result(empty, "กรุณาเข้าสู่ระบบ");
    const ctx = await getUserAccessContext(owner.userId);
    if (!ctx?.isActive) return result(empty, "บัญชีนี้ถูกระงับสิทธิ์การใช้งานแล้ว");
    const branchCode = text(input.branchCode);
    const dateFrom = text(input.dateFrom);
    const dateTo = text(input.dateTo);
    if (!branchCode || !dateFrom || !dateTo) return result(empty, "เลือกสาขาและช่วงวันที่");
    const branch = await schemaAdmin().schema("fnb").from("branches").select("brand_code").eq("branch_code", branchCode).maybeSingle();
    const brand = text((branch.data as { brand_code?: string } | null)?.brand_code);
    if (!ctx.isSuperAdmin) {
      if (!ctx.fnbModulePermissions.own_branch_menu_sales) return result(empty, "ไม่มีสิทธิ์ดูยอดขายรายเมนู");
      if (!ctx.allowedBranchCodes.includes(branchCode)) return result(empty, "สาขานี้อยู่นอกพื้นที่ที่ได้รับมอบหมาย");
      if (ctx.assignedBrandCode && brand !== ctx.assignedBrandCode) return result(empty, "ไม่มีสิทธิ์ข้ามแบรนด์ร้านน้ำ");
    }
    const showCost = ctx.isSuperAdmin || ctx.fnbGuardrailPermissions.can_view_cost_price;
    const columns = showCost
      ? "menu_name_th, category_name, cup_size, qty_sold, gross_amount, estimated_bom_cost"
      : "menu_name_th, category_name, cup_size, qty_sold, gross_amount";
    const listed = await schemaAdmin().schema("fnb").from("daily_menu_sales_lines").select(columns).eq("branch_code", branchCode).gte("work_date", dateFrom).lte("work_date", dateTo).limit(5000);
    if (listed.error) return fail(empty, listed.error, "อ่านยอดขายรายเมนูไม่สำเร็จ");
    const menus = new Map<string, { menuName: string; categoryName: string; qtySold: number; grossAmount: number; qtyR: number; qtyL: number; estimatedBomCost?: number }>();
    const categories = new Map<string, { name: string; qtySold: number; grossAmount: number }>();
    let totalCups = 0;
    let totalAmount = 0;
    for (const row of asRows(listed.data)) {
      const menuName = text(row.menu_name_th) || "ไม่ระบุเมนู";
      const categoryName = text(row.category_name) || "ไม่ระบุหมวด";
      const qty = num(row.qty_sold);
      const gross = num(row.gross_amount);
      const size = text(row.cup_size).toUpperCase();
      totalCups += qty;
      totalAmount += gross;
      const menu = menus.get(menuName) ?? { menuName, categoryName, qtySold: 0, grossAmount: 0, qtyR: 0, qtyL: 0, ...(showCost ? { estimatedBomCost: 0 } : {}) };
      menu.qtySold += qty;
      menu.grossAmount += gross;
      if (showCost && menu.estimatedBomCost != null) menu.estimatedBomCost += num(row.estimated_bom_cost);
      if (size.startsWith("R")) menu.qtyR += qty;
      if (size.startsWith("L")) menu.qtyL += qty;
      menus.set(menuName, menu);
      const category = categories.get(categoryName) ?? { name: categoryName, qtySold: 0, grossAmount: 0 };
      category.qtySold += qty;
      category.grossAmount += gross;
      categories.set(categoryName, category);
    }
    return result({
      branchCode,
      totalCups,
      totalAmount,
      menus: [...menus.values()].sort((a, b) => b.qtySold - a.qtySold).slice(0, 20),
      categories: [...categories.values()].sort((a, b) => b.qtySold - a.qtySold),
      showCost,
    });
  } catch (error) {
    return caught(empty, error, "อ่านยอดขายรายเมนูไม่สำเร็จ");
  }
}

async function earlyNote(branchCode: string, workDate: string, draft: FnbMenuSalesDraft): Promise<string | null> {
  const db = schemaAdmin().schema("fnb");
  const [branch, shifts] = await Promise.all([
    db.from("branches").select("closing_time").eq("branch_code", branchCode).maybeSingle(),
    db.from("shift_closings").select("gross_sales").eq("branch_code", branchCode).eq("work_date", workDate).limit(5),
  ]);
  const closing = text((branch.data as Record<string, unknown> | null)?.closing_time);
  const notes: string[] = [];
  if (draft.slip_printed_at && closing) {
    const printed = new Date(draft.slip_printed_at).getTime();
    const closeAt = new Date(`${workDate}T${closing.slice(0, 8)}+07:00`).getTime();
    if (Number.isFinite(printed) && Number.isFinite(closeAt) && closeAt - printed > 25 * 60 * 1000) {
      const clock = new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit" }).format(new Date(draft.slip_printed_at));
      notes.push(`สลิปพิมพ์เวลา ${clock} น. ก่อนปิดร้าน ยอดอาจตกหล่นออเดอร์ท้ายวัน`);
    }
  }
  const gross = asRows(shifts.data).reduce((sum, row) => sum + num(row.gross_sales), 0);
  if (gross > 0 && draft.reported_total_amount > 0 && draft.reported_total_amount + 0.5 < gross) {
    notes.push("ยอดบนสลิปต่ำกว่ายอดขายรวมของกะทั้งวัน");
  }
  return notes.join(" · ") || null;
}
