/**
 * Purchase UoM → Base UoM conversion (Raw Materials / Manufactured).
 * Example: buy 1 ROLL, consume in Meters → factor 50
 *   ledger_qty = purchase_qty × factor
 *   unit_cost_base = purchase_unit_cost ÷ factor
 *
 * Precision: NUMERIC(…,4) via roundTo4Decimals — prevents GAAP float leakage.
 */

import { roundTo4Decimals } from "@/lib/utils/accounting";

export type PurchaseUomConversionInput = {
  /** Quantity on the purchase document (purchasing UoM). */
  purchaseQty: number;
  /** Unit cost in purchasing UoM (e.g. landed cost per roll). */
  purchaseUnitCost: number;
  /** product_models.uom_conversion_factor — base units per 1 purchasing unit. */
  conversionFactor: number | null | undefined;
};

export type PurchaseUomConversionResult = {
  /** Factor applied (1 when conversion inactive). */
  factor: number;
  /** Quantity posted to inventory_ledger (base UoM). */
  ledgerQty: number;
  /** True unit cost in base UoM for LPP / Moving Average. */
  unitCostBase: number;
  /** True when factor was applied (> 1). */
  converted: boolean;
};

/**
 * Normalize conversion factor — only apply when finite and > 1.
 * Missing / ≤ 1 → treat as 1 (no conversion).
 */
export function normalizeUomConversionFactor(
  value: number | string | null | undefined,
): number {
  const n = Number(value ?? 1);
  if (!Number.isFinite(n) || n <= 0) return 1;
  const rounded = roundTo4Decimals(n);
  return rounded > 1 ? rounded : 1;
}

/**
 * Convert purchase-document qty/cost into base-UoM ledger qty + unit cost.
 */
export function applyPurchaseUomConversion(
  input: PurchaseUomConversionInput,
): PurchaseUomConversionResult {
  const purchaseQty = Number(input.purchaseQty);
  const purchaseUnitCost = Number(input.purchaseUnitCost);
  const safeQty =
    Number.isFinite(purchaseQty) && purchaseQty > 0 ? purchaseQty : 0;
  const safeCost =
    Number.isFinite(purchaseUnitCost) && purchaseUnitCost >= 0
      ? purchaseUnitCost
      : 0;

  const factor = normalizeUomConversionFactor(input.conversionFactor);
  if (factor <= 1) {
    return {
      factor: 1,
      ledgerQty: roundTo4Decimals(safeQty),
      unitCostBase: roundTo4Decimals(safeCost),
      converted: false,
    };
  }

  return {
    factor,
    ledgerQty: roundTo4Decimals(safeQty * factor),
    unitCostBase: roundTo4Decimals(safeCost / factor),
    converted: true,
  };
}
