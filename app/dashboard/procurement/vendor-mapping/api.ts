import { supabase } from "@/lib/supabase";
import { getColors } from "@/lib/actions/master";
import { getActiveVendors } from "@/lib/actions/mapping";
import {
  DUPLICATE_VENDOR_SKU_MESSAGE,
  type BulkMappingInsertRow,
  type BulkMappingResult,
  type CreateVendorMappingInput,
  type FlattenedVendorMapping,
  type ModelSku,
  type ProductModelGroup,
  type ProductOption,
  type VendorMappingRow,
  type VendorOption,
} from "./types";

const productSelect =
  "id, sku, name, color, size, gender, base_uom, is_active";
const modelSkuSelect = "id, sku, name, color, size, base_uom, is_active";
const mappingSelect = `
  id,
  vendor_id,
  vendor_sku,
  vendor_product_name,
  vendor_uom,
  internal_product_id,
  conversion_factor,
  created_at,
  product:products(${productSelect})
`;

function normalizeProduct(
  product: ProductOption | ProductOption[] | null | undefined,
): ProductOption | null {
  if (!product) return null;
  return Array.isArray(product) ? (product[0] ?? null) : product;
}

export function flattenMappingRow(
  row: VendorMappingRow,
): FlattenedVendorMapping {
  return {
    ...row,
    product: normalizeProduct(row.product),
  };
}

export { applyVendorSkuPattern } from "./lib/bulk-mapping";

function resolveColorCode(
  colorName: string | null | undefined,
  nameToCode: Map<string, string>,
): string | null {
  const raw = (colorName ?? "").trim();
  if (!raw) return null;

  if (/^[A-Za-z]{3}$/.test(raw)) {
    return raw.toUpperCase();
  }

  const fromMaster = nameToCode.get(raw.toLocaleLowerCase("th"));
  if (fromMaster) return fromMaster.toUpperCase();

  const paren = raw.match(/\(([A-Za-z]{2,3})\)\s*$/);
  if (paren?.[1]) return paren[1].toUpperCase();

  return null;
}

/**
 * @deprecated Import `getActiveVendors` from `@/lib/actions/mapping` directly.
 */
export async function fetchVendors(): Promise<{
  data: VendorOption[];
  error: string | null;
}> {
  return getActiveVendors();
}

/**
 * Fetch product_models for a vendor, JOIN products (nested grouping source).
 * Enriches each SKU with color_code from mst_colors (matched by color name).
 */
export async function fetchModelsByVendor(vendorId: string): Promise<{
  data: ProductModelGroup[];
  error: string | null;
}> {
  if (!vendorId) return { data: [], error: null };

  const [modelsResult, colorsResult] = await Promise.all([
    supabase
      .from("product_models")
      .select(
        `
      id,
      model_code,
      name,
      short_name,
      status,
      vendor_id,
      products(${modelSkuSelect})
    `,
      )
      .eq("vendor_id", vendorId)
      .order("model_code", { ascending: true }),
    getColors(),
  ]);

  if (modelsResult.error) {
    return {
      data: [],
      error:
        modelsResult.error.code === "42P01"
          ? "ยังไม่มีตาราง product_models — รัน sql/product_models.sql ก่อน"
          : modelsResult.error.message,
    };
  }

  const nameToCode = new Map<string, string>();
  for (const row of colorsResult.data ?? []) {
    const name = row.color_name.trim();
    const code = row.color_code.trim().toUpperCase();
    if (name && code) {
      nameToCode.set(name.toLocaleLowerCase("th"), code);
    }
  }

  type RawProduct = {
    id: string;
    sku: string;
    name: string;
    color: string | null;
    size: string | null;
    base_uom: string | null;
    is_active: boolean;
  };

  type RawModel = {
    id: string;
    model_code: string;
    name: string;
    short_name: string | null;
    status: string | null;
    vendor_id: string | null;
    products: RawProduct[] | null;
  };

  const models: ProductModelGroup[] = (
    (modelsResult.data ?? []) as RawModel[]
  ).map((row) => ({
    id: row.id,
    model_code: row.model_code,
    name: row.name,
    short_name: row.short_name,
    status: row.status,
    vendor_id: row.vendor_id,
    products: (row.products ?? [])
      .filter((product) => product.is_active !== false)
      .map((product) => {
        const sizeLabel = (product.size ?? "").trim() || null;
        return {
          id: product.id,
          sku: product.sku,
          name: product.name,
          color: product.color,
          color_code: resolveColorCode(product.color, nameToCode),
          size: sizeLabel,
          size_code: sizeLabel,
          base_uom: product.base_uom,
          is_active: product.is_active,
        } satisfies ModelSku;
      })
      .sort((left, right) => left.sku.localeCompare(right.sku, "th")),
  }));

  return { data: models, error: null };
}

export async function fetchMappingsByVendor(vendorId: string): Promise<{
  data: FlattenedVendorMapping[];
  error: string | null;
}> {
  if (!vendorId) return { data: [], error: null };

  const { data, error } = await supabase
    .from("vendor_product_mapping")
    .select(mappingSelect)
    .eq("vendor_id", vendorId)
    .order("created_at", { ascending: false });

  if (error) return { data: [], error: error.message };

  return {
    data: ((data ?? []) as VendorMappingRow[]).map(flattenMappingRow),
    error: null,
  };
}

export async function createVendorMapping(
  input: CreateVendorMappingInput,
): Promise<{
  data: FlattenedVendorMapping | null;
  error: string | null;
  code?: string;
}> {
  const vendorSku = input.vendorSku.trim();
  const vendorProductName = input.vendorProductName.trim();
  const vendorUom = input.vendorUom?.trim() || null;

  if (!input.vendorId) {
    return { data: null, error: "กรุณาเลือกผู้จำหน่าย" };
  }
  if (!input.internalProductId) {
    return { data: null, error: "กรุณาเลือกสินค้าภายใน" };
  }
  if (!vendorSku) {
    return { data: null, error: "กรุณาระบุรหัสสินค้าของโรงงาน (vendor_sku)" };
  }

  const { data, error } = await supabase
    .from("vendor_product_mapping")
    .insert({
      vendor_id: input.vendorId,
      vendor_sku: vendorSku,
      vendor_product_name: vendorProductName || null,
      vendor_uom: vendorUom,
      internal_product_id: input.internalProductId,
      conversion_factor: input.conversionFactor ?? 1,
    })
    .select(mappingSelect)
    .single();

  if (error) {
    if (error.code === "23505") {
      return {
        data: null,
        error: DUPLICATE_VENDOR_SKU_MESSAGE,
        code: "23505",
      };
    }
    return { data: null, error: error.message, code: error.code };
  }

  return {
    data: flattenMappingRow(data as VendorMappingRow),
    error: null,
  };
}

/**
 * Bulk insert vendor mappings.
 * Tries batch insert first; on 23505 falls back to row-by-row (skip duplicates).
 */
export async function bulkInsertVendorMappings(
  rows: BulkMappingInsertRow[],
): Promise<BulkMappingResult> {
  if (rows.length === 0) {
    return { inserted: 0, skipped: 0, error: null };
  }

  const { error } = await supabase.from("vendor_product_mapping").insert(rows);

  if (!error) {
    return { inserted: rows.length, skipped: 0, error: null };
  }

  if (error.code !== "23505") {
    return { inserted: 0, skipped: 0, error: error.message };
  }

  // Unique violation on batch → insert individually, skip duplicates
  let inserted = 0;
  let skipped = 0;

  for (const row of rows) {
    const { error: rowError } = await supabase
      .from("vendor_product_mapping")
      .insert(row);

    if (!rowError) {
      inserted += 1;
      continue;
    }

    if (rowError.code === "23505") {
      skipped += 1;
      continue;
    }

    return {
      inserted,
      skipped,
      error: rowError.message,
    };
  }

  return { inserted, skipped, error: null };
}

export async function deleteVendorMapping(mappingId: string): Promise<{
  error: string | null;
}> {
  const { error } = await supabase
    .from("vendor_product_mapping")
    .delete()
    .eq("id", mappingId);

  return { error: error?.message ?? null };
}

/** @deprecated flat product list — kept for compatibility */
export async function fetchProducts(): Promise<{
  data: ProductOption[];
  error: string | null;
}> {
  const { data, error } = await supabase
    .from("products")
    .select(productSelect)
    .eq("is_active", true)
    .order("sku", { ascending: true });

  if (error) return { data: [], error: error.message };
  return { data: (data ?? []) as ProductOption[], error: null };
}
