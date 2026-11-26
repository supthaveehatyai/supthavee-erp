"use server";

import { generateWithGeminiFallback, resolveGeminiApiKey } from "@/lib/ai/gemini-client";
import { resolveFnbActor } from "@/lib/fnb/actor";
import { parseVendorCatalogSheet } from "@/lib/fnb/excel";
import { callFnbRpc } from "@/lib/fnb/rpc";
import { asRows, caught, fail, num, result, text, todayBangkok } from "@/lib/fnb/rows";
import { schemaAdmin } from "@/lib/holding/schema-db";
import { requireFnbProcurementOffice, requireSuperAdmin } from "@/lib/holding/workspace-access";
import type { FnbActionResult, FnbBrandCode, FnbExpiryLotRow, FnbGoodsReceiptLineRow, FnbGoodsReceiptRow, FnbItemRow, FnbReimbursementRow, FnbUnpackLine, FnbVendorSheetPreview } from "@/types/fnb";

function asciiBranch(code: string): string {
  return code.replace(/[^A-Za-z0-9-]/g, "").slice(0, 16) || "BRANCH";
}

async function storeFile(branchCode: string, kind: string, file: File): Promise<string> {
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  const path = `fnb/${asciiBranch(branchCode)}/${kind}_${crypto.randomUUID()}.${ext}`;
  const uploaded = await schemaAdmin().storage.from("fnb_operations").upload(path, Buffer.from(await file.arrayBuffer()), {
    contentType: file.type || "application/octet-stream",
    upsert: false,
  });
  if (uploaded.error) throw new Error(uploaded.error.message || "อัปโหลดไฟล์ไม่สำเร็จ");
  return schemaAdmin().storage.from("fnb_operations").getPublicUrl(path).data.publicUrl;
}

function lineMoney(qty: number, unitPrice: number, vatMode: string) {
  if (vatMode === "INC_VAT") {
    const total = qty * unitPrice;
    const net = total / 1.07;
    return { net, vat: total - net, total };
  }
  if (vatMode === "EXEMPT") {
    const net = qty * unitPrice;
    return { net, vat: 0, total: net };
  }
  const net = qty * unitPrice;
  const vat = net * 0.07;
  return { net, vat, total: net + vat };
}

export async function listProcurementQueueAction(): Promise<FnbActionResult<{ receipts: FnbGoodsReceiptRow[]; payouts: FnbReimbursementRow[] }>> {
  try {
    await requireFnbProcurementOffice();
    const db = schemaAdmin().schema("fnb");
    const [receipts, payouts] = await Promise.all([
      db.from("goods_receipts").select("*").order("received_date", { ascending: false }).limit(80),
      db.from("store_reimbursements").select("*").eq("payout_status", "PENDING_PAYOUT").limit(200),
    ]);
    if (receipts.error) return fail({ receipts: [], payouts: [] }, receipts.error, "อ่านใบรับของไม่สำเร็จ");
    if (payouts.error) return fail({ receipts: [], payouts: [] }, payouts.error, "อ่านคิวโอนคืนไม่สำเร็จ");
    return result({
      receipts: asRows(receipts.data).map((row) => ({
        id: text(row.id),
        gr_no: text(row.gr_no),
        receiving_branch_code: text(row.receiving_branch_code),
        tax_invoice_branch_code: row.tax_invoice_branch_code == null ? null : text(row.tax_invoice_branch_code),
        vendor_name: row.vendor_name == null ? null : text(row.vendor_name),
        doc_tax_status: text(row.doc_tax_status),
        sub_total_ex_vat: num(row.sub_total_ex_vat),
        vat_amount: num(row.vat_amount),
        grand_total: num(row.grand_total),
        branch_mismatch_warning: row.branch_mismatch_warning === true,
        received_date: text(row.received_date),
      })),
      payouts: asRows(payouts.data).map((row) => ({
        id: text(row.id),
        reimb_no: text(row.reimb_no),
        branch_code: text(row.branch_code),
        staff_name: text(row.staff_name),
        reimb_mode: text(row.reimb_mode),
        vendor_or_purpose: text(row.vendor_or_purpose),
        total_amount: num(row.total_amount),
        payout_status: text(row.payout_status),
        payee_bank_info: row.payee_bank_info == null ? null : text(row.payee_bank_info),
      })),
    });
  } catch (error) {
    return caught({ receipts: [], payouts: [] }, error, "อ่านคิวจัดซื้อไม่สำเร็จ");
  }
}

export async function listReceiptLinesAction(grId: string): Promise<FnbActionResult<FnbGoodsReceiptLineRow[]>> {
  try {
    await requireFnbProcurementOffice();
    const listed = await schemaAdmin().schema("fnb").from("goods_receipt_lines").select("*").eq("gr_id", grId).limit(200);
    if (listed.error) return fail([], listed.error, "อ่านรายการรับของไม่สำเร็จ");
    return result(asRows(listed.data).map((row) => ({
      id: text(row.id),
      gr_id: text(row.gr_id),
      item_id: text(row.item_id),
      item_description: text(row.item_description),
      received_qty: num(row.received_qty),
      received_uom: text(row.received_uom),
      recipe_qty_per_unit: num(row.recipe_qty_per_unit) || 1,
      unit_price: num(row.unit_price),
      line_vat_mode: text(row.line_vat_mode) || "EX_VAT",
    })));
  } catch (error) {
    return caught([], error, "อ่านรายการรับของไม่สำเร็จ");
  }
}

export async function listReceiveItemsAction(brandLock?: FnbBrandCode | null): Promise<FnbActionResult<Pick<FnbItemRow, "id" | "short_code" | "name_th" | "count_uom" | "default_purchase_uom" | "recipe_per_purchase_uom" | "shelf_life_months" | "requires_expiry_tracking" | "brand_scope">[]>> {
  try {
    const listed = await schemaAdmin().schema("fnb").from("items").select("id,short_code,name_th,count_uom,default_purchase_uom,recipe_per_purchase_uom,shelf_life_months,requires_expiry_tracking,brand_scope").eq("is_active", true).order("short_code", { ascending: true }).limit(500);
    if (listed.error) return fail([], listed.error, "อ่านรายการสินค้าไม่สำเร็จ");
    return result(asRows(listed.data).map((row) => ({
      id: text(row.id),
      short_code: text(row.short_code),
      name_th: text(row.name_th),
      count_uom: text(row.count_uom),
      default_purchase_uom: text(row.default_purchase_uom),
      recipe_per_purchase_uom: num(row.recipe_per_purchase_uom) || 1,
      shelf_life_months: row.shelf_life_months == null ? null : num(row.shelf_life_months),
      requires_expiry_tracking: row.requires_expiry_tracking !== false,
      brand_scope: text(row.brand_scope),
    })).filter((item) => {
      if (!brandLock) return true;
      if (item.brand_scope !== "ALL" && item.brand_scope !== brandLock) return false;
      const label = `${item.short_code} ${item.name_th}`;
      return brandLock === "LUCKY_CUP" ? !/ชาทร|chatorn/i.test(label) : !/lucky\s*cup|ลัคกี้|luckycup/i.test(label);
    }));
  } catch (error) {
    return caught([], error, "อ่านรายการสินค้าไม่สำเร็จ");
  }
}

export async function submitBlindGoodsReceiptAction(formData: FormData): Promise<FnbActionResult<{ gr_no: string; line_count: number }>> {
  try {
    const actor = await resolveFnbActor({
      actorSource: text(formData.get("actor_source")),
      brandLock: text(formData.get("brand_lock")),
      branchCode: text(formData.get("receiving_branch_code")),
    });
    if (!actor.ok) return result({ gr_no: "", line_count: 0 }, actor.error);
    formData.set("staff_name", actor.actor.name);
    const branch = text(formData.get("receiving_branch_code"));
    const brand = text(formData.get("brand_lock"));
    const brandLock = brand === "LUCKY_CUP" || brand === "CHATORN" ? brand : null;
    const branchRow = await schemaAdmin().schema("fnb").from("branches").select("brand_code,vat_branch_code").eq("branch_code", branch).maybeSingle();
    if (branchRow.error) return fail({ gr_no: "", line_count: 0 }, branchRow.error, "อ่านสาขาไม่สำเร็จ");
    const branchData = branchRow.data && typeof branchRow.data === "object" ? branchRow.data as Record<string, unknown> : {};
    if (brandLock && text(branchData.brand_code) !== brandLock) return result({ gr_no: "", line_count: 0 }, "สาขานี้ไม่อยู่ในแบรนด์ที่เปิดใช้งาน");
    const reveal = formData.get("reveal_cost") === "true";
    if (reveal) await requireSuperAdmin();
    const lines = JSON.parse(text(formData.get("lines_json")) || "[]") as { item_id: string; raw_desc?: string; raw_code?: string; received_qty: number; received_uom: string; recipe_qty_per_unit?: number; unit_price?: number; line_vat_mode?: string }[];
    const safeLines = reveal ? lines : lines.map((line) => ({ ...line, unit_price: 0 }));
    const photos = await Promise.all(
      formData.getAll("photos").filter((entry): entry is File => entry instanceof File && entry.size > 0).map((file) => storeFile(branch, "gr", file)),
    );
    const saved = await callFnbRpc("save_fnb_goods_receipt_transaction", {
      p_receiving_branch_code: branch,
      p_tax_invoice_branch_code: text(formData.get("tax_invoice_branch_code")) || text(branchData.vat_branch_code) || null,
      p_received_date: text(formData.get("received_date")) || todayBangkok(),
      p_received_by_staff: text(formData.get("staff_name")) || "พนักงาน",
      p_vendor_name: text(formData.get("vendor_name")) || null,
      p_vendor_invoice_no: text(formData.get("vendor_invoice_no")) || null,
      p_doc_tax_status: text(formData.get("doc_tax_status")) || "PENDING_HQ_MATCH",
      p_vat_mode: "MIXED",
      p_discount_coupon_amount: reveal ? Number(formData.get("discount_coupon_amount") ?? 0) : 0,
      p_freight_amount: reveal ? Number(formData.get("freight_amount") ?? 0) : 0,
      p_under_moq_surcharge: reveal ? Number(formData.get("under_moq_surcharge") ?? 0) : 0,
      p_delivery_photo_urls: photos,
      p_invoice_file_urls: [],
      p_notes: text(formData.get("notes")) || null,
      p_lines: safeLines,
    });
    if (saved.error) return fail({ gr_no: "", line_count: 0 }, saved.error, "บันทึกรับของไม่สำเร็จ");
    const body = saved.data && typeof saved.data === "object" ? saved.data as Record<string, unknown> : {};
    if (body.ok === false) return result({ gr_no: "", line_count: 0 }, text(body.error) || "บันทึกรับของไม่สำเร็จ");
    return result({ gr_no: text(body.gr_no), line_count: safeLines.length });
  } catch (error) {
    return caught({ gr_no: "", line_count: 0 }, error, "บันทึกรับของไม่สำเร็จ");
  }
}

export async function previewVendorSheetAction(formData: FormData): Promise<FnbActionResult<FnbVendorSheetPreview>> {
  try {
    await requireFnbProcurementOffice();
    const file = formData.get("file");
    if (!(file instanceof File)) return result({ branch_code: null, rows: [] }, "ไม่พบไฟล์ Excel");
    const parsed = parseVendorCatalogSheet(await file.arrayBuffer());
    const [items, maps] = await Promise.all([
      schemaAdmin().schema("fnb").from("items").select("id,short_code,external_code,name_th").limit(800),
      schemaAdmin().schema("fnb").from("vendor_item_mappings").select("item_id,raw_vendor_code,raw_vendor_desc").limit(1000),
    ]);
    if (items.error) return fail(parsed, items.error, "จับคู่รหัสวัตถุดิบไม่สำเร็จ");
    const byCode = new Map<string, { id: string; name: string }>();
    for (const row of asRows(items.data)) {
      const hit = { id: text(row.id), name: text(row.name_th) };
      if (text(row.external_code)) byCode.set(text(row.external_code).toUpperCase(), hit);
      if (text(row.short_code)) byCode.set(text(row.short_code).toUpperCase(), hit);
    }
    for (const row of asRows(maps.data)) {
      const hit = { id: text(row.item_id), name: text(row.raw_vendor_desc) };
      if (text(row.raw_vendor_code)) byCode.set(text(row.raw_vendor_code).toUpperCase(), hit);
    }
    return result({
      branch_code: parsed.branch_code,
      rows: parsed.rows.map((row) => {
        const hit = byCode.get(row.external_code);
        return { ...row, item_id: hit?.id ?? null, item_name: hit?.name ?? null };
      }),
    });
  } catch (error) {
    return caught({ branch_code: null, rows: [] }, error, "อ่านไฟล์ใบสั่งของไม่สำเร็จ");
  }
}

export async function listExpiryWorkspaceAction(brandLock?: FnbBrandCode | null): Promise<FnbActionResult<{ pending: FnbUnpackLine[]; lots: FnbExpiryLotRow[] }>> {
  try {
    const db = schemaAdmin().schema("fnb");
    const [lines, receipts, items, lots] = await Promise.all([
      db.from("goods_receipt_lines").select("id,gr_id,item_id,item_description,received_qty,allocated_lot_qty,received_uom,expiry_tracking_status").limit(400),
      db.from("goods_receipts").select("id,gr_no,receiving_branch_code").limit(200),
      db.from("items").select("id,short_code,name_th,shelf_life_months,brand_scope").limit(500),
      db.from("item_expiry_lots").select("id,branch_code,item_id,pack_qty,remaining_pack_qty,pack_uom,mfg_date,expiry_date,lot_status").eq("lot_status", "ACTIVE").limit(400),
    ]);
    if (lines.error) return fail({ pending: [], lots: [] }, lines.error, "อ่านรายการรอแกะกล่องไม่สำเร็จ");
    const receiptById = new Map(asRows(receipts.data).map((row) => [text(row.id), row]));
    const itemById = new Map(asRows(items.data).map((row) => [text(row.id), row]));
    const branches = await db.from("branches").select("branch_code,brand_code").limit(20);
    const brandByBranch = new Map(asRows(branches.data).map((row) => [text(row.branch_code), text(row.brand_code)]));
    const allowed = (branchCode: string, label: string) => {
      if (!brandLock) return true;
      if (brandByBranch.get(branchCode) !== brandLock) return false;
      return brandLock === "LUCKY_CUP" ? !/ชาทร|chatorn/i.test(label) : !/lucky\s*cup|ลัคกี้|luckycup/i.test(label);
    };
    const pending = asRows(lines.data).flatMap((row) => {
      const status = text(row.expiry_tracking_status);
      if (status !== "PENDING_UNPACK" && status !== "PARTIAL_UNPACK") return [];
      const receipt = receiptById.get(text(row.gr_id));
      const item = itemById.get(text(row.item_id));
      const branch = text(receipt?.receiving_branch_code);
      const label = `${text(item?.short_code)} ${text(item?.name_th) || text(row.item_description)}`;
      if (!allowed(branch, label)) return [];
      return [{
        id: text(row.id),
        gr_no: text(receipt?.gr_no),
        branch_code: branch,
        item_id: text(row.item_id),
        short_code: text(item?.short_code),
        name_th: text(item?.name_th) || text(row.item_description),
        received_qty: num(row.received_qty),
        allocated_lot_qty: num(row.allocated_lot_qty),
        received_uom: text(row.received_uom),
        expiry_tracking_status: status,
        shelf_life_months: item?.shelf_life_months == null ? null : num(item.shelf_life_months),
      }];
    });
    const activeLots = asRows(lots.data).flatMap((row) => {
      const item = itemById.get(text(row.item_id));
      const label = `${text(item?.short_code)} ${text(item?.name_th)}`;
      if (!allowed(text(row.branch_code), label)) return [];
      return [{
        id: text(row.id),
        branch_code: text(row.branch_code),
        item_id: text(row.item_id),
        short_code: text(item?.short_code),
        name_th: text(item?.name_th),
        pack_qty: num(row.pack_qty),
        remaining_pack_qty: num(row.remaining_pack_qty),
        pack_uom: text(row.pack_uom),
        mfg_date: row.mfg_date == null ? null : text(row.mfg_date),
        expiry_date: text(row.expiry_date),
        lot_status: text(row.lot_status),
      }];
    }).sort((a, b) => a.expiry_date.localeCompare(b.expiry_date));
    return result({ pending, lots: activeLots });
  } catch (error) {
    return caught({ pending: [], lots: [] }, error, "อ่านล็อตวันหมดอายุไม่สำเร็จ");
  }
}

export async function saveExpiryLotsAction(input: {
  gr_line_id: string;
  staff_name: string;
  actor_source?: string;
  brand_lock?: FnbBrandCode | null;
  branch_code?: string | null;
  lots: { pack_qty: number; mfg_date: string; expiry_date: string; shelf_life_months: number | null }[];
}): Promise<FnbActionResult<{ ok: boolean }>> {
  try {
    const actor = await resolveFnbActor({ actorSource: input.actor_source ?? "desktop", brandLock: input.brand_lock ?? null, branchCode: input.branch_code ?? null });
    if (!actor.ok) return result({ ok: false }, actor.error);
    const saved = await callFnbRpc("save_gr_line_expiry_lots", {
      p_gr_line_id: input.gr_line_id,
      p_staff_name: actor.actor.name,
      p_lots: input.lots,
    });
    if (saved.error) return fail({ ok: false }, saved.error, "บันทึกล็อตไม่สำเร็จ");
    const body = saved.data && typeof saved.data === "object" ? saved.data as Record<string, unknown> : {};
    if (body.ok === false) return result({ ok: false }, text(body.error) || "บันทึกล็อตไม่สำเร็จ");
    return result({ ok: true });
  } catch (error) {
    return caught({ ok: false }, error, "บันทึกล็อตไม่สำเร็จ");
  }
}

export async function parseFnbBillImageAction(formData: FormData): Promise<FnbActionResult<{ vendor_name: string; invoice_no: string; lines: { name: string; qty: number; uom: string; price: number }[] }>> {
  try {
    await requireFnbProcurementOffice();
    const file = formData.get("file");
    if (!(file instanceof File)) return result({ vendor_name: "", invoice_no: "", lines: [] }, "ไม่พบรูปบิล");
    const apiKey = resolveGeminiApiKey();
    if (!apiKey) return result({ vendor_name: "", invoice_no: "", lines: [] }, "ยังไม่ได้ตั้งค่า Gemini");
    const generated = await generateWithGeminiFallback({
      apiKey,
      parts: [
        { text: "อ่านบิลซื้อวัตถุดิบร้านกาแฟ ภาษาจีนหรือไทย ตอบ JSON เท่านั้น คีย์ vendor_name, invoice_no, lines เป็นอาร์เรย์ของ {name, qty, uom, price}. ไม่พบให้เป็นค่าว่างหรือ 0." },
        { inlineData: { mimeType: file.type || "image/jpeg", data: Buffer.from(await file.arrayBuffer()).toString("base64") } },
      ],
    });
    const match = generated.text.match(/\{[\s\S]*\}/);
    const parsed = match ? JSON.parse(match[0]) as { vendor_name?: string; invoice_no?: string; lines?: { name?: string; qty?: number; uom?: string; price?: number }[] } : {};
    return result({
      vendor_name: text(parsed.vendor_name),
      invoice_no: text(parsed.invoice_no),
      lines: (parsed.lines ?? []).map((line) => ({ name: text(line.name), qty: num(line.qty), uom: text(line.uom), price: num(line.price) })),
    });
  } catch (error) {
    return caught({ vendor_name: "", invoice_no: "", lines: [] }, error, "อ่านบิลไม่สำเร็จ");
  }
}

export async function depleteExpiryLotAction(lotId: string): Promise<FnbActionResult<{ ok: boolean }>> {
  try {
    const updated = await schemaAdmin().schema("fnb").from("item_expiry_lots").update({
      remaining_pack_qty: 0,
      lot_status: "DEPLETED",
      updated_at: new Date().toISOString(),
    }).eq("id", lotId);
    if (updated.error) return fail({ ok: false }, updated.error, "ตัดล็อตไม่สำเร็จ");
    return result({ ok: true });
  } catch (error) {
    return caught({ ok: false }, error, "ตัดล็อตไม่สำเร็จ");
  }
}

export async function confirmHqGoodsReceiptAction(input: {
  gr_id: string;
  receiving_branch_code: string;
  tax_invoice_branch_code: string;
  vendor_name: string;
  vendor_invoice_no: string;
  doc_tax_status: string;
  discount_coupon_amount: number;
  freight_amount: number;
  under_moq_surcharge: number;
  lines: { id?: string; item_id: string; item_description: string; received_qty: number; received_uom: string; recipe_qty_per_unit: number; unit_price: number; line_vat_mode: string }[];
}): Promise<FnbActionResult<{ ok: boolean; mismatch: boolean }>> {
  try {
    await requireFnbProcurementOffice();
    const db = schemaAdmin().schema("fnb");
    const branch = await db.from("branches").select("vat_branch_code,legal_entity_id").eq("branch_code", input.receiving_branch_code).maybeSingle();
    if (branch.error) return fail({ ok: false, mismatch: false }, branch.error, "อ่านสาขาไม่สำเร็จ");
    const branchData = branch.data && typeof branch.data === "object" ? branch.data as Record<string, unknown> : {};
    const mismatch = Boolean(input.tax_invoice_branch_code) && input.tax_invoice_branch_code !== text(branchData.vat_branch_code);
    const priced = input.lines.map((line) => {
      const money = lineMoney(Number(line.received_qty) || 0, Number(line.unit_price) || 0, line.line_vat_mode);
      const per = Number(line.recipe_qty_per_unit) || 1;
      return { ...line, ...money, total_recipe_qty: (Number(line.received_qty) || 0) * per, per };
    });
    const sub = priced.reduce((sum, line) => sum + line.net, 0);
    const vat = priced.reduce((sum, line) => sum + line.vat, 0);
    const modes = new Set(priced.map((line) => line.line_vat_mode));
    const updated = await db.from("goods_receipts").update({
      receiving_branch_code: input.receiving_branch_code,
      tax_invoice_branch_code: input.tax_invoice_branch_code || null,
      legal_entity_id: text(branchData.legal_entity_id) || null,
      vendor_name: input.vendor_name || null,
      vendor_invoice_no: input.vendor_invoice_no || null,
      doc_tax_status: input.doc_tax_status,
      vat_mode: modes.size > 1 ? "MIXED" : [...modes][0] || "EX_VAT",
      sub_total_ex_vat: sub,
      discount_coupon_amount: Number(input.discount_coupon_amount) || 0,
      freight_amount: Number(input.freight_amount) || 0,
      under_moq_surcharge: Number(input.under_moq_surcharge) || 0,
      vat_amount: vat,
      grand_total: sub - (Number(input.discount_coupon_amount) || 0) + (Number(input.freight_amount) || 0) + (Number(input.under_moq_surcharge) || 0) + vat,
      branch_mismatch_warning: mismatch,
    }).eq("id", input.gr_id);
    if (updated.error) return fail({ ok: false, mismatch }, updated.error, "อัปเดตใบรับของไม่สำเร็จ");
    for (const line of priced) {
      const payload = {
        gr_id: input.gr_id,
        item_id: line.item_id,
        item_description: line.item_description,
        received_qty: Number(line.received_qty) || 0,
        received_uom: line.received_uom,
        recipe_qty_per_unit: line.per,
        total_recipe_qty: line.total_recipe_qty,
        unit_price: Number(line.unit_price) || 0,
        line_vat_mode: line.line_vat_mode,
        line_net_ex_vat: line.net,
        line_vat_amount: line.vat,
        line_total_inc_vat: line.total,
      };
      const written = line.id
        ? await db.from("goods_receipt_lines").update(payload).eq("id", line.id)
        : await db.from("goods_receipt_lines").insert(payload);
      if (written.error) return fail({ ok: false, mismatch }, written.error, "อัปเดตรายการรับของไม่สำเร็จ");
    }
    const posted = await db.from("stock_ledger").select("id").eq("ref_id", input.gr_id).limit(1);
    if (posted.error) return fail({ ok: false, mismatch }, posted.error, "ตรวจสต็อกไม่สำเร็จ");
    if (asRows(posted.data).length > 0) return result({ ok: true, mismatch });
    for (const line of priced) {
      if (!line.item_id || line.total_recipe_qty <= 0) continue;
      const unit = line.net / line.total_recipe_qty;
      const item = await db.from("items").select("moving_avg_cost_per_recipe_unit").eq("id", line.item_id).maybeSingle();
      const onHandRows = await db.from("stock_ledger").select("qty_delta").eq("item_id", line.item_id).limit(2000);
      if (item.error || onHandRows.error) return fail({ ok: false, mismatch }, item.error ?? onHandRows.error, "คำนวณทุนเฉลี่ยไม่สำเร็จ");
      const oldCost = num((item.data as Record<string, unknown> | null)?.moving_avg_cost_per_recipe_unit);
      const onHand = asRows(onHandRows.data).reduce((sum, row) => sum + num(row.qty_delta), 0);
      const nextCost = onHand + line.total_recipe_qty <= 0 ? unit : ((onHand * oldCost) + line.net) / (onHand + line.total_recipe_qty);
      const costSaved = await db.from("items").update({ moving_avg_cost_per_recipe_unit: nextCost }).eq("id", line.item_id);
      if (costSaved.error) return fail({ ok: false, mismatch }, costSaved.error, "อัปเดตทุนเฉลี่ยไม่สำเร็จ");
      const ledger = await db.from("stock_ledger").insert({
        branch_code: input.receiving_branch_code,
        item_id: line.item_id,
        tx_date: todayBangkok(),
        tx_type: "GR_IN",
        qty_delta: line.total_recipe_qty,
        unit_cost_ex_vat: unit,
        total_cost_ex_vat: line.net,
        ref_table: "goods_receipts",
        ref_id: input.gr_id,
        notes: "HQ tax match",
      });
      if (ledger.error) return fail({ ok: false, mismatch }, ledger.error, "ลงสต็อกรับเข้าไม่สำเร็จ");
    }
    return result({ ok: true, mismatch });
  } catch (error) {
    return caught({ ok: false, mismatch: false }, error, "ชนบิลภาษีไม่สำเร็จ");
  }
}

export async function submitStaffReimbursementAction(formData: FormData): Promise<FnbActionResult<{ reimb_no: string }>> {
  try {
    const actor = await resolveFnbActor({
      actorSource: text(formData.get("actor_source")),
      brandLock: text(formData.get("brand_lock")),
      branchCode: text(formData.get("branch_code")),
    });
    if (!actor.ok) return result({ reimb_no: "" }, actor.error);
    formData.set("staff_name", actor.actor.name);
    const mode = text(formData.get("reimb_mode"));
    if (mode !== "STAFF_ADVANCE_REIMBURSE" && mode !== "HQ_DIRECT_PAY") return result({ reimb_no: "" }, "เลือกประเภทรายการให้ถูกต้อง");
    const branch = text(formData.get("branch_code"));
    const photos = await Promise.all(
      formData.getAll("photos").filter((entry): entry is File => entry instanceof File && entry.size > 0).map((file) => storeFile(branch, "reimb", file)),
    );
    const total = Number(formData.get("total_amount") ?? 0);
    const vat = mode === "HQ_DIRECT_PAY" ? total - total / 1.07 : 0;
    const id = crypto.randomUUID();
    const reimbNo = `FNB-RB-${todayBangkok().replace(/-/g, "")}-${id.slice(0, 4).toUpperCase()}`;
    const inserted = await schemaAdmin().schema("fnb").from("store_reimbursements").insert({
      id,
      reimb_no: reimbNo,
      branch_code: branch,
      expense_date: todayBangkok(),
      reimb_mode: mode,
      staff_name: text(formData.get("staff_name")),
      payee_bank_info: text(formData.get("payee_bank_info")) || null,
      vendor_or_purpose: text(formData.get("vendor_or_purpose")),
      base_amount_ex_vat: total - vat,
      vat_amount: vat,
      total_amount: total,
      accounting_tax_tier: mode === "HQ_DIRECT_PAY" ? "CORP_VAT" : "INTERNAL_1_3",
      bill_image_urls: photos,
      payout_status: "PENDING_PAYOUT",
    });
    if (inserted.error) return fail({ reimb_no: "" }, inserted.error, "ส่งคำขอโอนคืนไม่สำเร็จ");
    return result({ reimb_no: reimbNo });
  } catch (error) {
    return caught({ reimb_no: "" }, error, "ส่งคำขอโอนคืนไม่สำเร็จ");
  }
}

export async function markReimbursementsPaidAction(formData: FormData): Promise<FnbActionResult<{ paid: number }>> {
  try {
    const admin = await requireFnbProcurementOffice();
    const ids = text(formData.get("ids")).split(",").map((id) => id.trim()).filter(Boolean);
    const slip = formData.get("slip");
    const branch = text(formData.get("branch_code")) || "HQ";
    const slipUrl = slip instanceof File && slip.size > 0 ? await storeFile(branch, "payout", slip) : null;
    let paid = 0;
    for (const id of ids) {
      const updated = await schemaAdmin().schema("fnb").from("store_reimbursements").update({
        payout_status: "PAID",
        paid_at: new Date().toISOString(),
        paid_by_name: admin.userId,
        payout_slip_url: slipUrl,
      }).eq("id", id);
      if (updated.error) return fail({ paid }, updated.error, "บันทึกการโอนไม่สำเร็จ");
      paid += 1;
    }
    return result({ paid });
  } catch (error) {
    return caught({ paid: 0 }, error, "บันทึกการโอนไม่สำเร็จ");
  }
}
