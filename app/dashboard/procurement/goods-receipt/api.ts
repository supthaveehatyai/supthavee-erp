import { supabase } from "@/lib/supabase";
import { getVendors } from "@/lib/actions/master";
import { normalizeVendorSku } from "./lib/normalize-vendor-sku";
import type {
  CreateOnTheFlyMappingInput,
  ProductSummary,
  VendorMappingMatch,
  VendorOption,
} from "./types";

const productSelect =
  "id, sku, name, color, size, gender, base_uom, is_active";

const mappingSelect = `
  id,
  vendor_id,
  vendor_sku,
  vendor_product_name,
  vendor_uom,
  internal_product_id,
  conversion_factor,
  product:products(${productSelect})
`;

type MappingQueryRow = {
  id: string;
  vendor_id: string;
  vendor_sku: string;
  vendor_product_name: string | null;
  vendor_uom: string | null;
  internal_product_id: string;
  conversion_factor: number | null;
  product: ProductSummary | ProductSummary[] | null;
};

function normalizeProduct(
  product: ProductSummary | ProductSummary[] | null | undefined,
): ProductSummary | null {
  if (!product) return null;
  return Array.isArray(product) ? (product[0] ?? null) : product;
}

function toMappingMatch(row: MappingQueryRow): VendorMappingMatch {
  return {
    id: row.id,
    vendor_id: row.vendor_id,
    vendor_sku: row.vendor_sku,
    vendor_product_name: row.vendor_product_name,
    vendor_uom: row.vendor_uom,
    internal_product_id: row.internal_product_id,
    conversion_factor: row.conversion_factor,
    product: normalizeProduct(row.product),
  };
}

/**
 * Vendors (`contacts`) go through the `getVendors` Server Action —
 * Service Role Key bypasses RLS. Never fetched client-side (anon key hits
 * "permission denied" on this table).
 */
export async function fetchVendors(): Promise<{
  data: VendorOption[];
  error: string | null;
}> {
  const { data, error } = await getVendors();
  return { data, error };
}

export async function fetchActiveProducts(): Promise<{
  data: ProductSummary[];
  error: string | null;
}> {
  const { data, error } = await supabase
    .from("products")
    .select(productSelect)
    .eq("is_active", true)
    .order("sku", { ascending: true });

  if (error) return { data: [], error: error.message };
  return { data: (data ?? []) as ProductSummary[], error: null };
}

/**
 * Query vendor_product_mapping for a vendor + normalized SKU set.
 * Lookup key = normalizeVendorSku(vendor_sku) so OCR spacing/case still match.
 */
export async function fetchMappingsByNormalizedSkus(
  vendorId: string,
  normalizedSkus: string[],
): Promise<{
  data: Map<string, VendorMappingMatch>;
  error: string | null;
}> {
  const uniqueSkus = [
    ...new Set(normalizedSkus.map((sku) => normalizeVendorSku(sku)).filter(Boolean)),
  ];

  const empty = new Map<string, VendorMappingMatch>();
  if (!vendorId || uniqueSkus.length === 0) {
    return { data: empty, error: null };
  }

  const { data, error } = await supabase
    .from("vendor_product_mapping")
    .select(mappingSelect)
    .eq("vendor_id", vendorId)
    .in("vendor_sku", uniqueSkus);

  if (error) {
    return { data: empty, error: error.message };
  }

  const map = new Map<string, VendorMappingMatch>();
  for (const row of (data ?? []) as MappingQueryRow[]) {
    const match = toMappingMatch(row);
    map.set(normalizeVendorSku(match.vendor_sku), match);
  }

  // Fallback: if DB stored non-normalized SKUs, .in() may miss — rematch from vendor set
  const missing = uniqueSkus.filter((sku) => !map.has(sku));
  if (missing.length > 0) {
    const { data: allRows, error: fallbackError } = await supabase
      .from("vendor_product_mapping")
      .select(mappingSelect)
      .eq("vendor_id", vendorId);

    if (!fallbackError) {
      const wanted = new Set(missing);
      for (const row of (allRows ?? []) as MappingQueryRow[]) {
        const key = normalizeVendorSku(row.vendor_sku);
        if (wanted.has(key) && !map.has(key)) {
          map.set(key, toMappingMatch(row));
        }
      }
    }
  }

  return { data: map, error: null };
}

/** Insert on-the-fly mapping when staff resolves an unmapped OCR line */
export async function insertOnTheFlyMapping(
  input: CreateOnTheFlyMappingInput,
): Promise<{
  data: VendorMappingMatch | null;
  error: string | null;
  code?: string;
}> {
  const vendorSku = normalizeVendorSku(input.vendorSku);
  const vendorProductName = input.vendorProductName.trim();

  if (!input.vendorId) {
    return { data: null, error: "กรุณาเลือกผู้จำหน่าย" };
  }
  if (!input.internalProductId) {
    return { data: null, error: "กรุณาเลือกสินค้าภายใน" };
  }
  if (!vendorSku) {
    return { data: null, error: "รหัสสินค้าโรงงานว่างเปล่า" };
  }

  const { data, error } = await supabase
    .from("vendor_product_mapping")
    .insert({
      vendor_id: input.vendorId,
      vendor_sku: vendorSku,
      vendor_product_name: vendorProductName || null,
      vendor_uom: "ตัว",
      internal_product_id: input.internalProductId,
      conversion_factor: 1,
    })
    .select(mappingSelect)
    .single();

  if (error) {
    if (error.code === "23505") {
      return {
        data: null,
        error: "รหัสสินค้านี้ถูกผูกไว้กับ Vendor เจ้านี้แล้ว",
        code: "23505",
      };
    }
    return { data: null, error: error.message, code: error.code };
  }

  return { data: toMappingMatch(data as MappingQueryRow), error: null };
}

/** OCR line shape returned by Edge Function `process-receipt-ocr` */
export type {
  ProcessReceiptOcrLine,
  ProcessReceiptOcrMeta,
} from "./lib/upload-bill-ocr";

export {
  convertFileToBase64 as fileToBase64Payload,
  mapOcrLinesToReviewItems,
  postProcessReceiptOcr,
  uploadBillAndProcessOcr,
  reviewItemsToJsonText,
} from "./lib/upload-bill-ocr";

import {
  postProcessReceiptOcr,
  type ProcessReceiptOcrLine,
  type ProcessReceiptOcrMeta,
} from "./lib/upload-bill-ocr";

/** @deprecated Prefer {@link uploadBillAndProcessOcr} / {@link postProcessReceiptOcr} */
export async function processReceiptOcr(input: {
  vendorId: string;
  imageBase64: string;
  mimeType?: string;
}): Promise<{
  data: ProcessReceiptOcrLine[];
  meta: ProcessReceiptOcrMeta | null;
  error: string | null;
}> {
  const { lines, meta, error } = await postProcessReceiptOcr(input);
  return { data: lines, meta, error };
}
