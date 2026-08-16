"use server";

/**
 * "Quick Create SKU" — Server Actions for the On-the-fly product mapping
 * feature (Smart Goods Receipt).
 *
 * Zero Client-Side Fetching: `QuickCreateDialog` never talks to Supabase
 * directly — every read/write goes through these Server Actions using the
 * service-role admin client, same convention as `lib/actions/receipt.ts`.
 *
 * SKU formula reuses the exact same Blueprint utilities as the full
 * Product Matrix flow (`app/products/product-sku.ts`) for consistency:
 * `sku = BrandCode + CategoryCode(2) + ModelCode(6) + GenderCode(1) + ColorCode(3) + SizeCode(2)`.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  buildProductSku,
  isValidSizeCodeForSku,
  makeGenderCodeFromName,
  normalizeSizeCodeForSku,
} from "@/app/products/product-sku";
import {
  COLOR_CODE_ERROR_MESSAGE,
  COLOR_CODE_REGEX,
  SIZE_CODE_ERROR_MESSAGE,
} from "@/app/products/zod-schemas";
import type { ReceiptProductSummary } from "@/lib/actions/receipt";

/**
 * Raw service-role client — bypasses RLS.
 * Never falls back to anon / SSR cookie clients.
 */
function createSupabaseAdminClient(): SupabaseClient {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "Missing SUPABASE_SERVICE_ROLE_KEY (หรือ NEXT_PUBLIC_SUPABASE_URL) — ตั้งค่าใน .env.development แล้วรีสตาร์ท next dev",
    );
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

/** Unwrap a Supabase nested-join field that may come back as an object OR a 1-item array. */
function unwrapJoin<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/* -------------------------------------------------------------------------- */
/* getModelsByVendorForQuickCreate                                           */
/* -------------------------------------------------------------------------- */

export type VendorModelOption = {
  id: string;
  model_code: string;
  name: string;
  gender: string | null;
  tax_type: string | null;
  brand_id: string | null;
  brand_code: string | null;
  brand_name: string | null;
  category_id: string | null;
  category_code: string | null;
  category_name: string | null;
};

export type GetModelsByVendorResult = {
  data: VendorModelOption[];
  error: string | null;
};

/**
 * Models available for "Quick Create SKU" — scoped to the vendor selected
 * in the Goods Receipt header. Only `ACTIVE` models are eligible: a `DRAFT`
 * model has not been through the full Product Matrix confirmation yet, so
 * it should not be used to spin off real, stockable SKUs on the fly.
 */
export async function getModelsByVendorForQuickCreate(
  vendorId: string,
): Promise<GetModelsByVendorResult> {
  const trimmedVendorId = vendorId?.trim() ?? "";
  if (!trimmedVendorId) {
    return { data: [], error: "กรุณาเลือกผู้จำหน่ายก่อน" };
  }

  try {
    const supabaseAdmin = createSupabaseAdminClient();

    const { data, error } = await supabaseAdmin
      .from("product_models")
      .select(
        `
        id, model_code, name, gender, tax_type, brand_id, category_id,
        brand:mst_brands ( brand_code, brand_name ),
        category:mst_categories ( category_code, category_name )
      `,
      )
      .eq("vendor_id", trimmedVendorId)
      .eq("status", "ACTIVE")
      .order("created_at", { ascending: false });

    if (error) {
      return { data: [], error: error.message };
    }

    type Row = {
      id: string;
      model_code: string;
      name: string;
      gender: string | null;
      tax_type: string | null;
      brand_id: string | null;
      category_id: string | null;
      brand: { brand_code: string; brand_name: string } | { brand_code: string; brand_name: string }[] | null;
      category:
        | { category_code: string; category_name: string }
        | { category_code: string; category_name: string }[]
        | null;
    };

    const models: VendorModelOption[] = ((data ?? []) as Row[]).map((row) => {
      const brand = unwrapJoin(row.brand);
      const category = unwrapJoin(row.category);
      return {
        id: row.id,
        model_code: row.model_code,
        name: row.name,
        gender: row.gender,
        tax_type: row.tax_type,
        brand_id: row.brand_id,
        brand_code: brand?.brand_code ?? null,
        brand_name: brand?.brand_name ?? null,
        category_id: row.category_id,
        category_code: category?.category_code ?? null,
        category_name: category?.category_name ?? null,
      };
    });

    return { data: models, error: null };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "โหลดรายการรุ่นสินค้าไม่สำเร็จ";
    return { data: [], error: message };
  }
}

/* -------------------------------------------------------------------------- */
/* getSizesByBrand                                                            */
/* -------------------------------------------------------------------------- */

export type SizeOption = {
  id: string;
  size_code: string;
  size_label: string;
};

export type GetSizesByBrandResult = {
  data: SizeOption[];
  error: string | null;
};

/**
 * `mst_sizes` is brand-scoped (a brand's own size run, e.g. "S/M/L" vs "38/40/42")
 * — needed so the Quick Create dialog's Size Select shows only sizes valid
 * for the selected model's brand. Not explicitly listed in the original
 * task's Server Action list, but required to keep the Size Select
 * "Zero Client-Side Fetching" instead of querying Supabase from the browser.
 */
export async function getSizesByBrand(
  brandId: string,
): Promise<GetSizesByBrandResult> {
  const trimmedBrandId = brandId?.trim() ?? "";
  if (!trimmedBrandId) {
    return { data: [], error: "รุ่นสินค้านี้ยังไม่ได้ผูกแบรนด์ — เลือกไซส์ไม่ได้" };
  }

  try {
    const supabaseAdmin = createSupabaseAdminClient();

    const { data, error } = await supabaseAdmin
      .from("mst_sizes")
      .select("id, size_code, size_label")
      .eq("brand_id", trimmedBrandId)
      .eq("is_active", true)
      .order("sort_order", { ascending: true });

    if (error) {
      return { data: [], error: error.message };
    }

    return { data: (data ?? []) as SizeOption[], error: null };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "โหลดรายการไซส์ไม่สำเร็จ";
    return { data: [], error: message };
  }
}

/* -------------------------------------------------------------------------- */
/* quickCreateSKU                                                             */
/* -------------------------------------------------------------------------- */

export type QuickCreateInput = {
  model_id: string;
  color_code: string;
  size_id: string;
  unit_price: number;
  vendor_id: string;
};

export type QuickCreateSkuResult = {
  product: ReceiptProductSummary | null;
  error: string | null;
};

/** HTTP 409 (PostgREST unique_violation) — the exact SKU already exists. */
const POSTGRES_UNIQUE_VIOLATION = "23505";

/**
 * Add a single new color/size variant onto an EXISTING, ACTIVE product model.
 *
 * SKU formula (Blueprint Fixed-2 Size):
 * `BrandCode + CategoryCode(2) + ModelCode(6) + GenderCode(1) + ColorCode(3) + SizeCode(2)`
 * — built via {@link buildProductSku} so both creation paths never drift.
 *
 * `color_code` is validated against Fixed-3 (`COLOR_CODE_REGEX`).
 * `size_code` from `mst_sizes` is validated/normalized to Fixed-2 (zero-pad if needed).
 * `vendor_id` is re-validated server-side against the model's own
 * `vendor_id` — never trust that the client-selected model actually belongs
 * to the vendor in the active Goods Receipt context.
 */
export async function quickCreateSKU(
  input: QuickCreateInput,
): Promise<QuickCreateSkuResult> {
  const modelId = input.model_id?.trim() ?? "";
  const sizeId = input.size_id?.trim() ?? "";
  const vendorId = input.vendor_id?.trim() ?? "";
  const colorCode = (input.color_code ?? "").trim().toUpperCase();
  const unitPrice = Number(input.unit_price);

  if (!vendorId) {
    return { product: null, error: "กรุณาเลือกผู้จำหน่าย (vendor_id)" };
  }
  if (!modelId) {
    return { product: null, error: "กรุณาเลือกรุ่นสินค้า (Model)" };
  }
  if (!sizeId) {
    return { product: null, error: "กรุณาเลือกไซส์" };
  }
  if (!COLOR_CODE_REGEX.test(colorCode)) {
    return { product: null, error: COLOR_CODE_ERROR_MESSAGE };
  }
  if (!Number.isFinite(unitPrice) || unitPrice < 0) {
    return { product: null, error: "ราคา (unit_price) ไม่ถูกต้อง" };
  }

  try {
    const supabaseAdmin = createSupabaseAdminClient();

    // 1. Fetch the base model — brand_code + category_code + gender feed the SKU formula.
    const { data: model, error: modelError } = await supabaseAdmin
      .from("product_models")
      .select(
        `
        id, model_code, name, gender, vendor_id,
        brand:mst_brands ( brand_code ),
        category:mst_categories ( category_code )
      `,
      )
      .eq("id", modelId)
      .single();

    if (modelError || !model) {
      return {
        product: null,
        error: modelError?.message ?? "ไม่พบรุ่นสินค้าที่เลือก",
      };
    }

    type ModelRow = {
      id: string;
      model_code: string;
      name: string;
      gender: string | null;
      vendor_id: string | null;
      brand: { brand_code: string } | { brand_code: string }[] | null;
      category: { category_code: string } | { category_code: string }[] | null;
    };
    const modelRow = model as ModelRow;

    if (modelRow.vendor_id !== vendorId) {
      return {
        product: null,
        error: "รุ่นสินค้านี้ไม่ได้อยู่ภายใต้ผู้จำหน่ายที่เลือก (vendor_id ไม่ตรงกัน)",
      };
    }

    const brand = unwrapJoin(modelRow.brand);
    const category = unwrapJoin(modelRow.category);

    if (!brand?.brand_code) {
      return { product: null, error: "รุ่นสินค้านี้ยังไม่ได้ผูกแบรนด์ (brand_code)" };
    }
    if (!category?.category_code) {
      return { product: null, error: "รุ่นสินค้านี้ยังไม่ได้ผูกหมวดหมู่ (category_code)" };
    }

    // 2. Fetch the chosen size row.
    const { data: size, error: sizeError } = await supabaseAdmin
      .from("mst_sizes")
      .select("id, size_code, size_label")
      .eq("id", sizeId)
      .single();

    if (sizeError || !size) {
      return { product: null, error: sizeError?.message ?? "ไม่พบไซส์ที่เลือก" };
    }
    const sizeRow = size as { id: string; size_code: string; size_label: string };
    const sizeCode = normalizeSizeCodeForSku(sizeRow.size_code);
    if (!isValidSizeCodeForSku(sizeCode)) {
      return { product: null, error: SIZE_CODE_ERROR_MESSAGE };
    }

    // 3. Build the SKU — Brand + Category(2) + Model(6) + Gender(1) + Color(3) + Size(2).
    const genderCode = makeGenderCodeFromName(modelRow.gender ?? "Unisex (U)");
    const sku = buildProductSku({
      brandCode: brand.brand_code,
      categoryCode: category.category_code,
      modelCode: modelRow.model_code,
      genderCode,
      colorCode,
      sizeCode,
    });

    // 4. Insert into products, linked via model_id — 409/unique_violation handled gracefully below.
    const { data: product, error: productError } = await supabaseAdmin
      .from("products")
      .insert({
        model_id: modelRow.id,
        sku,
        name: modelRow.name,
        color: colorCode,
        size: sizeRow.size_label,
        gender: modelRow.gender,
        cost_price: unitPrice,
        is_active: true,
      })
      .select("id, sku, name, color, size")
      .single();

    if (productError || !product) {
      const message =
        productError?.code === POSTGRES_UNIQUE_VIOLATION
          ? `SKU "${sku}" มีอยู่แล้วในระบบ (สี/ไซส์นี้ถูกสร้างไปแล้ว)`
          : (productError?.message ?? "สร้างสินค้าไม่สำเร็จ");
      return { product: null, error: message };
    }

    // Formatted to match `ReceiptProductSummary` so the calling UI can
    // auto-select this row directly in the Smart Combobox.
    return { product: product as ReceiptProductSummary, error: null };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "สร้างสินค้า (Quick Create SKU) ไม่สำเร็จ";
    return { product: null, error: message };
  }
}
