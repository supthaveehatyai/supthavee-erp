const SHORT_SIZE_TOKENS = new Set([
  "s",
  "m",
  "l",
  "xl",
  "2xl",
  "3xl",
  "4xl",
  "5xl",
]);

export type SmartSkuSearchItem = {
  sku?: string | null;
  name?: string | null;
  product_name?: string | null;
  color?: string | null;
  size?: string | null;
  vendor_sku?: string | null;
};

/**
 * Multi-token search across SKU, name, color, size, and vendor SKU.
 * Size words are stripped so "HA003SUGRN size L" matches a SKU plus size L.
 */
export function matchesSmartSkuSearch(
  item: SmartSkuSearchItem,
  rawQuery: string,
): boolean {
  if (!rawQuery.trim()) return true;

  const tokens = rawQuery
    .toLowerCase()
    .replace(/\b(size|ไซส์|ไซด์|สี|เบอร์)\b/gi, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  const haystack = [
    item.sku,
    item.name,
    item.product_name,
    item.color,
    item.size,
    item.vendor_sku,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return tokens.every((token) => {
    if (SHORT_SIZE_TOKENS.has(token)) {
      return (
        (item.size != null && item.size.toLowerCase() === token) ||
        haystack.includes(token)
      );
    }
    return haystack.includes(token);
  });
}
