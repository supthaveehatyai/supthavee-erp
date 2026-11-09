"use server";

/**
 * Product Model mutations — delete with usage guardrail.
 * Service Role only. Zero Client-Side Fetching.
 */

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server-admin";
import { getCurrentAuthUser, requireSessionUserId } from "@/lib/auth/current-user";
import type {
  BundleKit,
  BundleKitSearchHit,
  BundleSizeUpcharge,
  BundleSlot,
  BundleSlotModel,
  SaveBundleKitInput,
} from "@/types/bundle-kit";
import { fetchOnHandQtyByProductIds } from "@/lib/inventory/ledger-balances";
import { fetchAllPages } from "@/lib/supabase/fetch-all-pages";
import type { DeleteProductModelResult } from "@/types/product-matrix";

const CATALOG_PRODUCT_SELECT =
  "id, created_at, sku, name, short_name, description, category, color, size, gender, tax_type, base_uom, cost_price, retail_price, wholesale_price, is_active, model_id" as const;

const USAGE_BLOCK_MESSAGE =
  "ไม่อนุญาตให้ลบ: สินค้ารุ่นนี้มีการเดินรายการบัญชีหรือสต็อกแล้ว กรุณาใช้วิธี 'ปิดการใช้งาน (Inactive)' แทน";

const modelIdSchema = z.string().uuid("รหัสรุ่นสินค้าไม่ถูกต้อง");

const PRODUCTS_PATH = "/products";
const IN_CHUNK = 200;

function chunkIds(ids: string[]): string[][] {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    chunks.push(ids.slice(i, i + IN_CHUNK));
  }
  return chunks;
}

async function hasRowsForProducts(
  table: "inventory_ledger" | "document_items",
  productIds: string[],
): Promise<{ used: boolean; error: string | null }> {
  if (productIds.length === 0) return { used: false, error: null };

  const supabaseAdmin = createClient();
  for (const chunk of chunkIds(productIds)) {
    const { count, error } = await supabaseAdmin
      .from(table)
      .select("id", { count: "exact", head: true })
      .in("product_id", chunk);

    if (error) return { used: false, error: error.message };
    if ((count ?? 0) > 0) return { used: true, error: null };
  }

  return { used: false, error: null };
}

export async function deleteProductModel(
  modelId: string,
): Promise<DeleteProductModelResult> {
  const actor = await getCurrentAuthUser();
  if (!actor) {
    return { success: false, error: "กรุณาเข้าสู่ระบบ" };
  }

  const parsed = modelIdSchema.safeParse(String(modelId ?? "").trim());
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "รหัสรุ่นสินค้าไม่ถูกต้อง",
    };
  }

  const id = parsed.data;

  try {
    const supabaseAdmin = createClient();

    const { data: model, error: modelError } = await supabaseAdmin
      .from("product_models")
      .select("id, model_code, name")
      .eq("id", id)
      .maybeSingle();

    if (modelError) {
      return { success: false, error: modelError.message };
    }
    if (!model) {
      return { success: false, error: "ไม่พบสินค้ารุ่นที่ต้องการลบ" };
    }

    const { data: skuRows, error: skuError } = await supabaseAdmin
      .from("products")
      .select("id")
      .eq("model_id", id);

    if (skuError) {
      return { success: false, error: skuError.message };
    }

    const productIds = (skuRows ?? [])
      .map((row) => String(row.id ?? "").trim())
      .filter(Boolean);

    const ledger = await hasRowsForProducts("inventory_ledger", productIds);
    if (ledger.error) return { success: false, error: ledger.error };
    if (ledger.used) return { success: false, error: USAGE_BLOCK_MESSAGE };

    const docs = await hasRowsForProducts("document_items", productIds);
    if (docs.error) return { success: false, error: docs.error };
    if (docs.used) return { success: false, error: USAGE_BLOCK_MESSAGE };

    const { count: bomAsMaterialCount, error: bomCheckError } =
      await supabaseAdmin
        .from("product_boms")
        .select("id", { count: "exact", head: true })
        .eq("raw_material_model_id", id);

    if (bomCheckError) {
      return { success: false, error: bomCheckError.message };
    }
    if ((bomAsMaterialCount ?? 0) > 0) {
      return { success: false, error: USAGE_BLOCK_MESSAGE };
    }

    // PostgREST ไม่มี multi-statement transaction — ลบลูกก่อนแม่ตามลำดับ
    if (productIds.length > 0) {
      for (const chunk of chunkIds(productIds)) {
        const { error: mappingError } = await supabaseAdmin
          .from("vendor_product_mapping")
          .delete()
          .in("internal_product_id", chunk);
        if (mappingError) {
          return { success: false, error: mappingError.message };
        }
      }
    }

    const { error: ownBomError } = await supabaseAdmin
      .from("product_boms")
      .delete()
      .eq("finished_model_id", id);
    if (ownBomError) {
      return { success: false, error: ownBomError.message };
    }

    const { error: ratesError } = await supabaseAdmin
      .from("technician_rates")
      .delete()
      .eq("service_model_id", id);
    if (ratesError) {
      return { success: false, error: ratesError.message };
    }

    const { error: productsError } = await supabaseAdmin
      .from("products")
      .delete()
      .eq("model_id", id);
    if (productsError) {
      const fkHint = /foreign key|violates/i.test(productsError.message);
      return {
        success: false,
        error: fkHint ? USAGE_BLOCK_MESSAGE : productsError.message,
      };
    }

    const { error: deleteModelError } = await supabaseAdmin
      .from("product_models")
      .delete()
      .eq("id", id);
    if (deleteModelError) {
      const fkHint = /foreign key|violates/i.test(deleteModelError.message);
      return {
        success: false,
        error: fkHint ? USAGE_BLOCK_MESSAGE : deleteModelError.message,
      };
    }

    revalidatePath(PRODUCTS_PATH);
    revalidatePath(PRODUCTS_PATH, "layout");
    return { success: true };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "ลบสินค้ารุ่นไม่สำเร็จ";
    return { success: false, error: message };
  }
}

/** Full product catalog for /products — paged past the PostgREST 1,000-row cap. */
export async function getProductsForCatalog() {
  const actor = await getCurrentAuthUser();
  if (!actor) {
    return { data: [], error: "กรุณาเข้าสู่ระบบ" };
  }

  try {
    const supabaseAdmin = createClient();
    const page = await fetchAllPages((from, to) =>
      supabaseAdmin
        .from("products")
        .select(CATALOG_PRODUCT_SELECT)
        .order("created_at", { ascending: false })
        .order("id", { ascending: true })
        .range(from, to),
    );

    if (page.error) {
      return { data: [], error: page.error.message };
    }
    return { data: page.data, error: null as string | null };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "โหลดรายการสินค้าไม่สำเร็จ";
    return { data: [], error: message };
  }
}

/** Soft-delete catalog SKUs. Chunks ids so `.in()` stays inside the URL limit. */
export async function deactivateProductsByIds(productIds: string[]) {
  const actor = await getCurrentAuthUser();
  if (!actor) {
    return { error: "กรุณาเข้าสู่ระบบ" };
  }

  const ids = [
    ...new Set(productIds.map((id) => String(id ?? "").trim()).filter(Boolean)),
  ];
  if (ids.length === 0) {
    return { error: "ไม่พบรหัสสินค้าที่ต้องการปิดใช้งาน" };
  }

  try {
    const supabaseAdmin = createClient();
    for (const chunk of chunkIds(ids)) {
      const { error } = await supabaseAdmin
        .from("products")
        .update({ is_active: false })
        .in("id", chunk);
      if (error) return { error: error.message };
    }

    revalidatePath(PRODUCTS_PATH);
    revalidatePath(PRODUCTS_PATH, "layout");
    return { error: null as string | null };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "ปิดการใช้งานสินค้าไม่สำเร็จ";
    return { error: message };
  }
}

function readDeleteSkuPayloadError(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const row = payload as Record<string, unknown>;
  if (row.success === false || row.ok === false) {
    return String(row.error ?? row.message ?? "ลบ SKU ไม่สำเร็จ");
  }
  const message = String(row.error ?? "").trim();
  return message || null;
}

/** ลบ SKU ที่ยังไม่เคยออกบิลและสต็อกเป็น 0 ผ่าน `delete_skus_safely`. */
export async function deleteSkusSafelyAction(skus: string[]) {
  const owner = await requireSessionUserId();
  if (!owner.ok) return { error: owner.error };

  const unique = [
    ...new Set(skus.map((sku) => String(sku ?? "").trim()).filter(Boolean)),
  ];
  if (unique.length === 0) return { error: "ไม่พบรหัส SKU ที่ต้องการลบ" };

  try {
    const supabaseAdmin = createClient();
    const rpcClient = supabaseAdmin as unknown as {
      rpc: (
        fn: "delete_skus_safely",
        args: { p_skus: string[] },
      ) => Promise<{ data: unknown; error: { message: string } | null }>;
    };
    const deleted = await rpcClient.rpc("delete_skus_safely", { p_skus: unique });
    if (deleted.error) {
      if (/Could not find the function|PGRST202/i.test(deleted.error.message)) {
        return { error: "ยังไม่พบฟังก์ชันลบ SKU บนฐานข้อมูลที่แอปเชื่อมอยู่" };
      }
      return { error: deleted.error.message };
    }
    const payloadError = readDeleteSkuPayloadError(deleted.data);
    if (payloadError) return { error: payloadError };

    revalidatePath(PRODUCTS_PATH);
    revalidatePath("/inventory/ledger");
    return { error: null as string | null };
  } catch (err) {
    const message = err instanceof Error ? err.message : "ลบ SKU ไม่สำเร็จ";
    return { error: message };
  }
}

/** ยอดคงเหลือของ SKU ที่กำลังกางดู — ใช้ตัดสินว่าไซส์นั้นลบได้หรือไม่ */
export async function getProductOnHandQty(productIds: string[]) {
  const owner = await requireSessionUserId();
  if (!owner.ok) return { data: {} as Record<string, number>, error: owner.error };

  const ids = [
    ...new Set(productIds.map((id) => String(id ?? "").trim()).filter(Boolean)),
  ];
  if (ids.length === 0) return { data: {} as Record<string, number>, error: null };

  try {
    const supabaseAdmin = createClient();
    const balances = await fetchOnHandQtyByProductIds(supabaseAdmin, ids);
    if (balances.error) return { data: {} as Record<string, number>, error: balances.error };
    const data: Record<string, number> = {};
    for (const [id, qty] of balances.balances) data[id] = qty;
    return { data, error: null as string | null };
  } catch (err) {
    const message = err instanceof Error ? err.message : "โหลดยอดสต็อกไม่สำเร็จ";
    return { data: {} as Record<string, number>, error: message };
  }
}

type LooseRow = Record<string, unknown>;

function bundleAdmin(): SupabaseClient {
  return createClient() as unknown as SupabaseClient;
}

function asRows(data: unknown): LooseRow[] {
  if (!Array.isArray(data)) return [];
  return data.filter((row): row is LooseRow => Boolean(row) && typeof row === "object");
}

function readText(row: LooseRow, keys: string[], fallback = ""): string {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return fallback;
}

function readNumber(row: LooseRow, keys: string[], fallback = 0): number {
  for (const key of keys) {
    const value = Number(row[key] ?? NaN);
    if (Number.isFinite(value)) return Math.round(value * 100) / 100;
  }
  return fallback;
}

function readUpcharges(value: unknown): BundleSizeUpcharge[] {
  let parsed = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return [];
    }
  }
  if (Array.isArray(parsed)) {
    return parsed
      .map((entry) => {
        if (!entry || typeof entry !== "object") return null;
        const record = entry as LooseRow;
        const size = readText(record, ["size_code", "size", "label"]);
        const amount = readNumber(record, ["amount", "upcharge", "price"]);
        if (!size) return null;
        return { size_code: size.toUpperCase(), amount };
      })
      .filter((entry): entry is BundleSizeUpcharge => entry != null);
  }
  if (parsed && typeof parsed === "object") {
    return Object.entries(parsed as LooseRow)
      .map(([size, amount]) => ({
        size_code: size.trim().toUpperCase(),
        amount: Number(amount ?? 0),
      }))
      .filter((entry) => entry.size_code && Number.isFinite(entry.amount));
  }
  return [];
}

function upchargePayload(rules: BundleSizeUpcharge[]): Record<string, number> {
  const payload: Record<string, number> = {};
  for (const rule of rules) {
    const size = rule.size_code.trim().toUpperCase();
    const amount = Number(rule.amount);
    if (!size || !Number.isFinite(amount)) continue;
    payload[size] = Math.round(amount * 100) / 100;
  }
  return payload;
}

function slotKitId(row: LooseRow): string {
  return readText(row, ["kit_id", "bundle_kit_id", "mst_bundle_kit_id"]);
}

function modelSlotId(row: LooseRow): string {
  return readText(row, ["slot_id", "bundle_slot_id", "mst_bundle_slot_id"]);
}

async function loadBundleKitRows(): Promise<{ kits: BundleKit[]; error: string | null }> {
  const admin = bundleAdmin();
  const [kitResult, slotResult, modelResult] = await Promise.all([
    admin.from("mst_bundle_kits").select("*").order("kit_code", { ascending: true }),
    admin.from("mst_bundle_slots").select("*"),
    admin.from("mst_bundle_slot_models").select("*"),
  ]);
  if (kitResult.error) return { kits: [], error: kitResult.error.message };
  if (slotResult.error) return { kits: [], error: slotResult.error.message };
  if (modelResult.error) return { kits: [], error: modelResult.error.message };

  const slotRows = asRows(slotResult.data);
  const modelRows = asRows(modelResult.data);
  const modelIds = [
    ...new Set(modelRows.map((row) => readText(row, ["model_id", "product_model_id"])).filter(Boolean)),
  ];
  const modelMeta = new Map<string, { model_code: string; name: string }>();
  if (modelIds.length > 0) {
    const models = await admin
      .from("product_models")
      .select("id, model_code, name")
      .in("id", modelIds);
    if (models.error) return { kits: [], error: models.error.message };
    for (const row of asRows(models.data)) {
      const id = readText(row, ["id"]);
      if (!id) continue;
      modelMeta.set(id, {
        model_code: readText(row, ["model_code"]),
        name: readText(row, ["name"]),
      });
    }
  }

  const modelsBySlot = new Map<string, BundleSlotModel[]>();
  for (const row of modelRows) {
    const slotId = modelSlotId(row);
    const modelId = readText(row, ["model_id", "product_model_id"]);
    if (!slotId || !modelId) continue;
    const meta = modelMeta.get(modelId);
    const list = modelsBySlot.get(slotId) ?? [];
    list.push({
      id: readText(row, ["id"]) || modelId,
      model_id: modelId,
      model_code: meta?.model_code || readText(row, ["model_code"]),
      model_name: meta?.name || readText(row, ["model_name"]),
      model_price_delta: readNumber(row, ["model_price_delta", "price_delta"]),
    });
    modelsBySlot.set(slotId, list);
  }

  const slotsByKit = new Map<string, BundleSlot[]>();
  for (const row of slotRows) {
    const kitId = slotKitId(row);
    const slotId = readText(row, ["id"]);
    if (!kitId || !slotId) continue;
    const list = slotsByKit.get(kitId) ?? [];
    list.push({
      id: slotId,
      slot_no: Number(readText(row, ["slot_no", "slot_index", "sort_order"], "0")) || list.length + 1,
      slot_name: readText(row, ["slot_name", "name"], `ช่อง ${list.length + 1}`),
      size_upcharge_rules: readUpcharges(row.size_upcharge_rules ?? row.upcharge_rules),
      models: modelsBySlot.get(slotId) ?? [],
    });
    slotsByKit.set(kitId, list);
  }

  const kits = asRows(kitResult.data)
    .filter((row) => row.is_active !== false)
    .map((row) => {
      const id = readText(row, ["id"]);
      const slots = (slotsByKit.get(id) ?? []).sort((a, b) => a.slot_no - b.slot_no);
      return {
        id,
        kit_code: readText(row, ["kit_code", "code"]),
        kit_name: readText(row, ["kit_name", "name"]),
        short_name: readText(row, ["short_name"]),
        base_price: readNumber(row, ["base_price", "price"]),
        is_active: row.is_active !== false,
        slots,
      };
    })
    .filter((kit) => kit.id && kit.kit_code);

  return { kits, error: null };
}

/** ชุดเซ็ตที่เปิดใช้ พร้อมช่องและรุ่นที่ผูก */
export async function listBundleKits(): Promise<{ data: BundleKit[]; error: string | null }> {
  try {
    const owner = await requireSessionUserId();
    if (!owner.ok) return { data: [], error: owner.error };
    const loaded = await loadBundleKitRows();
    return { data: loaded.kits, error: loaded.error };
  } catch (err) {
    const message = err instanceof Error ? err.message : "โหลดชุดเซ็ตไม่สำเร็จ";
    return { data: [], error: message };
  }
}

/** ค้นหารหัสหรือชื่อชุดเซ็ตสำหรับช่องค้นหาลงบิล */
export async function searchBundleKits(
  keyword: string,
): Promise<{ data: BundleKitSearchHit[]; error: string | null }> {
  try {
    const trimmed = keyword.trim().toLowerCase();
    if (!trimmed) return { data: [], error: null };
    const loaded = await loadBundleKitRows();
    if (loaded.error) return { data: [], error: loaded.error };
    const data = loaded.kits
      .filter((kit) => {
        const haystack = `${kit.kit_code} ${kit.kit_name} ${kit.short_name}`.toLowerCase();
        return haystack.includes(trimmed);
      })
      .slice(0, 8)
      .map((kit) => ({
        id: kit.id,
        kit_code: kit.kit_code,
        kit_name: kit.kit_name,
        short_name: kit.short_name,
        base_price: kit.base_price,
      }));
    return { data, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : "ค้นหาชุดเซ็ตไม่สำเร็จ";
    return { data: [], error: message };
  }
}

/** โหลดชุดเดียวพร้อม Matrix ที่หน้าจับคู่ต้องใช้ */
export async function getBundleKitById(
  kitId: string,
): Promise<{ data: BundleKit | null; error: string | null }> {
  try {
    const id = kitId.trim();
    if (!id) return { data: null, error: "ไม่พบรหัสชุดเซ็ต" };
    const loaded = await loadBundleKitRows();
    if (loaded.error) return { data: null, error: loaded.error };
    return { data: loaded.kits.find((kit) => kit.id === id) ?? null, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : "โหลดชุดเซ็ตไม่สำเร็จ";
    return { data: null, error: message };
  }
}

function revalidateBundleSurfaces() {
  revalidatePath(PRODUCTS_PATH);
  revalidatePath("/sales/create");
  revalidatePath("/sales");
  revalidatePath("/sales", "layout");
}

/** สร้างหรือแก้ชุดเซ็ต แล้วเขียนช่องกับรุ่นที่ผูกใหม่ทั้งชุด */
export async function saveBundleKit(
  input: SaveBundleKitInput,
): Promise<{ data: { id: string } | null; error: string | null }> {
  try {
    const owner = await requireSessionUserId();
    if (!owner.ok) return { data: null, error: owner.error };

    const kitCode = input.kit_code.trim().toUpperCase();
    const kitName = input.kit_name.trim();
    const shortName = input.short_name.trim();
    const basePrice = Number(input.base_price);
    if (!kitCode) return { data: null, error: "กรุณาระบุรหัสชุดเซ็ต" };
    if (!kitName) return { data: null, error: "กรุณาระบุชื่อชุดเซ็ต" };
    if (!Number.isFinite(basePrice) || basePrice < 0) {
      return { data: null, error: "ราคาฐานของชุดไม่ถูกต้อง" };
    }
    const slots = (input.slots ?? []).map((slot, index) => ({
      slot_name: slot.slot_name.trim() || `ช่อง ${index + 1}`,
      size_upcharge_rules: slot.size_upcharge_rules ?? [],
      models: (slot.models ?? []).filter((model) => model.model_id.trim()),
    }));
    if (slots.length < 2) return { data: null, error: "ชุดเซ็ตต้องมีอย่างน้อย 2 ช่องส่วนประกอบ" };
    if (slots.some((slot) => slot.models.length === 0)) {
      return { data: null, error: "ทุกช่องต้องผูกอย่างน้อย 1 รุ่นสินค้า" };
    }

    const admin = bundleAdmin();
    const kitId = input.id?.trim() || crypto.randomUUID();
    const now = new Date().toISOString();
    const kitPayload: Record<string, unknown> = {
      id: kitId,
      kit_code: kitCode,
      kit_name: kitName,
      short_name: shortName || kitName,
      base_price: Math.round(basePrice * 100) / 100,
      is_active: true,
      updated_at: now,
      created_at: input.id?.trim() ? undefined : now,
    };
    async function writeRow(
      table: string,
      payload: Record<string, unknown>,
      mode: "insert" | "update",
    ) {
      let current = Object.fromEntries(
        Object.entries(payload).filter(([, value]) => value !== undefined),
      );
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const result =
          mode === "update"
            ? await admin.from(table).update(current).eq("id", String(current.id ?? kitId))
            : await admin.from(table).insert(current);
        if (!result.error) return null;
        const missing = /Could not find the '([^']+)' column/i.exec(result.error.message);
        if (!missing || !(missing[1] in current) || missing[1] === "id") {
          return result.error.message;
        }
        delete current[missing[1]];
        current = { ...current };
      }
      return "บันทึกชุดเซ็ตไม่สำเร็จ";
    }
    const savedError = await writeRow(
      "mst_bundle_kits",
      kitPayload,
      input.id?.trim() ? "update" : "insert",
    );
    if (savedError) return { data: null, error: savedError };

    const existingSlots = await admin.from("mst_bundle_slots").select("*").eq("kit_id", kitId);
    const slotRows = existingSlots.error ? [] : asRows(existingSlots.data);
    const kitColumn = existingSlots.error ? "bundle_kit_id" : "kit_id";
    const slotsForKit = existingSlots.error
      ? asRows((await admin.from("mst_bundle_slots").select("*").eq("bundle_kit_id", kitId)).data)
      : slotRows;
    const slotIds = slotsForKit.map((row) => readText(row, ["id"])).filter(Boolean);
    if (slotIds.length > 0) {
      await admin.from("mst_bundle_slot_models").delete().in("slot_id", slotIds);
      await admin.from("mst_bundle_slots").delete().in("id", slotIds);
    }

    for (const [index, slot] of slots.entries()) {
      const slotId = crypto.randomUUID();
      const slotError = await writeRow(
        "mst_bundle_slots",
        {
          id: slotId,
          [kitColumn]: kitId,
          slot_no: index + 1,
          sort_order: index + 1,
          slot_name: slot.slot_name,
          size_upcharge_rules: upchargePayload(slot.size_upcharge_rules),
          created_at: now,
        },
        "insert",
      );
      if (slotError) return { data: null, error: slotError };
      for (const [modelIndex, model] of slot.models.entries()) {
        const modelError = await writeRow(
          "mst_bundle_slot_models",
          {
            id: crypto.randomUUID(),
            slot_id: slotId,
            model_id: model.model_id,
            model_price_delta: Number(model.model_price_delta) || 0,
            sort_order: modelIndex + 1,
            created_at: now,
          },
          "insert",
        );
        if (modelError) return { data: null, error: modelError };
      }
    }

    revalidateBundleSurfaces();
    return { data: { id: kitId }, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : "บันทึกชุดเซ็ตไม่สำเร็จ";
    return { data: null, error: message };
  }
}
