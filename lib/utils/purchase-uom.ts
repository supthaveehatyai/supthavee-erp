import { roundTo4Decimals } from "@/lib/utils/accounting";

export const DEFAULT_PURCHASE_UOM_CODE = "PCS";

export type PurchaseUomOption = {
  uom_code: string;
  uom_name: string;
  default_multiplier: number;
  allow_custom_multiplier: boolean;
};

export const FALLBACK_PURCHASE_UOMS: PurchaseUomOption[] = [
  {
    uom_code: "PCS",
    uom_name: "ตัว",
    default_multiplier: 1,
    allow_custom_multiplier: false,
  },
];

const CUSTOM_MULTIPLIER_CODES = new Set(["CTN", "BOX", "PAC", "PACK"]);

export function resolveConversionFactor(
  value: number | string | null | undefined,
): number {
  const n = Number(value ?? 1);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return roundTo4Decimals(n);
}

export function stockBaseQty(qty: number, conversionFactor: number): number {
  const safeQty = Number(qty);
  if (!Number.isFinite(safeQty) || safeQty <= 0) return 0;
  return roundTo4Decimals(safeQty * resolveConversionFactor(conversionFactor));
}

export function netUnitCostPerBase(
  allocatedLineTotal: number,
  qty: number,
  conversionFactor: number,
): number {
  const baseQty = stockBaseQty(qty, conversionFactor);
  const total = Number(allocatedLineTotal);
  if (!Number.isFinite(total) || total < 0 || baseQty <= 0) return 0;
  return roundTo4Decimals(total / baseQty);
}

export function allowsCustomMultiplier(uom: PurchaseUomOption | undefined): boolean {
  if (!uom) return false;
  if (uom.allow_custom_multiplier) return true;
  return CUSTOM_MULTIPLIER_CODES.has(uom.uom_code.trim().toUpperCase());
}

export function uomOptionLabel(uom: PurchaseUomOption): string {
  const factor = resolveConversionFactor(uom.default_multiplier);
  const factorLabel = factor > 1 ? ` (x${factor})` : "";
  return `${uom.uom_code} — ${uom.uom_name}${factorLabel}`;
}

export function findPurchaseUom(
  catalog: PurchaseUomOption[],
  code: string | null | undefined,
): PurchaseUomOption | undefined {
  const key = String(code ?? "").trim().toUpperCase();
  if (!key) return undefined;
  return catalog.find(
    (uom) =>
      uom.uom_code.trim().toUpperCase() === key ||
      uom.uom_name.trim() === String(code ?? "").trim(),
  );
}

/** PCS unless the SKU base unit matches a catalog code or name (e.g. KGS). */
export function defaultPurchaseUom(
  catalog: PurchaseUomOption[],
  baseUom: string | null | undefined,
): { uomCode: string; conversionFactor: number } {
  const matched = findPurchaseUom(catalog, baseUom);
  const pcs = findPurchaseUom(catalog, DEFAULT_PURCHASE_UOM_CODE);
  const chosen = matched ?? pcs ?? catalog[0];
  if (!chosen) {
    return { uomCode: DEFAULT_PURCHASE_UOM_CODE, conversionFactor: 1 };
  }
  return {
    uomCode: chosen.uom_code,
    conversionFactor: resolveConversionFactor(chosen.default_multiplier),
  };
}
