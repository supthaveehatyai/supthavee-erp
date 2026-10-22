import { computeVendorPayable, normalizeFreightTaxMode } from "@/lib/utils/dual-freight";
import type { VatCalculationType } from "@/lib/utils/document-summary";

export const PURCHASE_VAT_REVISE_MODES = ["INC_VAT", "EXC_VAT", "NONE"] as const;

export type PurchaseVatReviseMode = (typeof PURCHASE_VAT_REVISE_MODES)[number];

export type PurchaseVatFigures = {
  preVatAmount: number;
  vatAmount: number;
  grandTotal: number;
  vatRate: number;
};

export function isPurchaseVatReviseMode(value: string): value is PurchaseVatReviseMode {
  return (PURCHASE_VAT_REVISE_MODES as readonly string[]).includes(value);
}

export function purchaseVatReviseModeToDocumentVat(
  mode: PurchaseVatReviseMode,
): VatCalculationType {
  if (mode === "INC_VAT") return "INCLUSIVE";
  if (mode === "EXC_VAT") return "EXCLUSIVE";
  return "NONE";
}

export function documentVatToPurchaseReviseMode(
  vatType: string | null | undefined,
): PurchaseVatReviseMode {
  if (vatType === "INCLUSIVE" || vatType === "INC_VAT") return "INC_VAT";
  if (vatType === "EXCLUSIVE" || vatType === "EXC_VAT") return "EXC_VAT";
  return "NONE";
}

export function previewPurchaseVatRevision(input: {
  goodsNet: number;
  originFreight: number;
  freightTaxMode?: string | null;
  mode: PurchaseVatReviseMode;
}): PurchaseVatFigures {
  const summary = computeVendorPayable({
    goodsNet: input.goodsNet,
    originFreight: input.originFreight,
    freightTaxMode: normalizeFreightTaxMode(input.freightTaxMode),
    vatType: purchaseVatReviseModeToDocumentVat(input.mode),
  });
  return {
    preVatAmount: summary.preVatAmount,
    vatAmount: summary.vatAmount,
    grandTotal: summary.grandTotal,
    vatRate: summary.vatRate,
  };
}
