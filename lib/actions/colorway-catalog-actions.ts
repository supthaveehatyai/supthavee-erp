"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server-admin";
import { requireSessionUserId } from "@/lib/auth/current-user";
import type {
  CatalogCategoryOption,
  CatalogFilterMetadata,
  ColorFamilyOption,
  ColorwayCatalogItem,
  ColorwayCatalogQuery,
  ColorwayCropperStateResult,
  ColorwayDeleteResult,
  ColorwayMutationResult,
  ColorwaySizeBreakdown,
  ModelColorCropperItem,
  ModelColorCropperModel,
  ModelColorCropperState,
  SearchColorwayCatalogResult,
} from "@/types/colorway-catalog";

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
    display_image_url: textOrNull(row.display_image_url),
    colorway_image_url: textOrNull(row.colorway_image_url),
    model_poster_url: textOrNull(row.model_poster_url),
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
  const model: ModelColorCropperModel = {
    model_id: textOrNull(modelRow.model_id) ?? "",
    model_code: textOrNull(modelRow.model_code) ?? "",
    name: textOrNull(modelRow.name) ?? "",
    short_name: textOrNull(modelRow.short_name),
    poster_image_url: textOrNull(modelRow.poster_image_url),
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

export async function uploadModelMasterPosterAction(
  formData: FormData,
): Promise<ColorwayMutationResult> {
  const owner = await requireSessionUserId();
  if (!owner.ok) return { ok: false, error: owner.error };

  const modelId = String(formData.get("modelId") ?? "").trim();
  if (!UUID_RE.test(modelId)) {
    return { ok: false, error: "รหัสรุ่นสินค้าไม่ถูกต้อง" };
  }

  const image = readImageFile(formData);
  if ("error" in image) return { ok: false, error: image.error };

  const modelCode = asciiToken(formData.get("modelCode"), "MODEL");
  const mime = (image.file.type || "").toLowerCase();
  const ext = imageExtension(mime);
  const storagePath = `models/${modelCode}/${crypto.randomUUID()}.${ext}`;

  const supabase = createClient();
  const buffer = Buffer.from(await image.file.arrayBuffer());
  const { error: uploadError } = await supabase.storage
    .from(PRODUCT_ASSETS_BUCKET)
    .upload(storagePath, buffer, {
      contentType: mime === "image/jpg" ? "image/jpeg" : mime,
      upsert: false,
    });
  if (uploadError) {
    return { ok: false, error: uploadError.message || "อัปโหลดโปสเตอร์ไม่สำเร็จ" };
  }

  const imageUrl =
    supabase.storage.from(PRODUCT_ASSETS_BUCKET).getPublicUrl(storagePath).data
      .publicUrl?.split("?")[0] ?? "";
  if (!imageUrl) {
    await removeAssetBestEffort(storagePath);
    return { ok: false, error: "อัปโหลดสำเร็จ แต่สร้างลิงก์โปสเตอร์ไม่ได้" };
  }

  const { error: updateError } = await supabase
    .from("product_models")
    .update({ image_url: imageUrl })
    .eq("id", modelId);
  if (updateError) {
    await removeAssetBestEffort(storagePath);
    return { ok: false, error: updateError.message };
  }

  revalidateCatalog();
  return { ok: true, imageUrl, storagePath };
}
