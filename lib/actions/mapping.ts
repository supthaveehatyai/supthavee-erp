"use server";

import { revalidatePath } from "next/cache";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

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

/** SKU row nested under a product model (minimal join fields). */
export type ModelProductSku = {
  id: string;
  sku: string;
  color: string | null;
  size: string | null;
  name: string;
};

/** SKU with existing vendor mapping (if any). */
export type MappedProductSku = ModelProductSku & {
  vendor_sku: string | null;
  mapping_id: string | null;
};

/** product_models row with nested products for a given vendor. */
export type VendorProductModel = {
  id: string;
  model_code: string;
  name: string;
  short_name: string | null;
  status: string | null;
  vendor_id: string | null;
  is_active: boolean | null;
  products: ModelProductSku[];
};

/** product_models + products + existing vendor_sku mapping. */
export type VendorMappingModel = Omit<VendorProductModel, "products"> & {
  products: MappedProductSku[];
};

export type GetModelsByVendorResult = {
  data: VendorProductModel[];
  error: string | null;
};

/** Flat vendor_product_mapping row with joined internal product (for list UI). */
export type ExistingVendorMapping = {
  id: string;
  vendor_id: string;
  vendor_sku: string;
  vendor_product_name: string | null;
  vendor_uom: string | null;
  internal_product_id: string;
  conversion_factor: number | null;
  created_at: string | null;
  product: {
    id: string;
    sku: string;
    name: string;
    color: string | null;
    size: string | null;
  } | null;
};

export type GetVendorMappingDataResult = {
  /** Nested models → SKUs (with vendor_sku prefilled when mapped). */
  data: VendorMappingModel[];
  /** ALL existing mappings for this vendor (flat list for bottom table). */
  existingMappings: ExistingVendorMapping[];
  error: string | null;
};

export type BulkUpsertMappingInput = {
  vendor_id: string;
  vendor_sku: string;
  internal_product_id: string;
};

export type BulkUpsertVendorMappingResult = {
  data: Array<{
    id: string;
    vendor_id: string;
    vendor_sku: string;
    internal_product_id: string;
  }>;
  upserted: number;
  error: string | null;
};

/* -------------------------------------------------------------------------- */
/* Raw row shapes                                                             */
/* -------------------------------------------------------------------------- */

type RawProductRow = {
  id: string;
  sku: string;
  color: string | null;
  size: string | null;
  name: string;
};

type RawModelRow = {
  id: string;
  model_code: string;
  name: string;
  short_name: string | null;
  status: string | null;
  vendor_id: string | null;
  is_active: boolean | null;
  products: RawProductRow[] | RawProductRow | null;
};

type RawVendorMappingRow = {
  id: string;
  vendor_id: string;
  vendor_sku: string;
  internal_product_id: string;
};

type RawExistingMappingRow = {
  id: string;
  vendor_id: string;
  vendor_sku: string;
  vendor_product_name: string | null;
  vendor_uom: string | null;
  internal_product_id: string;
  conversion_factor: number | null;
  created_at: string | null;
  product:
    | {
        id: string;
        sku: string;
        name: string;
        color: string | null;
        size: string | null;
      }
    | {
        id: string;
        sku: string;
        name: string;
        color: string | null;
        size: string | null;
      }[]
    | null;
};

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function asArray<T>(value: T[] | T | null | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function normalizeProducts(
  products: RawProductRow[] | RawProductRow | null | undefined,
): ModelProductSku[] {
  return asArray(products)
    .map((row) => ({
      id: row.id,
      sku: row.sku,
      color: row.color,
      size: row.size,
      name: row.name,
    }))
    .sort((a, b) => a.sku.localeCompare(b.sku, "th"));
}

function mergeMappingsOntoProducts(
  products: ModelProductSku[],
  mappingByProductId: Map<string, RawVendorMappingRow>,
): MappedProductSku[] {
  return products.map((product) => {
    const mapping = mappingByProductId.get(product.id);
    return {
      ...product,
      vendor_sku: mapping?.vendor_sku ?? null,
      mapping_id: mapping?.id ?? null,
    };
  });
}

function normalizeExistingMappings(
  rows: RawExistingMappingRow[],
): ExistingVendorMapping[] {
  return rows.map((row) => {
    const productRaw = row.product;
    const product = Array.isArray(productRaw)
      ? (productRaw[0] ?? null)
      : (productRaw ?? null);

    return {
      id: row.id,
      vendor_id: row.vendor_id,
      vendor_sku: row.vendor_sku,
      vendor_product_name: row.vendor_product_name,
      vendor_uom: row.vendor_uom,
      internal_product_id: row.internal_product_id,
      conversion_factor: row.conversion_factor,
      created_at: row.created_at,
      product,
    };
  });
}

function emptyVendorMappingResult(
  error: string,
): GetVendorMappingDataResult {
  return { data: [], existingMappings: [], error };
}

/* -------------------------------------------------------------------------- */
/* getActiveVendors                                                           */
/* -------------------------------------------------------------------------- */

export type VendorOption = {
  id: string;
  company_name: string;
};

export type GetActiveVendorsResult = {
  data: VendorOption[];
  error: string | null;
};

/**
 * Fetch active Vendor contacts via service-role admin client (bypasses RLS).
 * Never uses anon / SSR clients.
 */
export async function getActiveVendors(): Promise<GetActiveVendorsResult> {
  try {
    // Strict: service-role only — same pattern as bulkUpsertVendorMapping
    const supabaseAdmin = createSupabaseAdminClient();

    const { data, error } = await supabaseAdmin
      .from("contacts")
      .select("id, company_name")
      .contains("contact_roles", ["Vendor"])
      .eq("is_active", true)
      .order("company_name", { ascending: true });

    if (error) {
      return { data: [], error: error.message };
    }

    // Always return a real array — never undefined
    const vendors = Array.isArray(data) ? (data as VendorOption[]) : [];
    return { data: vendors, error: null };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "ไม่สามารถโหลดรายการ Vendor ได้";
    return { data: [], error: message };
  }
}

/* -------------------------------------------------------------------------- */
/* getVendorMappingData                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Fetch product_models for a vendor, join products (internal SKUs),
 * attach existing vendor_sku onto each SKU, and return a separate flat list
 * of ALL vendor_product_mapping rows for the bottom "รายการจับคู่" table.
 *
 * Uses service-role client (bypasses RLS) — same pattern as bulkUpsertVendorMapping.
 */
export async function getVendorMappingData(
  vendorId: string,
): Promise<GetVendorMappingDataResult> {
  const trimmedId = vendorId?.trim() ?? "";
  if (!trimmedId) {
    return emptyVendorMappingResult("กรุณาระบุ vendorId");
  }

  try {
    const supabaseAdmin = createSupabaseAdminClient();

    const [modelsResult, mappingsResult] = await Promise.all([
      supabaseAdmin
        .from("product_models")
        .select(
          `
          id,
          model_code,
          name,
          short_name,
          status,
          vendor_id,
          is_active,
          products (
            id,
            sku,
            color,
            size,
            name
          )
        `,
        )
        .eq("vendor_id", trimmedId)
        .order("model_code", { ascending: true }),
      supabaseAdmin
        .from("vendor_product_mapping")
        .select(
          `
          id,
          vendor_id,
          vendor_sku,
          vendor_product_name,
          vendor_uom,
          internal_product_id,
          conversion_factor,
          created_at,
          product:products (
            id,
            sku,
            name,
            color,
            size
          )
        `,
        )
        .eq("vendor_id", trimmedId)
        .order("created_at", { ascending: false }),
    ]);

    if (modelsResult.error) {
      if (modelsResult.error.code === "42P01") {
        return emptyVendorMappingResult(
          "ยังไม่มีตาราง product_models — รัน migration ก่อน",
        );
      }
      return emptyVendorMappingResult(modelsResult.error.message);
    }

    if (mappingsResult.error) {
      if (mappingsResult.error.code === "42P01") {
        return emptyVendorMappingResult(
          "ยังไม่มีตาราง vendor_product_mapping — รัน migration ก่อน",
        );
      }
      return emptyVendorMappingResult(mappingsResult.error.message);
    }

    const rawMappings = (mappingsResult.data ?? []) as RawExistingMappingRow[];
    const existingMappings = normalizeExistingMappings(rawMappings);

    const mappingByProductId = new Map<string, RawVendorMappingRow>();
    for (const row of existingMappings) {
      if (!mappingByProductId.has(row.internal_product_id)) {
        mappingByProductId.set(row.internal_product_id, {
          id: row.id,
          vendor_id: row.vendor_id,
          vendor_sku: row.vendor_sku,
          internal_product_id: row.internal_product_id,
        });
      }
    }

    const data: VendorMappingModel[] = (
      (modelsResult.data ?? []) as RawModelRow[]
    ).map((row) => ({
      id: row.id,
      model_code: row.model_code,
      name: row.name,
      short_name: row.short_name,
      status: row.status,
      vendor_id: row.vendor_id,
      is_active: row.is_active,
      products: mergeMappingsOntoProducts(
        normalizeProducts(row.products),
        mappingByProductId,
      ),
    }));

    return { data, existingMappings, error: null };
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : "ไม่สามารถโหลดข้อมูล vendor mapping ได้";
    return emptyVendorMappingResult(message);
  }
}

/* -------------------------------------------------------------------------- */
/* getModelsByVendor (compat wrapper)                                         */
/* -------------------------------------------------------------------------- */

/**
 * @deprecated Prefer getVendorMappingData — kept for BulkMatrixMappingUI compat.
 */
export async function getModelsByVendor(
  vendorId: string,
): Promise<GetModelsByVendorResult> {
  const result = await getVendorMappingData(vendorId);
  if (result.error) {
    return { data: [], error: result.error };
  }

  const data: VendorProductModel[] = result.data.map((model) => ({
    id: model.id,
    model_code: model.model_code,
    name: model.name,
    short_name: model.short_name,
    status: model.status,
    vendor_id: model.vendor_id,
    is_active: model.is_active,
    products: model.products.map(
      ({ id, sku, color, size, name }): ModelProductSku => ({
        id,
        sku,
        color,
        size,
        name,
      }),
    ),
  }));

  return { data, error: null };
}

/* -------------------------------------------------------------------------- */
/* bulkUpsertVendorMapping                                                    */
/* -------------------------------------------------------------------------- */

function mapUpsertError(error: {
  code?: string;
  message: string;
}): string {
  if (error.code === "42P01") {
    return "ยังไม่มีตาราง vendor_product_mapping — รัน migration ก่อน";
  }
  if (error.code === "23503") {
    return "vendor_id หรือ internal_product_id ไม่พบในระบบ";
  }
  if (error.code === "23505") {
    return "รหัส Vendor SKU ซ้ำกับรายการอื่น — ตรวจสอบการจับคู่ซ้ำ";
  }
  if (error.code === "42501" || /permission denied/i.test(error.message)) {
    return "permission denied — ตรวจว่า SUPABASE_SERVICE_ROLE_KEY ถูกตั้งค่าถูกต้อง (ไม่ใช่ anon key)";
  }
  return error.message || "บันทึก vendor mapping ไม่สำเร็จ";
}

/**
 * Bulk upsert into vendor_product_mapping (Overwrite-safe).
 *
 * 1) ลบ mapping เดิมของสินค้าในชุดที่บันทึก (vendor_id + internal_product_id)
 *    เพื่อให้การเปลี่ยน Vendor SKU เป็นการเขียนทับ ไม่เหลือแถวเก่าค้าง
 * 2) UPSERT ด้วย onConflict `vendor_id,vendor_sku` อัปเดต `internal_product_id`
 * 3) revalidatePath เสมอเมื่อสำเร็จ — ห้ามคืน success เมื่อมี error
 *
 * Uses service-role client only (bypasses RLS).
 */
export async function bulkUpsertVendorMapping(
  mappings: BulkUpsertMappingInput[],
): Promise<BulkUpsertVendorMappingResult> {
  if (!Array.isArray(mappings) || mappings.length === 0) {
    return { data: [], upserted: 0, error: "ไม่มีรายการ mapping ให้บันทึก" };
  }

  const rows: BulkUpsertMappingInput[] = [];
  const seen = new Set<string>();

  for (const item of mappings) {
    const vendorId = item.vendor_id?.trim() ?? "";
    const vendorSku = item.vendor_sku?.trim() ?? "";
    const productId = item.internal_product_id?.trim() ?? "";

    if (!vendorId || !vendorSku || !productId) {
      return {
        data: [],
        upserted: 0,
        error:
          "แต่ละแถวต้องมี vendor_id, vendor_sku และ internal_product_id ที่ไม่ว่าง",
      };
    }

    const key = `${vendorId}::${vendorSku}`;
    if (seen.has(key)) {
      // Last write wins within the same batch (same vendor_sku)
      const index = rows.findIndex(
        (row) =>
          row.vendor_id === vendorId && row.vendor_sku === vendorSku,
      );
      if (index >= 0) {
        rows[index] = {
          vendor_id: vendorId,
          vendor_sku: vendorSku,
          internal_product_id: productId,
        };
      }
      continue;
    }

    seen.add(key);
    rows.push({
      vendor_id: vendorId,
      vendor_sku: vendorSku,
      internal_product_id: productId,
    });
  }

  try {
    const supabaseAdmin = createSupabaseAdminClient();

    // Group by vendor — overwrite stale product bindings before upsert
    const productIdsByVendor = new Map<string, string[]>();
    for (const row of rows) {
      const list = productIdsByVendor.get(row.vendor_id) ?? [];
      if (!list.includes(row.internal_product_id)) {
        list.push(row.internal_product_id);
      }
      productIdsByVendor.set(row.vendor_id, list);
    }

    for (const [vendorId, productIds] of productIdsByVendor) {
      const { error: deleteError } = await supabaseAdmin
        .from("vendor_product_mapping")
        .delete()
        .eq("vendor_id", vendorId)
        .in("internal_product_id", productIds);

      if (deleteError) {
        return {
          data: [],
          upserted: 0,
          error: mapUpsertError(deleteError),
        };
      }
    }

    const { data, error } = await supabaseAdmin
      .from("vendor_product_mapping")
      .upsert(
        rows.map((row) => ({
          vendor_id: row.vendor_id,
          vendor_sku: row.vendor_sku,
          internal_product_id: row.internal_product_id,
          conversion_factor: 1,
        })),
        {
          onConflict: "vendor_id,vendor_sku",
          ignoreDuplicates: false,
        },
      )
      .select("id, vendor_id, vendor_sku, internal_product_id");

    if (error) {
      return {
        data: [],
        upserted: 0,
        error: mapUpsertError(error),
      };
    }

    const upsertedRows = (data ?? []) as BulkUpsertVendorMappingResult["data"];

    // Guard: never report success when no rows were written
    if (upsertedRows.length === 0) {
      return {
        data: [],
        upserted: 0,
        error:
          "บันทึกไม่สำเร็จ — ไม่มีแถวถูกอัปเดตในฐานข้อมูล (ตรวจ unique constraint vendor_id,vendor_sku)",
      };
    }

    if (upsertedRows.length < rows.length) {
      return {
        data: [],
        upserted: 0,
        error: `บันทึกไม่ครบ — คาดหวัง ${rows.length} แถว แต่ได้ ${upsertedRows.length} แถว`,
      };
    }

    revalidatePath("/dashboard/procurement/vendor-mapping");
    revalidatePath("/procurement/vendor-mapping");

    return {
      data: upsertedRows,
      upserted: upsertedRows.length,
      error: null,
    };
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : "ไม่สามารถบันทึก vendor mapping ได้";
    return { data: [], upserted: 0, error: message };
  }
}
