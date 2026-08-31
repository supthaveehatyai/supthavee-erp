/**
 * Phase 15 — Landed Cost / Freight-In apportionment engine.
 * Pure TypeScript — no I/O, no UI dependencies.
 */

import {
  roundTo4Decimals,
  type ApportionmentVatType,
} from "@/lib/utils/accounting";

export type LandedCostVatType = ApportionmentVatType;

export type LandedCostLineInput = {
  id: string;
  qty: number;
  /** Net line total ex-VAT after discounts — weight for freight proration. */
  lineNetAmount: number;
  /** Net unit cost before freight (4 dp). */
  unitNetCost: number;
  isFoc?: boolean;
};

export type LandedCostLineResult = LandedCostLineInput & {
  /** Freight allocated to this line (ex-VAT, 2 dp) — `document_items.prorated_freight`. */
  proratedFreight: number;
  /** Freight per unit added on top of unitNetCost (4 dp). */
  freightPerUnit: number;
  /** unitNetCost + freightPerUnit — stamped to ledger / Moving Average engine. */
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

export type LandedCostOptions = {
  /** INCLUSIVE: strip VAT from freight before proration. EXCLUSIVE / NONE: as entered. */
  vatType?: LandedCostVatType | null;
  /** Percent, default 7. */
  vatRate?: number;
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
  vatType: LandedCostVatType,
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
 * Prorate header freight by each line's share of total net line value.
 *
 * Remainder Allocation: every eligible line except the last receives a rounded
 * share; the final eligible line absorbs the penny remainder so
 * Σ proratedFreight === freightAmount exactly (Decimal Leakage prevention).
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
 * Landed unit cost from prorated freight:
 * true_total_cost = line_net_amount + prorated_freight
 * landed_unit_cost = true_total_cost / qty
 */
export function calculateLandedUnitCostFromProration(
  lineNetAmount: number,
  proratedFreight: number,
  qty: number,
): number {
  const quantity = Math.max(0, Math.trunc(Number(qty) || 0));
  if (quantity <= 0) return 0;

  const lineNet = Number.isFinite(lineNetAmount) ? lineNetAmount : 0;
  const freight = Number.isFinite(proratedFreight)
    ? Math.max(0, proratedFreight)
    : 0;
  const trueTotalCost = lineNet + freight;

  return roundTo4Decimals(trueTotalCost / quantity);
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

  const blended = (oldQty * oldCost + newQty * landed) / (oldQty + newQty);
  return roundTo4Decimals(blended);
}

/**
 * Main entry — apportion header freight across receipt lines by relative net
 * line value, then derive per-unit landed cost for inventory_ledger /
 * Moving Average. Remainder pennies are absorbed by the last eligible line.
 */
export function calculateLandedCost(
  freightCost: number,
  lines: LandedCostLineInput[],
  options?: LandedCostOptions | null,
): LandedCostLineResult[] {
  const vatType: LandedCostVatType =
    options?.vatType === "INCLUSIVE" ||
    options?.vatType === "EXCLUSIVE" ||
    options?.vatType === "NONE"
      ? options.vatType
      : "NONE";
  const vatRate =
    typeof options?.vatRate === "number" && Number.isFinite(options.vatRate)
      ? Math.max(0, options.vatRate)
      : 7;

  const freightExVat = resolveFreightExVat(freightCost, vatType, vatRate);
  const proratedById = new Map(
    apportionFreightByNetValue(
      freightExVat,
      lines.map((line) => ({
        id: line.id,
        lineNetAmount: line.lineNetAmount,
        isFoc: line.isFoc,
      })),
    ).map((row) => [row.id, row.proratedFreight]),
  );

  return lines.map((line) => {
    if (line.isFoc) {
      return {
        ...line,
        proratedFreight: 0,
        freightPerUnit: 0,
        landedUnitCost: 0,
      };
    }

    if (line.qty <= 0 || line.lineNetAmount <= 0) {
      return {
        ...line,
        proratedFreight: 0,
        freightPerUnit: 0,
        landedUnitCost: roundTo4Decimals(line.unitNetCost),
      };
    }

    const proratedFreight = proratedById.get(line.id) ?? 0;
    const freightPerUnit = roundTo4Decimals(proratedFreight / line.qty);
    const landedUnitCost = roundTo4Decimals(line.unitNetCost + freightPerUnit);

    return {
      ...line,
      proratedFreight,
      freightPerUnit,
      landedUnitCost,
    };
  });
}
