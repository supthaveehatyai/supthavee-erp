/**
 * Phase 15 — re-exports from pure utils layer.
 * Server Actions import from here or `@/lib/utils/landed-cost` directly.
 */

import {
  calculateLandedCost,
  type LandedCostLineInput,
  type LandedCostVatType,
} from "@/lib/utils/landed-cost";
import type { VatCalculationType } from "@/lib/utils/document-summary";

export {
  apportionFreightByNetValue,
  calculateApSubTotalWithFreight,
  calculateLandedCost,
  calculateLandedUnitCostFromProration,
  calculateMovingAverageUnitCost,
  resolveFreightExVat,
  type FreightNetValueLine,
  type FreightNetValueResult,
  type LandedCostLineInput,
  type LandedCostLineResult,
  type LandedCostOptions,
  type LandedCostVatType,
} from "@/lib/utils/landed-cost";

/** @deprecated Use `LandedCostLineInput` — legacy field names for receipt pipeline. */
export type LegacyLandedCostLineInput = {
  id: string;
  qty: number;
  unitCostPrice: number;
  lineNetExVat: number;
  isFoc?: boolean;
};

export type LegacyLandedCostLineResult = LegacyLandedCostLineInput & {
  proratedFreight: number;
  freightPerUnit: number;
  landedUnitCost: number;
};

/**
 * Backward-compatible alias — maps legacy field names to `calculateLandedCost`.
 */
export function apportionFreightToLines(
  freightCost: number,
  lines: LegacyLandedCostLineInput[],
  vatType: VatCalculationType | LandedCostVatType,
  vatRate: number,
): LegacyLandedCostLineResult[] {
  const mapped: LandedCostLineInput[] = lines.map((line) => ({
    id: line.id,
    qty: line.qty,
    lineNetAmount: line.lineNetExVat,
    unitNetCost: line.unitCostPrice,
    isFoc: line.isFoc,
  }));

  const results = calculateLandedCost(freightCost, mapped, {
    vatType,
    vatRate,
  });

  return results.map((row) => ({
    id: row.id,
    qty: row.qty,
    unitCostPrice: row.unitNetCost,
    lineNetExVat: row.lineNetAmount,
    isFoc: row.isFoc,
    proratedFreight: row.proratedFreight,
    freightPerUnit: row.freightPerUnit,
    landedUnitCost: row.landedUnitCost,
  }));
}
