"use server";

import { createSupabaseServerClient } from "@/lib/supabase-server";
import {
  isValidModelCode,
  MODEL_CODE_LENGTH,
} from "@/app/products/product-sku";
import {
  parseProductModelIdentity,
} from "@/app/products/zod-schemas";

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
  };
}

const EXISTING_MODEL_SELECT =
  "id, model_code, name, short_name, gender, tax_type, status, vendor_id, brand_id, category_id, size_pricing_config";

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
