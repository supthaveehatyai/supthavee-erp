"use server";

import { revalidatePath } from "next/cache";
import { requireSessionUserId } from "@/lib/auth/current-user";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import {
  MATERIAL_STOCK_MODES,
  type MaterialCategory,
  type MaterialDraft,
  type MaterialMatch,
  type MaterialPurchaseLine,
  type MaterialRecord,
  type MaterialStockMode,
} from "@/types/material";

function isStockMode(value: string): value is MaterialStockMode {
  return (MATERIAL_STOCK_MODES as readonly string[]).includes(value);
}

function money(value: unknown): number {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : 0;
}

function revalidateMaterialSurfaces() {
  revalidatePath("/products");
  revalidatePath("/products/materials");
  revalidatePath("/purchases");
  revalidatePath("/purchases/manual-receipt");
  revalidatePath("/dashboard/procurement/goods-receipt");
}

export async function listMaterialCatalogAction(): Promise<{
  categories: MaterialCategory[];
  materials: MaterialRecord[];
  error: string | null;
}> {
  const owner = await requireSessionUserId();
  if (!owner.ok) return { categories: [], materials: [], error: owner.error };
  const supabase = createSupabaseServerClient();
  const [categoriesResult, materialsResult] = await Promise.all([
    supabase
      .from("mst_material_categories")
      .select("code, name_th, name_en, default_purchase_uom, default_usage_uom, sort_order, is_active")
      .eq("is_active", true)
      .order("sort_order", { ascending: true }),
    supabase
      .from("mst_materials")
      .select(
        "id, material_code, material_name, spec_description, category_code, stock_control_mode, purchase_uom, usage_uom, uom_conversion_factor, reference_purchase_price, last_purchase_price, moving_avg_usage_cost, current_usage_qty, reorder_point_usage_qty, is_active",
      )
      .order("material_code", { ascending: true }),
  ]);
  if (categoriesResult.error) {
    return { categories: [], materials: [], error: categoriesResult.error.message };
  }
  if (materialsResult.error) {
    return { categories: [], materials: [], error: materialsResult.error.message };
  }
  const categories: MaterialCategory[] = (categoriesResult.data ?? []).map((row) => ({
    code: String(row.code),
    nameTh: String(row.name_th ?? ""),
    nameEn: String(row.name_en ?? ""),
    defaultPurchaseUom: String(row.default_purchase_uom ?? ""),
    defaultUsageUom: String(row.default_usage_uom ?? ""),
    sortOrder: Number(row.sort_order ?? 0),
  }));
  const categoryName = new Map(categories.map((category) => [category.code, category.nameTh]));
  const materials: MaterialRecord[] = (materialsResult.data ?? []).flatMap((row) => {
    const mode = String(row.stock_control_mode ?? "");
    if (!isStockMode(mode)) return [];
    return [{
      id: String(row.id),
      materialCode: String(row.material_code ?? ""),
      materialName: String(row.material_name ?? ""),
      specDescription: row.spec_description ? String(row.spec_description) : null,
      categoryCode: String(row.category_code ?? ""),
      categoryName: categoryName.get(String(row.category_code ?? "")) ?? String(row.category_code ?? ""),
      stockControlMode: mode,
      purchaseUom: String(row.purchase_uom ?? ""),
      usageUom: String(row.usage_uom ?? ""),
      uomConversionFactor: money(row.uom_conversion_factor),
      referencePurchasePrice: money(row.reference_purchase_price),
      lastPurchasePrice: money(row.last_purchase_price),
      movingAvgUsageCost: money(row.moving_avg_usage_cost),
      currentUsageQty: money(row.current_usage_qty),
      reorderPointUsageQty: money(row.reorder_point_usage_qty),
      isActive: row.is_active !== false,
    }];
  });
  return { categories, materials, error: null };
}

export async function saveMaterialAction(
  draft: MaterialDraft,
): Promise<{ success: boolean; id: string | null; error: string | null }> {
  const owner = await requireSessionUserId();
  if (!owner.ok) return { success: false, id: null, error: owner.error };
  const materialCode = draft.materialCode.trim().toUpperCase();
  const materialName = draft.materialName.trim();
  const categoryCode = draft.categoryCode.trim();
  const factor = Number(draft.uomConversionFactor);
  const referencePrice = Number(draft.referencePurchasePrice);
  if (!materialCode || !materialName || !categoryCode) {
    return { success: false, id: null, error: "กรอกรหัส ชื่อ และหมวดวัตถุดิบ" };
  }
  if (!isStockMode(draft.stockControlMode)) {
    return { success: false, id: null, error: "โหมดคุมสต็อกไม่ถูกต้อง" };
  }
  if (!Number.isFinite(factor) || factor <= 0) {
    return { success: false, id: null, error: "อัตราแปลงหน่วยต้องมากกว่า 0" };
  }
  if (!Number.isFinite(referencePrice) || referencePrice < 0) {
    return { success: false, id: null, error: "ราคาซื้ออ้างอิงไม่ถูกต้อง" };
  }
  const payload = {
    material_code: materialCode,
    material_name: materialName,
    spec_description: draft.specDescription.trim() || null,
    category_code: categoryCode,
    stock_control_mode: draft.stockControlMode,
    purchase_uom: draft.purchaseUom.trim().toUpperCase() || "PCS",
    usage_uom: draft.usageUom.trim().toUpperCase() || "PCS",
    uom_conversion_factor: factor,
    reference_purchase_price: referencePrice,
    reorder_point_usage_qty: Math.max(0, Number(draft.reorderPointUsageQty) || 0),
    is_active: draft.isActive !== false,
    updated_at: new Date().toISOString(),
  };
  const supabase = createSupabaseServerClient();
  const id = draft.id?.trim() ?? "";
  if (id) {
    const { error } = await supabase.from("mst_materials").update(payload).eq("id", id);
    if (error) return { success: false, id: null, error: error.message };
    revalidateMaterialSurfaces();
    return { success: true, id, error: null };
  }
  const { data, error } = await supabase
    .from("mst_materials")
    .insert(payload)
    .select("id")
    .single();
  if (error || !data?.id) {
    return { success: false, id: null, error: error?.message ?? "บันทึกวัตถุดิบไม่สำเร็จ" };
  }
  revalidateMaterialSurfaces();
  return { success: true, id: String(data.id), error: null };
}

export async function issueMaterialToShopFloorAction(input: {
  materialId: string;
  usageQty: number;
  notes?: string | null;
}): Promise<{ success: boolean; error: string | null }> {
  const owner = await requireSessionUserId();
  if (!owner.ok) return { success: false, error: owner.error };
  const materialId = input.materialId.trim();
  const usageQty = Number(input.usageQty);
  if (!materialId) return { success: false, error: "ไม่พบวัตถุดิบ" };
  if (!Number.isFinite(usageQty) || usageQty <= 0) {
    return { success: false, error: "จำนวนเบิกต้องมากกว่า 0" };
  }
  const supabase = createSupabaseServerClient();
  const { data: material, error: readError } = await supabase
    .from("mst_materials")
    .select("id, stock_control_mode, current_usage_qty, moving_avg_usage_cost, usage_uom")
    .eq("id", materialId)
    .maybeSingle();
  if (readError || !material) {
    return { success: false, error: readError?.message ?? "ไม่พบวัตถุดิบ" };
  }
  if (String(material.stock_control_mode) === "DIRECT_CONSUMABLE") {
    return { success: false, error: "วัสดุสิ้นเปลืองทันทีไม่มียอดคงเหลือให้เบิกหน้างาน" };
  }
  const onHand = money(material.current_usage_qty);
  if (usageQty - onHand > 0.0001) {
    return { success: false, error: `คงเหลือไม่พอ (${onHand.toLocaleString("th-TH")} ${material.usage_uom})` };
  }
  const nextQty = Math.round((onHand - usageQty) * 10000) / 10000;
  const unitCost = money(material.moving_avg_usage_cost);
  const totalCost = Math.round(usageQty * unitCost * 100) / 100;
  const { data: updated, error: updateError } = await supabase
    .from("mst_materials")
    .update({ current_usage_qty: nextQty, updated_at: new Date().toISOString() })
    .eq("id", materialId)
    .gte("current_usage_qty", usageQty)
    .select("id")
    .maybeSingle();
  if (updateError || !updated) {
    return { success: false, error: updateError?.message ?? "ยอดคงเหลือเปลี่ยนไประหว่างเบิก กรุณาลองใหม่" };
  }
  const { error: ledgerError } = await supabase.from("material_stock_ledger").insert({
    material_id: materialId,
    tx_type: "SHOP_FLOOR_ISSUE",
    tx_date: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date()),
    usage_qty_delta: -usageQty,
    unit_usage_cost: unitCost,
    total_cost: totalCost,
    notes: input.notes?.trim() || "เบิกเปิดขวด/ม้วนใช้หน้างาน",
    actor_user_id: owner.userId,
  });
  if (ledgerError) {
    await supabase
      .from("mst_materials")
      .update({ current_usage_qty: onHand, updated_at: new Date().toISOString() })
      .eq("id", materialId);
    return { success: false, error: ledgerError.message };
  }
  revalidateMaterialSurfaces();
  return { success: true, error: null };
}

export async function findMaterialMatchesForVendorCodes(
  vendorId: string,
  codes: string[],
): Promise<{ matches: Record<string, MaterialMatch>; error: string | null }> {
  const owner = await requireSessionUserId();
  if (!owner.ok) return { matches: {}, error: owner.error };
  const wanted = [...new Set(codes.map((code) => code.trim()).filter(Boolean))];
  if (wanted.length === 0) return { matches: {}, error: null };
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("material_vendor_mappings")
    .select("raw_vendor_code, contact_id, material_id")
    .in("raw_vendor_code", wanted);
  if (error) return { matches: {}, error: error.message };
  const ranked = new Map<string, { materialId: string; rank: number }>();
  for (const row of data ?? []) {
    const code = String(row.raw_vendor_code ?? "").trim();
    const materialId = String(row.material_id ?? "").trim();
    if (!code || !materialId) continue;
    const rank = String(row.contact_id ?? "") === vendorId ? 2 : String(row.contact_id ?? "") === "" ? 1 : 0;
    const current = ranked.get(code);
    if (!current || rank > current.rank) ranked.set(code, { materialId, rank });
  }
  const materialIds = [...new Set([...ranked.values()].map((row) => row.materialId))];
  if (materialIds.length === 0) return { matches: {}, error: null };
  const materials = await supabase
    .from("mst_materials")
    .select(
      "id, material_code, material_name, purchase_uom, usage_uom, uom_conversion_factor, reference_purchase_price, is_active",
    )
    .in("id", materialIds);
  if (materials.error) return { matches: {}, error: materials.error.message };
  const byId = new Map(
    (materials.data ?? []).map((row) => [String(row.id), row]),
  );
  const matches: Record<string, MaterialMatch> = {};
  for (const [code, pick] of ranked) {
    const row = byId.get(pick.materialId);
    if (!row || row.is_active === false) continue;
    matches[code] = {
      id: String(row.id),
      materialCode: String(row.material_code ?? ""),
      materialName: String(row.material_name ?? ""),
      purchaseUom: String(row.purchase_uom ?? "PCS"),
      usageUom: String(row.usage_uom ?? "PCS"),
      uomConversionFactor: money(row.uom_conversion_factor) || 1,
      referencePurchasePrice: money(row.reference_purchase_price),
    };
  }
  return { matches, error: null };
}

export async function confirmMaterialVendorMappingAction(input: {
  contactId: string;
  rawVendorCode: string;
  rawVendorDesc?: string | null;
  materialId: string;
  lastUnitPrice?: number | null;
}): Promise<{ success: boolean; material: MaterialMatch | null; error: string | null }> {
  const owner = await requireSessionUserId();
  if (!owner.ok) return { success: false, material: null, error: owner.error };
  const contactId = input.contactId.trim();
  const rawVendorCode = input.rawVendorCode.trim();
  const materialId = input.materialId.trim();
  if (!contactId || !rawVendorCode || !materialId) {
    return { success: false, material: null, error: "ข้อมูลจับคู่วัตถุดิบไม่ครบ" };
  }
  const supabase = createSupabaseServerClient();
  const materialResult = await supabase
    .from("mst_materials")
    .select(
      "id, material_code, material_name, purchase_uom, usage_uom, uom_conversion_factor, reference_purchase_price, is_active",
    )
    .eq("id", materialId)
    .maybeSingle();
  if (materialResult.error || !materialResult.data || materialResult.data.is_active === false) {
    return { success: false, material: null, error: materialResult.error?.message ?? "ไม่พบวัตถุดิบ" };
  }
  const existing = await supabase
    .from("material_vendor_mappings")
    .select("id")
    .eq("contact_id", contactId)
    .eq("raw_vendor_code", rawVendorCode)
    .maybeSingle();
  const patch = {
    contact_id: contactId,
    raw_vendor_code: rawVendorCode,
    raw_vendor_desc: input.rawVendorDesc?.trim() || null,
    material_id: materialId,
    last_unit_price: input.lastUnitPrice == null ? null : money(input.lastUnitPrice),
  };
  const saved = existing.data?.id
    ? await supabase.from("material_vendor_mappings").update(patch).eq("id", existing.data.id)
    : await supabase.from("material_vendor_mappings").insert(patch);
  if (saved.error) return { success: false, material: null, error: saved.error.message };
  const row = materialResult.data;
  revalidateMaterialSurfaces();
  return {
    success: true,
    material: {
      id: String(row.id),
      materialCode: String(row.material_code ?? ""),
      materialName: String(row.material_name ?? ""),
      purchaseUom: String(row.purchase_uom ?? "PCS"),
      usageUom: String(row.usage_uom ?? "PCS"),
      uomConversionFactor: money(row.uom_conversion_factor) || 1,
      referencePurchasePrice: money(row.reference_purchase_price),
    },
    error: null,
  };
}

export async function postMaterialPurchaseLines(input: {
  documentId: string;
  docDate: string;
  lines: MaterialPurchaseLine[];
}): Promise<{ error: string | null }> {
  const owner = await requireSessionUserId();
  if (!owner.ok) return { error: owner.error };
  const documentId = input.documentId.trim();
  if (!documentId) return { error: "ไม่พบเอกสารสำหรับรับวัตถุดิบ" };
  if (input.lines.length === 0) return { error: null };
  const supabase = createSupabaseServerClient();
  for (const line of input.lines) {
    const qty = Number(line.qty);
    const lineTotal = Math.round((Number(line.lineTotal) + Number.EPSILON) * 100) / 100;
    if (!line.materialId || !(qty > 0)) {
      return { error: "รายการวัตถุดิบไม่ครบจำนวน" };
    }
    const { error: itemError } = await supabase.from("document_items").insert({
      document_id: documentId,
      product_id: null,
      material_id: line.materialId,
      description: line.description.slice(0, 255),
      qty,
      uom_used: line.purchaseUom || null,
      unit_price: Number(line.unitPrice) || 0,
      unit_cost_price: qty > 0 ? lineTotal / qty : 0,
      discount_amount: 0,
      line_total: lineTotal,
      sort_order: line.sortOrder,
      item_nature: "RAW_MATERIAL",
      skip_stock_ledger: true,
    });
    if (itemError) return { error: itemError.message };
    const { error: rpcError } = await supabase.rpc("record_material_purchase_inbound", {
      p_document_id: documentId,
      p_material_id: line.materialId,
      p_purchase_qty: qty,
      p_net_line_amount: lineTotal,
      p_tx_date: input.docDate,
    });
    if (rpcError) return { error: rpcError.message };
  }
  revalidateMaterialSurfaces();
  return { error: null };
}
