"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server-admin";
import { requireSessionUserId } from "@/lib/auth/current-user";
import {
  isVercelDeploymentHashUrl,
  recommendedProductionWebhookUrl,
} from "@/lib/line/line-target";
import type {
  CatalogCategoryOption,
  CatalogFilterMetadata,
  ColorFamilyOption,
  ColorwayCatalogItem,
  ColorwayCatalogQuery,
  ColorwayCropperStateResult,
  ColorwayDeleteResult,
  CatalogMetaResult,
  ColorwayMutationResult,
  ColorwaySizeBreakdown,
  ModelColorCropperItem,
  ModelColorCropperModel,
  ModelColorCropperState,
  ModelSlotResult,
  ModelVisualSlot,
  SearchColorwayCatalogResult,
} from "@/types/colorway-catalog";
import type {
  LineSalesBotDiagnostics,
  LineWebhookEventLogRow,
} from "@/types/line-sales-bot";

const PRODUCT_ASSETS_BUCKET = "product_assets";
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const CATALOG_ROW_LIMIT = 240;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALLOWED_IMAGE_MIME = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);

type LooseAdmin = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (
        column: string,
        value: boolean,
      ) => Promise<{ data: unknown[] | null; error: { message: string } | null }>;
    };
  };
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
};

function looseAdmin(): LooseAdmin {
  return createClient() as unknown as LooseAdmin;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function textOrNull(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
}

function toNumber(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function toNullableNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function asciiToken(value: unknown, fallback: string): string {
  const token = String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9._-]+/g, "")
    .slice(0, 32);
  return token || fallback;
}

function imageExtension(mime: string): "jpg" | "png" | "webp" {
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  return "jpg";
}

function readSizes(value: unknown): ColorwaySizeBreakdown[] {
  let raw = value;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw) as unknown;
    } catch {
      return [];
    }
  }
  if (!Array.isArray(raw)) return [];
  const sizes: ColorwaySizeBreakdown[] = [];
  for (const entry of raw) {
    const row = asRecord(entry);
    if (!row) continue;
    const size = textOrNull(row.size);
    if (!size) continue;
    sizes.push({
      sku: textOrNull(row.sku) ?? "",
      size,
      product_id: textOrNull(row.product_id) ?? "",
      on_hand_qty: toNumber(row.on_hand_qty),
      retail_price: toNumber(row.retail_price),
      wholesale_price: toNumber(row.wholesale_price),
    });
  }
  return sizes;
}

function mapCatalogItem(value: unknown): ColorwayCatalogItem | null {
  const row = asRecord(value);
  if (!row) return null;
  const modelId = textOrNull(row.model_id);
  const colorId = textOrNull(row.color_id);
  if (!modelId || !colorId) return null;
  return {
    model_id: modelId,
    model_code: textOrNull(row.model_code) ?? "",
    model_name: textOrNull(row.model_name) ?? "",
    model_short_name: textOrNull(row.model_short_name),
    brand_code: textOrNull(row.brand_code),
    brand_name: textOrNull(row.brand_name),
    category_id: textOrNull(row.category_id),
    category_code: textOrNull(row.category_code),
    category_name: textOrNull(row.category_name),
    gender: textOrNull(row.gender),
    color_id: colorId,
    color_code: textOrNull(row.color_code) ?? "",
    color_name: textOrNull(row.color_name) ?? "",
    color_family: textOrNull(row.color_family),
    color_family_th: textOrNull(row.color_family_th),
    hex_code: textOrNull(row.hex_code),
    catalog_name: textOrNull(row.catalog_name),
    display_image_url: textOrNull(row.display_image_url),
    colorway_image_url: textOrNull(row.colorway_image_url),
    model_poster_url: textOrNull(row.model_poster_url),
    model_main_image_url:
      textOrNull(row.model_main_image_url) ?? textOrNull(row.model_poster_url),
    catalog_image_url: textOrNull(row.catalog_image_url),
    size_chart_image_url: textOrNull(row.size_chart_image_url),
    has_colorway_image: row.has_colorway_image === true,
    total_on_hand_qty: toNumber(row.total_on_hand_qty),
    in_stock_size_count: Math.trunc(toNumber(row.in_stock_size_count)),
    min_retail_price: toNullableNumber(row.min_retail_price),
    max_retail_price: toNullableNumber(row.max_retail_price),
    min_wholesale_price: toNullableNumber(row.min_wholesale_price),
    max_wholesale_price: toNullableNumber(row.max_wholesale_price),
    sizes_breakdown: readSizes(row.sizes_breakdown),
  };
}

function mapCropperColor(value: unknown): ModelColorCropperItem | null {
  const row = asRecord(value);
  if (!row) return null;
  const colorId = textOrNull(row.color_id);
  if (!colorId) return null;
  const meta = asRecord(row.crop_meta);
  return {
    color_id: colorId,
    color_code: textOrNull(row.color_code) ?? "",
    color_name: textOrNull(row.color_name) ?? "",
    color_family: textOrNull(row.color_family),
    color_family_th: textOrNull(row.color_family_th),
    hex_code: textOrNull(row.hex_code),
    sku_count: Math.trunc(toNumber(row.sku_count)),
    colorway_image_url: textOrNull(row.colorway_image_url),
    storage_path: textOrNull(row.storage_path),
    crop_meta: meta,
  };
}

function mapCropperState(value: unknown): ModelColorCropperState | null {
  const row = asRecord(value);
  if (!row) return null;
  const modelRow = asRecord(row.model);
  if (!modelRow) return null;
  const mainImage =
    textOrNull(modelRow.main_image_url) ?? textOrNull(modelRow.poster_image_url);
  const model: ModelColorCropperModel = {
    model_id: textOrNull(modelRow.model_id) ?? "",
    model_code: textOrNull(modelRow.model_code) ?? "",
    name: textOrNull(modelRow.name) ?? "",
    short_name: textOrNull(modelRow.short_name),
    catalog_name: textOrNull(modelRow.catalog_name),
    poster_image_url: mainImage,
    main_image_url: mainImage,
    catalog_image_url: textOrNull(modelRow.catalog_image_url),
    size_chart_image_url: textOrNull(modelRow.size_chart_image_url),
  };
  const colors = Array.isArray(row.colors)
    ? row.colors.flatMap((entry) => {
        const color = mapCropperColor(entry);
        return color ? [color] : [];
      })
    : [];
  return {
    ok: row.ok !== false,
    model,
    colors,
    error: textOrNull(row.error) ?? undefined,
  };
}

function rpcFailure(data: unknown): string | null {
  const row = asRecord(data);
  if (!row || row.ok !== false) return null;
  return textOrNull(row.error) ?? textOrNull(row.message) ?? "บันทึกรูปสีไม่สำเร็จ";
}

function revalidateCatalog() {
  revalidatePath("/sales/catalog");
  revalidatePath("/products");
}

async function removeAssetBestEffort(storagePath: string | null | undefined) {
  const path = String(storagePath ?? "")
    .trim()
    .replace(/^\/+/, "");
  if (!path || path.includes("..")) return;
  try {
    const supabase = createClient();
    await supabase.storage.from(PRODUCT_ASSETS_BUCKET).remove([path]);
  } catch {
    // Replacing the catalog row already succeeded. A leftover object is cleaned later.
  }
}

const VISUAL_SLOT_PREFIX: Record<ModelVisualSlot, string> = {
  MAIN: "main",
  CATALOG: "catalog",
  SIZE_CHART: "sizechart",
};

type PathProbe = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (
        column: string,
        value: string,
      ) => {
        limit: (
          count: number,
        ) => Promise<{ data: unknown[] | null; error: { message: string } | null }>;
      };
      ilike: (
        column: string,
        pattern: string,
      ) => {
        limit: (
          count: number,
        ) => Promise<{ data: unknown[] | null; error: { message: string } | null }>;
      };
    };
  };
};

function parseVisualSlot(value: unknown): ModelVisualSlot | null {
  const slot = String(value ?? "").trim().toUpperCase();
  if (slot === "MAIN" || slot === "CATALOG" || slot === "SIZE_CHART") return slot;
  return null;
}

async function probeHasRows(
  run: Promise<{ data: unknown[] | null; error: { message: string } | null }>,
): Promise<boolean> {
  const { data, error } = await run;
  if (error) return true;
  return (data?.length ?? 0) > 0;
}

async function storagePathStillReferenced(storagePath: string): Promise<boolean> {
  const path = storagePath.trim().replace(/^\/+/, "");
  if (!path) return true;
  const probe = createClient() as unknown as PathProbe;
  const like = `%/${path}`;
  const models = () => probe.from("product_models").select("id");
  const colors = () => probe.from("product_model_color_images").select("id");
  const checks = await Promise.all([
    probeHasRows(models().eq("catalog_storage_path", path).limit(1)),
    probeHasRows(models().eq("size_chart_storage_path", path).limit(1)),
    probeHasRows(models().ilike("image_url", like).limit(1)),
    probeHasRows(models().ilike("catalog_image_url", like).limit(1)),
    probeHasRows(models().ilike("size_chart_image_url", like).limit(1)),
    probeHasRows(colors().eq("storage_path", path).limit(1)),
    probeHasRows(colors().ilike("image_url", like).limit(1)),
  ]);
  return checks.some(Boolean);
}

async function removeUnreferencedSlotPath(
  oldPath: string | null,
  nextPath: string | null,
) {
  const previous = String(oldPath ?? "").trim().replace(/^\/+/, "");
  const current = String(nextPath ?? "").trim().replace(/^\/+/, "");
  if (!previous || previous === current || previous.includes("..")) return;
  if (await storagePathStillReferenced(previous)) return;
  await removeAssetBestEffort(previous);
}

async function applyVisualSlot(input: {
  modelId: string;
  slot: ModelVisualSlot;
  imageUrl: string | null;
  storagePath: string | null;
}): Promise<{ ok: true; oldPath: string | null } | { ok: false; error: string }> {
  const { data, error } = await looseAdmin().rpc("set_product_model_visual_slot", {
    p_model_id: input.modelId,
    p_slot: input.slot,
    p_image_url: input.imageUrl,
    p_storage_path: input.storagePath,
  });
  if (error) return { ok: false, error: error.message };
  const failure = rpcFailure(data);
  if (failure) return { ok: false, error: failure };
  return { ok: true, oldPath: textOrNull(asRecord(data)?.old_storage_path) };
}

function readImageFile(formData: FormData): { file: File } | { error: string } {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size <= 0) {
    return { error: "ไม่พบไฟล์รูปสำหรับอัปโหลด" };
  }
  const mime = (file.type || "").toLowerCase();
  if (!ALLOWED_IMAGE_MIME.has(mime)) {
    return { error: "ใช้ไฟล์ JPG, PNG หรือ WebP เท่านั้น" };
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return { error: "ไฟล์ใหญ่เกิน 5MB" };
  }
  return { file };
}

function parseCropMeta(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "string" || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return asRecord(parsed) ?? {};
  } catch {
    return {};
  }
}

export async function searchColorwayCatalogAction(
  params: ColorwayCatalogQuery,
): Promise<SearchColorwayCatalogResult> {
  const owner = await requireSessionUserId();
  if (!owner.ok) return { items: [], truncated: false, error: owner.error };

  const q = String(params.q ?? "").trim();
  const family = String(params.family ?? "").trim();
  const categoryId = String(params.categoryId ?? "").trim();
  if (categoryId && !UUID_RE.test(categoryId)) {
    return { items: [], truncated: false, error: "หมวดหมู่ไม่ถูกต้อง" };
  }

  try {
    const { data, error } = await looseAdmin().rpc("search_colorway_sales_catalog", {
      p_search_text: q || null,
      p_color_family: family || null,
      p_category_id: categoryId || null,
      p_in_stock_only: params.inStockOnly === true,
      p_limit: CATALOG_ROW_LIMIT,
    });
    if (error) return { items: [], truncated: false, error: error.message };

    const rows = Array.isArray(data) ? data : [];
    const items = rows.flatMap((row) => {
      const item = mapCatalogItem(row);
      return item ? [item] : [];
    });
    return {
      items,
      truncated: items.length >= CATALOG_ROW_LIMIT,
      error: null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "โหลดแคตตาล็อกไม่สำเร็จ";
    return { items: [], truncated: false, error: message };
  }
}

export async function getCatalogFilterMetadataAction(): Promise<CatalogFilterMetadata> {
  const owner = await requireSessionUserId();
  if (!owner.ok) return { categories: [], families: [], error: owner.error };

  try {
    const supabase = createClient();
    const [categoriesResult, colorsResult] = await Promise.all([
      supabase
        .from("mst_categories")
        .select("id, category_code, category_name")
        .eq("is_active", true)
        .order("category_code"),
      looseAdmin()
        .from("mst_colors")
        .select("color_family, color_family_th, hex_code, is_active")
        .eq("is_active", true),
    ]);

    if (categoriesResult.error) {
      return { categories: [], families: [], error: categoriesResult.error.message };
    }
    if (colorsResult.error) {
      return { categories: [], families: [], error: colorsResult.error.message };
    }

    const categories: CatalogCategoryOption[] = (categoriesResult.data ?? []).map(
      (row) => ({
        id: row.id,
        category_code: row.category_code,
        category_name: row.category_name,
      }),
    );

    const families = new Map<string, ColorFamilyOption>();
    for (const entry of colorsResult.data ?? []) {
      const row = asRecord(entry);
      if (!row) continue;
      const code = textOrNull(row.color_family);
      const label = textOrNull(row.color_family_th);
      if (!code || !label) continue;
      if (!families.has(code)) {
        families.set(code, {
          color_family: code,
          color_family_th: label,
          hex_code: textOrNull(row.hex_code),
        });
      }
    }

    return {
      categories,
      families: [...families.values()],
      error: null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "โหลดตัวกรองแคตตาล็อกไม่สำเร็จ";
    return { categories: [], families: [], error: message };
  }
}

export async function getModelCropperStateAction(
  modelId: string,
): Promise<ColorwayCropperStateResult> {
  const owner = await requireSessionUserId();
  if (!owner.ok) return { state: null, error: owner.error };

  const id = String(modelId ?? "").trim();
  if (!UUID_RE.test(id)) return { state: null, error: "รหัสรุ่นสินค้าไม่ถูกต้อง" };

  try {
    const { data, error } = await looseAdmin().rpc("get_model_colorway_cropper_state", {
      p_model_id: id,
    });
    if (error) return { state: null, error: error.message };
    const state = mapCropperState(data);
    if (!state?.model.model_id) {
      return { state: null, error: "ไม่พบข้อมูลรุ่นสำหรับตัดรูป" };
    }
    if (state.ok === false) {
      return { state: null, error: state.error ?? "โหลดสีของรุ่นนี้ไม่สำเร็จ" };
    }
    return { state, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : "โหลดสีของรุ่นนี้ไม่สำเร็จ";
    return { state: null, error: message };
  }
}

export async function uploadColorwayCroppedImageAction(
  formData: FormData,
): Promise<ColorwayMutationResult> {
  const owner = await requireSessionUserId();
  if (!owner.ok) return { ok: false, error: owner.error };

  const modelId = String(formData.get("modelId") ?? "").trim();
  const colorId = String(formData.get("colorId") ?? "").trim();
  if (!UUID_RE.test(modelId) || !UUID_RE.test(colorId)) {
    return { ok: false, error: "รหัสรุ่นหรือสีไม่ถูกต้อง" };
  }

  const image = readImageFile(formData);
  if ("error" in image) return { ok: false, error: image.error };

  const modelCode = asciiToken(formData.get("modelCode"), "MODEL");
  const colorCode = asciiToken(formData.get("colorCode"), "COLOR");
  const mime = (image.file.type || "").toLowerCase();
  const ext = imageExtension(mime);
  const storagePath = `colorways/${modelCode}/${colorCode}_${crypto.randomUUID()}.${ext}`;
  const sourcePosterUrl = textOrNull(formData.get("sourcePosterUrl"));
  const cropMeta = parseCropMeta(formData.get("cropMeta"));

  const supabase = createClient();
  const buffer = Buffer.from(await image.file.arrayBuffer());
  const { error: uploadError } = await supabase.storage
    .from(PRODUCT_ASSETS_BUCKET)
    .upload(storagePath, buffer, {
      contentType: mime === "image/jpg" ? "image/jpeg" : mime,
      upsert: false,
    });
  if (uploadError) {
    return { ok: false, error: uploadError.message || "อัปโหลดรูปสีไม่สำเร็จ" };
  }

  const imageUrl =
    supabase.storage.from(PRODUCT_ASSETS_BUCKET).getPublicUrl(storagePath).data
      .publicUrl?.split("?")[0] ?? "";
  if (!imageUrl) {
    await removeAssetBestEffort(storagePath);
    return { ok: false, error: "อัปโหลดสำเร็จ แต่สร้างลิงก์รูปไม่ได้" };
  }

  try {
    const { data, error } = await looseAdmin().rpc("upsert_product_model_color_image", {
      p_model_id: modelId,
      p_color_id: colorId,
      p_image_url: imageUrl,
      p_storage_path: storagePath,
      p_source_poster_url: sourcePosterUrl,
      p_crop_meta: cropMeta,
      p_actor_id: owner.userId,
    });
    if (error) {
      await removeAssetBestEffort(storagePath);
      return { ok: false, error: error.message };
    }
    const failure = rpcFailure(data);
    if (failure) {
      await removeAssetBestEffort(storagePath);
      return { ok: false, error: failure };
    }

    const oldPath = textOrNull(asRecord(data)?.old_storage_path);
    if (oldPath && oldPath !== storagePath) {
      await removeAssetBestEffort(oldPath);
    }
    revalidateCatalog();
    return { ok: true, imageUrl, storagePath };
  } catch (err) {
    await removeAssetBestEffort(storagePath);
    const message = err instanceof Error ? err.message : "บันทึกรูปสีไม่สำเร็จ";
    return { ok: false, error: message };
  }
}

export async function deleteColorwayImageAction(
  modelId: string,
  colorId: string,
): Promise<ColorwayDeleteResult> {
  const owner = await requireSessionUserId();
  if (!owner.ok) return { ok: false, error: owner.error };

  const model = String(modelId ?? "").trim();
  const color = String(colorId ?? "").trim();
  if (!UUID_RE.test(model) || !UUID_RE.test(color)) {
    return { ok: false, error: "รหัสรุ่นหรือสีไม่ถูกต้อง" };
  }

  try {
    const { data, error } = await looseAdmin().rpc("delete_product_model_color_image", {
      p_model_id: model,
      p_color_id: color,
    });
    if (error) return { ok: false, error: error.message };
    const failure = rpcFailure(data);
    if (failure) return { ok: false, error: failure };

    await removeAssetBestEffort(textOrNull(asRecord(data)?.deleted_storage_path));
    revalidateCatalog();
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "ลบรูปสีไม่สำเร็จ";
    return { ok: false, error: message };
  }
}

export async function updateModelCatalogMetaAction(
  modelId: string,
  catalogName: string,
): Promise<CatalogMetaResult> {
  const owner = await requireSessionUserId();
  if (!owner.ok) return { ok: false, error: owner.error };

  const id = String(modelId ?? "").trim();
  if (!UUID_RE.test(id)) return { ok: false, error: "รหัสรุ่นสินค้าไม่ถูกต้อง" };

  try {
    const { data, error } = await looseAdmin().rpc("update_product_model_catalog_meta", {
      p_model_id: id,
      p_catalog_name: String(catalogName ?? ""),
    });
    if (error) return { ok: false, error: error.message };
    const failure = rpcFailure(data);
    if (failure) return { ok: false, error: failure };
    revalidateCatalog();
    return { ok: true, catalogName: textOrNull(asRecord(data)?.catalog_name) };
  } catch (err) {
    const message = err instanceof Error ? err.message : "บันทึกชื่อ Catalog ไม่สำเร็จ";
    return { ok: false, error: message };
  }
}

export async function uploadModelVisualSlotAction(
  formData: FormData,
): Promise<ColorwayMutationResult> {
  const owner = await requireSessionUserId();
  if (!owner.ok) return { ok: false, error: owner.error };

  const modelId = String(formData.get("modelId") ?? "").trim();
  const slot = parseVisualSlot(formData.get("slot"));
  if (!UUID_RE.test(modelId)) return { ok: false, error: "รหัสรุ่นสินค้าไม่ถูกต้อง" };
  if (!slot) return { ok: false, error: "ประเภทช่องรูปไม่ถูกต้อง" };

  const image = readImageFile(formData);
  if ("error" in image) return { ok: false, error: image.error };

  const modelCode = asciiToken(formData.get("modelCode"), "MODEL");
  const mime = (image.file.type || "").toLowerCase();
  const ext = imageExtension(mime);
  const storagePath = `models/${modelCode}/${VISUAL_SLOT_PREFIX[slot]}_${crypto.randomUUID()}.${ext}`;

  const supabase = createClient();
  const buffer = Buffer.from(await image.file.arrayBuffer());
  const { error: uploadError } = await supabase.storage
    .from(PRODUCT_ASSETS_BUCKET)
    .upload(storagePath, buffer, {
      contentType: mime === "image/jpg" ? "image/jpeg" : mime,
      upsert: false,
    });
  if (uploadError) {
    return { ok: false, error: uploadError.message || "อัปโหลดรูปไม่สำเร็จ" };
  }

  const imageUrl =
    supabase.storage.from(PRODUCT_ASSETS_BUCKET).getPublicUrl(storagePath).data
      .publicUrl?.split("?")[0] ?? "";
  if (!imageUrl) {
    await removeAssetBestEffort(storagePath);
    return { ok: false, error: "อัปโหลดสำเร็จ แต่สร้างลิงก์รูปไม่ได้" };
  }

  try {
    const applied = await applyVisualSlot({
      modelId,
      slot,
      imageUrl,
      storagePath,
    });
    if (!applied.ok) {
      await removeAssetBestEffort(storagePath);
      return { ok: false, error: applied.error };
    }
    await removeUnreferencedSlotPath(applied.oldPath, storagePath);
    revalidateCatalog();
    return { ok: true, imageUrl, storagePath };
  } catch (err) {
    await removeAssetBestEffort(storagePath);
    const message = err instanceof Error ? err.message : "บันทึกรูปไม่สำเร็จ";
    return { ok: false, error: message };
  }
}

export async function clearModelVisualSlotAction(
  modelId: string,
  slot: ModelVisualSlot,
): Promise<ModelSlotResult> {
  const owner = await requireSessionUserId();
  if (!owner.ok) return { ok: false, error: owner.error };

  const id = String(modelId ?? "").trim();
  const parsed = parseVisualSlot(slot);
  if (!UUID_RE.test(id)) return { ok: false, error: "รหัสรุ่นสินค้าไม่ถูกต้อง" };
  if (!parsed) return { ok: false, error: "ประเภทช่องรูปไม่ถูกต้อง" };

  try {
    const applied = await applyVisualSlot({
      modelId: id,
      slot: parsed,
      imageUrl: null,
      storagePath: null,
    });
    if (!applied.ok) return { ok: false, error: applied.error };
    await removeUnreferencedSlotPath(applied.oldPath, null);
    revalidateCatalog();
    return { ok: true, imageUrl: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : "ลบรูปไม่สำเร็จ";
    return { ok: false, error: message };
  }
}

export async function copyMainImageToCatalogSlotAction(
  modelId: string,
  mainImageUrl: string,
): Promise<ModelSlotResult> {
  const owner = await requireSessionUserId();
  if (!owner.ok) return { ok: false, error: owner.error };

  const id = String(modelId ?? "").trim();
  const imageUrl = String(mainImageUrl ?? "").trim();
  if (!UUID_RE.test(id)) return { ok: false, error: "รหัสรุ่นสินค้าไม่ถูกต้อง" };
  if (!imageUrl) return { ok: false, error: "ยังไม่มีรูปหลักของรุ่นให้ดึงมาใช้" };

  try {
    const applied = await applyVisualSlot({
      modelId: id,
      slot: "CATALOG",
      imageUrl,
      storagePath: null,
    });
    if (!applied.ok) return { ok: false, error: applied.error };
    await removeUnreferencedSlotPath(applied.oldPath, null);
    revalidateCatalog();
    return { ok: true, imageUrl };
  } catch (err) {
    const message = err instanceof Error ? err.message : "ดึงรูปหลักมาเป็นใบ Catalog ไม่สำเร็จ";
    return { ok: false, error: message };
  }
}

export async function uploadModelMasterPosterAction(
  formData: FormData,
): Promise<ColorwayMutationResult> {
  formData.set("slot", "MAIN");
  return uploadModelVisualSlotAction(formData);
}

export async function getLineSalesBotDiagnosticsAction(): Promise<LineSalesBotDiagnostics> {
  const owner = await requireSessionUserId();
  const recommended = recommendedProductionWebhookUrl();
  const empty: LineSalesBotDiagnostics = {
    line_oa_basic_id: null,
    line_webhook_url: null,
    line_webhook_last_verified_at: null,
    recommended_webhook_url: recommended,
    is_stale_deployment_url: false,
    events: [],
    error: null,
  };
  if (!owner.ok) return { ...empty, error: owner.error };

  const supabase = createClient() as unknown as {
    from: (table: string) => {
      select: (columns: string) => {
        eq: (
          column: string,
          value: number,
        ) => {
          maybeSingle: () => Promise<{
            data: Record<string, unknown> | null;
            error: { message: string } | null;
          }>;
        };
        order: (
          column: string,
          options: { ascending: boolean },
        ) => {
          limit: (count: number) => Promise<{
            data: Record<string, unknown>[] | null;
            error: { message: string } | null;
          }>;
        };
      };
    };
  };

  const [settings, events] = await Promise.all([
    supabase
      .from("system_settings")
      .select("line_oa_basic_id, line_webhook_url, line_webhook_last_verified_at")
      .eq("id", 1)
      .maybeSingle(),
    supabase
      .from("line_webhook_events_log")
      .select("id, received_at, source_type, message_text, bot_reply_status, bot_reply_error")
      .order("received_at", { ascending: false })
      .limit(8),
  ]);

  if (settings.error) return { ...empty, error: settings.error.message };
  if (events.error) return { ...empty, error: events.error.message };

  const row = settings.data;
  const webhookUrl = textOrNull(row?.line_webhook_url);
  const mapped: LineWebhookEventLogRow[] = (events.data ?? []).map((item) => ({
    id: textOrNull(item.id) ?? "",
    received_at: textOrNull(item.received_at) ?? "",
    source_type: textOrNull(item.source_type),
    message_text: textOrNull(item.message_text),
    bot_reply_status: textOrNull(item.bot_reply_status),
    bot_reply_error: textOrNull(item.bot_reply_error),
  }));

  return {
    line_oa_basic_id: textOrNull(row?.line_oa_basic_id),
    line_webhook_url: webhookUrl,
    line_webhook_last_verified_at: textOrNull(row?.line_webhook_last_verified_at),
    recommended_webhook_url: recommended,
    is_stale_deployment_url: webhookUrl ? isVercelDeploymentHashUrl(webhookUrl) : false,
    events: mapped.filter((item) => item.id),
    error: null,
  };
}
