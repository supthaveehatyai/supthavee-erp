/**
 * Purchase-document tax mode for Smart Goods Receipt.
 * Product master stores EXC_VAT / INC_VAT / NON_VAT.
 * Documents persist the same idea as vat_calculation_type: EXCLUSIVE / INCLUSIVE / NONE.
 */

import type { VatCalculationType } from "@/lib/utils/document-summary";

export const PURCHASE_TAX_MODES = ["EXC_VAT", "INC_VAT", "NON_VAT"] as const;

export type PurchaseTaxMode = (typeof PURCHASE_TAX_MODES)[number];

export type TaxModeSource = "ai" | "product" | "manual" | "vat-input";

const PURCHASE_VAT_RATE = 7;

export function money2(value: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Number(Math.max(0, n).toFixed(2));
}

/** products.tax_type first, then product_models.tax_type. */
export function resolveProductTaxCode(
  productTax: string | null | undefined,
  modelTax?: string | null,
): PurchaseTaxMode | null {
  return normalizePurchaseTaxMode(productTax) ?? normalizePurchaseTaxMode(modelTax);
}

export function normalizePurchaseTaxMode(
  value: string | null | undefined,
): PurchaseTaxMode | null {
  const raw = String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
  if (!raw) return null;
  if (raw === "EXC_VAT" || raw === "EXCLUSIVE" || raw === "EXC" || raw === "VAT_EXC") {
    return "EXC_VAT";
  }
  if (raw === "INC_VAT" || raw === "INCLUSIVE" || raw === "INC" || raw === "VAT_INC") {
    return "INC_VAT";
  }
  if (raw === "NON_VAT" || raw === "NONE" || raw === "NON" || raw === "NO_VAT") {
    return "NON_VAT";
  }
  return null;
}

export function purchaseTaxModeToVatType(mode: PurchaseTaxMode): VatCalculationType {
  if (mode === "EXC_VAT") return "EXCLUSIVE";
  if (mode === "INC_VAT") return "INCLUSIVE";
  return "NONE";
}

export function vatTypeToPurchaseTaxMode(vatType: VatCalculationType): PurchaseTaxMode {
  if (vatType === "EXCLUSIVE") return "EXC_VAT";
  if (vatType === "INCLUSIVE") return "INC_VAT";
  return "NON_VAT";
}

/**
 * Delivery notes often have no VAT line, so OCR returns NON_VAT.
 * When matched SKUs are taxable, inherit that mode (majority, else the first match).
 */
export function inheritVatTypeFromMatchedProducts(input: {
  currentVatType: VatCalculationType;
  productTaxCodes: Array<string | null | undefined>;
}): {
  vatType: VatCalculationType;
  inherited: boolean;
  productMode: PurchaseTaxMode | null;
} {
  if (input.currentVatType !== "NONE") {
    return { vatType: input.currentVatType, inherited: false, productMode: null };
  }

  const modes = input.productTaxCodes
    .map((code) => normalizePurchaseTaxMode(code))
    .filter((mode): mode is PurchaseTaxMode => mode === "EXC_VAT" || mode === "INC_VAT");

  if (modes.length === 0) {
    return { vatType: "NONE", inherited: false, productMode: null };
  }

  const exc = modes.filter((mode) => mode === "EXC_VAT").length;
  const inc = modes.filter((mode) => mode === "INC_VAT").length;
  const productMode: PurchaseTaxMode =
    exc > inc ? "EXC_VAT" : inc > exc ? "INC_VAT" : modes[0]!;

  return {
    vatType: purchaseTaxModeToVatType(productMode),
    inherited: true,
    productMode,
  };
}

export type ReceiptVatTotals = {
  preVatAmount: number;
  vatAmount: number;
  grandTotal: number;
  vatRate: number;
};

/**
 * TAS 2 purchase VAT.
 * EXC_VAT: VAT is added on top and is not part of inventory cost.
 * INC_VAT: strip VAT out of the bill amount before costing.
 */
export function resolveReceiptVatTotals(input: {
  netAfterDiscountAndFreight: number;
  vatType: VatCalculationType;
  /** When set on EXCLUSIVE, this replaces the automatic 7%. */
  manualVatAmount?: number | null;
}): ReceiptVatTotals {
  const net = money2(input.netAfterDiscountAndFreight);

  if (input.vatType === "INCLUSIVE") {
    const grandTotal = net;
    const preVatAmount = money2(grandTotal / (1 + PURCHASE_VAT_RATE / 100));
    const vatAmount = money2(grandTotal - preVatAmount);
    return { preVatAmount, vatAmount, grandTotal, vatRate: PURCHASE_VAT_RATE };
  }

  if (input.vatType === "EXCLUSIVE") {
    const preVatAmount = net;
    const autoVat = money2(preVatAmount * (PURCHASE_VAT_RATE / 100));
    const typed = input.manualVatAmount;
    const vatAmount =
      typed != null && Number.isFinite(Number(typed)) ? money2(Number(typed)) : autoVat;
    const grandTotal = money2(preVatAmount + vatAmount);
    return { preVatAmount, vatAmount, grandTotal, vatRate: PURCHASE_VAT_RATE };
  }

  return { preVatAmount: net, vatAmount: 0, grandTotal: net, vatRate: 0 };
}

/** Line amount that may enter stock cost. EXCLUSIVE keeps the ex-VAT total. */
export function exVatGoodsAmount(
  lineTotal: number,
  vatType: VatCalculationType,
): number {
  const amount = Number(lineTotal);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  if (vatType === "INCLUSIVE") {
    return Number((amount / (1 + PURCHASE_VAT_RATE / 100)).toFixed(2));
  }
  return amount;
}

export function purchaseTaxModeHint(
  source: TaxModeSource,
  mode: PurchaseTaxMode,
): string {
  if (source === "product") {
    return `(ดึงอัตโนมัติจากประเภทภาษีของสินค้า: ${mode})`;
  }
  if (source === "manual") return "(ผู้ใช้เลือกเอง)";
  if (source === "vat-input") return "(สลับเป็นภาษีนอกเพราะกรอก VAT Amount)";
  return "(อ่านจาก AI)";
}
