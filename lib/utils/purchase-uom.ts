import { roundTo4Decimals } from "@/lib/utils/accounting";

export const DEFAULT_PURCHASE_UOM_CODE = "PCS";

/**
 * Thai unit text printed on vendor bills → `mst_uom.uom_code`.
 * Trophy / medal bills use ใบ, เหรียญ, แผ่น, ป้าย, อัน.
 */
const PURCHASE_UOM_TEXT_ALIASES: Record<string, string> = {
  ใบ: "CUP",
  เหรียญ: "MDL",
  แผ่น: "PLT",
  ป้าย: "PLT",
  อัน: "UNT",
  ตัว: "PCS",
  ชิ้น: "PCS",
  โหล: "DZN",
  ล: "DZN",
  กิโล: "KGS",
  กิโลกรัม: "KGS",
  กก: "KGS",
  "ก.ก": "KGS",
  kg: "KGS",
  kgs: "KGS",
};

/** Map a printed unit or code (`ใบ`, `CUP`, `pcs`) to `mst_uom.uom_code`. */
export function resolvePurchaseUomCode(value: unknown): string {
  const raw = String(value ?? "")
    .trim()
    .replace(/[.\s]+$/g, "");
  if (!raw) return DEFAULT_PURCHASE_UOM_CODE;
  const alias =
    PURCHASE_UOM_TEXT_ALIASES[raw] ??
    PURCHASE_UOM_TEXT_ALIASES[raw.toLowerCase()];
  if (alias) return alias;
  const code = raw.toUpperCase();
  return code || DEFAULT_PURCHASE_UOM_CODE;
}

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
  {
    uom_code: "CUP",
    uom_name: "ใบ",
    default_multiplier: 1,
    allow_custom_multiplier: false,
  },
  {
    uom_code: "MDL",
    uom_name: "เหรียญ",
    default_multiplier: 1,
    allow_custom_multiplier: false,
  },
  {
    uom_code: "PLT",
    uom_name: "แผ่น",
    default_multiplier: 1,
    allow_custom_multiplier: false,
  },
  {
    uom_code: "UNT",
    uom_name: "อัน",
    default_multiplier: 1,
    allow_custom_multiplier: false,
  },
  {
    uom_code: "KGS",
    uom_name: "กิโลกรัม",
    default_multiplier: 1,
    allow_custom_multiplier: false,
  },
];

const CUSTOM_MULTIPLIER_CODES = new Set(["CTN", "BOX", "PAC", "PACK"]);
const PACK_MULTIPLIER_CODES = new Set(["DZN", "CTN", "BOX", "PAC", "PACK"]);

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

function unitFamily(value: string | null | undefined): string {
  const raw = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\./g, "");
  if (!raw) return "";
  if (raw === "kgs" || raw === "kg" || raw === "กก" || raw === "กิโล" || raw === "กิโลกรัม") {
    return "kgs";
  }
  if (raw === "pcs" || raw === "ตัว" || raw === "ชิ้น") return "pcs";
  if (raw === "cup" || raw === "ใบ") return "cup";
  if (raw === "mdl" || raw === "เหรียญ") return "mdl";
  if (raw === "plt" || raw === "แผ่น" || raw === "ป้าย") return "plt";
  if (raw === "unt" || raw === "อัน") return "unt";
  if (raw === "dzn" || raw === "โหล") return "dzn";
  return raw;
}

/**
 * Show the conversion box only for pack units (โหล / กล่อง).
 * A 1:1 purchase unit that already matches the stock unit (KGS → กิโลกรัม) stays hidden.
 */
export function showsPurchaseMultiplierInput(
  uom: PurchaseUomOption | undefined,
  conversionFactor: number,
  baseUnitLabel?: string | null,
): boolean {
  if (!uom) return false;
  const code = uom.uom_code.trim().toUpperCase();
  const factor = resolveConversionFactor(conversionFactor);
  const oneToOne = Math.abs(factor - 1) < 0.00005;
  const baseFamily = unitFamily(baseUnitLabel);
  const matchesBase =
    Boolean(baseFamily) &&
    (baseFamily === unitFamily(uom.uom_name) || baseFamily === unitFamily(code));
  if (PACK_MULTIPLIER_CODES.has(code)) return true;
  if (oneToOne && (matchesBase || !baseFamily)) return false;
  return allowsCustomMultiplier(uom);
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
