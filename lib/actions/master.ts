"use server";

/**
 * Master Data Server Actions — Vendors (Contacts) / Brands / Categories / Genders.
 *
 * Phase 3 architecture: "Strict Server-Side Fetching". These replace the
 * direct `supabase.from(...)` calls that `products-client.tsx` and the
 * Brand/Category comboboxes previously made with the browser anon-key
 * client, which were hitting RLS "Permission Denied" on `mst_brands`,
 * `mst_categories`, `mst_genders`, and `contacts`. Every read AND mutation
 * here goes through `createSupabaseAdminClient()` (Service Role Key) to
 * bypass RLS entirely — no anon-key fallback, ever.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { findDuplicateContactError } from "@/lib/contacts/duplicate-check";

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

/* -------------------------------------------------------------------------- */
/* Shared types                                                               */
/* -------------------------------------------------------------------------- */

export type MasterBrand = {
  id: string;
  brand_code: string;
  brand_name: string;
};

export type MasterCategory = {
  id: string;
  category_code: string;
  category_name: string;
};

export type MasterGender = {
  id: string;
  gender_code: string;
  gender_name: string;
};

export type MasterVendor = {
  id: string;
  company_name: string;
};

export type MasterColor = {
  id: string;
  color_code: string;
  color_name: string;
};

export type MasterSize = {
  id: string;
  brand_id: string | null;
  size_label: string;
  size_code: string;
  sort_order: number;
};

export type MasterVendorDetail = {
  id: string;
  company_name: string;
  phone: string | null;
  tax_id: string | null;
  address: string | null;
  branch_code: string | null;
  credit_days: number | null;
  default_price_tier: string | null;
};

const POSTGRES_UNIQUE_VIOLATION = "23505";

/** PostgREST FK-embed rows come back as an object OR a 1-item array depending on the relationship — normalize to one object. */
function unwrapEmbeddedRow<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/** UPPERCASE + strip anything that isn't A-Z/0-9, capped to `maxLength`. */
function normalizeCode(raw: string, maxLength: number): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, maxLength);
}

/* -------------------------------------------------------------------------- */
/* getBrands / getCategories / getGenders                                    */
/* -------------------------------------------------------------------------- */

export type GetBrandsResult = { data: MasterBrand[]; error: string | null };
export type GetCategoriesResult = { data: MasterCategory[]; error: string | null };
export type GetGendersResult = { data: MasterGender[]; error: string | null };
export type GetVendorsResult = { data: MasterVendor[]; error: string | null };

export async function getBrands(): Promise<GetBrandsResult> {
  try {
    const supabaseAdmin = createSupabaseAdminClient();
    const { data, error } = await supabaseAdmin
      .from("mst_brands")
      .select("id, brand_code, brand_name")
      .eq("is_active", true)
      .order("brand_name");

    if (error) return { data: [], error: error.message };
    return { data: (data ?? []) as MasterBrand[], error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : "โหลดรายการแบรนด์ไม่สำเร็จ";
    return { data: [], error: message };
  }
}

export async function getCategories(): Promise<GetCategoriesResult> {
  try {
    const supabaseAdmin = createSupabaseAdminClient();
    const { data, error } = await supabaseAdmin
      .from("mst_categories")
      .select("id, category_code, category_name")
      .eq("is_active", true)
      .order("category_code");

    if (error) return { data: [], error: error.message };
    return { data: (data ?? []) as MasterCategory[], error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : "โหลดรายการหมวดหมู่ไม่สำเร็จ";
    return { data: [], error: message };
  }
}

export async function getGenders(): Promise<GetGendersResult> {
  try {
    const supabaseAdmin = createSupabaseAdminClient();
    const { data, error } = await supabaseAdmin
      .from("mst_genders")
      .select("id, gender_code, gender_name")
      .eq("is_active", true)
      .order("gender_name");

    if (error) return { data: [], error: error.message };
    return { data: (data ?? []) as MasterGender[], error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : "โหลดรายการเพศไม่สำเร็จ";
    return { data: [], error: message };
  }
}

export async function getVendors(): Promise<GetVendorsResult> {
  try {
    const supabaseAdmin = createSupabaseAdminClient();
    const { data, error } = await supabaseAdmin
      .from("contacts")
      .select("id, company_name")
      .eq("contact_type", "Vendor")
      .eq("is_active", true)
      .order("company_name");

    if (error) return { data: [], error: error.message };
    return { data: (data ?? []) as MasterVendor[], error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : "โหลดรายการผู้จำหน่ายไม่สำเร็จ";
    return { data: [], error: message };
  }
}

export type GetColorsResult = { data: MasterColor[]; error: string | null };

/**
 * `mst_colors` carries legacy rows seeded before the "exactly 3 uppercase
 * letters" SKU standard was adopted (e.g. `GY`/`SV`/`PK` alongside the
 * current `GRY`/`SLV`/`PNK`) — same Thai name, two different codes. Rather
 * than mutate/delete historical rows here, strictly filter the dropdown to
 * codes matching the Fixed-3-Character standard so the combobox never shows
 * duplicate/legacy entries. See `COLOR_CODE_PATTERN` used by `createColor`.
 */
export async function getColors(): Promise<GetColorsResult> {
  try {
    const supabaseAdmin = createSupabaseAdminClient();
    const { data, error } = await supabaseAdmin
      .from("mst_colors")
      .select("id, color_code, color_name")
      .eq("is_active", true)
      .order("color_name");

    if (error) return { data: [], error: error.message };

    const strict = ((data ?? []) as MasterColor[]).filter((color) =>
      COLOR_CODE_PATTERN.test(color.color_code?.trim().toUpperCase() ?? ""),
    );
    const sorted = strict.sort((left, right) =>
      left.color_name.localeCompare(right.color_name, "th"),
    );
    return { data: sorted, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : "โหลดรายการสีไม่สำเร็จ";
    return { data: [], error: message };
  }
}

/* -------------------------------------------------------------------------- */
/* getSizesByBrand / getAllSizesByBrand                                      */
/* -------------------------------------------------------------------------- */

export type GetSizesResult = { data: MasterSize[]; error: string | null };

const SIZE_COLUMNS = "id, brand_id, size_label, size_code, sort_order";

/** Sizes for a brand's own size run (e.g. S/M/L vs 38/40/42) — active only, for the Size selector. */
export async function getSizesByBrand(brandId: string): Promise<GetSizesResult> {
  const trimmedBrandId = brandId?.trim() ?? "";
  if (!trimmedBrandId) return { data: [], error: null };

  try {
    const supabaseAdmin = createSupabaseAdminClient();
    const { data, error } = await supabaseAdmin
      .from("mst_sizes")
      .select(SIZE_COLUMNS)
      .eq("brand_id", trimmedBrandId)
      .eq("is_active", true)
      .order("sort_order", { ascending: true });

    if (error) return { data: [], error: error.message };
    return { data: (data ?? []) as MasterSize[], error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : "โหลดรายการไซส์ไม่สำเร็จ";
    return { data: [], error: message };
  }
}

/**
 * Global Size catalog (`mst_sizes.brand_id IS NULL`) — active only, ordered
 * by `sort_order`. Used by Product Matrix Step 2 to SELECT existing sizes
 * into the matrix without INSERTing duplicates.
 */
export async function getGlobalSizes(): Promise<GetSizesResult> {
  try {
    const supabaseAdmin = createSupabaseAdminClient();
    const { data, error } = await supabaseAdmin
      .from("mst_sizes")
      .select(SIZE_COLUMNS)
      .is("brand_id", null)
      .eq("is_active", true)
      .order("sort_order", { ascending: true });

    if (error) return { data: [], error: error.message };
    return { data: (data ?? []) as MasterSize[], error: null };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "โหลดรายการไซส์มาตรฐาน (Global) ไม่สำเร็จ";
    return { data: [], error: message };
  }
}

/** Active + inactive sizes for a brand — reference table shown inside the "Add New Size" modal. */
export async function getAllSizesByBrand(brandId: string): Promise<GetSizesResult> {
  const trimmedBrandId = brandId?.trim() ?? "";
  if (!trimmedBrandId) return { data: [], error: null };

  try {
    const supabaseAdmin = createSupabaseAdminClient();
    const { data, error } = await supabaseAdmin
      .from("mst_sizes")
      .select(SIZE_COLUMNS)
      .eq("brand_id", trimmedBrandId)
      .order("sort_order", { ascending: true });

    if (error) return { data: [], error: error.message };
    return { data: (data ?? []) as MasterSize[], error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : "โหลดตารางอ้างอิงไซส์ไม่สำเร็จ";
    return { data: [], error: message };
  }
}

/* -------------------------------------------------------------------------- */
/* createSize / createSizesBulk                                             */
/* -------------------------------------------------------------------------- */

/** Same char set as `normalizeSkuPart` (app/products/product-sku.ts) — kept local so this file has zero `app/` deps. */
function normalizeSizeCode(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/[^A-Z0-9ก-๙-]/g, "");
}

export type CreateSizeInput = {
  brand_id: string;
  size_label: string;
  size_code: string;
  sort_order: number;
};

export type CreateSizeResult = { data: MasterSize | null; error: string | null };

export async function createSize(
  input: CreateSizeInput,
): Promise<CreateSizeResult> {
  const brandId = input.brand_id?.trim() ?? "";
  const sizeLabel = input.size_label?.trim() ?? "";
  const sizeCode = normalizeSizeCode(input.size_code ?? "");
  const sortOrder = Number(input.sort_order);

  if (!brandId) {
    return { data: null, error: "กรุณาเลือกแบรนด์ก่อนเพิ่มไซส์" };
  }
  if (!sizeLabel || !sizeCode) {
    return { data: null, error: "กรุณากรอกข้อมูลไซส์ให้ครบทั้ง 3 ช่อง" };
  }
  if (!Number.isInteger(sortOrder) || sortOrder < 0) {
    return { data: null, error: "ลำดับต้องเป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไป" };
  }

  try {
    const supabaseAdmin = createSupabaseAdminClient();

    const { data, error } = await supabaseAdmin
      .from("mst_sizes")
      .insert({
        brand_id: brandId,
        size_label: sizeLabel,
        size_code: sizeCode,
        sort_order: sortOrder,
        is_active: true,
      })
      .select(SIZE_COLUMNS)
      .single();

    if (error || !data) {
      const message =
        error?.code === POSTGRES_UNIQUE_VIOLATION
          ? `รหัสไซส์ "${sizeCode}" มีอยู่สำหรับแบรนด์นี้แล้ว`
          : (error?.message ?? "ไม่สามารถบันทึกไซส์ใหม่ได้");
      return { data: null, error: message };
    }

    return { data: data as MasterSize, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : "สร้างไซส์ใหม่ไม่สำเร็จ";
    return { data: null, error: message };
  }
}

export type CreateSizesBulkInput = {
  brand_id: string;
  sizes: Array<{
    size_label: string;
    size_code: string;
    sort_order: number;
  }>;
};

export type CreateSizesBulkResult = {
  data: MasterSize[];
  error: string | null;
};

/** Batch insert for the "Quick Sizes" (standard size run) picker. */
export async function createSizesBulk(
  input: CreateSizesBulkInput,
): Promise<CreateSizesBulkResult> {
  const brandId = input.brand_id?.trim() ?? "";
  if (!brandId) {
    return { data: [], error: "กรุณาเลือกแบรนด์ก่อนเพิ่มไซส์" };
  }
  if (!input.sizes || input.sizes.length === 0) {
    return { data: [], error: "กรุณาเลือกไซส์อย่างน้อย 1 รายการ" };
  }

  const payload = input.sizes.map((size) => ({
    brand_id: brandId,
    size_label: size.size_label.trim(),
    size_code: normalizeSizeCode(size.size_code),
    sort_order: size.sort_order,
    is_active: true,
  }));

  try {
    const supabaseAdmin = createSupabaseAdminClient();

    const { data, error } = await supabaseAdmin
      .from("mst_sizes")
      .insert(payload)
      .select(SIZE_COLUMNS);

    if (error || !data) {
      const message =
        error?.code === POSTGRES_UNIQUE_VIOLATION
          ? "มีไซส์บางรายการซ้ำในแบรนด์นี้แล้ว"
          : (error?.message ?? "ไม่สามารถบันทึกไซส์มาตรฐานได้");
      return { data: [], error: message };
    }

    return { data: data as MasterSize[], error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : "สร้างไซส์มาตรฐานไม่สำเร็จ";
    return { data: [], error: message };
  }
}

export type ProductVendorMapping = {
  internal_product_id: string;
  vendor: MasterVendorDetail;
};

export type GetVendorMappingsResult = {
  data: ProductVendorMapping[];
  error: string | null;
};

/**
 * `vendor_product_mapping` embeds `contacts` (vendor) per row — the SAME
 * "Permission Denied" tables this file exists to bypass. Used by the
 * products list page to show which vendor each internal product maps to.
 */
export async function getVendorMappingsByProductIds(
  productIds: string[],
): Promise<GetVendorMappingsResult> {
  if (productIds.length === 0) return { data: [], error: null };

  try {
    const supabaseAdmin = createSupabaseAdminClient();
    const { data, error } = await supabaseAdmin
      .from("vendor_product_mapping")
      .select(
        "internal_product_id, vendor:contacts(id, company_name, phone, tax_id, address, branch_code, credit_days, default_price_tier)",
      )
      .in("internal_product_id", productIds);

    if (error) return { data: [], error: error.message };

    const rows = (data ?? [])
      .map((row) => {
        const record = row as {
          internal_product_id: string;
          vendor: MasterVendorDetail | MasterVendorDetail[] | null;
        };
        const vendor = unwrapEmbeddedRow(record.vendor);
        if (!vendor?.id) return null;
        return { internal_product_id: record.internal_product_id, vendor };
      })
      .filter((row): row is ProductVendorMapping => row !== null);

    return { data: rows, error: null };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "โหลดข้อมูลผู้จำหน่ายของสินค้าไม่สำเร็จ";
    return { data: [], error: message };
  }
}

/**
 * All five in one round trip — for the Matrix Generator's initial load.
 * Individual actions above stay exported for callers that only need one list.
 */
export type GetMasterDataResult = {
  brands: MasterBrand[];
  categories: MasterCategory[];
  colors: MasterColor[];
  genders: MasterGender[];
  vendors: MasterVendor[];
  error: string | null;
};

export async function getMasterDataForMatrix(): Promise<GetMasterDataResult> {
  const [brandsResult, categoriesResult, colorsResult, gendersResult, vendorsResult] =
    await Promise.all([
      getBrands(),
      getCategories(),
      getColors(),
      getGenders(),
      getVendors(),
    ]);

  const error =
    brandsResult.error ??
    categoriesResult.error ??
    colorsResult.error ??
    gendersResult.error ??
    vendorsResult.error;

  return {
    brands: brandsResult.data,
    categories: categoriesResult.data,
    colors: colorsResult.data,
    genders: gendersResult.data,
    vendors: vendorsResult.data,
    error,
  };
}

/* -------------------------------------------------------------------------- */
/* createBrand                                                               */
/* -------------------------------------------------------------------------- */

export type CreateBrandInput = {
  brand_code: string;
  brand_name: string;
};

export type CreateBrandResult = {
  data: MasterBrand | null;
  error: string | null;
};

export async function createBrand(
  input: CreateBrandInput,
): Promise<CreateBrandResult> {
  const brandName = input.brand_name?.trim() ?? "";
  const brandCode = normalizeCode(input.brand_code ?? "", 10);

  if (!brandName) {
    return { data: null, error: "กรุณากรอกชื่อแบรนด์" };
  }
  if (!brandCode) {
    return { data: null, error: "กรุณากรอกรหัสแบรนด์เป็นภาษาอังกฤษหรือตัวเลข" };
  }

  try {
    const supabaseAdmin = createSupabaseAdminClient();

    const { data, error } = await supabaseAdmin
      .from("mst_brands")
      .insert({
        brand_code: brandCode,
        brand_name: brandName,
        is_active: true,
      })
      .select("id, brand_code, brand_name")
      .single();

    if (error || !data) {
      const message =
        error?.code === POSTGRES_UNIQUE_VIOLATION
          ? `รหัสหรือชื่อแบรนด์ "${brandCode}" มีอยู่ในระบบแล้ว`
          : (error?.message ?? "ไม่สามารถบันทึกแบรนด์ใหม่ได้");
      return { data: null, error: message };
    }

    return { data: data as MasterBrand, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : "สร้างแบรนด์ใหม่ไม่สำเร็จ";
    return { data: null, error: message };
  }
}

/* -------------------------------------------------------------------------- */
/* createVendor                                                              */
/* -------------------------------------------------------------------------- */

export type CreateVendorInput = {
  company_name: string;
  phone?: string;
};

export type CreateVendorResult = {
  data: MasterVendor | null;
  error: string | null;
};

export async function createVendor(
  input: CreateVendorInput,
): Promise<CreateVendorResult> {
  const companyName = input.company_name?.trim() ?? "";
  const phone = input.phone?.trim() || null;

  if (!companyName) {
    return { data: null, error: "กรุณากรอกชื่อผู้จำหน่าย" };
  }

  try {
    const supabaseAdmin = createSupabaseAdminClient();

    const duplicateError = await findDuplicateContactError(supabaseAdmin, {
      companyName,
    });
    if (duplicateError) {
      return { data: null, error: duplicateError };
    }

    const { data, error } = await supabaseAdmin
      .from("contacts")
      .insert({
        contact_type: "Vendor",
        company_name: companyName,
        phone,
        customer_type: "นิติบุคคล",
        branch_code: "สำนักงานใหญ่",
        default_price_tier: "Wholesale",
        credit_days: 0,
        is_active: true,
      })
      .select("id, company_name")
      .single();

    if (error || !data) {
      const message =
        error?.code === POSTGRES_UNIQUE_VIOLATION
          ? `ชื่อผู้จำหน่าย "${companyName}" มีอยู่ในระบบแล้ว`
          : (error?.message ?? "ไม่สามารถบันทึกผู้จำหน่ายใหม่ได้");
      return { data: null, error: message };
    }

    return { data: data as MasterVendor, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : "สร้างผู้จำหน่ายใหม่ไม่สำเร็จ";
    return { data: null, error: message };
  }
}

/* -------------------------------------------------------------------------- */
/* createColor                                                               */
/* -------------------------------------------------------------------------- */

const COLOR_CODE_PATTERN = /^[A-Z]{3}$/;

export type CreateColorInput = {
  color_code: string;
  color_name: string;
};

export type CreateColorResult = {
  data: MasterColor | null;
  error: string | null;
};

export async function createColor(
  input: CreateColorInput,
): Promise<CreateColorResult> {
  const colorName = input.color_name?.trim() ?? "";
  const colorCode = normalizeCode(input.color_code ?? "", 3);

  if (!colorName) {
    return { data: null, error: "กรุณากรอกชื่อสี" };
  }
  if (!COLOR_CODE_PATTERN.test(colorCode)) {
    return { data: null, error: "รหัสสีต้องเป็นตัวพิมพ์ใหญ่ภาษาอังกฤษ 3 ตัวอักษร" };
  }

  try {
    const supabaseAdmin = createSupabaseAdminClient();

    const { data, error } = await supabaseAdmin
      .from("mst_colors")
      .insert({
        color_code: colorCode,
        color_name: colorName,
        is_active: true,
      })
      .select("id, color_code, color_name")
      .single();

    if (error || !data) {
      const message =
        error?.code === POSTGRES_UNIQUE_VIOLATION
          ? `รหัสหรือชื่อสี "${colorCode}" มีอยู่ในระบบแล้ว`
          : (error?.message ?? "ไม่สามารถบันทึกสีใหม่ได้");
      return { data: null, error: message };
    }

    return { data: data as MasterColor, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : "สร้างสีใหม่ไม่สำเร็จ";
    return { data: null, error: message };
  }
}

/* -------------------------------------------------------------------------- */
/* createCategory                                                            */
/* -------------------------------------------------------------------------- */

const CATEGORY_CODE_PATTERN = /^[A-Z]{2}$/;

export type CreateCategoryInput = {
  category_code: string;
  category_name: string;
};

export type CreateCategoryResult = {
  data: MasterCategory | null;
  error: string | null;
};

export async function createCategory(
  input: CreateCategoryInput,
): Promise<CreateCategoryResult> {
  const categoryName = input.category_name?.trim() ?? "";
  const categoryCode = normalizeCode(input.category_code ?? "", 2);

  if (!categoryName) {
    return { data: null, error: "กรุณากรอกชื่อหมวดหมู่" };
  }
  if (!CATEGORY_CODE_PATTERN.test(categoryCode)) {
    return { data: null, error: "รหัสหมวดหมู่ต้องเป็นตัวพิมพ์ใหญ่ภาษาอังกฤษ 2 ตัวอักษร" };
  }

  try {
    const supabaseAdmin = createSupabaseAdminClient();

    const { data, error } = await supabaseAdmin
      .from("mst_categories")
      .insert({
        category_code: categoryCode,
        category_name: categoryName,
        is_active: true,
      })
      .select("id, category_code, category_name")
      .single();

    if (error || !data) {
      const message =
        error?.code === POSTGRES_UNIQUE_VIOLATION
          ? `รหัสหรือชื่อหมวดหมู่ "${categoryCode}" มีอยู่ในระบบแล้ว`
          : (error?.message ?? "ไม่สามารถบันทึกหมวดหมู่ใหม่ได้");
      return { data: null, error: message };
    }

    return { data: data as MasterCategory, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : "สร้างหมวดหมู่ใหม่ไม่สำเร็จ";
    return { data: null, error: message };
  }
}
