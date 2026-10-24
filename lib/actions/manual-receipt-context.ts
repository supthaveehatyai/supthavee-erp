"use server";

import { requireSessionUserId } from "@/lib/auth/current-user";
import {
  GOODS_RECEIPT_DOC_TYPES,
  type GoodsReceiptDocType,
} from "@/lib/constants/document";
import { normalizeFreightTaxMode, isFreightTaxMode } from "@/lib/utils/dual-freight";
import {
  normalizePurchaseTaxMode,
  purchaseTaxModeToVatType,
  type PurchaseTaxMode,
} from "@/lib/utils/purchase-tax";
import type { VatCalculationType } from "@/lib/utils/document-summary";
import { fetchAllPages } from "@/lib/supabase/fetch-all-pages";
import { createClient as createSupabaseAdmin } from "@/lib/supabase/server-admin";
import type { SalesProductSearchItem } from "@/types/document";
import type {
  GetManualReceiptVendorContextResult,
  GetSmartSkuPickerCatalogResult,
  VendorMappedReceiptProduct,
} from "@/types/manual-receipt";

function first<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function isDocType(value: string): value is GoodsReceiptDocType {
  return (GOODS_RECEIPT_DOC_TYPES as readonly string[]).includes(value);
}

type ProductModelJoin = {
  name: string | null;
  image_url: string | null;
  is_service: boolean | null;
  is_raw_material: boolean | null;
  tax_type: string | null;
  vendor_id?: string | null;
};

type CatalogProductRow = {
  id: string;
  sku: string;
  name: string | null;
  color: string | null;
  size: string | null;
  cost_price: number | null;
  retail_price: number | null;
  base_uom: string | null;
  is_active: boolean | null;
  tax_type: string | null;
  product_models: ProductModelJoin | ProductModelJoin[] | null;
};

type MappingCatalogRow = {
  vendor_sku: string;
  purchase_uom_code: string | null;
  conversion_factor: number | null;
  vendor_product_name: string | null;
  products: CatalogProductRow | CatalogProductRow[] | null;
};

function textValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function moneyValue(value: unknown): number {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? amount : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMissingVendorProductsRpc(error: { code?: string; message?: string }): boolean {
  const message = error.message ?? "";
  return (
    error.code === "PGRST202" ||
    /get_smart_sku_picker_vendor_products|does not exist|could not find the function|schema cache/i.test(
      message,
    )
  );
}

function toReceiptProduct(
  product: CatalogProductRow,
  model: ProductModelJoin | null,
  vendorSku: string,
  purchaseUomCode: string | null,
  conversionFactor: number | null,
): VendorMappedReceiptProduct {
  return {
    id: product.id,
    sku: product.sku,
    display_name: product.name?.trim() || product.sku,
    unit_price: moneyValue(product.retail_price),
    cost_price: moneyValue(product.cost_price),
    model_name: model?.name ?? null,
    color_name: textValue(product.color),
    size_label: textValue(product.size),
    base_uom: product.base_uom,
    image_url: model?.image_url ?? null,
    is_service: false,
    is_raw_material: model?.is_raw_material === true,
    vendor_sku: vendorSku,
    purchase_uom_code: purchaseUomCode,
    conversion_factor: conversionFactor,
  };
}

function mapRpcVendorProduct(row: Record<string, unknown>): VendorMappedReceiptProduct | null {
  const nested = first(
    (row.products ?? row.product) as CatalogProductRow | CatalogProductRow[] | null,
  );
  const id =
    textValue(row.id) ||
    textValue(row.product_id) ||
    textValue(row.internal_product_id) ||
    nested?.id ||
    "";
  const sku = textValue(row.sku) || nested?.sku || "";
  if (!id || !sku) return null;
  if (row.is_active === false || nested?.is_active === false) return null;
  if (row.is_service === true) return null;
  const model = nested ? first(nested.product_models) : null;
  if (model?.is_service) return null;
  const name =
    textValue(row.name) ||
    textValue(row.product_name) ||
    textValue(row.display_name) ||
    nested?.name ||
    sku;
  const color = textValue(row.color) || textValue(row.color_name) || textValue(nested?.color);
  const size = textValue(row.size) || textValue(row.size_label) || textValue(nested?.size);
  return {
    id,
    sku,
    display_name: name,
    unit_price: moneyValue(row.unit_price ?? row.retail_price ?? nested?.retail_price),
    cost_price: moneyValue(row.cost_price ?? nested?.cost_price),
    model_name: textValue(row.model_name) || model?.name || null,
    color_name: color,
    size_label: size,
    base_uom: textValue(row.base_uom) || nested?.base_uom || null,
    image_url: textValue(row.image_url) || model?.image_url || null,
    is_service: false,
    is_raw_material: row.is_raw_material === true || model?.is_raw_material === true,
    vendor_sku: textValue(row.vendor_sku) || "",
    purchase_uom_code: textValue(row.purchase_uom_code),
    conversion_factor:
      row.conversion_factor == null || row.conversion_factor === ""
        ? null
        : moneyValue(row.conversion_factor),
  };
}

function rpcRows(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data.filter(isRecord);
  if (!isRecord(data)) return [];
  if (Array.isArray(data.products)) return data.products.filter(isRecord);
  if (Array.isArray(data.data)) return data.data.filter(isRecord);
  return [];
}

async function enrichColorNames(
  supabase: ReturnType<typeof createSupabaseAdmin>,
  products: VendorMappedReceiptProduct[],
): Promise<void> {
  const codes = [
    ...new Set(
      products
        .map((product) => product.color_name?.trim().toUpperCase() ?? "")
        .filter(Boolean),
    ),
  ];
  if (codes.length === 0) return;
  const page = await fetchAllPages<{ color_code: string; color_name: string }>((from, to) =>
    supabase
      .from("mst_colors")
      .select("color_code, color_name")
      .in("color_code", codes)
      .order("color_code", { ascending: true })
      .range(from, to),
  );
  if (page.error) return;
  const nameByCode = new Map(
    page.data.map((row) => [
      String(row.color_code).trim().toUpperCase(),
      String(row.color_name).trim(),
    ]),
  );
  for (const product of products) {
    const code = product.color_name?.trim().toUpperCase() ?? "";
    const colorName = nameByCode.get(code);
    if (code && colorName && colorName.toUpperCase() !== code) {
      product.color_name = `${product.color_name} ${colorName}`;
    }
  }
}

async function loadVendorProductsFromTables(
  supabase: ReturnType<typeof createSupabaseAdmin>,
  vendorId: string,
): Promise<{ products: VendorMappedReceiptProduct[]; taxVotes: string[]; error: string | null }> {
  const [modelPage, mappingPage] = await Promise.all([
    fetchAllPages<CatalogProductRow>((from, to) =>
      supabase
        .from("products")
        .select(
          `
          id,
          sku,
          name,
          color,
          size,
          cost_price,
          retail_price,
          base_uom,
          is_active,
          tax_type,
          product_models!inner (
            name,
            image_url,
            is_service,
            is_raw_material,
            tax_type,
            vendor_id
          )
        `,
        )
        .eq("is_active", true)
        .eq("product_models.vendor_id", vendorId)
        .eq("product_models.is_service", false)
        .order("sku", { ascending: true })
        .range(from, to),
    ),
    fetchAllPages<MappingCatalogRow>((from, to) =>
      supabase
        .from("vendor_product_mapping")
        .select(
          `
          vendor_sku,
          purchase_uom_code,
          conversion_factor,
          vendor_product_name,
          products:internal_product_id (
            id,
            sku,
            name,
            color,
            size,
            cost_price,
            retail_price,
            base_uom,
            is_active,
            tax_type,
            product_models (
              name,
              image_url,
              is_service,
              is_raw_material,
              tax_type
            )
          )
        `,
        )
        .eq("vendor_id", vendorId)
        .order("vendor_sku", { ascending: true })
        .range(from, to),
    ),
  ]);

  if (modelPage.error) return { products: [], taxVotes: [], error: modelPage.error.message };
  if (mappingPage.error) {
    return { products: [], taxVotes: [], error: mappingPage.error.message };
  }

  const products: VendorMappedReceiptProduct[] = [];
  const taxVotes: string[] = [];
  const indexByProductId = new Map<string, number>();

  for (const product of modelPage.data) {
    if (product.is_active === false) continue;
    const model = first(product.product_models);
    if (model?.is_service) continue;
    const tax = product.tax_type || model?.tax_type || null;
    if (tax) taxVotes.push(tax);
    indexByProductId.set(product.id, products.length);
    products.push(toReceiptProduct(product, model, "", null, null));
  }

  for (const row of mappingPage.data) {
    const product = first(row.products);
    if (!product || product.is_active === false) continue;
    const model = first(product.product_models);
    if (model?.is_service) continue;
    const mapped = toReceiptProduct(
      product,
      model,
      row.vendor_sku,
      row.purchase_uom_code,
      row.conversion_factor == null ? null : Number(row.conversion_factor),
    );
    if (row.vendor_product_name?.trim()) {
      mapped.display_name = product.name?.trim() || row.vendor_product_name.trim();
    }
    const existingIndex = indexByProductId.get(product.id);
    if (existingIndex == null) {
      const tax = product.tax_type || model?.tax_type || null;
      if (tax) taxVotes.push(tax);
      indexByProductId.set(product.id, products.length);
      products.push(mapped);
      continue;
    }
    const existing = products[existingIndex];
    if (!existing.vendor_sku) {
      products[existingIndex] = mapped;
    }
  }

  products.sort((left, right) => left.sku.localeCompare(right.sku, "th"));
  await enrichColorNames(supabase, products);
  return { products, taxVotes, error: null };
}

async function loadVendorPickerProducts(
  supabase: ReturnType<typeof createSupabaseAdmin>,
  vendorId: string,
): Promise<{ products: VendorMappedReceiptProduct[]; taxVotes: string[]; error: string | null }> {
  const rpcClient = supabase as unknown as {
    rpc: (
      fn: "get_smart_sku_picker_vendor_products",
      args: { p_vendor_id: string },
    ) => Promise<{
      data: unknown;
      error: { code?: string; message?: string } | null;
    }>;
  };
  const { data, error } = await rpcClient.rpc("get_smart_sku_picker_vendor_products", {
    p_vendor_id: vendorId,
  });
  if (error && isMissingVendorProductsRpc(error)) {
    return loadVendorProductsFromTables(supabase, vendorId);
  }
  if (error) return { products: [], taxVotes: [], error: error.message ?? "โหลดสินค้าผู้จำหน่ายไม่สำเร็จ" };

  const products = rpcRows(data)
    .map((row) => {
      const tax = textValue(row.tax_type);
      return { product: mapRpcVendorProduct(row), tax };
    })
    .filter(
      (row): row is { product: VendorMappedReceiptProduct; tax: string | null } =>
        row.product != null,
    );
  const mapped = products
    .map((row) => row.product)
    .sort((left, right) => left.sku.localeCompare(right.sku, "th"));
  const taxVotes = products
    .map((row) => row.tax)
    .filter((tax): tax is string => Boolean(tax));
  await enrichColorNames(supabase, mapped);
  return { products: mapped, taxVotes, error: null };
}

export async function getManualReceiptVendorContext(
  vendorId: string,
): Promise<GetManualReceiptVendorContextResult> {
  try {
    const owner = await requireSessionUserId();
    if (!owner.ok) return { data: null, error: owner.error };
    const id = vendorId.trim();
    if (!id) return { data: null, error: "กรุณาเลือกผู้จำหน่าย" };

    const supabase = createSupabaseAdmin();
    const [contactResult, historyResult, productResult] = await Promise.all([
      supabase
        .from("contacts")
        .select("default_freight_tax_mode")
        .eq("id", id)
        .maybeSingle(),
      supabase
        .from("documents")
        .select("doc_type, vat_type")
        .eq("contact_id", id)
        .in("doc_type", [...GOODS_RECEIPT_DOC_TYPES])
        .order("doc_date", { ascending: false })
        .limit(1)
        .maybeSingle(),
      loadVendorPickerProducts(supabase, id),
    ]);

    if (contactResult.error) return { data: null, error: contactResult.error.message };
    if (historyResult.error) return { data: null, error: historyResult.error.message };
    if (productResult.error) return { data: null, error: productResult.error };

    const products = productResult.products;
    const taxVotes = productResult.taxVotes;

    const historyType = String(historyResult.data?.doc_type ?? "");
    const historyVat = normalizePurchaseTaxMode(String(historyResult.data?.vat_type ?? ""));
    const productMode = majorityTax(taxVotes);
    const vatType: VatCalculationType | null = historyVat
      ? purchaseTaxModeToVatType(historyVat)
      : productMode
        ? purchaseTaxModeToVatType(productMode)
        : null;
    const freightRaw = contactResult.data?.default_freight_tax_mode;
    const source = historyResult.data
      ? "จากเอกสารซื้อล่าสุดของผู้จำหน่าย"
      : productMode
        ? "จากภาษีสินค้าที่ผูกกับผู้จำหน่าย"
        : "ค่าเริ่มต้นของระบบ";

    return {
      data: {
        docType: isDocType(historyType) ? historyType : null,
        vatType,
        freightTaxMode: isFreightTaxMode(String(freightRaw ?? ""))
          ? normalizeFreightTaxMode(freightRaw)
          : null,
        source,
        products,
      },
      error: null,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "โหลดข้อมูลผู้จำหน่ายไม่สำเร็จ";
    return { data: null, error: message };
  }
}

export async function getSmartSkuPickerAllProducts(): Promise<GetSmartSkuPickerCatalogResult> {
  try {
    const owner = await requireSessionUserId();
    if (!owner.ok) return { data: [], error: owner.error };

    const supabase = createSupabaseAdmin();
    const page = await fetchAllPages<CatalogProductRow>((from, to) =>
      supabase
        .from("products")
        .select(
          `
          id,
          sku,
          name,
          color,
          size,
          cost_price,
          retail_price,
          base_uom,
          is_active,
          tax_type,
          product_models!inner (
            name,
            image_url,
            is_service,
            is_raw_material,
            tax_type
          )
        `,
        )
        .eq("is_active", true)
        .eq("product_models.is_service", false)
        .order("sku", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to),
    );
    if (page.error) return { data: [], error: page.error.message };

    const products: VendorMappedReceiptProduct[] = [];
    for (const product of page.data) {
      if (product.is_active === false) continue;
      const model = first(product.product_models);
      if (model?.is_service) continue;
      products.push(toReceiptProduct(product, model, "", null, null));
    }
    await enrichColorNames(supabase, products);
    const catalog: SalesProductSearchItem[] = products.map((product) => ({
      id: product.id,
      sku: product.sku,
      unit_price: product.unit_price,
      cost_price: product.cost_price,
      display_name: product.display_name,
      model_name: product.model_name,
      color_name: product.color_name,
      size_label: product.size_label,
      base_uom: product.base_uom,
      image_url: product.image_url,
      is_service: product.is_service,
      is_raw_material: product.is_raw_material,
    }));
    return { data: catalog, error: null };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "โหลดสินค้าทั้งคลังไม่สำเร็จ";
    return { data: [], error: message };
  }
}

function majorityTax(values: string[]): PurchaseTaxMode | null {
  const modes = values
    .map((value) => normalizePurchaseTaxMode(value))
    .filter((mode): mode is PurchaseTaxMode => mode != null);
  if (modes.length === 0) return null;
  const counts = new Map<PurchaseTaxMode, number>();
  for (const mode of modes) counts.set(mode, (counts.get(mode) ?? 0) + 1);
  let best: PurchaseTaxMode = modes[0];
  for (const [mode, count] of counts) {
    if (count > (counts.get(best) ?? 0)) best = mode;
  }
  return best;
}
