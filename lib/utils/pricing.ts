/**
 * Pricing utilities for Goods Receipt / document line costing.
 */

/** Result of net unit cost calculation for `doc_details.unit_cost_price`. */
export interface NetUnitCostResult {
  /** Net cost per unit after discount (2 d.p.) */
  unitCostPrice: number;
  /** Discount amount subtracted per unit (2 d.p.) */
  discountAmountPerUnit: number;
}

/**
 * Round a number to 2 decimal places using banker's-safe half-up via integer cents.
 */
function roundToTwoDecimals(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Parse a numeric token from discount text (strips spaces, percent sign, commas).
 * Returns `null` when the value is not a finite number.
 */
function parseDiscountNumber(raw: string): number | null {
  const cleaned = raw.replace(/[%\s,]/g, "").trim();
  if (!cleaned) return null;

  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  return value;
}

/**
 * Calculate the exact net unit cost from a vendor invoice unit price and discount text.
 *
 * Discount rules:
 * - Contains `%` → percentage off (e.g. `"40%"` of 289 → discount 115.60, net 173.40;
 *   supports decimals like `"41.8%"`).
 * - No `%` but a valid number → flat discount per unit (e.g. `"50"` off 289 → net 239).
 * - Empty / null / invalid → no discount; returns the original unit price.
 *
 * Outputs are rounded to 2 decimal places. Net cost is never negative (floored at 0).
 *
 * @param unitPrice - Raw unit price from OCR / invoice line
 * @param discountText - Discount string such as `"40%"`, `"41.8%"`, `"50"`, or empty
 * @returns `{ unitCostPrice, discountAmountPerUnit }`
 *
 * @example
 * calculateNetUnitCost(289, "40%")
 * // → { unitCostPrice: 173.4, discountAmountPerUnit: 115.6 }
 *
 * @example
 * calculateNetUnitCost(289, "50")
 * // → { unitCostPrice: 239, discountAmountPerUnit: 50 }
 */
export function calculateNetUnitCost(
  unitPrice: number,
  discountText: string | null,
): NetUnitCostResult {
  const safeUnitPrice =
    Number.isFinite(unitPrice) && unitPrice > 0 ? unitPrice : 0;

  const noDiscount = (): NetUnitCostResult => ({
    unitCostPrice: roundToTwoDecimals(safeUnitPrice),
    discountAmountPerUnit: 0,
  });

  if (!Number.isFinite(unitPrice)) {
    return { unitCostPrice: 0, discountAmountPerUnit: 0 };
  }

  const text = (discountText ?? "").trim();
  if (!text) {
    return noDiscount();
  }

  const isPercent = text.includes("%");
  const parsed = parseDiscountNumber(text);

  if (parsed === null || parsed < 0) {
    return noDiscount();
  }

  let discountAmountPerUnit: number;

  if (isPercent) {
    // Cap at 100% so net never goes below zero from percentage math alone
    const percent = Math.min(parsed, 100);
    discountAmountPerUnit = (safeUnitPrice * percent) / 100;
  } else {
    discountAmountPerUnit = parsed;
  }

  // Flat discount must not exceed unit price
  discountAmountPerUnit = Math.min(discountAmountPerUnit, safeUnitPrice);

  const unitCostPrice = Math.max(safeUnitPrice - discountAmountPerUnit, 0);

  return {
    unitCostPrice: roundToTwoDecimals(unitCostPrice),
    discountAmountPerUnit: roundToTwoDecimals(discountAmountPerUnit),
  };
}

/**
 * Dynamic `unit_cost_price` for `doc_details` / Goods Receipt lines.
 * Thin wrapper over {@link calculateNetUnitCost} when only the net price is needed.
 */
export function calculateUnitCostPrice(
  unitPrice: number,
  discountText: string | null,
): number {
  return calculateNetUnitCost(unitPrice, discountText).unitCostPrice;
}
