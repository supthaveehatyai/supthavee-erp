/**
 * Phase 15 — AP Freight-In / Landed Cost utilities.
 * Pure functions (no I/O) — used by Goods Receipt Server Actions.
 */

import {
  roundTo4Decimals,
  type ApportionmentVatType,
} from "@/lib/utils/accounting";
import type { VatCalculationType } from "@/lib/utils/document-summary";

export type LandedCostLineInput = {
  id: string;
  qty: number;
  /** Net unit cost after line/bill discounts, ex-VAT (4 dp). */
  unitCostPrice: number;
  /** Net line value ex-VAT — weight for freight proration (`line_net_amount`). */
  lineNetExVat: number;
  isFoc?: boolean;
};

export type LandedCostLineResult = LandedCostLineInput & {
  /** Freight allocated to this line (ex-VAT, 2 dp) — `document_items.prorated_freight`. */
  proratedFreight: number;
  /** Freight per unit added on top of unitCostPrice (4 dp). */
  freightPerUnit: number;
  /** unitCostPrice + freightPerUnit — stamped to ledger / MA engine. */
  landedUnitCost: number;
};

export type FreightNetValueLine = {
  id: string;
  lineNetAmount: number;
  isFoc?: boolean;
};

export type FreightNetValueResult = {
  id: string;
  proratedFreight: number;
};

function roundMoney2(value: number): number {
  return Math.round((Math.max(0, value) + Number.EPSILON) * 100) / 100;
}

/**
 * Strip VAT from freight when the entered amount follows INCLUSIVE doc pricing.
 * EXCLUSIVE / NONE: freight is already ex-VAT (or non-VAT).
 */
export function resolveFreightExVat(
  freightCost: number,
  vatType: VatCalculationType | ApportionmentVatType,
  vatRate: number,
): number {
  const amount = Number(freightCost);
  if (!Number.isFinite(amount) || amount <= 0) return 0;

  const rate =
    typeof vatRate === "number" && Number.isFinite(vatRate) && vatRate > 0
      ? vatRate
      : 7;

  if (vatType === "INCLUSIVE") {
    return roundTo4Decimals(amount / (1 + rate / 100));
  }
  return roundTo4Decimals(amount);
}

/**
 * Net Cost Apportionment Engine — prorate header freight by each line's share of
 * total net line value (`line_net_amount / Σ line_net_amount`).
 *
 * Remainder Allocation: every eligible line except the last receives a rounded
 * share; the final eligible line absorbs the penny remainder so
 * Σ proratedFreight === freightAmount exactly.
 */
export function apportionFreightByNetValue(
  freightAmount: number,
  lines: FreightNetValueLine[],
): FreightNetValueResult[] {
  const freightTotal = roundMoney2(freightAmount);
  const eligible = lines.filter(
    (line) => !line.isFoc && line.lineNetAmount > 0,
  );
  const totalNet = eligible.reduce((sum, line) => sum + line.lineNetAmount, 0);

  if (freightTotal <= 0 || totalNet <= 0) {
    return lines.map((line) => ({ id: line.id, proratedFreight: 0 }));
  }

  let allocated = 0;
  const lastEligibleId = eligible[eligible.length - 1]!.id;

  return lines.map((line) => {
    if (line.isFoc || line.lineNetAmount <= 0) {
      return { id: line.id, proratedFreight: 0 };
    }

    if (line.id === lastEligibleId) {
      return {
        id: line.id,
        proratedFreight: roundMoney2(freightTotal - allocated),
      };
    }

    const prorated = roundMoney2(
      freightTotal * (line.lineNetAmount / totalNet),
    );
    allocated += prorated;
    return { id: line.id, proratedFreight: prorated };
  });
}

/**
 * AP header sub_total before VAT:
 * Σ line_net_amount + freight_cost (header payload).
 */
export function calculateApSubTotalWithFreight(
  lineNetAmounts: number[],
  freightCost: number,
): number {
  const lineSum = lineNetAmounts.reduce(
    (sum, value) => sum + (Number.isFinite(value) ? value : 0),
    0,
  );
  const freight = Math.max(0, Number(freightCost) || 0);
  return roundMoney2(lineSum + freight);
}

/**
 * Prorate ex-VAT freight across receipt lines by relative net line value,
 * then derive per-unit landed cost for inventory_ledger / Moving Average.
 */
export function apportionFreightToLines(
  freightCost: number,
  lines: LandedCostLineInput[],
  vatType: VatCalculationType | ApportionmentVatType,
  vatRate: number,
): LandedCostLineResult[] {
  const freightExVat = resolveFreightExVat(freightCost, vatType, vatRate);
  const proratedById = new Map(
    apportionFreightByNetValue(
      freightExVat,
      lines.map((line) => ({
        id: line.id,
        lineNetAmount: line.lineNetExVat,
        isFoc: line.isFoc,
      })),
    ).map((row) => [row.id, row.proratedFreight]),
  );

  return lines.map((line) => {
    if (line.isFoc || line.qty <= 0 || line.lineNetExVat <= 0) {
      return {
        ...line,
        proratedFreight: 0,
        freightPerUnit: 0,
        landedUnitCost: roundTo4Decimals(line.unitCostPrice),
      };
    }

    const proratedFreight = proratedById.get(line.id) ?? 0;
    const freightPerUnit = roundTo4Decimals(proratedFreight / line.qty);
    const landedUnitCost = roundTo4Decimals(line.unitCostPrice + freightPerUnit);

    return {
      ...line,
      proratedFreight,
      freightPerUnit,
      landedUnitCost,
    };
  });
}

/**
 * Moving Average Cost — Phase 15 inventory valuation after freight-in receipt.
 *
 * new_avg = (on_hand_qty × current_avg + receipt_qty × landed_unit_cost)
 *           / (on_hand_qty + receipt_qty)
 */
export function calculateMovingAverageUnitCost(
  onHandQty: number,
  currentAvgCost: number,
  receiptQty: number,
  landedUnitCost: number,
): number {
  const oldQty = Math.max(0, Math.trunc(onHandQty));
  const newQty = Math.max(0, Math.trunc(receiptQty));
  const oldCost = Number.isFinite(currentAvgCost) ? currentAvgCost : 0;
  const landed = Number.isFinite(landedUnitCost) ? landedUnitCost : 0;

  if (newQty <= 0) return roundTo4Decimals(oldCost);
  if (oldQty <= 0) return roundTo4Decimals(landed);

  const blended =
    (oldQty * oldCost + newQty * landed) / (oldQty + newQty);
  return roundTo4Decimals(blended);
}
