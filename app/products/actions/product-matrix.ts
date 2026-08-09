"use server";

import { createSupabaseServerClient } from "@/lib/supabase-server";
import { revalidatePath } from "next/cache";
import {
  isValidModelCode,
  MODEL_CODE_LENGTH,
} from "@/app/products/product-sku";
import {
  parseProductModelIdentity,
  updateProductModelSchema,
  zodFirstError,
} from "@/app/products/zod-schemas";
import type { GetProductModelPreviewResult } from "@/types/product-preview";
import type {
  UpdateProductModelResult,
  UpdateProductModelSizePrice,
} from "@/types/product-matrix";

export type TaxType = "INC_VAT" | "EXC_VAT" | "NON_VAT";

export type SaveDraftModelInput = {
  vendorId: string;
  brandId: string;
  categoryId: string;
  modelCode: string;
  name: string;
  shortName?: string;
  gender: string;
  taxType: TaxType;
  /** JSON string for product_models.size_pricing_config */
  sizePricingConfig?: string;
  /** Public URL จาก Storage bucket product_assets */
  imageUrl?: string;
};

export type ExistingProductModel = {
  id: string;
  model_code: string;
  name: string;
  short_name: string | null;
  gender: string | null;
  tax_type: string | null;
  status: string | null;
  vendor_id: string | null;
  brand_id: string | null;
  category_id: string | null;
  size_pricing_config: unknown;
  image_url: string | null;
};

export type UploadProductModelImageResult = {
  ok: boolean;
  url?: string;
  path?: string;
  error?: string;
};

export type SaveDraftModelResult = {
  ok: boolean;
  modelId?: string;
  overwritten?: boolean;
  error?: string;
};

export type GenerateSkuRow = {
  sku: string;
  name: string;
  shortName: string;
  description: string;
  category: string | null;
  color: string;
  size: string;
  gender: string;
  taxType: TaxType;
  costPrice: number;
  retailPrice: number;
  wholesalePrice: number;
};

export type GenerateSkusInput = {
  /** Existing draft/parent model id from Phase 1 (optional — created if missing). */
  modelId?: string | null;
  model: SaveDraftModelInput;
  vendorId: string;
  skus: GenerateSkuRow[];
};

export type GenerateSkusResult = {
  ok: boolean;
  modelId?: string;
  inserted?: number;
  skipped?: number;
  error?: string;
};

export type LoadableProductModel = ExistingProductModel & {
  brand_code?: string | null;
  brand_name?: string | null;
  category_code?: string | null;
  category_name?: string | null;
};

function normalizeTaxType(value: string): TaxType {
  const raw = value.toUpperCase();
  if (raw.includes("EXC")) return "EXC_VAT";
  if (raw.includes("NON")) return "NON_VAT";
  return "INC_VAT";
}

function parseSizePricingConfig(raw?: string): unknown {
  try {
    return JSON.parse(raw ?? "[]");
  } catch {
    return [];
  }
}

function validateStep1(input: SaveDraftModelInput): string | null {
  const identity = parseProductModelIdentity({
    vendorId: input.vendorId,
    brandId: input.brandId,
    categoryId: input.categoryId,
    modelCode: input.modelCode,
    name: input.name,
    shortName: input.shortName,
    gender: input.gender,
    taxType: input.taxType,
    imageUrl: input.imageUrl ?? null,
  });
  if (!identity.ok) return identity.error;
  if (!isValidModelCode(identity.data.model_code)) {
    return `รหัสรุ่น (model_code) ต้องมีความยาว ${MODEL_CODE_LENGTH} ตัวอักษรพอดี`;
  }
  return null;
}

function buildDraftPayload(input: SaveDraftModelInput) {
  const modelCode = input.modelCode.trim().toUpperCase();
  const shortName =
    input.shortName?.trim() || `${input.name.trim()}`.slice(0, 100);

  return {
    vendor_id: input.vendorId,
    brand_id: input.brandId,
    category_id: input.categoryId,
    model_code: modelCode,
    name: input.name.trim(),
    short_name: shortName,
    gender: input.gender.trim(),
    tax_type: normalizeTaxType(input.taxType),
    status: "DRAFT" as const,
    size_pricing_config: parseSizePricingConfig(input.sizePricingConfig),
    image_url: input.imageUrl?.trim().split("?")[0] || null,
  };
}

const EXISTING_MODEL_SELECT =
  "id, model_code, name, short_name, gender, tax_type, status, vendor_id, brand_id, category_id, size_pricing_config, image_url";

const PRODUCT_ASSETS_BUCKET = "product_assets";
const MAX_PRODUCT_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_PRODUCT_IMAGE_MIME = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
]);

/**
 * อัปโหลดรูปสินค้าเข้า Storage `product_assets` (Service Role).
 * คืน Public URL ให้ Client เก็บใน form state `image_url`
 */
export async function uploadProductModelImage(
  formData: FormData,
): Promise<UploadProductModelImageResult> {
  try {
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return { ok: false, error: "ไม่พบไฟล์รูปสำหรับอัปโหลด" };
    }

    const mimeType = (file.type || "").toLowerCase();
    if (!ALLOWED_PRODUCT_IMAGE_MIME.has(mimeType)) {
      return {
        ok: false,
        error: `ประเภทไฟล์ไม่รองรับ (${mimeType || "unknown"}) — ใช้ JPG/PNG/WEBP/GIF`,
      };
    }

    if (file.size > MAX_PRODUCT_IMAGE_BYTES) {
      return { ok: false, error: "ไฟล์ใหญ่เกิน 5MB" };
    }

    const ext =
      mimeType === "image/png"
        ? ".png"
        : mimeType === "image/webp"
          ? ".webp"
          : mimeType === "image/gif"
            ? ".gif"
            : ".jpg";

    const rawCode = String(formData.get("modelCode") ?? "")
      .trim()
      .toUpperCase()
      .replace(/[^\w.-]+/g, "_")
      .slice(0, 32);
    const folder = rawCode || "draft";
    const objectPath = `models/${folder}/${crypto.randomUUID()}${ext}`;

    const supabase = createSupabaseServerClient();
    const buffer = Buffer.from(await file.arrayBuffer());

    const { error: uploadError } = await supabase.storage
      .from(PRODUCT_ASSETS_BUCKET)
      .upload(objectPath, buffer, {
        contentType: mimeType,
        upsert: false,
      });

    if (uploadError) {
      return {
        ok: false,
        error: uploadError.message ?? "อัปโหลดรูปสินค้าขึ้น Storage ไม่สำเร็จ",
      };
    }

    const { data: publicData } = supabase.storage
      .from(PRODUCT_ASSETS_BUCKET)
      .getPublicUrl(objectPath);

    const url = publicData?.publicUrl?.trim();
    if (!url) {
      return {
        ok: false,
        error: "อัปโหลดสำเร็จ แต่สร้าง Public URL ไม่ได้",
      };
    }

    return { ok: true, url, path: objectPath };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "อัปโหลดรูปสินค้าไม่สำเร็จ";
    return { ok: false, error: message };
  }
}

/**
 * Pre-check: find an existing product_models row by model_code.
 */
export async function findProductModelByCode(
  modelCode: string,
): Promise<{ ok: boolean; existing: ExistingProductModel | null; error?: string }> {
  const code = modelCode.trim().toUpperCase();
  if (!code) {
    return { ok: false, existing: null, error: "model_code ห้ามว่าง" };
  }

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("product_models")
    .select(EXISTING_MODEL_SELECT)
    .eq("model_code", code)
    .maybeSingle();

  if (error) {
    return {
      ok: false,
      existing: null,
      error:
        error.code === "42P01"
          ? "ยังไม่มีตาราง product_models — รัน sql/product_models.sql ก่อน"
          : error.message,
    };
  }

  return {
    ok: true,
    existing: (data as ExistingProductModel | null) ?? null,
  };
}

/**
 * Load models for Matrix combobox — DRAFT and ACTIVE only.
 */
export async function listLoadableProductModels(): Promise<{
  ok: boolean;
  models: LoadableProductModel[];
  error?: string;
}> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("product_models")
    .select(
      `
      ${EXISTING_MODEL_SELECT},
      brand:mst_brands(brand_code, brand_name),
      category:mst_categories(category_code, category_name)
    `,
    )
    .in("status", ["DRAFT", "ACTIVE"])
    .order("created_at", { ascending: false });

  if (error) {
    return {
      ok: false,
      models: [],
      error:
        error.code === "42P01"
          ? "ยังไม่มีตาราง product_models — รัน sql/product_models.sql ก่อน"
          : error.message,
    };
  }

  const models: LoadableProductModel[] = (data ?? []).map((row) => {
    const record = row as ExistingProductModel & {
      brand?:
        | { brand_code?: string; brand_name?: string }
        | { brand_code?: string; brand_name?: string }[]
        | null;
      category?:
        | { category_code?: string; category_name?: string }
        | { category_code?: string; category_name?: string }[]
        | null;
    };
    const brand = Array.isArray(record.brand) ? record.brand[0] : record.brand;
    const category = Array.isArray(record.category)
      ? record.category[0]
      : record.category;

    return {
      id: record.id,
      model_code: record.model_code,
      name: record.name,
      short_name: record.short_name,
      gender: record.gender,
      tax_type: record.tax_type,
      status: record.status,
      vendor_id: record.vendor_id,
      brand_id: record.brand_id,
      category_id: record.category_id,
      size_pricing_config: record.size_pricing_config,
      image_url: record.image_url ?? null,
      brand_code: brand?.brand_code ?? null,
      brand_name: brand?.brand_name ?? null,
      category_code: category?.category_code ?? null,
      category_name: category?.category_name ?? null,
    };
  });

  return { ok: true, models };
}

/**
 * Phase 1 Branch 1 — insert a new DRAFT model (no conflict).
 */
export async function insertDraftProductModel(
  input: SaveDraftModelInput,
): Promise<SaveDraftModelResult> {
  const validationError = validateStep1(input);
  if (validationError) {
    return { ok: false, error: validationError };
  }

  const supabase = createSupabaseServerClient();
  const payload = buildDraftPayload(input);

  const { data, error } = await supabase
    .from("product_models")
    .insert(payload)
    .select("id")
    .single();

  if (error || !data) {
    return {
      ok: false,
      error:
        error?.code === "42P01"
          ? "ยังไม่มีตาราง product_models — รัน sql/product_models.sql ก่อน"
          : error?.code === "23505"
            ? "มีโมเดลนี้อยู่ในระบบแล้ว"
            : (error?.message ?? "บันทึกโครงร่างสินค้าไม่สำเร็จ"),
    };
  }

  return { ok: true, modelId: data.id as string, overwritten: false };
}

/**
 * Phase 1 Branch 2 — overwrite existing row by model_code after user confirms.
 */
export async function overwriteDraftProductModel(
  input: SaveDraftModelInput,
): Promise<SaveDraftModelResult> {
  const validationError = validateStep1(input);
  if (validationError) {
    return { ok: false, error: validationError };
  }

  const supabase = createSupabaseServerClient();
  const payload = buildDraftPayload(input);

  const { data, error } = await supabase
    .from("product_models")
    .update(payload)
    .eq("model_code", payload.model_code)
    .select("id")
    .maybeSingle();

  if (error) {
    return {
      ok: false,
      error:
        error.code === "42P01"
          ? "ยังไม่มีตาราง product_models — รัน sql/product_models.sql ก่อน"
          : error.message,
    };
  }

  if (!data) {
    return {
      ok: false,
      error: "ไม่พบโมเดลที่ต้องการบันทึกทับ",
    };
  }

  return { ok: true, modelId: data.id as string, overwritten: true };
}

/**
 * @deprecated Prefer find + insert / overwrite. Kept for callers that only insert.
 */
export async function saveDraftProductModel(
  input: SaveDraftModelInput,
): Promise<SaveDraftModelResult> {
  return insertDraftProductModel(input);
}

/**
 * Phase 2 — Upsert generated SKUs (ignore existing sku), link via model_id.
 * Keeps / sets product_models.status = ACTIVE after success.
 */
export async function generateSkusFromModel(
  input: GenerateSkusInput,
): Promise<GenerateSkusResult> {
  const validationError = validateStep1(input.model);
  if (validationError) {
    return { ok: false, error: validationError };
  }

  if (!input.vendorId) {
    return { ok: false, error: "กรุณาเลือกผู้จำหน่าย" };
  }
  if (input.vendorId !== input.model.vendorId) {
    return {
      ok: false,
      error: "vendor_id ของฟอร์มกับโมเดลไม่ตรงกัน — ต้องระบุ Vendor บังคับ",
    };
  }

  if (!input.skus.length) {
    return { ok: false, error: "ไม่มี SKU ที่จะสร้าง" };
  }

  const skuList = input.skus.map((row) => row.sku);
  if (new Set(skuList).size !== skuList.length) {
    return { ok: false, error: "พบ SKU ซ้ำกันเองใน Matrix" };
  }

  const supabase = createSupabaseServerClient();
  const modelPayload = buildDraftPayload(input.model);
  const activePayload = {
    ...modelPayload,
    status: "ACTIVE" as const,
  };

  // Ensure / promote parent model → ACTIVE
  let modelId = input.modelId ?? null;

  if (modelId) {
    const { error: updateError } = await supabase
      .from("product_models")
      .update(activePayload)
      .eq("id", modelId);

    if (updateError) {
      return { ok: false, error: updateError.message };
    }
  } else {
    const { data: modelRow, error: modelError } = await supabase
      .from("product_models")
      .insert(activePayload)
      .select("id")
      .single();

    if (modelError || !modelRow) {
      return {
        ok: false,
        error: modelError?.message ?? "สร้างโมเดลหลักไม่สำเร็จ",
      };
    }
    modelId = modelRow.id as string;
  }

  // Which SKUs already exist? (for skipped count)
  const { data: existingRows, error: checkError } = await supabase
    .from("products")
    .select("sku")
    .in("sku", skuList);

  if (checkError) {
    return { ok: false, modelId, error: checkError.message };
  }

  const existingSkuSet = new Set(
    (existingRows ?? []).map((row) => String(row.sku)),
  );
  const skipped = input.skus.filter((row) => existingSkuSet.has(row.sku)).length;

  const productRows = input.skus.map((row) => ({
    model_id: modelId,
    sku: row.sku,
    name: row.name,
    short_name: row.shortName,
    description: row.description,
    category: row.category,
    color: row.color,
    size: row.size,
    gender: row.gender,
    tax_type: normalizeTaxType(row.taxType),
    base_uom: "ตัว",
    cost_price: row.costPrice,
    retail_price: row.retailPrice,
    wholesale_price: row.wholesalePrice,
    is_active: true,
  }));

  // Safe insert: existing SKUs ignored; only net-new rows are written
  const { error: productError } = await supabase
    .from("products")
    .upsert(productRows, { onConflict: "sku", ignoreDuplicates: true });

  if (productError) {
    return {
      ok: false,
      modelId,
      error: productError.message ?? "ไม่สามารถบันทึกสินค้าได้",
    };
  }

  // Resolve product ids for vendor mapping (net-new only)
  const netNewSkus = input.skus
    .filter((row) => !existingSkuSet.has(row.sku))
    .map((row) => row.sku);

  let insertedCount = 0;

  if (netNewSkus.length > 0) {
    const { data: insertedProducts, error: fetchError } = await supabase
      .from("products")
      .select("id, sku, name")
      .in("sku", netNewSkus);

    if (fetchError) {
      return { ok: false, modelId, error: fetchError.message };
    }

    insertedCount = insertedProducts?.length ?? 0;

    if (insertedProducts && insertedProducts.length > 0) {
      const mappings = insertedProducts.map((product) => ({
        vendor_id: input.vendorId,
        vendor_sku: product.sku,
        vendor_product_name: product.name,
        vendor_uom: "ตัว",
        internal_product_id: product.id,
        conversion_factor: 1,
      }));

      const { error: mappingError } = await supabase
        .from("vendor_product_mapping")
        .insert(mappings);

      if (mappingError && mappingError.code !== "23505") {
        return {
          ok: false,
          modelId,
          error: `ผูกผู้จำหน่ายไม่สำเร็จ: ${mappingError.message}`,
        };
      }
    }
  }

  // Always keep parent model ACTIVE after successful generation
  const { error: activeError } = await supabase
    .from("product_models")
    .update({ status: "ACTIVE" })
    .eq("id", modelId);

  if (activeError) {
    return { ok: false, modelId, error: activeError.message };
  }

  return {
    ok: true,
    modelId,
    inserted: insertedCount,
    skipped,
  };
}

/**
 * Phase 11 Visual Verification — โหลดรายละเอียดรุ่นสำหรับ Thumbnail Preview Sheet
 * (`?preview_model_id=` บนหน้าสินค้าและราคา)
 */
export async function getProductModelPreview(
  modelId: string,
): Promise<GetProductModelPreviewResult> {
  try {
    const id = modelId?.trim() ?? "";
    if (!id) {
      return { data: null, error: "ไม่พบรหัสรุ่นสินค้า" };
    }

    const supabase = createSupabaseServerClient();
    const { data, error } = await supabase
      .from("product_models")
      .select(
        `
        id,
        model_code,
        name,
        short_name,
        gender,
        image_url,
        brand:mst_brands(brand_code, brand_name),
        category:mst_categories(category_code, category_name)
      `,
      )
      .eq("id", id)
      .maybeSingle();

    if (error) {
      return { data: null, error: error.message };
    }
    if (!data) {
      return { data: null, error: "ไม่พบรุ่นสินค้า" };
    }

    const row = data as {
      id: string;
      model_code: string;
      name: string;
      short_name: string | null;
      gender: string | null;
      image_url: string | null;
      brand?:
        | { brand_code?: string; brand_name?: string }
        | { brand_code?: string; brand_name?: string }[]
        | null;
      category?:
        | { category_code?: string; category_name?: string }
        | { category_code?: string; category_name?: string }[]
        | null;
    };

    const brand = Array.isArray(row.brand) ? row.brand[0] : row.brand;
    const category = Array.isArray(row.category)
      ? row.category[0]
      : row.category;

    return {
      data: {
        id: row.id,
        model_code: row.model_code,
        name: row.name,
        short_name: row.short_name,
        gender: row.gender,
        image_url: row.image_url?.trim().split("?")[0] || null,
        brand_code: brand?.brand_code ?? null,
        brand_name: brand?.brand_name ?? null,
        category_code: category?.category_code ?? null,
        category_name: category?.category_name ?? null,
      },
      error: null,
    };
  } catch (err) {
    return {
      data: null,
      error:
        err instanceof Error ? err.message : "โหลดรายละเอียดรุ่นไม่สำเร็จ",
    };
  }
}

function formDataText(formData: FormData, key: string): string {
  const value = formData.get(key);
  if (typeof value === "string") return value.trim();
  return "";
}

function parseSizePricesFromFormData(
  formData: FormData,
): UpdateProductModelSizePrice[] | { error: string } {
  const raw =
    formDataText(formData, "sizePrices") ||
    formDataText(formData, "size_prices");
  if (!raw) {
    return { error: "ไม่พบข้อมูลราคาตามไซส์ (sizePrices)" };
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return { error: "รูปแบบ sizePrices ต้องเป็น Array" };
    }

    return parsed.map((row) => {
      const item = row as Record<string, unknown>;
      return {
        sizeCode: String(item.sizeCode ?? item.size_code ?? "").trim(),
        sizeLabel:
          item.sizeLabel != null || item.size_label != null
            ? String(item.sizeLabel ?? item.size_label ?? "").trim() || null
            : null,
        costPrice: Number(item.costPrice ?? item.cost_price ?? 0),
        retailPrice: Number(item.retailPrice ?? item.retail_price ?? 0),
        wholesalePrice: Number(
          item.wholesalePrice ?? item.wholesale_price ?? 0,
        ),
      };
    });
  } catch {
    return { error: "แปลง JSON ของ sizePrices ไม่สำเร็จ" };
  }
}

/**
 * อัปเดต Product Model + Bulk Update ราคา SKU ตามไซส์ (Service Role).
 * FormData keys: modelId, image_url, vendorId, name, shortName, gender,
 * taxType, sizePrices (JSON array)
 */
export async function updateProductModel(
  formData: FormData,
): Promise<UpdateProductModelResult> {
  try {
    const sizePricesOrError = parseSizePricesFromFormData(formData);
    if ("error" in sizePricesOrError) {
      return { ok: false, error: sizePricesOrError.error };
    }

    const imageRaw =
      formDataText(formData, "image_url") ||
      formDataText(formData, "imageUrl");
    const imageUrl = imageRaw ? imageRaw.split("?")[0] : null;

    const parsed = updateProductModelSchema.safeParse({
      modelId: formDataText(formData, "modelId") || formDataText(formData, "model_id"),
      vendorId:
        formDataText(formData, "vendorId") ||
        formDataText(formData, "vendor_id"),
      name:
        formDataText(formData, "name") ||
        formDataText(formData, "description"),
      shortName:
        formDataText(formData, "shortName") ||
        formDataText(formData, "short_name") ||
        undefined,
      gender: formDataText(formData, "gender"),
      taxType:
        formDataText(formData, "taxType") ||
        formDataText(formData, "tax_type") ||
        "INC_VAT",
      image_url: imageUrl,
      sizePrices: sizePricesOrError,
    });

    if (!parsed.success) {
      return { ok: false, error: zodFirstError(parsed.error) };
    }

    const input = parsed.data;
    const baseName = input.name;
    const shortName = input.shortName?.trim() || baseName;
    const taxType = normalizeTaxType(input.taxType);
    const supabaseAdmin = createSupabaseServerClient();

    const { data: modelRow, error: modelLookupError } = await supabaseAdmin
      .from("product_models")
      .select("id")
      .eq("id", input.modelId)
      .maybeSingle();

    if (modelLookupError) {
      return { ok: false, error: modelLookupError.message };
    }
    if (!modelRow) {
      return { ok: false, error: "ไม่พบรุ่นสินค้า (product_models)" };
    }

    const { error: modelUpdateError } = await supabaseAdmin
      .from("product_models")
      .update({
        vendor_id: input.vendorId,
        name: baseName,
        short_name: shortName,
        gender: input.gender,
        tax_type: taxType,
        image_url: input.image_url?.trim() || null,
      })
      .eq("id", input.modelId);

    if (modelUpdateError) {
      return {
        ok: false,
        error: `อัปเดต product_models ไม่สำเร็จ: ${modelUpdateError.message}`,
      };
    }

    const sizeCodes = [
      ...new Set(
        input.sizePrices
          .map((row) => row.sizeCode.trim().toUpperCase())
          .filter(Boolean),
      ),
    ];
    const sizeLabelsFromInput = [
      ...new Set(
        input.sizePrices
          .map((row) => row.sizeLabel?.trim() ?? "")
          .filter(Boolean),
      ),
    ];

    const sizeMetaByCode = new Map<
      string,
      { size_code: string; size_label: string }
    >();
    const sizeMetaByLabel = new Map<
      string,
      { size_code: string; size_label: string }
    >();

    if (sizeCodes.length > 0 || sizeLabelsFromInput.length > 0) {
      const [byCodeResult, byLabelResult] = await Promise.all([
        sizeCodes.length > 0
          ? supabaseAdmin
              .from("mst_sizes")
              .select("size_code, size_label")
              .in("size_code", sizeCodes)
          : Promise.resolve({
              data: [] as { size_code: string; size_label: string }[],
              error: null,
            }),
        sizeLabelsFromInput.length > 0
          ? supabaseAdmin
              .from("mst_sizes")
              .select("size_code, size_label")
              .in("size_label", sizeLabelsFromInput)
          : Promise.resolve({
              data: [] as { size_code: string; size_label: string }[],
              error: null,
            }),
      ]);

      if (byCodeResult.error) {
        return { ok: false, error: byCodeResult.error.message };
      }
      if (byLabelResult.error) {
        return { ok: false, error: byLabelResult.error.message };
      }

      for (const row of [
        ...(byCodeResult.data ?? []),
        ...(byLabelResult.data ?? []),
      ]) {
        const code = String(row.size_code ?? "").trim();
        const label = String(row.size_label ?? "").trim();
        if (code) {
          sizeMetaByCode.set(code.toUpperCase(), {
            size_code: code,
            size_label: label || code,
          });
        }
        if (label) {
          sizeMetaByLabel.set(label.toUpperCase(), {
            size_code: code || label,
            size_label: label,
          });
        }
      }
    }

    type PriceMatch = {
      costPrice: number;
      retailPrice: number;
      wholesalePrice: number;
      matchKeys: Set<string>;
    };

    const priceMatchers: PriceMatch[] = input.sizePrices.map((row) => {
      const codeKey = row.sizeCode.trim().toUpperCase();
      const labelKey = (row.sizeLabel ?? "").trim().toUpperCase();
      const matchKeys = new Set<string>();

      if (row.sizeCode.trim()) matchKeys.add(row.sizeCode.trim());
      if (row.sizeLabel?.trim()) matchKeys.add(row.sizeLabel.trim());

      const byCode = sizeMetaByCode.get(codeKey);
      if (byCode?.size_label) matchKeys.add(byCode.size_label);
      if (byCode?.size_code) matchKeys.add(byCode.size_code);

      const byLabel = labelKey ? sizeMetaByLabel.get(labelKey) : undefined;
      if (byLabel?.size_label) matchKeys.add(byLabel.size_label);
      if (byLabel?.size_code) matchKeys.add(byLabel.size_code);

      // Also match uppercase variants on products.size
      for (const key of [...matchKeys]) {
        matchKeys.add(key.toUpperCase());
      }

      return {
        costPrice: row.costPrice,
        retailPrice: row.retailPrice,
        wholesalePrice: row.wholesalePrice,
        matchKeys,
      };
    });

    const { data: skuRows, error: skuError } = await supabaseAdmin
      .from("products")
      .select("id, color, size")
      .eq("model_id", input.modelId);

    if (skuError) {
      return { ok: false, error: skuError.message };
    }

    const products = skuRows ?? [];
    if (products.length === 0) {
      revalidatePath("/products");
      return {
        ok: true,
        modelId: input.modelId,
        updatedSkuCount: 0,
      };
    }

    const updates = products.map((product) => {
      const sizeRaw = String(product.size ?? "").trim();
      const sizeUpper = sizeRaw.toUpperCase();
      const matched = priceMatchers.find(
        (entry) =>
          entry.matchKeys.has(sizeRaw) || entry.matchKeys.has(sizeUpper),
      );

      const colorPart = product.color ? ` สี${product.color}` : "";
      const sizePart = sizeRaw ? ` ไซส์ ${sizeRaw}` : "";

      return {
        id: product.id as string,
        payload: {
          name: `${baseName}${colorPart}${sizePart}`,
          short_name: shortName,
          description: baseName,
          gender: input.gender,
          tax_type: taxType,
          ...(matched
            ? {
                cost_price: matched.costPrice,
                retail_price: matched.retailPrice,
                wholesale_price: matched.wholesalePrice,
              }
            : {}),
        },
      };
    });

    const results = await Promise.all(
      updates.map(({ id, payload }) =>
        supabaseAdmin.from("products").update(payload).eq("id", id),
      ),
    );

    const firstError = results.find((result) => result.error)?.error;
    if (firstError) {
      return {
        ok: false,
        modelId: input.modelId,
        error: `อัปเดต SKU ไม่สำเร็จ: ${firstError.message}`,
      };
    }

    const pricedCount = products.filter((product) => {
      const sizeRaw = String(product.size ?? "").trim();
      const sizeUpper = sizeRaw.toUpperCase();
      return priceMatchers.some(
        (entry) =>
          entry.matchKeys.has(sizeRaw) || entry.matchKeys.has(sizeUpper),
      );
    }).length;

    revalidatePath("/products");
    revalidatePath("/products", "layout");

    return {
      ok: true,
      modelId: input.modelId,
      updatedSkuCount: pricedCount,
    };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error ? err.message : "อัปเดตรุ่นสินค้าไม่สำเร็จ",
    };
  }
}
