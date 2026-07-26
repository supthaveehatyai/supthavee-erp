/**
 * Pure Vendor SKU pattern expander.
 *
 * Supports:
 * - Tokenized model:  "[MODEL]-[COLOR]-[SIZE]"  → uses product.model_code
 * - Hardcoded model:  "PL002-[COLOR]-[SIZE]"    → keeps "PL002" as-is
 *
 * @example
 * // Internal model token
 * generateVendorSKUs(
 *   [{ id: "p1", sku: "INT001-BLK-M", color: "BLK", size: "M", model_code: "INT001" }],
 *   "[MODEL]-[COLOR]-[SIZE]",
 *   { BLK: "DD" },
 * );
 * // => [{ internal_product_id: "p1", generated_vendor_sku: "INT001-DD-M" }]
 *
 * @example
 * // Vendor model code differs from internal — hardcode it in the pattern
 * generateVendorSKUs(
 *   [{ id: "p1", sku: "INT001-BLK-M", color: "BLK", size: "M", model_code: "INT001" }],
 *   "PL002-[COLOR]-[SIZE]",
 *   { BLK: "DD" },
 * );
 * // => [{ internal_product_id: "p1", generated_vendor_sku: "PL002-DD-M" }]
 *
 * @example
 * // Mixed / custom separators still preserve literal text
 * generateVendorSKUs(
 *   [{ id: "p2", sku: "INT001-WHT-L", color: "WHT", size: "L", model_code: "INT001" }],
 *   "VND_PL002_[COLOR]_[SIZE]",
 *   { WHT: "WH" },
 * );
 * // => [{ internal_product_id: "p2", generated_vendor_sku: "VND_PL002_WH_L" }]
 *
 * @example
 * // Unmapped color falls back to internal color
 * generateVendorSKUs(
 *   [{ id: "p3", sku: "X", color: "NVY", size: "L", model_code: "INT002" }],
 *   "PL002-[COLOR]-[SIZE]",
 *   { BLK: "DD" },
 * );
 * // => [{ internal_product_id: "p3", generated_vendor_sku: "PL002-NVY-L" }]
 */

/** Internal product row required by the generator. */
export type SkuGeneratorProduct = {
  /** products.id — becomes internal_product_id in the result */
  id: string;
  sku: string;
  /** Internal color key (e.g. BLK, WHT) looked up in colorMap */
  color: string | null;
  size: string | null;
  model_code: string;
};

export type GeneratedVendorSku = {
  internal_product_id: string;
  generated_vendor_sku: string;
};

/** Internal color code → vendor color code (e.g. { BLK: "DD", WHT: "WH" }) */
export type VendorColorMap = Record<string, string>;

export type SkuPatternTokens = {
  MODEL: string;
  COLOR: string;
  SIZE: string;
};

/** Fresh regex per call — avoids lastIndex bugs from `/g` reuse. */
function modelTokenRegex(): RegExp {
  return /\[MODEL\]/gi;
}

function colorTokenRegex(): RegExp {
  return /\[COLOR\]/gi;
}

function sizeTokenRegex(): RegExp {
  return /\[SIZE\]/gi;
}

function normalizeToken(value: string | null | undefined): string {
  return (value ?? "").trim();
}

/** True when the pattern includes a replaceable [MODEL] tag. */
export function patternHasModelToken(pattern: string): boolean {
  return modelTokenRegex().test(pattern);
}

/**
 * Resolve vendor color from colorMap using the internal color as key.
 * Tries exact key first, then uppercase. Falls back to the internal color.
 */
export function resolveVendorColor(
  internalColor: string | null | undefined,
  colorMap: VendorColorMap,
): string {
  const key = normalizeToken(internalColor);
  if (!key) return "";

  const exact = colorMap[key];
  if (typeof exact === "string" && exact.trim() !== "") {
    return exact.trim();
  }

  const upper = key.toUpperCase();
  const fromUpper = colorMap[upper];
  if (typeof fromUpper === "string" && fromUpper.trim() !== "") {
    return fromUpper.trim();
  }

  return key;
}

/**
 * Apply pattern tokens without destroying hardcoded literals.
 *
 * - If `[MODEL]` is present → replace with tokens.MODEL
 * - If `[MODEL]` is absent  → leave hardcoded text (e.g. "PL002") untouched
 * - Always replace `[COLOR]` and `[SIZE]` when present
 * - Any other characters (prefixes, separators, suffixes) are preserved exactly
 */
export function applySkuPattern(
  pattern: string,
  tokens: SkuPatternTokens,
): string {
  let result = pattern;

  // Only substitute when the tag exists — never invent/overwrite hardcoded model codes
  if (patternHasModelToken(result)) {
    result = result.replace(modelTokenRegex(), tokens.MODEL);
  }

  result = result
    .replace(colorTokenRegex(), tokens.COLOR)
    .replace(sizeTokenRegex(), tokens.SIZE);

  return result.trim().replace(/\s+/g, " ");
}

/**
 * Generate vendor SKUs for each internal product using a pattern + color map.
 *
 * Pattern variations:
 * - `"[MODEL]-[COLOR]-[SIZE]"` → model from `product.model_code`
 * - `"PL002-[COLOR]-[SIZE]"`   → keeps vendor model string `"PL002"` as-is
 * - `"ACME_[MODEL]_[COLOR]"`   → mix of literal prefix + tokens is fine
 */
export function generateVendorSKUs(
  products: SkuGeneratorProduct[],
  pattern: string,
  colorMap: VendorColorMap,
): GeneratedVendorSku[] {
  if (!Array.isArray(products) || products.length === 0) {
    return [];
  }

  const safePattern = pattern?.trim() || "[MODEL]-[COLOR]-[SIZE]";
  const safeColorMap: VendorColorMap = colorMap ?? {};

  return products.map((product): GeneratedVendorSku => {
    const tokens: SkuPatternTokens = {
      MODEL: normalizeToken(product.model_code),
      COLOR: resolveVendorColor(product.color, safeColorMap),
      SIZE: normalizeToken(product.size),
    };

    return {
      internal_product_id: product.id,
      generated_vendor_sku: applySkuPattern(safePattern, tokens),
    };
  });
}
