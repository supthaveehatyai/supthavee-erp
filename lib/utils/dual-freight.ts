/**
 * Dual Freight-In — origin freight billed by the vendor vs destination freight
 * paid to a carrier. Inventory absorbs both (TAS 2). Vendor AP excludes destination freight.
 */

import type { VatCalculationType } from "@/lib/utils/document-summary";
import {
  money2,
  resolveReceiptVatTotals,
  type ReceiptVatTotals,
} from "@/lib/utils/purchase-tax";

export const FREIGHT_TAX_MODES = ["INCLUDED_IN_TAX", "SEPARATE_NON_VAT"] as const;

export type FreightTaxMode = (typeof FREIGHT_TAX_MODES)[number];

export const CARRIER_RECEIPT_STATUSES = ["PENDING", "RECEIVED"] as const;

export type CarrierReceiptStatus = (typeof CARRIER_RECEIPT_STATUSES)[number];

const FREIGHT_LINE_PATTERN = /ค่าส่ง|ค่าขนส่ง|ค่าจัดส่ง|freight|shipping/i;

export function isFreightTaxMode(value: string): value is FreightTaxMode {
  return (FREIGHT_TAX_MODES as readonly string[]).includes(value);
}

export function normalizeFreightTaxMode(
  value: string | null | undefined,
): FreightTaxMode {
  return isFreightTaxMode(String(value ?? "").trim())
    ? (String(value).trim() as FreightTaxMode)
    : "INCLUDED_IN_TAX";
}

/** Invoice rows such as "34223 ค่าส่ง" or "ค่าส่ง รวมกับบิลแรก" are freight, not stock. */
export function isOriginFreightText(
  sku: string | null | undefined,
  description?: string | null,
): boolean {
  const text = `${sku ?? ""} ${description ?? ""}`.replace(/\s+/g, " ").trim();
  if (!text) return false;
  return FREIGHT_LINE_PATTERN.test(text);
}

export function originFreightLineAmount(qty: number, unitPrice: number): number {
  const quantity = Number(qty);
  const price = Number(unitPrice);
  const safeQty = Number.isFinite(quantity) ? quantity : 0;
  const safePrice = Number.isFinite(price) ? Math.max(0, price) : 0;
  if (safeQty === 0) return money2(safePrice);
  return money2(Math.max(0, safeQty) * safePrice);
}

export function splitOriginFreightLines<T extends {
  raw_vendor_sku: string;
  raw_description?: string | null;
  qty: number;
  unit_price: number;
}>(
  items: T[],
  headerFreight = 0,
): { items: T[]; freightCost: number } {
  let freightCost = 0;
  const products: T[] = [];
  for (const item of items) {
    if (isOriginFreightText(item.raw_vendor_sku, item.raw_description)) {
      freightCost = money2(
        freightCost + originFreightLineAmount(item.qty, item.unit_price),
      );
      continue;
    }
    products.push(item);
  }
  const header = money2(headerFreight);
  return {
    items: products,
    freightCost: freightCost > 0 ? freightCost : header,
  };
}

/**
 * Vendor payable = goods + origin freight (+ VAT per mode).
 * SEPARATE_NON_VAT adds origin freight after VAT, so the freight is not taxed.
 * Destination freight is never included.
 */
export function computeVendorPayable(input: {
  goodsNet: number;
  originFreight: number;
  freightTaxMode: FreightTaxMode;
  vatType: VatCalculationType;
  manualVatAmount?: number | null;
}): ReceiptVatTotals {
  const goods = money2(input.goodsNet);
  const freight = money2(input.originFreight);
  if (input.freightTaxMode === "SEPARATE_NON_VAT") {
    const base = resolveReceiptVatTotals({
      netAfterDiscountAndFreight: goods,
      vatType: input.vatType,
      manualVatAmount: input.manualVatAmount,
    });
    return {
      ...base,
      grandTotal: money2(base.grandTotal + freight),
    };
  }
  return resolveReceiptVatTotals({
    netAfterDiscountAndFreight: money2(goods + freight),
    vatType: input.vatType,
    manualVatAmount: input.manualVatAmount,
  });
}

export type FreightDocumentColumns = {
  freight_cost: number;
  freight_tax_mode: FreightTaxMode;
  freight_paid_separately: boolean;
  separate_freight_amount: number;
  billing_note_eligible_amount: number;
  dest_freight_cost: number;
  carrier_id: string | null;
  carrier_tracking_no: string | null;
  dest_freight_paid_status: string | null;
  carrier_receipt_status: CarrierReceiptStatus | null;
  carrier_receipt_no: null;
  carrier_receipt_date: null;
};

export function buildFreightDocumentColumns(input: {
  originFreight: number;
  freightTaxMode: FreightTaxMode;
  destFreight: number;
  carrierId?: string | null;
  carrierTrackingNo?: string | null;
  vendorGrandTotal: number;
}): FreightDocumentColumns {
  const origin = money2(input.originFreight);
  const dest = money2(input.destFreight);
  const separate = input.freightTaxMode === "SEPARATE_NON_VAT";
  return {
    freight_cost: origin,
    freight_tax_mode: input.freightTaxMode,
    freight_paid_separately: separate,
    separate_freight_amount: separate ? origin : 0,
    billing_note_eligible_amount: money2(input.vendorGrandTotal),
    dest_freight_cost: dest,
    carrier_id: dest > 0 ? input.carrierId?.trim() || null : null,
    carrier_tracking_no: dest > 0 ? input.carrierTrackingNo?.trim() || null : null,
    dest_freight_paid_status: dest > 0 ? "UNPAID" : null,
    carrier_receipt_status: dest > 0 ? "PENDING" : null,
    carrier_receipt_no: null,
    carrier_receipt_date: null,
  };
}
