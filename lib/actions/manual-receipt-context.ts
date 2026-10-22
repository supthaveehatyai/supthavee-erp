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
import { createClient as createSupabaseAdmin } from "@/lib/supabase/server-admin";
import type {
  GetManualReceiptVendorContextResult,
  VendorMappedReceiptProduct,
} from "@/types/manual-receipt";

type MappedProductRow = {
  vendor_sku: string;
  purchase_uom_code: string | null;
  conversion_factor: number | null;
  products:
    | {
        id: string;
        sku: string;
        name: string;
        cost_price: number | null;
        retail_price: number | null;
        base_uom: string | null;
        is_active: boolean | null;
        tax_type: string | null;
        product_models:
          | {
              name: string | null;
              image_url: string | null;
              is_service: boolean | null;
              is_raw_material: boolean | null;
              tax_type: string | null;
            }
          | Array<{
              name: string | null;
              image_url: string | null;
              is_service: boolean | null;
              is_raw_material: boolean | null;
              tax_type: string | null;
            }>
          | null;
      }
    | Array<{
        id: string;
        sku: string;
        name: string;
        cost_price: number | null;
        retail_price: number | null;
        base_uom: string | null;
        is_active: boolean | null;
        tax_type: string | null;
        product_models:
          | {
              name: string | null;
              image_url: string | null;
              is_service: boolean | null;
              is_raw_material: boolean | null;
              tax_type: string | null;
            }
          | null;
      }>
    | null;
};

function first<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function isDocType(value: string): value is GoodsReceiptDocType {
  return (GOODS_RECEIPT_DOC_TYPES as readonly string[]).includes(value);
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
    const [contactResult, historyResult, mappingResult] = await Promise.all([
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
      supabase
        .from("vendor_product_mapping")
        .select(
          `
          vendor_sku,
          purchase_uom_code,
          conversion_factor,
          products:internal_product_id (
            id,
            sku,
            name,
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
        .eq("vendor_id", id)
        .limit(80),
    ]);

    if (contactResult.error) return { data: null, error: contactResult.error.message };
    if (historyResult.error) return { data: null, error: historyResult.error.message };
    if (mappingResult.error) return { data: null, error: mappingResult.error.message };

    const products: VendorMappedReceiptProduct[] = [];
    const taxVotes: string[] = [];
    for (const row of (mappingResult.data ?? []) as MappedProductRow[]) {
      const product = first(row.products);
      if (!product || product.is_active === false) continue;
      const model = first(product.product_models);
      if (model?.is_service) continue;
      const tax = product.tax_type || model?.tax_type || null;
      if (tax) taxVotes.push(tax);
      products.push({
        id: product.id,
        sku: product.sku,
        display_name: product.name,
        unit_price: Number(product.retail_price ?? 0),
        cost_price: Number(product.cost_price ?? 0),
        model_name: model?.name ?? null,
        color_name: null,
        size_label: null,
        base_uom: product.base_uom,
        image_url: model?.image_url ?? null,
        is_service: false,
        is_raw_material: model?.is_raw_material === true,
        vendor_sku: row.vendor_sku,
        purchase_uom_code: row.purchase_uom_code,
        conversion_factor:
          row.conversion_factor == null ? null : Number(row.conversion_factor),
      });
    }

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
