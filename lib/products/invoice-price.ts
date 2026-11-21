import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveBaseIncVatPrice } from "@/lib/utils/purchase-tax";

export type InvoicePricedProduct = {
  id: string;
  cost_price: number;
  base_net_cost_ex_vat?: number;
  base_inc_vat_price?: number;
  last_invoice_vat_mode?: string | null;
};

export function invoiceVatModeFromDocument(vatType: string): "INC_VAT" | "EXC_VAT" | "NONE" {
  const raw = vatType.trim().toUpperCase();
  if (raw === "INCLUSIVE" || raw === "INC_VAT") return "INC_VAT";
  if (raw === "EXCLUSIVE" || raw === "EXC_VAT") return "EXC_VAT";
  return "NONE";
}

export function billUnitPriceForVatMode(
  vatType: string,
  netCostExVat: number,
  incVatPrice: number,
): number {
  const raw = vatType.trim().toUpperCase();
  if (raw === "INCLUSIVE" || raw === "INC_VAT") return incVatPrice;
  return netCostExVat;
}

/** เติมราคาหน้าบิลจาก products โดยไม่เอา last_invoice_unit_price ไปแทนต้นทุนสต็อก */
export async function attachProductInvoicePrices(
  supabase: SupabaseClient,
  products: InvoicePricedProduct[],
): Promise<void> {
  const ids = [...new Set(products.map((product) => product.id).filter(Boolean))];
  const memory = new Map<string, { price: number; mode: string | null }>();
  for (let index = 0; index < ids.length; index += 400) {
    const chunk = ids.slice(index, index + 400);
    const { data, error } = await supabase
      .from("products")
      .select("id, last_invoice_unit_price, last_invoice_vat_mode")
      .in("id", chunk);
    if (error) return;
    for (const row of data ?? []) {
      memory.set(String(row.id), {
        price: Number(row.last_invoice_unit_price) || 0,
        mode: row.last_invoice_vat_mode ? String(row.last_invoice_vat_mode) : null,
      });
    }
  }
  for (const product of products) {
    const net = Number(product.cost_price) || 0;
    const remembered = memory.get(product.id);
    product.base_net_cost_ex_vat = net;
    product.base_inc_vat_price = resolveBaseIncVatPrice({
      netCostExVat: net,
      lastInvoiceUnitPrice: remembered?.price,
      lastInvoiceVatMode: remembered?.mode,
    });
    product.last_invoice_vat_mode = remembered?.mode ?? null;
  }
}

/**
 * จำราคาตามหน้าบิลแยกจาก cost_price
 * cost_price / inventory_ledger ต้องเป็นต้นทุนก่อน VAT เท่านั้น
 */
export async function stampProductInvoicePrices(
  supabase: SupabaseClient,
  input: {
    vatType: string;
    documentId?: string | null;
    lines: Array<{
      productId: string;
      invoiceUnitPrice: number;
      exVatUnitCost: number;
      sortOrder?: number | null;
    }>;
  },
): Promise<void> {
  const mode = invoiceVatModeFromDocument(input.vatType);
  const latest = new Map<string, number>();
  for (const line of input.lines) {
    const productId = line.productId.trim();
    if (!productId) continue;
    const invoicePrice = Number(line.invoiceUnitPrice);
    if (!Number.isFinite(invoicePrice) || invoicePrice < 0) continue;
    latest.set(productId, invoicePrice);
    const documentId = input.documentId?.trim();
    if (!documentId) continue;
    let update = supabase
      .from("document_items")
      .update({ unit_cost_ex_vat: Number(line.exVatUnitCost) || 0 })
      .eq("document_id", documentId)
      .eq("product_id", productId);
    if (line.sortOrder != null) update = update.eq("sort_order", line.sortOrder);
    const { error } = await update;
    if (error && error.code !== "42703") {
      console.error("[stampProductInvoicePrices] unit_cost_ex_vat", error.message);
    }
  }
  for (const [productId, invoicePrice] of latest) {
    const { error } = await supabase
      .from("products")
      .update({
        last_invoice_unit_price: invoicePrice,
        last_invoice_vat_mode: mode,
      })
      .eq("id", productId);
    if (error) {
      console.error("[stampProductInvoicePrices] products", error.message);
    }
  }
}
