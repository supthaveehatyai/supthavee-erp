import type { ModelSku, ProductModelGroup } from "../types";
import { DEFAULT_VENDOR_SKU_PATTERN } from "../types";

export type VendorColorMap = Record<string, string>;

/**
 * Apply Vendor SKU Pattern tokens.
 * Supported: [MODEL], [COLOR], [SIZE] (case-insensitive).
 */
export function applyVendorSkuPattern(
  pattern: string,
  tokens: { MODEL: string; COLOR: string; SIZE: string },
): string {
  return pattern
    .replace(/\[MODEL\]/gi, tokens.MODEL)
    .replace(/\[COLOR\]/gi, tokens.COLOR)
    .replace(/\[SIZE\]/gi, tokens.SIZE)
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Extract unique internal color_code values from model SKUs
 * (e.g. BLK, NVY) — stable first-seen order.
 */
export function collectUniqueColorCodes(products: ModelSku[]): string[] {
  const seen = new Set<string>();
  const codes: string[] = [];

  for (const product of products) {
    const code = (product.color_code ?? "").trim().toUpperCase();
    if (!code || seen.has(code)) continue;
    seen.add(code);
    codes.push(code);
  }

  return codes;
}

/** Human label for a color_code row (includes Thai name when available). */
export function colorCodeLabel(
  colorCode: string,
  products: ModelSku[],
): string {
  const match = products.find(
    (item) => (item.color_code ?? "").trim().toUpperCase() === colorCode,
  );
  const name = match?.color?.trim();
  if (name && name.toUpperCase() !== colorCode) {
    return `${colorCode} · ${name}`;
  }
  return colorCode;
}

export function buildInitialVendorColorMap(
  model: ProductModelGroup,
): VendorColorMap {
  const map: VendorColorMap = {};
  for (const code of collectUniqueColorCodes(model.products)) {
    map[code] = "";
  }
  return map;
}

export { DEFAULT_VENDOR_SKU_PATTERN };
